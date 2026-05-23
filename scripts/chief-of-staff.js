require('dotenv').config()
// chief-of-staff.js — BSV revenue-first daily brief. Runs at 8AM via launchd.
// North star: Did BSV make money yesterday? If not, why not, what changes today?
// Priority order: Revenue → Posts → Agent health → Growth → Drive doc

const Anthropic = require('@anthropic-ai/sdk').default
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { sendTelegram, fetchUpdates, parseInboxKeyword } = require('./telegram')
const {
  addPendingItem,
  readDecisionFromDrive,
  archiveDecision,
  loadPendingItems,
  savePendingItems,
} = require('./telegram-queue')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'chief-of-staff.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-chief-of-staff')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

const _now         = new Date()
const DATE_STAMP   = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`
const DAY_NAME     = _now.toLocaleDateString('en-US', { weekday: 'long' })
const DAY_OF_WEEK  = _now.getDay()
const HANDOFF_FILENAME = `BSV-Handoff-${DATE_STAMP}.md`

const DAILY_API_CEILING   = 2.00
const CLAUDE_INPUT_PER_M  = 3.00
const CLAUDE_OUTPUT_PER_M = 15.00

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function rcloneCopy(src, destDir) {
  execSync(`rclone copy "${src}" "${destDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function rcloneCopyTo(src, dest) {
  execSync(`rclone copyto "${src}" "${dest}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function loadDriveFile(remotePath, localDir) {
  try {
    rcloneCopy(remotePath, localDir)
    const local = path.join(localDir, path.basename(remotePath))
    return fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null
  } catch { return null }
}

function loadLatestReport(prefix, folder = 'Reports') {
  try {
    const files = execSync(`rclone ls "${REMOTE}/${folder}"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.startsWith(prefix + '-') && f.endsWith('.md'))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    const content = loadDriveFile(`${REMOTE}/${folder}/${latest}`, TEMP_DIR)
    return content ? { filename: latest, content } : null
  } catch { return null }
}

function loadLatestHandoff() {
  try {
    const listing = execSync(`rclone ls "${REMOTE}/Handoff"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] })
    const files = listing.trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^BSV-Handoff-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    const localPath = path.join(TEMP_DIR, latest)
    execSync(`rclone copy "${REMOTE}/Handoff/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe','pipe','pipe'] })
    return fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : null
  } catch { return null }
}

// ─── Priority 1: Revenue ──────────────────────────────────────────────────────
// Checks CJ commissions API (yesterday + rolling week) and affiliate link
// deployment in public/shop/index.html. Sets the action for today.

async function checkRevenue() {
  const result = {
    available:   false,
    error:       null,
    yesterday:   { commissions: 0, amount: 0 },
    week:        { commissions: 0, amount: 0 },
    linksDeployed: false,
    shopLinkCount: 0,
    action:      null,
  }

  const cjToken = process.env.CJ_API_TOKEN
  const cjCid   = process.env.CJ_CID

  if (cjToken && cjCid) {
    const xmlTag = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`)); return m ? m[1].trim() : null }
    const allBlocks = (xml, tag) => { const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'g'); return [...xml.matchAll(re)].map(m => m[0]) }

    const fetchCommissions = async (startDate, endDate) => {
      const url = `https://commissions.api.cj.com/v3/commissions?date-type=posting&start-date=${startDate}&end-date=${endDate}&website-id=${cjCid}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cjToken}`, Accept: 'application/xml' },
      })
      const xml = await res.text()
      if (!res.ok) throw new Error(`CJ API ${res.status}: ${xml.slice(0, 200)}`)
      const totalMatch = xml.match(/total-matched="(\d+)"/)
      const total = totalMatch ? parseInt(totalMatch[1]) : 0
      const blocks = allBlocks(xml, 'commission')
      const amount = blocks.reduce((sum, b) => {
        const a = xmlTag(b, 'commission-amount')
        return sum + (a ? parseFloat(a) : 0)
      }, 0)
      return { commissions: total, amount }
    }

    try {
      const yd = new Date(_now)
      yd.setDate(yd.getDate() - 1)
      const ydStr = yd.toISOString().slice(0, 10)
      const wkStart = new Date(_now)
      wkStart.setDate(wkStart.getDate() - 7)
      const wkStr   = wkStart.toISOString().slice(0, 10)
      const todayStr = DATE_STAMP

      const [ydData, wkData] = await Promise.all([
        fetchCommissions(ydStr, ydStr),
        fetchCommissions(wkStr, todayStr),
      ])
      result.available  = true
      result.yesterday  = ydData
      result.week       = wkData
    } catch (err) {
      result.error = err.message
    }
  } else {
    result.error = 'CJ_API_TOKEN or CJ_CID not set'
  }

  // Affiliate link presence in shop
  try {
    const shopHtml = fs.readFileSync(path.join(ROOT, 'public', 'shop', 'index.html'), 'utf8')
    const matches  = shopHtml.match(/amazon\.com[^"']*tag=|impact\.com|shareasale\.com|cj\.com\/redir/g) || []
    result.shopLinkCount  = matches.length
    result.linksDeployed  = matches.length > 0
  } catch {
    result.linksDeployed = false
  }

  // Action for today
  if (!result.linksDeployed) {
    result.action = 'Deploy affiliate links — approve products in the sheet, run sync-shop.js'
  } else if (result.available && result.yesterday.amount === 0) {
    result.action = 'Links live, zero conversions — post product content with a direct shop CTA today'
  } else if (!result.available) {
    result.action = 'Revenue data unavailable — verify CJ credentials, confirm links are live in shop'
  } else {
    result.action = `$${result.yesterday.amount.toFixed(2)} earned yesterday — add a second product to the shelf to diversify`
  }

  log(`Revenue: available=${result.available}, yesterday=$${result.yesterday.amount.toFixed(2)} (${result.yesterday.commissions}), week=$${result.week.amount.toFixed(2)} (${result.week.commissions}), links=${result.linksDeployed} (${result.shopLinkCount} in shop)`)
  if (result.error) log(`Revenue error: ${result.error}`)
  return result
}

// ─── Priority 2: Post confirmation ────────────────────────────────────────────
// Computes expected slots for yesterday (always) and today (if past post window).
// Post windows: -am fires after 10:00 local, -pm fires after 20:00 local.
// Also surfaces any slots stuck in media-only state (caption never arrived).

function checkPosts() {
  const ABBRS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const yd    = new Date(_now)
  yd.setDate(yd.getDate() - 1)
  const dayAbbr       = ABBRS[yd.getDay()]
  const yesterdayStr  = yd.toISOString().slice(0, 10)

  // Yesterday's slots are always expected
  const expectedSlots = [`${dayAbbr}-am`, `${dayAbbr}-pm`]

  // Today's slots are expected once their post window has passed locally
  const todayAbbr  = ABBRS[_now.getDay()]
  const localHour  = _now.getHours()
  const localMin   = _now.getMinutes()
  const localMins  = localHour * 60 + localMin
  if (localMins >= 10 * 60)  expectedSlots.push(`${todayAbbr}-am`)   // past 10:00 AM
  if (localMins >= 20 * 60)  expectedSlots.push(`${todayAbbr}-pm`)   // past 8:00 PM

  // post-state.json: [{slot, platform, postId, timestamp, status}]
  const succeededSlots = new Set()
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    if (fs.existsSync(p)) {
      const entries = JSON.parse(fs.readFileSync(p, 'utf8'))
      for (const e of Array.isArray(entries) ? entries : []) {
        if (e.status === 'success' && e.slot) succeededSlots.add(e.slot)
      }
    }
  } catch {}

  const stuckMediaSlots = []
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'watch-drive-state.json'), 'utf8'))
    for (const [slot, data] of Object.entries(raw)) {
      if (!slot.startsWith('_') && data?._media_alerted) stuckMediaSlots.push(slot)
    }
  } catch {}

  const confirmed = expectedSlots.filter(s => succeededSlots.has(s))
  const gaps      = expectedSlots.filter(s => !succeededSlots.has(s))

  log(`Posts: ${dayAbbr}/today — confirmed=${confirmed.join(',') || 'none'}, gaps=${gaps.join(',') || 'none'}, stuck media=${stuckMediaSlots.join(',') || 'none'}`)
  return { expectedSlots, confirmed, gaps, stuckMediaSlots, dayAbbr, yesterdayStr }
}

