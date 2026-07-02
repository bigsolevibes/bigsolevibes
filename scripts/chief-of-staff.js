require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
// chief-of-staff.js — BSV revenue-first daily brief. Runs at 8AM via launchd.
// North star: Did BSV make money yesterday? If not, why not, what changes today?
// Priority order: Revenue → Posts → Agent health → Growth → Drive doc

const Anthropic = require('@anthropic-ai/sdk').default
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { sendTelegram } = require('./telegram')
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
  // ── Core pipeline — continuous, expected every 2h ─────────────────────────
  { name: 'watch-drive',       essential: true,  weekly: false, daily: false },
  { name: 'eng-bot',           essential: true,  weekly: false, daily: false },
  { name: 'change-agent',      essential: true,  weekly: false, daily: false },
  // ── Daily agents — run once per night via launchd, stale window = 25h ─────
  { name: 'media-director',    essential: true,  weekly: false, daily: true  },
  { name: 'creative-agent',    essential: true,  weekly: false, daily: true  },
  { name: 'distribute',        essential: true,  weekly: false, daily: true  },
  { name: 'update-handoff',    essential: true,  weekly: false, daily: true  },
  // ── Supporting — non-essential, expected every 2h ─────────────────────────
  { name: 'org-chart-agent',   essential: false, weekly: false },
  { name: 'drive-sync',        essential: false, weekly: false },
  { name: 'gemini-bridge',     essential: false, weekly: false },
  { name: 'image-gen',         essential: false, weekly: false },
  { name: 'video-gen',         essential: false, weekly: false },
  { name: 'cost-report',       essential: false, weekly: false },
  { name: 'accounting-agent',  essential: false, weekly: false },
  { name: 'reddit-agent',      essential: false, weekly: false },
  // ── Weekly agents — expected once per week ────────────────────────────────
  { name: 'strategist',        essential: false, weekly: true  },
  { name: 'brand-manager',     essential: false, weekly: true  },
  { name: 'marketing-manager', essential: false, weekly: true  },
  { name: 'social-listening',  essential: false, weekly: true  },
  { name: 'product-research',  essential: false, weekly: true  },
  { name: 'product-development',essential: false, weekly: true },
  { name: 'blog-agent',        essential: false, weekly: true  },
  { name: 'sole-report-agent', essential: false, weekly: true  },
  // Added 2026-07-01 — both had rotating logs and were being called "Healthy" in the
  // standup with zero backing check (see BSV-BigC-Audit-Log.md same date). affiliate-scout
  // is a real committed script (scripts/affiliate-scout.js) — weekly audit cadence.
  // cj-research is NOT in this repo at all (no .js file in git history) despite active
  // logs on the machine — tracked here for honest staleness reporting only; Big D still
  // needs to decide whether to commit its source or retire it.
  { name: 'affiliate-scout',   essential: false, weekly: true  },
  { name: 'cj-research',       essential: false, weekly: true  },
]

// Scripts with their own log file that are intentionally NOT tracked as recurring
// agents — one-off/manual/utility scripts, not part of the scheduled pipeline.
// findUntrackedAgents() below uses this to avoid false-flagging them as sprawl.
const KNOWN_NON_AGENT_LOGS = new Set([
  'run-now', 'seed-products', 'regen-4', 'generate-all-scenes', 'generate-locker-image',
  'promote-sole-report', 'log-rotate', 'dashboard', 'telegram-inbox', 'brand-image',
])

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
    const staleMins = agent.weekly ? 7 * 24 * 60 : agent.daily ? 25 * 60 : 120
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