// ─── Priority 3: Agent health ─────────────────────────────────────────────────
// Scans every agent log for errors and staleness. Returns issues with fix
// commands. Essential agents get Telegram alerts on error.

const AGENT_ROSTER = [
  { name: 'watch-drive',       essential: true,  weekly: false },
  { name: 'eng-bot',           essential: true,  weekly: false },
  { name: 'media-director',    essential: true,  weekly: false },
  { name: 'creative-agent',    essential: true,  weekly: false },
  { name: 'distribute',        essential: false, weekly: false },
  { name: 'social-listening',  essential: false, weekly: false },
  { name: 'gemini-bridge',     essential: false, weekly: false },
  { name: 'image-gen',         essential: false, weekly: false },
  { name: 'video-gen',         essential: false, weekly: false },
  { name: 'update-handoff',    essential: false, weekly: false },
  { name: 'change-agent',      essential: true,  weekly: false },
  { name: 'brand-manager',     essential: false, weekly: true  },
  { name: 'marketing-manager', essential: false, weekly: true  },
  { name: 'product-research',  essential: false, weekly: true  },
  { name: 'cj-research',       essential: false, weekly: true  },
  { name: 'blog-agent',        essential: false, weekly: true  },
  { name: 'cost-report',       essential: false, weekly: false },
]

function checkAgentHealth() {
  const now    = Date.now()
  const issues = []
  const ok     = []

  for (const agent of AGENT_ROSTER) {
    const logPath = path.join(ROOT, 'logs', `${agent.name}.log`)

    if (!fs.existsSync(logPath)) {
      if (agent.essential) {
        issues.push({ name: agent.name, severity: 'error', msg: 'never run — log missing', fix: `node scripts/${agent.name}.js` })
      }
      continue
    }

    const ageMins  = (now - fs.statSync(logPath).mtimeMs) / 60000
    const staleMins = agent.weekly ? 7 * 24 * 60 : 120
    const isStale  = ageMins > staleMins && agent.essential

    // Read last 60 lines for errors and output signal
    let lastLines = []
    let errors    = []
    try {
      const content = fs.readFileSync(logPath, 'utf8')
      lastLines = content.trim().split('\n').slice(-60)
      errors    = lastLines.filter(l => /^\[[^\]]+\]\s*(ERROR|CRASH|FATAL)/i.test(l))
    } catch {}

    if (isStale) {
      issues.push({ name: agent.name, severity: 'warning', msg: `stale — ${Math.round(ageMins / 60)}h since last activity`, fix: `node scripts/${agent.name}.js` })
    } else if (errors.length) {
      const msg = errors[errors.length - 1].replace(/^\[[^\]]+\]\s*/, '').slice(0, 140)
      issues.push({ name: agent.name, severity: 'error', msg, fix: `node scripts/${agent.name}.js` })
    } else {
      ok.push(agent.name)
    }
  }

  // change-agent heartbeat check (separate from log error — it can log clean but go silent)
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'change-state.json'), 'utf8'))
    const heartbeat  = cs.last_heartbeat ? new Date(cs.last_heartbeat) : null
    const hoursSince = heartbeat ? (now - heartbeat.getTime()) / 3600000 : Infinity
    if (hoursSince > 25 && !issues.find(i => i.name === 'change-agent')) {
      issues.push({ name: 'change-agent', severity: 'warning', msg: `heartbeat ${Math.round(hoursSince)}h ago — change monitoring stale`, fix: 'node scripts/change-agent.js' })
      ok.splice(ok.indexOf('change-agent'), 1)
    }
  } catch {}

  log(`Agent health: ${ok.length} OK, ${issues.length} issue(s)`)
  for (const i of issues) log(`  [${i.severity}] ${i.name}: ${i.msg}`)
  return { ok, issues }
}

// ─── Priority 4: Growth ───────────────────────────────────────────────────────
// Parses the two most recent marketing reports for subscriber counts.
// Flags flat or declining trends with a specific recommendation.

function checkGrowth() {
  const result = { lounge: null, drop: null, total: null, trend: 'unknown', recommendation: null }

  const parseSubscribers = (content) => {
    if (!content) return null
    const lounge = content.match(/lounge[^:\n]*:\s*([\d,]+)/i)
    const drop   = content.match(/drop[^:\n]*:\s*([\d,]+)/i)
    return {
      lounge: lounge ? parseInt(lounge[1].replace(/,/g, '')) : null,
      drop:   drop   ? parseInt(drop[1].replace(/,/g, ''))   : null,
    }
  }

  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.startsWith('marketing-') && f.endsWith('.md'))
      .sort()

    if (!files.length) {
      result.trend = 'no marketing reports'
      result.recommendation = 'Run marketing-manager.js to establish subscriber baseline'
      return result
    }

    const loadReport = (f) => {
      try {
        execSync(`rclone copy "${REMOTE}/Reports/${f}" "${TEMP_DIR}/"`, { stdio: ['pipe','pipe','pipe'] })
        return fs.readFileSync(path.join(TEMP_DIR, f), 'utf8')
      } catch { return null }
    }

    const latestContent = loadReport(files[files.length - 1])
    const prevContent   = files.length >= 2 ? loadReport(files[files.length - 2]) : null

    const latest = parseSubscribers(latestContent)
    const prev   = parseSubscribers(prevContent)

    if (latest) {
      result.lounge = latest.lounge
      result.drop   = latest.drop
      result.total  = (latest.lounge || 0) + (latest.drop || 0)
    }

    if (latest && prev) {
      const latestN = (latest.lounge || 0) + (latest.drop || 0)
      const prevN   = (prev.lounge || 0) + (prev.drop || 0)
      const delta   = latestN - prevN
      if (delta > 0)      result.trend = `+${delta} vs last report`
      else if (delta < 0) { result.trend = `${delta} vs last report`; result.recommendation = 'Subscriber decline — check opt-out rates and post high-engagement content today' }
      else                { result.trend = 'flat vs last report'; result.recommendation = 'Flat growth — post a strong visual with a direct follow/subscribe CTA today' }
    } else {
      result.trend = 'only one report — no trend yet'
    }
  } catch (err) {
    log(`Growth check error: ${err.message}`)
    result.trend = `error: ${err.message.slice(0, 60)}`
  }

  log(`Growth: total=${result.total ?? 'unknown'} (lounge=${result.lounge ?? '?'}, drop=${result.drop ?? '?'}), trend=${result.trend}`)
  return result
}

// ─── Local state helpers ──────────────────────────────────────────────────────

function getRecentLog(filename, n = 80) {
  try {
    const p = path.join(ROOT, 'logs', filename)
    if (!fs.existsSync(p)) return null
    const all = fs.readFileSync(p, 'utf8').trim().split('\n')
    return all.slice(-n).join('\n')
  } catch { return null }
}

function getHandoffFindings() {
  try {
    const p = path.join(ROOT, 'logs', 'handoff-findings.md')
    if (!fs.existsSync(p)) return null
    return fs.readFileSync(p, 'utf8').trim() || null
  } catch { return null }
}