// ─── Sprawl check: scripts producing logs that nobody is tracking ────────────
// Added 2026-07-01. AGENT_ROSTER is a hand-maintained list — it drifts. This scans
// what's actually producing log activity on disk and diffs it against the roster,
// so a script can't silently run untracked (and get called "Healthy" with zero
// backing check, which is exactly what happened with affiliate-scout/cj-research
// before they were added above). Recency-gated so retired scripts' old logs don't
// nag forever.
function findUntrackedAgents() {
  const rosterNames = new Set(AGENT_ROSTER.map(a => a.name))
  const now = Date.now()
  const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  let files = []
  try { files = fs.readdirSync(path.join(ROOT, 'logs')) } catch { return [] }

  const untracked = []
  for (const f of files) {
    const m = f.match(/^([a-z0-9-]+)\.log$/i)
    if (!m) continue // skip .log.1/.log.2 rotations, -error.log, non-log files
    const name = m[1]
    if (rosterNames.has(name) || KNOWN_NON_AGENT_LOGS.has(name)) continue
    let mtime
    try { mtime = fs.statSync(path.join(ROOT, 'logs', f)).mtimeMs } catch { continue }
    if (now - mtime <= ACTIVE_WINDOW_MS) {
      untracked.push({ name, lastActivityHoursAgo: Math.round((now - mtime) / 3600000) })
    }
  }
  return untracked
}

// ─── Priority 4: Growth ───────────────────────────────────────────────────────
// Reads subscriber counts from marketing reports + uses web_search to surface
// what is actually working in men's grooming/lifestyle content right now.
// Returns metrics + 2-3 specific, actionable growth plays for chief to include.