function getPostStateRaw() {
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function getOutputFiles() {
  try { return fs.readdirSync(path.join(ROOT, 'posts', 'output')).filter(f => !f.startsWith('.')).sort() }
  catch { return [] }
}

function getReadyToPost() {
  try {
    const out = execSync(`rclone ls --max-depth 1 "${REMOTE}/Ready to Post/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return out ? out.split('\n').map(l => l.trim().split(/\s+/).slice(1).join(' ')).filter(Boolean).join(', ') : '(empty)'
  } catch { return '(unavailable)' }
}

function getPostedLast24h() {
  const cutoffDate = new Date(_now.getTime() - 24 * 3600000).toISOString().slice(0, 10)
  try {
    const dirs = execSync(`rclone lsd "${REMOTE}/Posted/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const lines = []
    for (const line of dirs.split('\n')) {
      const folder = line.trim().split(/\s+/).pop()
      if (!folder || folder < cutoffDate) continue
      try {
        const files = execSync(`rclone ls "${REMOTE}/Posted/${folder}"`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        const names = files.split('\n').map(f => f.trim().split(/\s+/).slice(1).join(' ')).filter(Boolean)
        lines.push(`${folder}: ${names.join(', ')}`)
      } catch {}
    }
    return lines.join('\n') || '(nothing posted in last 24h)'
  } catch { return '(unavailable)' }
}

// ─── Token budget ─────────────────────────────────────────────────────────────

function buildTokenBudget() {
  const dayStart = new Date(_now)
  dayStart.setHours(0, 0, 0, 0)

  const LOGS = ['eng-bot','social-listening','media-director','brand-manager','marketing-manager',
    'product-development','product-research','change-agent','blog-agent','update-handoff','chief-of-staff',
    'resize-post','brand-image','brand-video']
  const breakdown = []

  for (const name of LOGS) {
    const p = path.join(ROOT, 'logs', `${name}.log`)
    if (!fs.existsSync(p)) continue
    let tokens = 0, calls = 0
    try {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const ts = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
        if (!ts || new Date(ts[1]) < dayStart) continue
        const m = line.match(/done[^\d]*(\d+)\s*(?:output\s+)?tokens/i)
        if (m) { tokens += parseInt(m[1], 10); calls++ }
      }
    } catch {}
    if (!calls) continue
    const cost = (tokens * 2 / 1_000_000) * CLAUDE_INPUT_PER_M + (tokens / 1_000_000) * CLAUDE_OUTPUT_PER_M
    breakdown.push({ name, calls, tokens, cost })
  }
  breakdown.sort((a, b) => b.cost - a.cost)

  const estTotal = breakdown.reduce((s, r) => s + r.cost, 0)
  let officialTotal = null
  try {
    for (const line of fs.readFileSync(path.join(ROOT, 'logs', 'cost-report.log'), 'utf8').split('\n').reverse()) {
      if (!line.includes(DATE_STAMP)) continue
      const m = line.match(/Today.*cost:\s*\$?([\d.]+)/i)
      if (m) { officialTotal = parseFloat(m[1]); break }
    }
  } catch {}

  return { breakdown, estTotal, officialTotal, reported: officialTotal ?? estTotal, pct: ((officialTotal ?? estTotal) / DAILY_API_CEILING) * 100 }
}

// ─── Two-way Telegram inbox ───────────────────────────────────────────────────
// Fetches new messages from Big D's Telegram replies, logs them, and dispatches
// keyword actions against the pending items queue.
// Replaces the Drive approval folder — Big D's phone is the approval interface.

async function processTelegramInbox() {
  log('Telegram inbox: fetching updates...')
  const messages = await fetchUpdates()
  if (!messages.length) { log('Telegram inbox: no new messages'); return }

  log(`Telegram inbox: ${messages.length} new message(s)`)
  const pending = loadPendingItems()
  let pendingChanged = false

  for (const msg of messages) {
    const keyword = parseInboxKeyword(msg.text)
    log(`Telegram inbox: "${msg.text}" → keyword=${keyword ?? 'none'}`)
    if (!keyword) continue

    // Apply to the oldest unresolved pending item in FIFO order
    const target = pending.find(i => !i._resolved)
    if (!target) { log('Telegram inbox: no pending items to resolve'); continue }

    log(`Telegram inbox: resolving ${target.id} → ${keyword}`)
    target._resolved  = true
    target._resolvedBy = 'telegram'
    target._resolvedAt = new Date().toISOString()
    target._decision   = keyword
    pendingChanged = true

    if (keyword === 'approved') {
      log(`  APPROVED: ${target.metadata?.title || target.id}`)
      if (target.type === 'chief') {
        const title = target.metadata?.title || ''
        const angle = target.metadata?.angle || ''
        const slug  = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        // Write directly to blog-calendar-queue so blog-agent picks it up next cycle
        const queuePath = path.join(ROOT, 'logs', 'blog-calendar-queue.json')
        let bQueue = []
        try { if (fs.existsSync(queuePath)) bQueue = JSON.parse(fs.readFileSync(queuePath, 'utf8')) } catch {}
        if (!bQueue.some(e => e.slug === slug)) {
          bQueue.push({ slug, title, angle, approvedAt: new Date().toISOString(), sourceId: target.id })
          fs.writeFileSync(queuePath, JSON.stringify(bQueue, null, 2))
          log(`  Lounge → blog-calendar-queue: "${title}" (${slug})`)
        }
        sendTelegram(`✅ Lounge content approved: "${title}"\nQueued for blog-agent next cycle.`).then(r => {
          if (r?.message_id) log(`Telegram approval confirm — message_id: ${r.message_id}`)
        })
      } else if (target.type === 'eng') {
        log(`  Fix approved — ${target.metadata?.fix}`)
        sendTelegram(`✅ Fix approved: ${target.metadata?.problem}\nFix: ${target.metadata?.fix}`).then(r => {
          if (r?.message_id) log(`Telegram fix confirm — message_id: ${r.message_id}`)
        })
      }
    } else if (keyword === 'denied') {
      log(`  DENIED: ${target.id}`)
      sendTelegram(`❌ Denied: ${target.metadata?.title || target.id}`).then(r => {
        if (r?.message_id) log(`Telegram deny confirm — message_id: ${r.message_id}`)
      })
    } else if (keyword === 'hold') {
      log(`  HOLD: ${target.id} — deferring to tomorrow`)
      target._resolved  = false  // unmark so it stays in queue
      target.remindAfter = new Date(Date.now() + 24 * 3600000).toISOString()
      pendingChanged = true
      sendTelegram(`⏸ Held: ${target.metadata?.title || target.id} — will resurface tomorrow.`).then(r => {
        if (r?.message_id) log(`Telegram hold confirm — message_id: ${r.message_id}`)
      })
    }
  }

  if (pendingChanged) {
    savePendingItems(pending.filter(i => !i._resolved))
    log('Telegram inbox: pending items updated')
  }
}

// ─── Chief inbox (Drive Inbox fallback) ───────────────────────────────────────

async function processChiefInbox(client) {
  try {
    let inboxFiles = []
    try {
      const listing = execSync(`rclone ls "${REMOTE}/Inbox"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] })
      inboxFiles = listing.trim().split('\n')
        .map(l => l.trim().split(/\s+/).slice(1).join(' '))
        .filter(f => /^chief-.+-decision\.md$/.test(f))
    } catch {}
    if (!inboxFiles.length) return
    log(`Inbox: ${inboxFiles.length} decision file(s)`)
    const allPending = loadPendingItems()
    for (const driveFile of inboxFiles) {
      const decision = readDecisionFromDrive(driveFile)
      if (!decision) continue
      log(`Inbox decision: ${driveFile} → ${decision.decision}`)
      const item = allPending.filter(i => i.type === 'chief').find(i => i.driveFile === driveFile)
      if (item) savePendingItems(loadPendingItems().filter(i => i.id !== item.id))
      archiveDecision(driveFile)
    }
  } catch (err) {
    log(`WARNING: processChiefInbox failed: ${err.message}`)
  }
}

// ─── Blog-agent staleness watchdog ────────────────────────────────────────────

async function watchBlogAgent() {
  try {
    const manifestPath = path.join(ROOT, 'public', 'sole-report', 'manifest.json')
    if (!fs.existsSync(manifestPath)) { log('WATCHDOG: blog-agent never published'); return }
    const manifest  = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const latest    = manifest[0]
    if (!latest) { log('WATCHDOG: blog-agent manifest empty'); return }
    const daysSince = (Date.now() - new Date(latest.date).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSince > 8) {
      log(`WATCHDOG: blog-agent stale — ${Math.round(daysSince)}d since "${latest.title}"`)
      sendTelegram(
        `⚠️ BSV — blog-agent stale\nLast article: "${latest.title}" (${latest.date}, ${Math.round(daysSince)}d ago)\nExpected weekly on Sundays.\nFix: node scripts/blog-agent.js`
      ).then(r => { if (r?.message_id) log(`Telegram blog-agent alert — message_id: ${r.message_id}`) })
    } else {
      log(`WATCHDOG: blog-agent OK — ${Math.round(daysSince)}d ago ("${latest.title}")`)
    }
  } catch (err) {
    log(`WATCHDOG: blog-agent check error: ${err.message}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ chief-of-staff start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const client  = new Anthropic({ apiKey })
  const outFile = `standup-${DATE_STAMP}.md`

  // Process Telegram replies first — Big D's phone is the approval interface
  await processTelegramInbox()
  await processChiefInbox(client)  // Drive inbox fallback (legacy)

  // ── P1: Revenue ───────────────────────────────────────────────────────────

  log('P1: Revenue...')
  const revenue = await checkRevenue()

  // ── P2: Posts ─────────────────────────────────────────────────────────────

  log('P2: Posts...')
  const posts = checkPosts()

  // ── P3: Agent health ──────────────────────────────────────────────────────

  log('P3: Agent health...')
  const agents = checkAgentHealth()

  // ── P4: Growth ────────────────────────────────────────────────────────────

  log('P4: Growth...')
  const growth = checkGrowth()

  // ── Supporting context ────────────────────────────────────────────────────

  const tokenBudget   = buildTokenBudget()
  const findings      = getHandoffFindings()
  const directive     = loadDriveFile(`${REMOTE}/BSV-Directive.md`, TEMP_DIR)
  const memory        = loadDriveFile(`${REMOTE}/BSV-Memory.md`, TEMP_DIR)
  const orgChart      = loadDriveFile(`${REMOTE}/BSV-Org.md`, TEMP_DIR)
  const handoff       = loadLatestHandoff()
  const watchLog      = getRecentLog('watch-drive.log', 80)
  const engBotLog     = getRecentLog('eng-bot.log', 30)
  const mediaLog      = getRecentLog('media-director.log', 30)
  const postStateRaw  = getPostStateRaw()
  const outputFiles   = getOutputFiles()
  const readyToPost   = getReadyToPost()
  const postedLast24h = getPostedLast24h()
  const socialReport  = loadLatestReport('social-report')
  const mktReport     = loadLatestReport('marketing')
  const productDevState = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'product-development-state.json')
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
    } catch { return null }
  })()
  const changeState = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'change-state.json')
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
    } catch { return null }
  })()
  const costState = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'cost-state.json')
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
    } catch { return null }
  })()
  const chiefDirective = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'strategy-active.md')
      if (!fs.existsSync(p)) return null
      const md = fs.readFileSync(p, 'utf8')
      const m  = md.match(/##\s+Chief Directive[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)
      return m ? m[1].trim() : null
    } catch { return null }
  })()

  log(`Context: directive=${!!directive}, strategy=${!!chiefDirective}, memory=${!!memory}, org=${!!orgChart}, handoff=${!!handoff}, social=${socialReport?.filename || 'none'}, marketing=${mktReport?.filename || 'none'}`)
  log(`Ready to Post: ${readyToPost}`)
  log(`Token budget: est $${tokenBudget.estTotal.toFixed(4)} (${tokenBudget.pct.toFixed(1)}% of $${DAILY_API_CEILING})`)

  // ── Standup Telegram — generated from data, not Claude ────────────────────
  // Format: exact spec. Revenue leads. One Telegram message is the full picture.

  const revenueYd = revenue.available
    ? `$${revenue.yesterday.amount.toFixed(2)} (${revenue.yesterday.commissions} commission${revenue.yesterday.commissions !== 1 ? 's' : ''})`
    : 'no data'
  const revenueWk = revenue.available
    ? ` | $${revenue.week.amount.toFixed(2)} this week`
    : ''
  const linkStatus = revenue.linksDeployed
    ? `✓ ${revenue.shopLinkCount} in shop`
    : `✗ NOT DEPLOYED`

  const postLine = `${posts.confirmed.length}/${posts.expectedSlots.length} confirmed`
    + (posts.gaps.length ? ` | ✗ missed: ${posts.gaps.join(', ')} — caption never arrived` : '')
    + (posts.stuckMediaSlots.length ? ` | stuck media: ${posts.stuckMediaSlots.join(', ')}` : '')

  const totalSubs  = growth.total != null ? growth.total.toLocaleString() : 'unknown'
  const audienceLine = `${totalSubs} total | ${growth.trend}`

  const blockerLines = []
  if (!revenue.linksDeployed) blockerLines.push('Affiliate links not in shop — zero revenue possible')
  if (posts.gaps.length)     blockerLines.push(`${posts.gaps.join(', ')} missed — caption files never uploaded to Drive`)
  if (posts.stuckMediaSlots.length) blockerLines.push(`Stuck media: ${posts.stuckMediaSlots.join(', ')}`)
  for (const i of agents.issues.filter(i => i.severity === 'error').slice(0, 2)) {
    blockerLines.push(`${i.name}: ${i.msg.slice(0, 80)} → ${i.fix}`)
  }
  if (findings) {
    for (const l of findings.split('\n').filter(Boolean).slice(0, 1)) {
      blockerLines.push(l.replace(/^\[[\d:TZ.-]+\]\s*/, '').slice(0, 100))
    }
  }

  const telegramParts = [
    `*BSV — ${DAY_NAME} ${DATE_STAMP}*`,
    ``,
    `💰 *REVENUE:* ${revenueYd}${revenueWk} | Links: ${linkStatus}`,
    `📲 *POSTS:* ${postLine}`,
    `👥 *AUDIENCE:* ${audienceLine}`,
  ]
  if (agents.issues.length) {
    telegramParts.push(`🔧 *AGENTS:* ${agents.issues.length} issue(s) — ${agents.issues.slice(0, 3).map(i => i.name).join(', ')}`)
  }
  telegramParts.push(
    `⚠️ *BLOCKERS:* ${blockerLines.length ? blockerLines.slice(0, 3).join('\n• ') : 'None'}`,
    `🎯 *TODAY:* ${revenue.action}`,
    ``,
    `📋 ${outFile} → Drive`,
  )

  const tgResult = await sendTelegram(telegramParts.join('\n'))
  if (tgResult?.message_id) log(`Standup Telegram delivered — message_id: ${tgResult.message_id}`)
  else log('WARNING: Standup Telegram returned no confirmation')

  // Alert on critical agent failures individually
  for (const issue of agents.issues.filter(i => i.severity === 'error' && AGENT_ROSTER.find(a => a.name === i.name)?.essential)) {
    const tgAlert = await sendTelegram(`🚨 BSV — ${issue.name} error\n${issue.msg}\n\nFix: \`${issue.fix}\``)
    if (tgAlert?.message_id) log(`Telegram agent alert (${issue.name}) — message_id: ${tgAlert.message_id}`)
    else log(`WARNING: Telegram agent alert returned no confirmation (${issue.name})`)
  }

  // ── Claude standup doc (Drive record) ─────────────────────────────────────
  // Shorter than before — Telegram carries the operational output.
  // Claude adds context, root-cause analysis, and the "Tonight" schedule.

  const fmtCost = (n) => `$${n.toFixed(4)}`
  const tokenSection = [
    `Daily ceiling: $${DAILY_API_CEILING.toFixed(2)}`,
    `Spend: ${tokenBudget.officialTotal != null ? fmtCost(tokenBudget.officialTotal) + ' (official)' : fmtCost(tokenBudget.estTotal) + ' (estimate)'} — ${tokenBudget.pct.toFixed(1)}%`,
    tokenBudget.breakdown.length
      ? tokenBudget.breakdown.map(a => `  ${a.name}: ${a.calls} call(s), ~${a.tokens.toLocaleString()} tokens, ${fmtCost(a.cost)}`).join('\n')
      : '  No Claude calls detected today.',
  ].join('\n')

  const standupSystem = [directive, memory, orgChart].filter(Boolean).join('\n\n---\n\n')
    + '\n\nYou are the BSV Chief of Staff. You know every agent in your org, their role, and their status. Revenue first. Direct. No padding. No filler sections.'

  const standupUser = `${chiefDirective ? `## Chief Directive — from Sunday Strategy Brief\n${chiefDirective}\n\n---\n\n` : ''}Today is ${DAY_NAME} ${DATE_STAMP}. Write the BSV operational brief.

## Revenue
Yesterday: ${revenueYd}${revenueWk}
Affiliate links deployed: ${revenue.linksDeployed ? `YES — ${revenue.shopLinkCount} product(s) in shop` : 'NO — shop has no affiliate links'}
CJ error: ${revenue.error || 'none'}
Action today: ${revenue.action}

## Post Confirmation (${posts.dayAbbr})
Expected: ${posts.expectedSlots.join(', ')}
Confirmed: ${posts.confirmed.join(', ') || 'none'}
Gaps: ${posts.gaps.join(', ') || 'none'}
Stuck media (caption never arrived): ${posts.stuckMediaSlots.join(', ') || 'none'}

## Agent Issues
${agents.issues.map(i => `${i.name} [${i.severity}]: ${i.msg} | fix: ${i.fix}`).join('\n') || 'None'}
Healthy: ${agents.ok.slice(0, 10).join(', ')}

## Growth
Total: ${growth.total ?? 'unknown'} (Lounge: ${growth.lounge ?? '?'}, Drop: ${growth.drop ?? '?'}) | ${growth.trend}
${growth.recommendation ? `Recommendation: ${growth.recommendation}` : ''}

## Pipeline Alerts
${findings || '(none)'}

## Drive State
Ready to Post: ${readyToPost}
Posted 24h: ${postedLast24h}
Output files: ${outputFiles.join(', ') || 'none'}