async function checkGrowth() {
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

  // ── Subscriber counts from marketing reports ──────────────────────────────
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
    } else {
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
        else                { result.trend = 'flat vs last report' }
      } else {
        result.trend = 'only one report — no trend yet'
      }
    }
  } catch (err) {
    log(`Growth metrics error: ${err.message}`)
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

// ─── Chief's running memory ───────────────────────────────────────────────────
// BSV-Memory.md is a snapshot that gets overwritten nightly — it doesn't carry
// day-to-day continuity. This file does: one append-only `## YYYY-MM-DD` entry
// per run, read back (last ~7) at the top of the next run, so Chief can say
// "yesterday I flagged X — still true today?" instead of starting blank each
// morning. Mirrors BSV-BigC-Audit-Log.md (the equivalent for chat sessions).

const CHIEF_AUDIT_LOG = path.join(ROOT, 'logs', 'chief-audit-log.md')

function getRecentAuditEntries(n = 7) {
  try {
    if (!fs.existsSync(CHIEF_AUDIT_LOG)) return null
    const text = fs.readFileSync(CHIEF_AUDIT_LOG, 'utf8').trim()
    if (!text) return null
    const entries = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter(Boolean)
    return entries.slice(-n).join('\n\n').trim() || null
  } catch { return null }
}

function appendAuditEntry(entry) {
  try {
    fs.mkdirSync(path.dirname(CHIEF_AUDIT_LOG), { recursive: true })
    if (!fs.existsSync(CHIEF_AUDIT_LOG)) {
      fs.writeFileSync(CHIEF_AUDIT_LOG,
        '# BSV Chief Audit Log\n' +
        'Running day-by-day record of what Chief of Staff found and decided each morning — ' +
        'read back (last ~7 entries) at the top of every run so today builds on yesterday ' +
        'instead of starting blank. Append-only; one `## YYYY-MM-DD` entry per run.\n\n')
    }
    fs.appendFileSync(CHIEF_AUDIT_LOG, entry.trim() + '\n\n')
  } catch (err) {
    log(`WARNING: audit log append failed — ${err.message}`)
  }
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

// ─── Weekly agent efficiency audit (Sunday only) ──────────────────────────────
// Reads logs to surface which agents ran, token usage, and whether model tier
// matches task complexity. No API call — all local log parsing.

function buildAgentEfficiencyAudit() {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const cutoff  = new Date(Date.now() - WEEK_MS)

  // Known model assignments per agent (update when scripts change)
  const MODEL_MAP = {
    'creative-agent':     { model: 'sonnet-4-6',  type: 'creative',   note: 'Brand voice captions — Sonnet correct' },
    'media-director':     { model: 'haiku-4-5',   type: 'brief',      note: 'Persona/brief assignment — Haiku correct' },
    'blog-agent':         { model: 'sonnet-4-6',  type: 'creative',   note: 'Long-form articles — Sonnet correct' },
    'brand-manager':      { model: 'sonnet-4-6',  type: 'qa',         note: 'Editorial QA — Sonnet correct; watch continuation calls' },
    'strategist':         { model: 'sonnet-4-6',  type: 'synthesis',  note: 'Weekly strategy — Sonnet correct; runs Sunday only' },
    'chief-of-staff':     { model: 'sonnet-4-6',  type: 'synthesis',  note: 'Daily standup — Sonnet correct' },
    'eng-bot':            { model: 'haiku-4-5',   type: 'triage',     note: 'Error triage — Haiku correct' },
    'social-listening':   { model: 'haiku-4-5',   type: 'synthesis',  note: 'Signal extraction — Haiku correct' },
    'marketing-manager':  { model: 'haiku-4-5',   type: 'report',     note: 'Audience analysis — Haiku correct' },
    'product-development':{ model: 'sonnet-4-6',  type: 'research',   note: 'Live web research — Sonnet correct; state now local' },
    'product-research':   { model: 'sonnet-4-6',  type: 'research',   note: 'Live product discovery — Sonnet correct' },
    'reddit-agent':       { model: 'haiku-4-5',   type: 'creative',   note: 'Reddit post copy — Haiku acceptable' },
    'lounge-reconcile':   { model: 'sonnet-4-6',  type: 'editorial',  note: 'Article rewrite — Sonnet correct; runs on-demand' },
    'update-handoff':     { model: 'none',         type: 'template',   note: 'Template render — no API call ✓' },
  }

  const results = []

  for (const [agent, meta] of Object.entries(MODEL_MAP)) {
    const logFile  = path.join(ROOT, 'logs', `${agent}.log`)
    const logFile1 = path.join(ROOT, 'logs', `${agent}.log.1`)

    let content = ''
    try { content += fs.readFileSync(logFile, 'utf8') } catch {}
    try { content += fs.readFileSync(logFile1, 'utf8') } catch {}

    if (!content) continue

    // Find runs in the last 7 days
    const lines = content.split('\n').filter(l => {
      const m = l.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
      if (!m) return false
      return new Date(m[1]) >= cutoff
    })

    if (!lines.length) continue

    // Count runs (start markers)
    const runs = lines.filter(l => l.includes('start ━━━') || l.includes('start ---')).length

    // Sum tokens from "Done — N tokens" or "N tokens" patterns
    let tokens = 0
    for (const line of lines) {
      const m = line.match(/(\d+)\s+(?:output\s+)?tokens/)
      if (m) tokens += parseInt(m[1])
    }

    // Flag continuation calls (brand-manager overflow)
    const continuations = lines.filter(l => l.includes('continuation') || l.includes('max_tokens')).length

    results.push({ agent, runs, tokens, continuations, ...meta })
  }

  if (!results.length) return '(no agent activity in the last 7 days)'

  const lines = [
    '| Agent | Model | Runs | Tokens | Type | Notes |',
    '|-------|-------|------|--------|------|-------|',
  ]
  for (const r of results.sort((a, b) => b.tokens - a.tokens)) {
    const flag = r.continuations > 0 ? ` ⚠ ${r.continuations} continuation(s)` : ''
    lines.push(`| ${r.agent} | ${r.model} | ${r.runs} | ${r.tokens || '—'} | ${r.type} | ${r.note}${flag} |`)
  }

  // Flags for chief to surface
  const flags = []
  for (const r of results) {
    if (r.continuations > 0) flags.push(`${r.agent}: hit max_tokens ${r.continuations}x this week — prompt is too long, trim input context`)
    if (r.model === 'sonnet-4-6' && r.type === 'report' && r.tokens < 500) flags.push(`${r.agent}: Sonnet generating <500 tokens — consider Haiku`)
    if (r.model === 'sonnet-4-6' && r.type === 'triage') flags.push(`${r.agent}: triage task on Sonnet — should be Haiku`)
  }

  return lines.join('\n') + (flags.length ? '\n\n**Flags:**\n' + flags.map(f => `- ${f}`).join('\n') : '\n\n**No flags.**')
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

// ─── Big C Session Context ────────────────────────────────────────────────────
// Appended to logs/bigc-brief.md so Big C starts every session from ONE file.
// Replaces the 4-file startup read (BSV-Start-Here, standup, Session-Context,
// Audit-Log) with a single local read. Chief is the aggregator; Big C reads.
// Added 2026-06-30 per Big D: "I want to start out fresh and clean."

function buildBigCContext() {
  const lines = ['\n\n---\n\n## Big C Session Context\n']

  // ── Last 3 audit log entries — headlines only, not full text ─────────────
  lines.push('### Recent Work (BSV-BigC-Audit-Log.md — last 3 entries)')
  try {
    const auditPath = path.join(ROOT, 'BSV-BigC-Audit-Log.md')
    if (fs.existsSync(auditPath)) {
      const text = fs.readFileSync(auditPath, 'utf8')
      const entries = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter(Boolean)
      const recent  = entries.slice(-3).reverse()
      for (const entry of recent) {
        const m = entry.match(/^## (.+)/)
        if (!m) continue
        const headline = m[1].trim()
        const snippet  = entry.split('\n').slice(1)
          .find(l => l.trim() && !l.startsWith('---'))
          ?.replace(/^\*\*[^*]+\*\*[:\s]*/, '').trim().slice(0, 120) || ''
        lines.push(`- **${headline}**${snippet ? ` — ${snippet}` : ''}`)
      }
    } else {
      lines.push('- (audit log not found)')
    }
  } catch {
    lines.push('- (audit log unavailable)')
  }

  // ── Hard rules — condensed, don't re-derive ───────────────────────────────
  lines.push('\n### Hard Rules')
  lines.push("- **Never delete files** without Big D's explicit say-so — ask first, every time")
  lines.push('- **Never touch .env** — tell Big D what to add manually; never write to it')
  lines.push('- **Pushing to main** = explicit, live confirmation each time + `mcp__bsv__push_to_main` only; never proactive')
  lines.push('- **Dashboard** (`lib/dashboard/`, `app/dashboard/`, `components/dashboard/`) = gitignored, localhost-only; saving to disk IS the deploy — no commit, no push')
  lines.push('- **Prefer `mcp__bsv__*` tools** over asking Big D to run terminal commands')

  // ── Precedence ────────────────────────────────────────────────────────────
  lines.push('\n### Precedence')
  lines.push('This brief > live MCP state > memory. For live slot/approval status: `mcp__bsv__get_pipeline_state`.')
  lines.push('To append to the audit log or dig into history: read `BSV-BigC-Audit-Log.md` on demand — not at startup.')

  return lines.join('\n')
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

  const untrackedAgents = findUntrackedAgents()
  if (untrackedAgents.length) {
    log(`Untracked agents (active logs, not in roster): ${untrackedAgents.map(u => u.name).join(', ')}`)
  }

  // ── Update org chart state — chief owns this ──────────────────────────────
  try {
    const orgState = {
      lastUpdated: new Date().toISOString(),
      agents: {}
    }
    for (const agent of AGENT_ROSTER) {
      const issue = agents.issues.find(i => i.name === agent.name)
      const isOk  = agents.ok.includes(agent.name)
      orgState.agents[agent.name] = {
        essential: agent.essential,
        weekly:    agent.weekly,
        status:    issue ? (issue.severity === 'error' ? 'error' : 'warning') : isOk ? 'ok' : 'unknown',
        msg:       issue ? issue.msg : null,
        fix:       issue ? issue.fix : null,
      }
    }
    fs.writeFileSync(path.join(ROOT, 'logs', 'org-chart-state.json'), JSON.stringify(orgState, null, 2))
    log('Org chart state updated')
    // Spawn org-chart-agent to rebuild the HTML
    const { spawnSync } = require('child_process')
    const r = spawnSync(process.execPath, [path.join(__dirname, 'org-chart-agent.js')], {
      cwd: ROOT, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, HOME: process.env.HOME }
    })
    if (r.status === 0) log('org-chart-agent: HTML rebuilt')
    else log(`org-chart-agent error: ${(r.stderr || '').slice(0, 200)}`)
  } catch (err) {
    log(`Org chart update error: ${err.message}`)
  }

  // ── P4: Growth ────────────────────────────────────────────────────────────

  log('P4: Growth...')
  const growth = await checkGrowth()

  // ── Supporting context ────────────────────────────────────────────────────

  const tokenBudget   = buildTokenBudget()
  const findings      = getHandoffFindings()
  const auditLog      = getRecentAuditEntries(7)
  const directive     = loadDriveFile(`${REMOTE}/BSV-Directive.md`, TEMP_DIR)
  const memory        = loadDriveFile(`${REMOTE}/BSV-Memory.md`, TEMP_DIR)
  const orgChart      = loadDriveFile(`${REMOTE}/BSV-Org.md`, TEMP_DIR)
  const handoff       = loadLatestHandoff()

  // Sub-agent running logs — Chief reads these to surface structural patterns
  // that individual agents can't see from their own perspective.
  const brandAuditLog = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'brand-manager-audit.md')
      if (!fs.existsSync(p)) return null
      const text = fs.readFileSync(p, 'utf8').trim()
      const entries = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter(Boolean)
      return entries.slice(-3).join('\n\n').trim() || null
    } catch { return null }
  })()
  const mediaDirAuditLog = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'media-director-audit.md')
      if (!fs.existsSync(p)) return null
      const text = fs.readFileSync(p, 'utf8').trim()
      const entries = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter(Boolean)
      return entries.slice(-3).join('\n\n').trim() || null
    } catch { return null }
  })()
  const denialCount = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'denial-log.json')
      if (!fs.existsSync(p)) return 0
      const entries = JSON.parse(fs.readFileSync(p, 'utf8'))
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      return entries.filter(e => new Date(e.date).getTime() > cutoff).length
    } catch { return 0 }
  })()

  const watchLog      = getRecentLog('watch-drive.log', 80)
  const engBotLog     = getRecentLog('eng-bot.log', 30)
  const mediaLog      = getRecentLog('media-director.log', 30)
  const postStateRaw  = getPostStateRaw()
  const outputFiles   = getOutputFiles()
  const readyToPost   = getReadyToPost()
  const postedLast24h = getPostedLast24h()
  const socialReport  = loadLatestReport('social-report')
  const mktReport     = loadLatestReport('marketing')
  const latestResearch = (() => {
    try { return loadLatestReport('research', 'Product Research') } catch { return null }
  })()
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
  const editionState = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'edition-state.json')
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
    } catch { return null }
  })()
  // Full strategy brief from strategist.js (runs Sunday, sets the week)
  const weekStrategy = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'strategy-active.md')
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').slice(0, 3000) : null
    } catch { return null }
  })()
  // Chief Directive is the action-oriented extract from the strategy brief
  const chiefDirective = (() => {
    if (!weekStrategy) return null
    const m = weekStrategy.match(/##\s+Chief Directive[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)
    return m ? m[1].trim() : null
  })()

  log(`Context: directive=${!!directive}, strategy=${!!chiefDirective}, memory=${!!memory}, org=${!!orgChart}, handoff=${!!handoff}, auditLog=${!!auditLog}, social=${socialReport?.filename || 'none'}, marketing=${mktReport?.filename || 'none'}`)
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

  // ── Local standup snapshot (dashboard reads this) ──────────────────────────
  // lib/dashboard/state-adapter.ts's getLatestStandup() reads the newest
  // logs/standup-*.txt for the Blockers panel. Nothing wrote this file once
  // the old retired generator (sole-report-agent) was replaced by this script
  // — the dashboard served a single 2026-05-29 snapshot as "today's blockers"
  // for a month (incl. a long-resolved "No bluesky/twitter image found" item)
  // until this was traced 2026-06-28. BLOCKERS must stay the last section,
  // with nothing after it — extractBlockers() captures from "BLOCKERS" to
  // end-of-string and checks for the literal substring "No blockers".
  try {
    const snapshotLines = [
      `*BSV — ${DAY_NAME} ${DATE_STAMP}*`,
      ``,
      `💰 *REVENUE:* ${revenueYd}${revenueWk} | Links: ${linkStatus}`,
      `📲 *POSTS:* ${postLine}`,
      `👥 *AUDIENCE:* ${audienceLine}`,
      agents.issues.length
        ? `🔧 *AGENTS:* ${agents.issues.length} issue(s) — ${agents.issues.slice(0, 3).map(i => i.name).join(', ')}`
        : null,
      ``,
      `*BLOCKERS*`,
      blockerLines.length ? blockerLines.slice(0, 3).map(l => `• ${l}`).join('\n') : 'No blockers.',
    ].filter(l => l !== null).join('\n')
    fs.writeFileSync(path.join(ROOT, 'logs', `standup-${DATE_STAMP}.txt`), snapshotLines)
    log(`Local standup snapshot written → logs/standup-${DATE_STAMP}.txt`)
  } catch (err) {
    log(`WARNING: failed to write local standup snapshot — ${err.message}`)
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


  // Weekly agent efficiency audit — Sunday only, no API call
  const efficiencyAudit = DAY_OF_WEEK === 0 ? buildAgentEfficiencyAudit() : null
  const standupSystem = [directive, memory, orgChart].filter(Boolean).join('\n\n---\n\n')
    + `\n\nYou are the BSV Chief of Staff — the operating brain of a one-man premium brand with a full AI agent team.

## Your job is not to report. It is to run the org.

Big D is the Proprietor. His job is vision, brand authority, and final decisions. Your job is everything else. That means:

- You notice when the org is producing below its capability and you say so — with a specific cause and a specific fix.
- You track whether your own recommendations from prior standups were acted on. If they weren't, you escalate — not repeat.
- You do not wait for Big D to identify systemic problems. You surface them first, with a recommendation.
- You distinguish between what's broken today (tactical) and what's holding the org back structurally (strategic).

BSV is at stage 1: building an audience and proving affiliate revenue before the private-label Proprietor's Foot Balm launches. Every structural decision you make should serve: more consistent content, higher quality briefs, faster feedback loops between what's posted and what generates revenue.

## The brief structure — required, in this order

### BIG D — DECISIONS NEEDED
(2–3 items max. Strategic choices that only Big D can make — approvals, direction calls, go/no-go decisions. Not tasks he can delegate. If there are no genuine decisions, write "None today.")

### BIG D — DO THIS TODAY
(2–3 items max. Tactical actions Big D personally needs to take. Specific. No vague suggestions.)

### BIG C — DO THIS TODAY
(2–3 items max. What Big C should build, fix, or improve in today's session. Specific enough to act on immediately. If you see a structural gap in how the agents are operating, put it here.)

Then write the full operational brief — Revenue, Posts, Agents, Growth, Tonight, Budget.

### Org Recommendations
(This section is mandatory every single day — not just when something is broken.)

Start with this question every single time, no exceptions: **Is the content we produced this week something only BSV could have made — or could it have come from any men's grooming account?**

BSV's identity is discovery. The Proprietor stocks what has earned its place, not what already has a famous name. He finds it before anyone is talking about it and brings it to the man who should know. When the content pipeline drifts to "the usual" — generic grooming lifestyle, product-as-hero, safe and predictable — BSV stops existing as a brand and becomes background noise. That is the failure you are here to prevent.

Answer the discovery question honestly. Then give 1–3 structural observations or recommendations. Look at your running history, brand-manager's log, denial count, agent efficiency. What is this org doing that it could do better? What pattern have you seen for more than one cycle? What would you build or fix if Big C had 2 hours today?

### Decisions Needed (Backlog)
Any open strategic decisions from prior standups that haven't been acted on yet. Track them here until they're resolved. If something has been in the backlog for more than 3 standups without movement, flag it explicitly.

## Before you list ANYTHING as a decision needed — check resolution first

BSV-Directive.md is the resolution ledger. Before adding an item to "BIG D — DECISIONS NEEDED" or "Decisions Needed (Backlog)", check whether the directive (loaded above) already marks it DECIDED, CLOSED, or WAIT. If it does, that decision is resolved — do NOT re-list it, no matter how many prior standups asked about it. Prior recurrence in your own running history is not evidence a decision is still open; it is usually evidence of this exact bug. Only treat something as open if the directive is silent on it, or if Big D has reopened it directly in chat since the date the directive shows it was closed.`

  const standupUser = `${weekStrategy ? `## This Week's Strategy (from strategist.js — Sunday brief)\n${weekStrategy}\n\n---\n\n` : chiefDirective ? `## Chief Directive — from Sunday Strategy Brief\n${chiefDirective}\n\n---\n\n` : ''}Today is ${DAY_NAME} ${DATE_STAMP}. Write the BSV operational brief.

${auditLog ? `## Your Running History (last ~7 standups)\nThis is your own record. Use it like a manager reviewing last week's notes — what did you flag? Was it fixed? If you recommended something and it hasn't happened, escalate it in Decisions Needed Backlog. If a pattern keeps appearing, it means something structural is wrong and you should name it.\n${auditLog}\n\n---\n` : ''}

${brandAuditLog ? `## Brand Manager Running Log (last 3 weeks)\nWhat brand-manager has been flagging. Look for repeating patterns — if the same fix list item appears 2+ weeks in a row, the pipeline isn't incorporating feedback fast enough. That is a structural problem to surface in Org Recommendations.\n${brandAuditLog}\n\n---\n` : ''}

${mediaDirAuditLog ? `## Media Director Running Log (last 3 runs)\nWhat media-director has been tracking — slot assignments, edition state, strategy alignment.\n${mediaDirAuditLog}\n\n---\n` : ''}

${latestResearch ? `## Latest Product Research (${latestResearch.filename})\nSurface shelf-ready picks, pending approvals, and any trending signals the curator flagged. If the shelf has picks that haven't been published in the Locker Room yet, flag that in Agent Briefings. If the research flagged a trending product with a time-sensitive signal, escalate it to BIG D — DO THIS TODAY.\n${latestResearch.content.slice(0, 2000)}\n\n---\n` : ''}

${denialCount > 0 ? `## Content Denials (last 7 days): ${denialCount} slot(s) denied by Big D\nDenials are the strongest quality signal. If denials are rising or repeating, brief quality is not improving — surface this in Org Recommendations.\n\n---\n` : ''}
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
This Healthy list is the ONLY source of truth for which agents are healthy. Do not add any name to your own "Healthy:" line that isn't in this exact list — not from memory, not from other context below, not because it sounds familiar.

## Untracked Agents (sprawl check)
${untrackedAgents.length ? untrackedAgents.map(u => `${u.name} — active log, last activity ${u.lastActivityHoursAgo}h ago, NOT in the tracked roster (no health check ever run on it)`).join('\n') : 'None — every script producing log activity is in the tracked roster.'}

## Growth
Total: ${growth.total ?? 'unknown'} (Lounge: ${growth.lounge ?? '?'}, Drop: ${growth.drop ?? '?'}) | ${growth.trend}
${growth.recommendation ? `Trend note: ${growth.recommendation}` : ''}


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

## Edition State
${editionState
  ? `Edition #${editionState.editionNumber} — ${editionState.month} | Theme: ${editionState.theme || 'TBD'} | Products: ${editionState.products?.join(', ') || 'unknown'} | Approved: ${editionState.approved ? 'YES' : 'NO — PENDING APPROVAL'} | Created: ${editionState.createdAt?.slice(0,10) || 'unknown'}`
  : 'No edition generated yet — run node scripts/edition-agent.js to generate Edition #1'}

## Token Budget
${tokenSection}

## Cost State
${costState ? `Burn: $${costState.avg_daily_burn?.toFixed(4)}/day | Balance: ${costState.balance != null ? '$' + costState.balance.toFixed(2) : 'unknown'} | Runway: ${costState.runway_hours != null ? costState.runway_hours.toFixed(0) + 'h' : 'unknown'}` : '(not available)'}

${efficiencyAudit ? "## Agent Efficiency (weekly)\n" + efficiencyAudit + "\n" : ""}
---

Produce this exact format:

# BSV Daily Brief — ${DAY_NAME}, ${DATE_STAMP}

## BIG D — DECISIONS NEEDED
Strategic choices only Big D can make. If none: "None today."

## BIG D — DO THIS TODAY
Tactical actions. 2–3 max. Specific.

## BIG C — DO THIS TODAY
What to build or fix in today's session. 2–3 max. If you see a structural gap, put it here.

## The One Question
Did BSV make money yesterday? One sentence.

## Revenue
CJ status, link deployment, action. Root cause if zero.

## Posts
Confirmed vs expected. Cause of any gap.

## Agent Briefings
What each agent reported last run — not a status light, a one-line summary of what they actually did or flagged. Required entries: Brand Manager (last score, top fix, denials reviewed), Media Director (chapter planned, strategy aligned), Eng-Bot (triage summary, any P0/P1 escalations), Research (shelf picks waiting, trending signals flagged, affiliate paths identified). If an agent hasn't run recently, say so — that's a signal too.

## Agents
Issues with fix commands. Healthy: [comma list] — copy this verbatim from the Healthy list given to you above. Never add a name to it yourself. If any Untracked Agents were reported above, list them here too, clearly separate from Healthy — e.g. "Untracked (no health check exists): x, y — needs a roster decision." Never call an untracked agent "Healthy."

## Growth
Numbers, trend, recommendation.

## Tonight
What runs when. What to watch.

## Org Recommendations
(Mandatory — every standup. 1–3 structural observations or recommendations. Look at your running history, brand-manager's log, denial count, agent efficiency. What is this org doing that it could do better? What pattern have you seen for more than one cycle? What would you build or fix if Big C had 2 hours today?)

## Decisions Needed (Backlog)
Open strategic decisions from prior standups. Track until resolved. Flag anything that has been here 3+ standups without movement.

## Budget
${tokenSection}

${efficiencyAudit ? "## Agent Efficiency\n(Review table. Call out flags.)" : ""}`

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

  // ── Big C brief — one-file session startup ───────────────────────────────
  // Full standup + compact session context written to logs/bigc-brief.md so
  // Big C reads ONE local file at startup instead of four separate sources.
  // CLAUDE.md Pre-Session Protocol points here. See buildBigCContext() above.
  if (standupText.trim()) {
    try {
      const bigcPath    = path.join(ROOT, 'logs', 'bigc-brief.md')
      const bigcContent = standupText + buildBigCContext()
      fs.writeFileSync(bigcPath, bigcContent)
      log(`Big C brief written → logs/bigc-brief.md`)
    } catch (err) {
      log(`WARNING: Big C brief write failed — ${err.message}`)
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

  // ── Blog-agent watchdog ────────────────────────────────────────────────────

  await watchBlogAgent()

  // ── Append today's entry to the running audit log ─────────────────────────
  // Factual, scannable record — not prose — so tomorrow's run (and Big D) can
  // see at a glance what was found, flagged, and actioned without re-deriving it.
  try {
    // Also extract Org Recommendations from the standup so they appear in tomorrow's history
    const orgRecsMatch = standupText.match(/##\s+Org Recommendations([\s\S]*?)(?=\n##\s|\n#\s|$)/i)
    const orgRecsSnippet = orgRecsMatch ? orgRecsMatch[1].trim().slice(0, 400) : null
    const decisionsMatch = standupText.match(/##\s+Decisions Needed \(Backlog\)([\s\S]*?)(?=\n##\s|\n#\s|$)/i)
    const decisionsSnippet = decisionsMatch ? decisionsMatch[1].trim().slice(0, 300) : null

    const lines = [
      `## ${DATE_STAMP} — ${DAY_NAME}`,
      `**Revenue:** ${revenueYd}${revenueWk ? ` | week: ${revenueWk.replace(/^\s*\|\s*/, '')}` : ''}${revenue.error ? ` — CJ error: ${revenue.error}` : ''}`,
      `**Action today:** ${revenue.action || 'none'}`,
      `**Posts (${posts.dayAbbr}):** confirmed [${posts.confirmed.join(', ') || 'none'}] · gaps [${posts.gaps.join(', ') || 'none'}]${posts.stuckMediaSlots.length ? ` · stuck media [${posts.stuckMediaSlots.join(', ')}]` : ''}`,
      `**Agent issues:** ${agents.issues.length ? agents.issues.map(i => `${i.name} [${i.severity}]: ${i.msg}`).join('; ') : 'none'}`,
      `**Growth:** total ${growth.total ?? 'unknown'} (Lounge ${growth.lounge ?? '?'} / Drop ${growth.drop ?? '?'}) — ${growth.trend}${growth.recommendation ? ` — ${growth.recommendation}` : ''}`,
      `**Denials this week:** ${denialCount}`,
      orgRecsSnippet ? `**Org Recommendations:**\n${orgRecsSnippet}` : null,
      decisionsSnippet ? `**Open Decisions:**\n${decisionsSnippet}` : null,
    ].filter(Boolean)
    appendAuditEntry(lines.join('\n'))
  } catch (err) {
    log(`WARNING: could not build audit log entry — ${err.message}`)
  }

  log('━━━ chief-of-staff complete ━━━\n')
})()