## Pipeline Logs (watch-drive — last 80 lines)
\`\`\`
${watchLog || '(no log)'}
\`\`\`

## Eng-bot log
\`\`\`
${engBotLog || '(no log)'}
\`\`\`

## Post State
\`\`\`json
${postStateRaw?.slice(0, 1500) || '(none)'}
\`\`\`

## Social Report (${socialReport?.filename || 'none'})
${socialReport ? socialReport.content.slice(0, 1200) : '(not available)'}

## Marketing Report (${mktReport?.filename || 'none'})
${mktReport ? mktReport.content.slice(0, 800) : '(not available)'}

## Change State
\`\`\`json
${changeState ? JSON.stringify(changeState, null, 2) : '(not available)'}
\`\`\`

## Token Budget
${tokenSection}

## Cost State
${costState ? `Burn: $${costState.avg_daily_burn?.toFixed(4)}/day | Balance: ${costState.balance != null ? '$' + costState.balance.toFixed(2) : 'unknown'} | Runway: ${costState.runway_hours != null ? costState.runway_hours.toFixed(0) + 'h' : 'unknown'}` : '(not available)'}

---

Produce this exact format:

# BSV Daily Brief — ${DAY_NAME}, ${DATE_STAMP}

## The One Question
Did BSV make money yesterday? One sentence answer — amount if yes, exact reason if no, what changes today.

## Revenue
CJ status, link deployment, action. If zero: root cause and specific fix.

## Posts
Yesterday's slots — confirmed vs expected. Cause of any gap.

## Agents
Issues with fix commands — one line each. Healthy: [comma list]. If no issues: "All essential agents healthy."

## Growth
Numbers and trend. Recommendation if flat or declining.

## Tonight
What runs when. Which slots generate for tomorrow. What to watch.

## Blockers
Anything needing Big D. Specific. "Clear" if none.

## Budget
${tokenSection}`

  log('Calling Claude for standup doc...')
  let standupText = ''
  try {
    const stream = await client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      system:     standupSystem,
      messages:   [{ role: 'user', content: standupUser }],
    })
    process.stdout.write('Generating standup doc')
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        standupText += event.delta.text
        process.stdout.write('.')
      }
    }
    process.stdout.write('\n')
    const finalMsg = await stream.finalMessage()
    log(`Standup done — ${finalMsg.usage?.output_tokens ?? '?'} tokens, stop: ${finalMsg.stop_reason}`)
  } catch (err) {
    process.stdout.write('\n')
    log(`ERROR: standup API call failed — ${err.message}`)
  }

  if (standupText.trim()) {
    const localOut = path.join(TEMP_DIR, outFile)
    try {
      fs.writeFileSync(localOut, standupText)
      rcloneCopyTo(localOut, `${REMOTE}/Reports/${outFile}`)
      log(`Standup uploaded → ${REMOTE}/Reports/${outFile}`)
    } catch (err) {
      log(`ERROR: standup upload — ${err.message}`)
    }
  }

  // ── Handoff update ────────────────────────────────────────────────────────

  log('Handoff update...')
  const handoffPrompt = `Update the BSV operational handoff.

Today's brief:
${standupText || '(brief unavailable)'}

Previous handoff:
${handoff ? handoff.slice(0, 2000) : '(none)'}

Write the complete ${HANDOFF_FILENAME}. Sections: what BSV is, pipeline state, content queue, platform status, audience, product shelf, known issues, tonight's schedule, agent team. Direct and specific. No padding.`

  let handoffText = ''
  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system:     (directive || '') + '\n\nYou are updating the BSV operational handoff. Return the complete document.',
      messages:   [{ role: 'user', content: handoffPrompt }],
    })
    handoffText = msg.content[0]?.text?.trim() || ''
    log(`Handoff done — ${msg.usage?.output_tokens ?? '?'} tokens`)
  } catch (err) {
    log(`ERROR: handoff API — ${err.message}`)
  }

  if (handoffText) {
    const localHandoff = path.join(TEMP_DIR, HANDOFF_FILENAME)
    try {
      fs.writeFileSync(localHandoff, handoffText)
      rcloneCopyTo(localHandoff, `${REMOTE}/Handoff/${HANDOFF_FILENAME}`)
      log(`Handoff uploaded → ${REMOTE}/Handoff/${HANDOFF_FILENAME}`)
    } catch (err) {
      log(`ERROR: handoff upload — ${err.message}`)
    }
  }

  // ── Memory update ─────────────────────────────────────────────────────────

  log('Memory update...')
  try {
    const currentMem = loadDriveFile(`${REMOTE}/BSV-Memory.md`, TEMP_DIR)
    const memMsg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system:     'You are updating the BSV strategic memory file. Return only the complete updated BSV-Memory.md.',
      messages:   [{
        role: 'user',
        content: `Update BSV-Memory.md based on today's brief. Preserve section structure. Only add what's new.

Current:
${currentMem || '(not found)'}

Today's brief:
${standupText || '(unavailable)'}

Return the complete updated BSV-Memory.md starting with # BSV-Memory.md`,
      }],
    })
    const updatedMem = memMsg.content[0]?.text?.trim() || ''
    log(`Memory done — ${memMsg.usage?.output_tokens ?? '?'} tokens`)
    if (updatedMem.includes('# BSV-Memory.md')) {
      const localMem = path.join(TEMP_DIR, 'BSV-Memory.md')
      fs.writeFileSync(localMem, updatedMem)
      rcloneCopyTo(localMem, `${REMOTE}/BSV-Memory.md`)
      log(`Memory uploaded → ${REMOTE}/BSV-Memory.md`)
    } else {
      log('WARNING: memory update missing header — skipping upload')
    }
  } catch (err) {
    log(`ERROR: memory API — ${err.message}`)
  }

  // ── Lounge content approval ────────────────────────────────────────────────
  // If Claude's standup includes a Lounge section, queue it for approval.

  try {
    const loungeMatch = standupText.match(/## The Lounge[^\n]*\n([\s\S]*?)(?=\n## |\n---|\n# |$)/)
    if (loungeMatch) {
      const titleMatch = loungeMatch[1].match(/\*\*Title:\*\*\s*(.+)/)
      const angleMatch = loungeMatch[1].match(/\*\*The angle:\*\*\s*(.+)/)
      if (titleMatch) {
        const loungeTitle = titleMatch[1].trim()
        const loungeAngle = angleMatch ? angleMatch[1].trim() : ''
        const driveFile   = `chief-lounge-${DATE_STAMP}-decision.md`
        if (!loadPendingItems().some(i => i.type === 'chief' && i.driveFile === driveFile)) {
          const msg = [`⚙️ *APPROVAL NEEDED*`, `*Lounge:* ${loungeTitle}`, loungeAngle, ``, `Reply *APPROVED*, *DENIED*, or *LATER*`].filter(Boolean).join('\n')
          addPendingItem({ id: `chief-lounge-${DATE_STAMP}`, type: 'chief', driveFile, sentAt: new Date().toISOString(), remindAfter: null, metadata: { title: loungeTitle, angle: loungeAngle }, originalMessage: msg })
          const tgL = await sendTelegram(msg)
          if (tgL?.message_id) log(`Lounge approval delivered — message_id: ${tgL.message_id}`)
          else log('WARNING: Lounge approval Telegram returned no confirmation')
        } else {
          log('Lounge content already queued')
        }
      }
    }
  } catch (err) {
    log(`WARNING: Lounge approval failed — ${err.message}`)
  }

  // ── Process Telegram inbox again after standup (catch replies that arrived during run) ──

  await processTelegramInbox()

  // ── Blog-agent watchdog ────────────────────────────────────────────────────

  await watchBlogAgent()

  log('━━━ chief-of-staff complete ━━━\n')
})()
