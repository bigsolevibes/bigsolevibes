require('dotenv').config()
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
const DOW_TO_SLUG  = ['sun','mon','tue','wed','thu','fri','sat']
const HANDOFF_FILENAME = `BSV-Handoff-${DATE_STAMP}.md`

const DAILY_API_CEILING   = 2.00
const CLAUDE_INPUT_PER_M  = 3.00
const CLAUDE_OUTPUT_PER_M = 15.00

// ─── Agent ecosystem registry ─────────────────────────────────────────────────
// Complete upstream → downstream map. Chief knows the whole chain.
// No agent ships without being added here first.

const AGENT_ECOSYSTEM_REGISTRY = `
social-listening    → feeds media-director (social-report to Drive/Reports/)
media-director      → feeds creative-agent; reads social-report and brand-health
creative-agent      → feeds distribute via Drive; reads media-director brief
brand-manager       → feeds media-director; audits creative-agent output (brand-health to Drive/Reports/)
marketing-manager   → feeds chief; informs media-director strategy
image-gen           → feeds watch-drive via Drive (images to Ready to Post/)
video-gen           → feeds watch-drive via Drive (videos to Ready to Post/)
gemini-bridge       → feeds image-gen and video-gen
watch-drive         → orchestrates resize-post, brand-image, brand-video, distribute
resize-post         → feeds brand-image; output to posts/output/
brand-image         → feeds distribute; output to posts/output/
brand-video         → feeds distribute; output to posts/output/
distribute          → posts to Instagram, Bluesky
eng-bot             → reads all logs; alerts chief and Big D on failures
change-agent        → monitors commits; files GitHub issues; alerts chief
update-handoff      → writes BSV-Handoff.md nightly to Drive/Handoff/
cost-report         → tracks API spend; alerts Big D on low balance
product-research    → feeds Google Sheets; feeds sync-shop
sync-shop           → generates Locker Room page; pushes to Cloudflare Pages
blog-agent          → writes Sole Report articles; pushes to GitHub
promote-sole-report → feeds distribute pipeline
product-development → feeds Big D decisions
`.trim()

const ECOSYSTEM_MANDATE = `ECOSYSTEM MANDATE: Every agent exists to serve the ecosystem, not itself. An agent that runs and produces nothing downstream has failed. An agent that runs without being fed has been abandoned. Chief's job is to make sure neither happens. Every morning chief confirms the chain is intact from social-listening all the way to distribute. Every break gets named, its downstream impact gets stated, and Big D gets a decision to make.

QUALITY GATE AUTHORITY: Your job is not to report on what happened. Your job is to ensure that what happens meets the standard before it happens. You have authority to hold any piece of content, any distribution, any pipeline output. When in doubt — hold it and ask. Never let poor quality go out because nobody stopped it.`

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

async function checkRevenue() {
  const result = {
    available:     false,
    error:         null,
    yesterday:     { commissions: 0, amount: 0 },
    week:          { commissions: 0, amount: 0 },
    linksDeployed: false,
    shopLinkCount: 0,
    action:        null,
  }

  const cjToken = process.env.CJ_API_TOKEN
  const cjCid   = process.env.CJ_CID

  if (cjToken && cjCid) {
    const xmlTag   = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`)); return m ? m[1].trim() : null }
    const allBlocks = (xml, tag) => { const re = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'g'); return [...xml.matchAll(re)].map(m => m[0]) }

    const fetchCommissions = async (startDate, endDate) => {
      const url = `https://commissions.api.cj.com/v3/commissions?date-type=posting&start-date=${startDate}&end-date=${endDate}&website-id=${cjCid}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${cjToken}`, Accept: 'application/xml' } })
      const xml = await res.text()
      if (!res.ok) throw new Error(`CJ API ${res.status}: ${xml.slice(0, 200)}`)
      const totalMatch = xml.match(/total-matched="(\d+)"/)
      const total  = totalMatch ? parseInt(totalMatch[1]) : 0
      const blocks = allBlocks(xml, 'commission')
      const amount = blocks.reduce((sum, b) => {
        const a = xmlTag(b, 'commission-amount')
        return sum + (a ? parseFloat(a) : 0)
      }, 0)
      return { commissions: total, amount }
    }

    try {
      const yd = new Date(_now); yd.setDate(yd.getDate() - 1)
      const wk = new Date(_now); wk.setDate(wk.getDate() - 7)
      const [ydData, wkData] = await Promise.all([
        fetchCommissions(yd.toISOString().slice(0, 10), yd.toISOString().slice(0, 10)),
        fetchCommissions(wk.toISOString().slice(0, 10), DATE_STAMP),
      ])
      result.available = true
      result.yesterday = ydData
      result.week      = wkData
    } catch (err) { result.error = err.message }
  } else {
    result.error = 'CJ_API_TOKEN or CJ_CID not set'
  }

  try {
    const shopHtml = fs.readFileSync(path.join(ROOT, 'public', 'shop', 'index.html'), 'utf8')
    const matches  = shopHtml.match(/amazon\.com[^"']*tag=|impact\.com|shareasale\.com|cj\.com\/redir/g) || []
    result.shopLinkCount = matches.length
    result.linksDeployed = matches.length > 0
  } catch { result.linksDeployed = false }

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

function checkPosts() {
  const ABBRS = ['sun','mon','tue','wed','thu','fri','sat']
  const yd    = new Date(_now); yd.setDate(yd.getDate() - 1)
  const dayAbbr = ABBRS[yd.getDay()]

  const expectedSlots = [`${dayAbbr}-am`, `${dayAbbr}-pm`]
  const todayAbbr = ABBRS[_now.getDay()]
  const localMins = _now.getHours() * 60 + _now.getMinutes()
  if (localMins >= 600)  expectedSlots.push(`${todayAbbr}-am`)
  if (localMins >= 1200) expectedSlots.push(`${todayAbbr}-pm`)

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
  return { expectedSlots, confirmed, gaps, stuckMediaSlots, dayAbbr }
}

// ─── Priority 3: Agent health ─────────────────────────────────────────────────

const AGENT_ROSTER = [
  { name: 'watch-drive',        essential: true,  weekly: false },
  { name: 'eng-bot',            essential: true,  weekly: false },
  { name: 'media-director',     essential: true,  weekly: false },
  { name: 'creative-agent',     essential: true,  weekly: false },
  { name: 'distribute',         essential: false, weekly: false },
  { name: 'social-listening',   essential: false, weekly: false },
  { name: 'gemini-bridge',      essential: false, weekly: false },
  { name: 'image-gen',          essential: false, weekly: false },
  { name: 'video-gen',          essential: false, weekly: false },
  { name: 'update-handoff',     essential: false, weekly: false },
  { name: 'change-agent',       essential: true,  weekly: false },
  { name: 'brand-manager',      essential: false, weekly: true  },
  { name: 'marketing-manager',  essential: false, weekly: true  },
  { name: 'product-research',   essential: false, weekly: true  },
  { name: 'cj-research',        essential: false, weekly: true  },
  { name: 'blog-agent',         essential: false, weekly: true  },
  { name: 'cost-report',        essential: false, weekly: false },
]

function checkAgentHealth() {
  const now    = Date.now()
  const issues = []
  const ok     = []

  for (const agent of AGENT_ROSTER) {
    const logPath = path.join(ROOT, 'logs', `${agent.name}.log`)
    if (!fs.existsSync(logPath)) {
      if (agent.essential) issues.push({ name: agent.name, severity: 'error', msg: 'never run — log missing', fix: `node scripts/${agent.name}.js` })
      continue
    }
    const ageMins   = (now - fs.statSync(logPath).mtimeMs) / 60000
    const staleMins = agent.weekly ? 7 * 24 * 60 : 120
    const isStale   = ageMins > staleMins && agent.essential
    let errors = []
    try {
      const content = fs.readFileSync(logPath, 'utf8')
      errors = content.trim().split('\n').slice(-60).filter(l => /^\[[^\]]+\]\s*(ERROR|CRASH|FATAL)/i.test(l))
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

  try {
    const cs = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'change-state.json'), 'utf8'))
    const heartbeat  = cs.last_heartbeat ? new Date(cs.last_heartbeat) : null
    const hoursSince = heartbeat ? (now - heartbeat.getTime()) / 3600000 : Infinity
    if (hoursSince > 25 && !issues.find(i => i.name === 'change-agent')) {
      issues.push({ name: 'change-agent', severity: 'warning', msg: `heartbeat ${Math.round(hoursSince)}h ago`, fix: 'node scripts/change-agent.js' })
      ok.splice(ok.indexOf('change-agent'), 1)
    }
  } catch {}

  log(`Agent health: ${ok.length} OK, ${issues.length} issue(s)`)
  for (const i of issues) log(`  [${i.severity}] ${i.name}: ${i.msg}`)
  return { ok, issues }
}

// ─── Priority 4: Growth ───────────────────────────────────────────────────────

function checkGrowth() {
  const result = { lounge: null, drop: null, total: null, trend: 'unknown', recommendation: null }
  const parseSubscribers = (content) => {
    if (!content) return null
    const lounge = content.match(/lounge[^:\n]*:\s*([\d,]+)/i)
    const drop   = content.match(/drop[^:\n]*:\s*([\d,]+)/i)
    return { lounge: lounge ? parseInt(lounge[1].replace(/,/g, '')) : null, drop: drop ? parseInt(drop[1].replace(/,/g, '')) : null }
  }
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] })
      .trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.startsWith('marketing-') && f.endsWith('.md'))
      .sort()
    if (!files.length) { result.trend = 'no marketing reports'; result.recommendation = 'Run marketing-manager.js to establish subscriber baseline'; return result }
    const loadReport = (f) => {
      try { execSync(`rclone copy "${REMOTE}/Reports/${f}" "${TEMP_DIR}/"`, { stdio: ['pipe','pipe','pipe'] }); return fs.readFileSync(path.join(TEMP_DIR, f), 'utf8') } catch { return null }
    }
    const latest = parseSubscribers(loadReport(files[files.length - 1]))
    const prev   = files.length >= 2 ? parseSubscribers(loadReport(files[files.length - 2])) : null
    if (latest) { result.lounge = latest.lounge; result.drop = latest.drop; result.total = (latest.lounge || 0) + (latest.drop || 0) }
    if (latest && prev) {
      const delta = ((latest.lounge || 0) + (latest.drop || 0)) - ((prev.lounge || 0) + (prev.drop || 0))
      if (delta > 0)      result.trend = `+${delta} vs last report`
      else if (delta < 0) { result.trend = `${delta} vs last report`; result.recommendation = 'Subscriber decline — check opt-out rates and post high-engagement content today' }
      else                { result.trend = 'flat vs last report'; result.recommendation = 'Flat growth — post a strong visual with a direct follow/subscribe CTA today' }
    } else { result.trend = 'only one report — no trend yet' }
  } catch (err) { log(`Growth check error: ${err.message}`); result.trend = `error: ${err.message.slice(0, 60)}` }
  log(`Growth: total=${result.total ?? 'unknown'} (lounge=${result.lounge ?? '?'}, drop=${result.drop ?? '?'}), trend=${result.trend}`)
  return result
}

// ─── Local state helpers ──────────────────────────────────────────────────────

function getHandoffFindings() {
  try { const p = path.join(ROOT, 'logs', 'handoff-findings.md'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() || null : null } catch { return null }
}

function getOutputFiles() {
  try { return fs.readdirSync(path.join(ROOT, 'posts', 'output')).filter(f => !f.startsWith('.')).sort() } catch { return [] }
}

// ─── Token budget ─────────────────────────────────────────────────────────────

function buildTokenBudget() {
  const dayStart = new Date(_now); dayStart.setHours(0, 0, 0, 0)
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

// ─── Overnight performance ────────────────────────────────────────────────────

function loadPostPerformance(days = 7) {
  const cutoff = Date.now() - days * 24 * 3600000
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    if (!fs.existsSync(p)) return []
    const entries = JSON.parse(fs.readFileSync(p, 'utf8'))
    return (Array.isArray(entries) ? entries : [])
      .filter(e => e.status === 'success' && e.timestamp && new Date(e.timestamp).getTime() > cutoff)
      .map(e => {
        let voice = null, persona = null, lane = null
        try {
          const brief = fs.readFileSync(path.join(ROOT, 'posts', 'briefs', `${e.slot}-brief.txt`), 'utf8')
          const voiceM   = brief.match(/^VOICE(?:_USED)?:\s*(\w+)/m)
          const personaM = brief.match(/Audience Persona:\s*([^\n]+)/i)
          const laneM    = brief.match(/Content Lane:\s*([^\n]+)/i)
          if (voiceM)   voice   = voiceM[1].trim()
          if (personaM) persona = personaM[1].trim()
          if (laneM)    lane    = laneM[1].trim()
        } catch {}
        return { ...e, voice, persona, lane }
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  } catch { return [] }
}

async function fetchInstagramInsights(mediaId) {
  const token = process.env.META_ACCESS_TOKEN
  if (!token || !mediaId) return null
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}/insights?metric=impressions,reach,saved&period=lifetime&access_token=${token}`
    )
    if (!res.ok) return null
    const data = await res.json()
    const metrics = {}
    for (const item of (data.data || [])) metrics[item.name] = item.values?.[0]?.value ?? item.value
    return metrics
  } catch { return null }
}

// ─── Ecosystem integrity check ────────────────────────────────────────────────
// Runs before everything else. Checks every agent handoff for breaks.
// Rogue = ran outside scheduled window without upstream directive.
// Orphaned = produced output nothing consumed within 24h.

function checkEcosystemIntegrity(agents) {
  const now  = Date.now()
  const H24  = 24  * 3600000
  const H48  = 48  * 3600000
  const H7D  = 168 * 3600000

  const logAge = (name) => {
    try {
      const p = path.join(ROOT, 'logs', `${name}.log`)
      return fs.existsSync(p) ? now - fs.statSync(p).mtimeMs : Infinity
    } catch { return Infinity }
  }

  const logContains = (name, pattern, lastN = 200) => {
    try {
      const p = path.join(ROOT, 'logs', `${name}.log`)
      if (!fs.existsSync(p)) return false
      return fs.readFileSync(p, 'utf8').trim().split('\n').slice(-lastN).some(l => pattern.test(l))
    } catch { return false }
  }

  const checks = []
  const check  = (label, ok, issue, downstreamImpact, decision) =>
    checks.push({ ok, label, ...(ok ? {} : { issue, downstreamImpact, decision }) })

  // social-listening → media-director
  const slAge = logAge('social-listening')
  if (slAge > H48) {
    check('social-listening → media-director', false,
      `social-listening has not run in ${Math.round(slAge / H24)}d`,
      'media-director briefing without fresh persona intelligence',
      'Run social-listening manually before tonight\'s brief?')
  } else if (!logContains('media-director', /social.?report|Social report/i, 100)) {
    check('social-listening → media-director', false,
      'social report generated but media-director shows no load confirmation',
      'Briefs may be running on stale persona signal',
      'Check media-director.log — social report load may have failed silently')
  } else {
    check('social-listening → media-director', true)
  }

  // brand-manager → media-director (weekly cadence)
  const bmAge = logAge('brand-manager')
  if (bmAge > H7D) {
    check('brand-manager → media-director', false,
      `brand-manager last ran ${Math.round(bmAge / H24)}d ago`,
      'media-director briefing on stale brand signal',
      'Force brand-manager run before tonight\'s brief?')
  } else {
    check('brand-manager → media-director', true)
  }

  // media-director → creative-agent
  const mdAge = logAge('media-director')
  const caAge = logAge('creative-agent')
  const briefsExist = (() => {
    try { return fs.readdirSync(path.join(ROOT, 'posts', 'briefs')).some(f => f.endsWith('-brief.txt')) } catch { return false }
  })()
  if (mdAge > H48) {
    check('media-director → creative-agent', false,
      `media-director has not run in ${Math.round(mdAge / H24)}d`,
      'No briefs generated. Content pipeline stalled.',
      'Check launchd status for com.bsv.media-director')
  } else if (mdAge < H24 && caAge > mdAge + 2 * 3600000) {
    check('media-director → creative-agent', false,
      'media-director ran but creative-agent did not follow within 2h',
      'Briefs not written — no content to distribute tonight',
      'Check creative-agent.log for API failures')
  } else if (!briefsExist) {
    check('media-director → creative-agent', false,
      'No brief files in posts/briefs/',
      'Nothing for distribute to pick up',
      'Run creative-agent manually for today\'s slots')
  } else {
    check('media-director → creative-agent', true)
  }

  // watch-drive → distribute
  const wdAge = logAge('watch-drive')
  if (wdAge > H24) {
    check('watch-drive → distribute', false,
      `watch-drive inactive for ${Math.round(wdAge / H24)}d`,
      'Nothing moving from Drive through pipeline. No posts distributing.',
      'Restart: node scripts/watch-drive.js')
  } else {
    check('watch-drive → distribute', true)
  }

  // gemini-bridge → image-gen / video-gen
  const gbAge = logAge('gemini-bridge')
  if (gbAge > H48) {
    check('gemini-bridge → image-gen / video-gen', false,
      `gemini-bridge has not run in ${Math.round(gbAge / H24)}d`,
      'No new media assets being generated for the pipeline',
      'Check gemini-bridge — it runs after media-director briefs slots')
  } else {
    check('gemini-bridge → image-gen / video-gen', true)
  }

  // eng-bot → log triage
  const ebAge = logAge('eng-bot')
  if (ebAge > H24) {
    check('eng-bot → log triage', false,
      'eng-bot has not run in 24h',
      'Pipeline errors accumulating without triage or alerts',
      'Check eng-bot launchd schedule')
  } else {
    check('eng-bot → log triage', true)
  }

  // update-handoff
  const uhAge = logAge('update-handoff')
  if (uhAge > H48) {
    check('update-handoff → Drive', false,
      'handoff not updated in 48h — BSV-Handoff.md stale',
      'Context gap on next session start',
      null)
  } else {
    check('update-handoff → Drive', true)
  }

  // cost-report spend tracking
  const crAge = logAge('cost-report')
  if (crAge > H24) {
    check('cost-report → spend tracking', false,
      'cost-report not run in 24h — spend untracked',
      'Balance alerts will not fire',
      null)
  } else {
    check('cost-report → spend tracking', true)
  }

  // Orphaned brief detection — brief exists, not distributed, >3h old
  const orphanedBriefs = []
  try {
    const briefFiles = fs.readdirSync(path.join(ROOT, 'posts', 'briefs')).filter(f => f.endsWith('-brief.txt'))
    const postState  = (() => { try { const p = path.join(ROOT, 'logs', 'post-state.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [] } catch { return [] } })()
    const distributed = new Set((Array.isArray(postState) ? postState : []).filter(e => e.status === 'success').map(e => e.slot))
    for (const brief of briefFiles) {
      const slot  = brief.replace('-brief.txt', '')
      const mtime = fs.statSync(path.join(ROOT, 'posts', 'briefs', brief)).mtimeMs
      if ((now - mtime) > 3 * 3600000 && !distributed.has(slot)) orphanedBriefs.push(slot)
    }
  } catch {}

  // Rogue agent detection — placeholder for future signal (requires schedule metadata)
  const rogueAgents = []

  const allGreen = checks.every(c => c.ok) && orphanedBriefs.length === 0
  log(`Ecosystem: ${allGreen ? 'all green' : checks.filter(c => !c.ok).length + ' break(s), orphaned=' + orphanedBriefs.join(',') || 'none'}`)
  return { checks, allGreen, orphanedBriefs, rogueAgents }
}

function formatEcosystemCheckText(ecosystem) {
  if (ecosystem.allGreen) return 'Ecosystem intact. All agents connected overnight.'
  const lines = []
  for (const c of ecosystem.checks) {
    if (c.ok) {
      lines.push(`✅ ${c.label}`)
    } else {
      lines.push(`❌ ${c.label}`)
      lines.push(`   ${c.issue}`)
      if (c.downstreamImpact) lines.push(`   ${c.downstreamImpact}`)
      if (c.decision) lines.push(`   Decision needed: ${c.decision}`)
    }
  }
  if (ecosystem.orphanedBriefs.length) {
    lines.push(`⚠️ Orphaned briefs (written, never distributed): ${ecosystem.orphanedBriefs.join(', ')}`)
    lines.push(`   Decision needed: check watch-drive and distribute logs for these slots`)
  }
  if (ecosystem.rogueAgents.length) {
    lines.push(`🚨 Rogue agents (ran without upstream directive): ${ecosystem.rogueAgents.join(', ')}`)
  }
  return lines.join('\n')
}

// ─── Directive options ────────────────────────────────────────────────────────

function saveDirectiveOptions(options) {
  const p = path.join(ROOT, 'logs', `chief-options-${DATE_STAMP}.json`)
  fs.writeFileSync(p, JSON.stringify({ date: DATE_STAMP, sentAt: new Date().toISOString(), options }, null, 2))
}

function loadDirectiveOptions(dateStamp) {
  try {
    const p = path.join(ROOT, 'logs', `chief-options-${dateStamp}.json`)
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
  } catch { return null }
}

function parseDirectiveOptions(standupText) {
  const options = []
  const re = /### Option (\d) — ([^\n]+)\n[\s\S]*?\*\*DIRECTIVE:\*\*\s*([^\n]+)/g
  let m
  while ((m = re.exec(standupText)) !== null) {
    const block   = standupText.slice(m.index, m.index + 600)
    const personaM = block.match(/\*\*Persona:\*\*\s*([^|*\n]+)/)
    const voiceM   = block.match(/\*\*Voice:\*\*\s*([^|*\n]+)/)
    const laneM    = block.match(/\*\*Lane:\*\*\s*([^|*\n]+)/)
    options.push({
      number:    parseInt(m[1]),
      label:     m[2].trim(),
      directive: m[3].trim(),
      persona:   personaM?.[1]?.trim() ?? null,
      voice:     voiceM?.[1]?.trim() ?? null,
      lane:      laneM?.[1]?.trim() ?? null,
    })
  }
  return options.slice(0, 3)
}

function writeDirectiveToDrive(option, dateStamp) {
  const content = [
    `# BSV Daily Directive — ${dateStamp}`,
    ``,
    `**Option ${option.number} — ${option.label}**`,
    `Persona: ${option.persona || 'default'} | Voice: ${option.voice || 'default'} | Lane: ${option.lane || 'default'}`,
    ``,
    `## Directive`,
    option.directive,
  ].join('\n')
  const localPath = path.join(TEMP_DIR, `daily-directive-${dateStamp}.md`)
  fs.writeFileSync(localPath, content)
  execSync(`rclone copyto "${localPath}" "${REMOTE}/Plans/daily-directive-${dateStamp}.md"`, { stdio: ['pipe', 'pipe', 'pipe'] })
  log(`Directive → Drive: Plans/daily-directive-${dateStamp}.md`)
}

// ─── Lounge article approval → MDX write + git push ──────────────────────────

async function approveLoungeArticle(pendingItem) {
  const meta     = pendingItem.metadata || {}
  const slug     = meta.slug
  const draftFile = pendingItem.driveFile   // e.g. "the-upgrade-path-DRAFT.md"
  const tempDir  = path.join(os.homedir(), 'tmp', 'bsv-chief-lounge')
  fs.mkdirSync(tempDir, { recursive: true })

  log(`  Lounge approve: downloading ${draftFile}...`)
  try {
    execSync(`rclone copy "${REMOTE}/The Lounge/${draftFile}" "${tempDir}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
    })
  } catch (err) {
    throw new Error(`rclone download failed — ${err.message}`)
  }

  const localDraft = path.join(tempDir, draftFile)
  if (!fs.existsSync(localDraft)) throw new Error(`DRAFT.md not found locally after download`)

  const draftContent = fs.readFileSync(localDraft, 'utf8')

  // Extract H1 title
  const titleMatch = draftContent.match(/^#\s+(.+)$/m)
  const title      = titleMatch ? titleMatch[1].trim() : meta.title || slug

  // Body = everything after the H1 line, minus leading blank lines
  const h1End = draftContent.indexOf('\n', draftContent.indexOf(title))
  const body  = draftContent.slice(h1End + 1).replace(/^\n+/, '')

  // Build MDX
  const tags = (meta.tags || []).map(t => `"${t}"`).join(', ')
  const mdx  = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `slug: ${slug}`,
    `date: "${meta.publishDate}"`,
    `excerpt: "${(meta.excerpt || '').replace(/"/g, '\\"')}"`,
    `chapter: ${meta.chapter}`,
    `type: ${meta.articleType}`,
    `tags: [${tags}]`,
    '---',
    '',
    body.trim(),
  ].join('\n')

  const mdxPath = path.join(ROOT, 'content', 'lounge', `${slug}.mdx`)
  fs.writeFileSync(mdxPath, mdx)
  log(`  Lounge approve: wrote ${mdxPath}`)

  // Git commit + push
  try {
    execSync(`git add "${path.join('content', 'lounge', `${slug}.mdx`)}"`, { cwd: ROOT, stdio: 'pipe' })
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim()
    if (status) {
      execSync(`git commit -m "feat: lounge article approved — ${slug} (${meta.publishDate})"`, { cwd: ROOT, stdio: 'pipe' })
      require('./git-push-guard').safePushToPreview(ROOT, log)
      log(`  Lounge approve: pushed ${slug}.mdx`)
    } else {
      log(`  Lounge approve: no diff — MDX already matches draft`)
    }
  } catch (err) {
    log(`WARNING: git push failed — ${err.message}`)
  }

  await sendTelegram(
    `✅ *Lounge article approved and published*\n*${title}*\nChapter ${meta.chapter} — ${meta.articleType}\nPublishes: ${meta.publishDate}\n/the-lounge/${slug}`
  )
  log(`  Lounge approve: complete for ${slug}`)
}

// ─── Two-way Telegram inbox ───────────────────────────────────────────────────

async function processTelegramInbox() {
  log('Telegram inbox: fetching updates...')
  const messages = await fetchUpdates()
  if (!messages.length) { log('Telegram inbox: no new messages'); return }

  log(`Telegram inbox: ${messages.length} new message(s)`)
  const pending = loadPendingItems()
  let pendingChanged = false

  for (const msg of messages) {
    // Numeric directive choice (1/2/3) — intercept before keyword flow
    if (/^[123]$/.test(msg.text.trim())) {
      const numChoice = parseInt(msg.text.trim())
      log(`Telegram inbox: directive choice "${numChoice}"`)
      const opts = loadDirectiveOptions(DATE_STAMP)
      if (opts?.options?.length) {
        const chosen = opts.options.find(o => o.number === numChoice)
        if (chosen) {
          try {
            writeDirectiveToDrive(chosen, DATE_STAMP)
            sendTelegram(`✅ Option ${numChoice} — ${chosen.label}\nDirective live for tonight's media-director run.`).then(r => {
              if (r?.message_id) log(`Directive confirm — message_id: ${r.message_id}`)
            })
            log(`Directive: option ${numChoice} "${chosen.label}" written to Drive`)
          } catch (err) {
            log(`ERROR: directive write failed — ${err.message}`)
            sendTelegram(`⚠️ Failed to write directive: ${err.message}`).then(() => {})
          }
        } else {
          log(`No option ${numChoice} in today's options file`)
        }
      } else {
        log(`No options file for ${DATE_STAMP}`)
        sendTelegram(`⚠️ No options loaded for today. Standup may not have completed.`).then(() => {})
      }
      continue
    }

    const keyword = parseInboxKeyword(msg.text)
    log(`Telegram inbox: "${msg.text}" → keyword=${keyword ?? 'none'}`)
    if (!keyword) continue

    const target = pending.find(i => !i._resolved)
    if (!target) { log('Telegram inbox: no pending items to resolve'); continue }

    log(`Telegram inbox: resolving ${target.id} → ${keyword}`)
    target._resolved   = true
    target._resolvedBy  = 'telegram'
    target._resolvedAt  = new Date().toISOString()
    target._decision    = keyword
    pendingChanged = true

    if (keyword === 'approved') {
      log(`  APPROVED: ${target.metadata?.title || target.id}`)
      if (target.type === 'chief') {
        const title = target.metadata?.title || ''
        const angle = target.metadata?.angle || ''
        const slug  = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
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
      } else if (target.type === 'lounge-draft') {
        approveLoungeArticle(target).then(() => {}).catch(err => {
          log(`ERROR: lounge-draft approval failed — ${err.message}`)
          sendTelegram(`⚠️ Lounge article commit failed: ${err.message}`).then(() => {})
        })
      } else if (target.type === 'social-draft') {
        const slot      = target.metadata?.slot || ''
        const briefDir  = path.join(ROOT, 'posts', 'briefs')
        const pendingDir = path.join(briefDir, 'pending')
        const pendingPath = path.join(pendingDir, `${slot}-brief.txt`)
        const livePath   = path.join(briefDir, `${slot}-brief.txt`)
        if (fs.existsSync(pendingPath)) {
          fs.mkdirSync(briefDir, { recursive: true })
          fs.renameSync(pendingPath, livePath)
          log(`  Social draft approved: moved ${slot}-brief.txt to briefs/`)
        }
        sendTelegram(`✅ Social draft approved: ${slot}\nBrief is live for next gemini-bridge run.`).then(r => {
          if (r?.message_id) log(`Telegram social-draft confirm — message_id: ${r.message_id}`)
        })
      } else if (target.type === 'content-gate') {
        const slot = target.metadata?.slot || ''
        const approvedSlotsFile = path.join(ROOT, 'logs', 'approved-slots.json')
        let approvedSlots = {}
        try { if (fs.existsSync(approvedSlotsFile)) approvedSlots = JSON.parse(fs.readFileSync(approvedSlotsFile, 'utf8')) } catch {}
        approvedSlots[slot] = new Date().toISOString()
        fs.writeFileSync(approvedSlotsFile, JSON.stringify(approvedSlots, null, 2))
        log(`  Content gate approved: ${slot} added to approved-slots.json`)
        sendTelegram(`✅ Content approved: \`${slot}\`\nWill distribute on next poll.`).then(r => {
          if (r?.message_id) log(`Telegram content-gate confirm — message_id: ${r.message_id}`)
        })
      } else if (target.type === 'video-gate') {
        const slot      = target.metadata?.slot || ''
        const stagePath = `big sole vibes:Big Sole Vibes/Video Review/${slot}.mp4`
        const destPath  = `big sole vibes:Big Sole Vibes/Ready to Post/${slot}.mp4`
        try {
          execSync(`rclone moveto "${stagePath}" "${destPath}"`, { stdio: 'pipe' })
          log(`  Video gate approved: ${slot}.mp4 moved to Ready to Post`)
          sendTelegram(`✅ Video approved: \`${slot}.mp4\` moved to Ready to Post.\nWill process on next watch-drive poll.`).then(r => {
            if (r?.message_id) log(`Telegram video-gate confirm — message_id: ${r.message_id}`)
          })
        } catch (err) {
          log(`  WARNING: video-gate move failed — ${err.message}`)
          sendTelegram(`⚠️ Video approval failed: ${err.message.slice(0, 120)}`).then(() => {})
        }
      }
    } else if (keyword === 'denied') {
      log(`  DENIED: ${target.id}`)
      if (target.type === 'social-draft') {
        const slot        = target.metadata?.slot || ''
        const pendingPath = path.join(ROOT, 'posts', 'briefs', 'pending', `${slot}-brief.txt`)
        const livePath    = path.join(ROOT, 'posts', 'briefs', `${slot}-brief.txt`)
        if (fs.existsSync(pendingPath)) { try { fs.unlinkSync(pendingPath) } catch {} }
        if (fs.existsSync(livePath))    { try { fs.unlinkSync(livePath) }   catch {} }
        log(`  Social-draft denied: brief removed for slot ${slot}`)
      } else if (target.type === 'content-gate') {
        const slot = target.metadata?.slot || ''
        log(`  Content gate denied: ${slot} — slot will not distribute until re-uploaded`)
        sendTelegram(`❌ Content denied: \`${slot}\`\nRemove and re-upload to Drive to requeue.`).then(() => {})
      } else if (target.type === 'video-gate') {
        const slot      = target.metadata?.slot || ''
        const stagePath = `big sole vibes:Big Sole Vibes/Video Review/${slot}.mp4`
        try {
          execSync(`rclone delete "${stagePath}"`, { stdio: 'pipe' })
          log(`  Video gate denied: ${slot}.mp4 deleted from Video Review`)
        } catch {}
        sendTelegram(`❌ Video rejected: \`${slot}.mp4\` deleted from Video Review.`).then(() => {})
      }
      sendTelegram(`❌ Denied: ${target.metadata?.title || target.id}`).then(r => {
        if (r?.message_id) log(`Telegram deny confirm — message_id: ${r.message_id}`)
      })
    } else if (keyword === 'hold') {
      log(`  HOLD: ${target.id} — deferring to tomorrow`)
      target._resolved   = false
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

// ─── Chief inbox (Drive fallback) ─────────────────────────────────────────────

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

  // Process Telegram inbox first — directive replies may have arrived overnight
  await processTelegramInbox()
  await processChiefInbox(client)

  // ── Data collection ───────────────────────────────────────────────────────

  log('P1: Revenue...')
  const revenue = await checkRevenue()

  log('P2: Posts...')
  const posts = checkPosts()

  log('P3: Agent health...')
  const agents = checkAgentHealth()

  log('P4: Growth...')
  const growth = checkGrowth()

  // Supporting context
  const tokenBudget = buildTokenBudget()
  const directive   = loadDriveFile(`${REMOTE}/BSV-Directive.md`, TEMP_DIR)
  const memory      = await (require('./lib/memory').loadMemoryById())
  const orgChart    = loadDriveFile(`${REMOTE}/BSV-Org.md`, TEMP_DIR)
  const handoff     = loadLatestHandoff()
  const socialReport = loadLatestReport('social-report')
  const costState = (() => {
    try { const p = path.join(ROOT, 'logs', 'cost-state.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null } catch { return null }
  })()

  log(`Context: directive=${!!directive}, memory=${!!memory}, social=${socialReport?.filename || 'none'}`)
  log(`Token budget: est $${tokenBudget.estTotal.toFixed(4)} (${tokenBudget.pct.toFixed(1)}% of $${DAILY_API_CEILING})`)

  // Post performance — annotated with persona/voice from briefs
  log('Loading post performance (7 days)...')
  const performance = loadPostPerformance(7)
  const overnight   = performance.filter(p => new Date(p.timestamp).getTime() > Date.now() - 24 * 3600000)
  log(`Performance: ${performance.length} post(s) in 7 days, ${overnight.length} in last 24h`)

  // Best-effort Instagram insights for overnight posts
  for (const p of overnight.filter(p => p.platform === 'instagram' && p.postId)) {
    const insights = await fetchInstagramInsights(p.postId)
    if (insights) p.insights = insights
  }

  // P0: Ecosystem integrity — runs first, feeds Section 0
  log('P0: Ecosystem integrity...')
  const ecosystem = checkEcosystemIntegrity(agents)
  const ecosystemCheckText = formatEcosystemCheckText(ecosystem)
  log(`Ecosystem: ${ecosystem.allGreen ? 'all green' : ecosystem.checks.filter(c => !c.ok).length + ' break(s)'}`)

  // Real blockers — things stopped that need Big D
  const realBlockers = []
  if (!revenue.linksDeployed) realBlockers.push('Affiliate links not deployed — zero revenue possible')
  if (posts.gaps.length)      realBlockers.push(`${posts.gaps.join(', ')} missed — caption files never uploaded`)
  for (const i of agents.issues.filter(i => i.severity === 'error' && AGENT_ROSTER.find(a => a.name === i.name)?.essential).slice(0, 2)) {
    realBlockers.push(`${i.name} down — ${i.msg.slice(0, 80)}`)
  }

  // ── Claude strategic brief ────────────────────────────────────────────────
  // Claude runs BEFORE Telegram so the three options are available in the message.

  const fmtCost = (n) => `$${n.toFixed(4)}`
  const tokenSection = [
    `Ceiling: $${DAILY_API_CEILING.toFixed(2)} | Spend: ${tokenBudget.officialTotal != null ? fmtCost(tokenBudget.officialTotal) + ' (official)' : fmtCost(tokenBudget.estTotal) + ' (est)'} — ${tokenBudget.pct.toFixed(1)}%`,
    tokenBudget.breakdown.length
      ? tokenBudget.breakdown.map(a => `  ${a.name}: ${a.calls} call(s), ${fmtCost(a.cost)}`).join('\n')
      : '  No Claude calls today.',
  ].join('\n')

  const perfLines = performance.length
    ? performance.map(p => {
        const date = new Date(p.timestamp).toISOString().slice(0, 10)
        const ig = p.insights ? `impressions=${p.insights.impressions ?? '?'} reach=${p.insights.reach ?? '?'} saved=${p.insights.saved ?? '?'}` : 'no engagement data'
        return `${date} | ${p.slot} | ${p.persona ?? 'unknown'} / ${p.voice ?? 'unknown'} / ${p.lane ?? 'unknown'} | ${ig}`
      }).join('\n')
    : '(no post history in last 7 days)'

  const overnightLines = overnight.length
    ? overnight.map(p => {
        const ig = p.insights ? `impressions: ${p.insights.impressions ?? 'n/a'}, reach: ${p.insights.reach ?? 'n/a'}, saved: ${p.insights.saved ?? 'n/a'}` : 'no API data'
        return `${p.slot} (${p.persona ?? 'unknown'} / ${p.voice ?? 'unknown'}): ${ig}`
      }).join('\n')
    : 'No posts in last 24h'

  const tomorrowSlug = DOW_TO_SLUG[(_now.getDay() + 1) % 7]

  const standupSystem = [directive, memory, orgChart].filter(Boolean).join('\n\n---\n\n')
    + `\n\n## Agent Ecosystem Registry\n${AGENT_ECOSYSTEM_REGISTRY}`
    + `\n\n${ECOSYSTEM_MANDATE}`
    + `\n\nYou are the BSV Chief of Staff — the Proprietor's most trusted advisor and the standard-bearer for everything that leaves this pipeline. Your job: confirm the ecosystem is intact, surface what is waiting for review, name what the data says, and present exactly three strategic options. He chooses. Then it happens. Statements not questions. Confident. Brief. No filler. Nothing ships without your clearance. The Proprietor runs the room.`

  const standupUser = `Today is ${DAY_NAME} ${DATE_STAMP}.

## Pre-Computed Ecosystem Check (Section 0 — use verbatim)
${ecosystemCheckText}

## Revenue
Yesterday: ${revenue.available ? `$${revenue.yesterday.amount.toFixed(2)} (${revenue.yesterday.commissions} commissions)` : 'no data'} | Week: ${revenue.available ? `$${revenue.week.amount.toFixed(2)}` : 'no data'}
Affiliate links: ${revenue.linksDeployed ? `live (${revenue.shopLinkCount} in shop)` : 'NOT deployed'}

## Overnight Post Performance (last 24h)
${overnightLines}

## 7-Day Post History (persona / voice / lane / engagement)
${perfLines}

## Growth
${growth.total != null ? `${growth.total.toLocaleString()} total subscribers | ${growth.trend}` : `No subscriber data | ${growth.trend}`}

## Social Intelligence (${socialReport?.filename || 'none'})
${socialReport ? socialReport.content.slice(0, 1400) : '(not available)'}

## Agent Issues
${agents.issues.length ? agents.issues.map(i => `${i.name} [${i.severity}]: ${i.msg}`).join('\n') : 'None'}

## Budget
${tokenSection}
${costState ? `Balance: ${costState.balance != null ? '$' + costState.balance.toFixed(2) : 'unknown'} | Runway: ${costState.runway_hours != null ? costState.runway_hours.toFixed(0) + 'h' : 'unknown'}` : ''}

---

Produce this EXACT format. Section 0 content is pre-computed above — use it verbatim. DIRECTIVE lines are parsed by the pipeline and must be on one line each.

# BSV — ${DAY_NAME}, ${DATE_STAMP}

## 0 — Ecosystem Integrity Check
[Insert the pre-computed ecosystem check text verbatim from above]

## 1 — Overnight Scorecard
[Each overnight post: slot, persona, voice, performance data or "no data". Never skip this section. If no posts ran, say so.]

## 2 — What The Data Is Saying
[One paragraph. Pattern recognition across the 7-day history — which persona performing, which voice converting, which lane flat. If fewer than 7 days of data, say so. No fluff.]

## 3 — Three Strategic Directions
[Three options for today. Each option in EXACTLY this format:]

### Option 1 — [LABEL IN CAPS]
- **Prioritizes:** [one sentence]
- **Trades off:** [one sentence]
- **Persona:** [name] | **Voice:** [name] | **Lane:** [name]
- **DIRECTIVE:** [one sentence telling media-director exactly what angle to run today]

### Option 2 — [LABEL IN CAPS]
- **Prioritizes:** [one sentence]
- **Trades off:** [one sentence]
- **Persona:** [name] | **Voice:** [name] | **Lane:** [name]
- **DIRECTIVE:** [one sentence directive]

### Option 3 — [LABEL IN CAPS]
- **Prioritizes:** [one sentence]
- **Trades off:** [one sentence]
- **Persona:** [name] | **Voice:** [name] | **Lane:** [name]
- **DIRECTIVE:** [one sentence directive]

## 4 — Blockers Requiring Big D Decision
[Real blockers only — things stopped that need a human decision. Max 3. If none: "No decisions needed today."]

## 5 — Tonight's Pipeline
[Exactly two sentences. What runs, what time, any known risk.]`

  log('Calling Claude for strategic brief...')
  let standupText = ''
  try {
    const stream = await client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2800,
      system:     standupSystem,
      messages:   [{ role: 'user', content: standupUser }],
    })
    process.stdout.write('Generating brief')
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        standupText += event.delta.text
        process.stdout.write('.')
      }
    }
    process.stdout.write('\n')
    const finalMsg = await stream.finalMessage()
    log(`Brief done — ${finalMsg.usage?.output_tokens ?? '?'} tokens, stop: ${finalMsg.stop_reason}`)
  } catch (err) {
    process.stdout.write('\n')
    log(`ERROR: strategic brief API call failed — ${err.message}`)
  }

  // Parse and save directive options for Big D's numeric reply
  let directiveOptions = []
  if (standupText) {
    directiveOptions = parseDirectiveOptions(standupText)
    if (directiveOptions.length) {
      saveDirectiveOptions(directiveOptions)
      log(`Options saved: ${directiveOptions.map(o => `${o.number}. ${o.label}`).join(' | ')}`)
    } else {
      log('WARNING: no directive options parsed from brief — format may have drifted')
    }
  }

  // Upload strategic brief to Drive
  if (standupText.trim()) {
    const localOut = path.join(TEMP_DIR, outFile)
    try {
      fs.writeFileSync(localOut, standupText)
      rcloneCopyTo(localOut, `${REMOTE}/Reports/${outFile}`)
      log(`Brief uploaded → ${REMOTE}/Reports/${outFile}`)
    } catch (err) {
      log(`ERROR: brief upload — ${err.message}`)
    }
  }

  // ── Telegram standup ──────────────────────────────────────────────────────
  // Six sections (0–5). Section 0 is pre-computed locally — no Claude needed.

  const extractSection = (text, n) => {
    const m = text.match(new RegExp(`## ${n} —[^\\n]*\\n([\\s\\S]*?)(?=\\n## \\d|$)`))
    return m ? m[1].trim() : null
  }

  const signalParagraph = standupText ? extractSection(standupText, '2') : null
  const tonightSection  = standupText ? extractSection(standupText, '5') : null

  const optionLines = directiveOptions.length
    ? directiveOptions.map(o => `${o.number}️⃣ *${o.label}*${[o.persona, o.voice, o.lane].filter(Boolean).length ? ' — ' + [o.persona, o.voice, o.lane].filter(Boolean).join(' / ') : ''}`).join('\n')
    : '(options unavailable — check logs/chief-of-staff.log)'

  const blockerText = realBlockers.length
    ? realBlockers.slice(0, 3).map(b => `• ${b}`).join('\n')
    : 'No decisions needed today.'

  const allPendingNow    = loadPendingItems()
  const pendingEditorial = allPendingNow.filter(i => ['lounge-draft', 'social-draft'].includes(i.type))
  const pendingGates     = allPendingNow.filter(i => ['content-gate', 'video-gate'].includes(i.type))

  const editorialTg = pendingEditorial.length
    ? pendingEditorial.map(i => {
        const ageH  = Math.floor((Date.now() - new Date(i.sentAt).getTime()) / 3600000)
        const emoji = i.type === 'lounge-draft' ? '📖' : '📣'
        const flag  = ageH > 48 ? ' ⚠️ OVERDUE' : ''
        return `${emoji} ${i.metadata?.title || i.id} (${ageH}h)${flag}`
      }).join('\n')
    : null

  const contentGateTg = pendingGates.length
    ? pendingGates.map(i => {
        const ageH  = Math.floor((Date.now() - new Date(i.sentAt).getTime()) / 3600000)
        const emoji = i.type === 'video-gate' ? '🎬' : '🔒'
        const label = i.type === 'video-gate' ? `Video: ${i.metadata?.slot}` : `Content: ${i.metadata?.slot}`
        return `${emoji} ${label} (${ageH}h) — reply APPROVE or DENY`
      }).join('\n')
    : null

  // Section 0 Telegram summary — failures only (passes are noise on mobile)
  const ecosystemFails = ecosystem.checks.filter(c => !c.ok)
  const ecosystemTg = ecosystem.allGreen && !ecosystem.orphanedBriefs.length
    ? 'Ecosystem intact. All agents connected overnight.'
    : ecosystemFails.map(c => `❌ ${c.label}: ${c.issue}`).join('\n')
      + (ecosystem.orphanedBriefs.length ? `\n⚠️ Orphaned briefs: ${ecosystem.orphanedBriefs.join(', ')}` : '')

  const overnightTg = overnight.length
    ? overnight.map(p => {
        const d = p.insights ? `impressions: ${p.insights.impressions ?? 'n/a'}, reach: ${p.insights.reach ?? 'n/a'}` : 'no data'
        return `${p.slot} (${p.persona ?? '?'} / ${p.voice ?? '?'}): ${d}`
      }).join('\n')
    : 'No posts in last 24h.'

  const telegramParts = [
    `*BSV — ${DAY_NAME} ${DATE_STAMP}*`,
    ``,
    `*0 — ECOSYSTEM*`,
    ecosystemTg,
    ``,
    `*1 — OVERNIGHT*`,
    overnightTg,
    ``,
    `*2 — SIGNAL*`,
    signalParagraph ? signalParagraph.split('\n')[0].slice(0, 280) : '(brief unavailable)',
    ``,
    `*3 — TODAY'S CALL*`,
    optionLines,
    ``,
    `Reply 1, 2, or 3. No reply by 10AM = yesterday's directive runs.`,
    ``,
    ...(contentGateTg ? [
      `*🔴 HOLDING FOR YOUR REVIEW*`,
      contentGateTg,
      ``,
    ] : []),
    ...(editorialTg ? [
      `*🟡 PENDING EDITORIAL APPROVAL*`,
      editorialTg,
      `Reply APPROVE or DENY.`,
      ``,
    ] : []),
    `*4 — BLOCKERS*`,
    blockerText,
    ``,
    `*5 — TONIGHT*`,
    tonightSection
      ? tonightSection.split('\n').filter(Boolean).slice(0, 2).join(' ')
      : `social-listening 11PM, media-director 2AM (briefs ${tomorrowSlug}).`,
  ]

  const tgResult = await sendTelegram(telegramParts.join('\n'))
  if (tgResult?.message_id) log(`Standup Telegram delivered — message_id: ${tgResult.message_id}`)
  else log('WARNING: Standup Telegram returned no confirmation')

  // Alert critical agent failures individually
  for (const issue of agents.issues.filter(i => i.severity === 'error' && AGENT_ROSTER.find(a => a.name === i.name)?.essential)) {
    const tgAlert = await sendTelegram(`🚨 BSV — ${issue.name} error\n${issue.msg}\n\nFix: \`${issue.fix}\``)
    if (tgAlert?.message_id) log(`Telegram agent alert (${issue.name}) — message_id: ${tgAlert.message_id}`)
    else log(`WARNING: Telegram agent alert returned no confirmation (${issue.name})`)
  }

  // ── Handoff update ────────────────────────────────────────────────────────

  log('Handoff update...')
  let handoffText = ''
  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system:     (directive || '') + '\n\nYou are updating the BSV operational handoff. Return the complete document.',
      messages:   [{
        role: 'user', content: `Update the BSV operational handoff.

Today's brief:
${standupText || '(brief unavailable)'}

Previous handoff:
${handoff ? handoff.slice(0, 2000) : '(none)'}

Write the complete ${HANDOFF_FILENAME}. Sections: what BSV is, pipeline state, content queue, platform status, audience, product shelf, known issues, tonight's schedule, agent team. Direct and specific. No padding.`,
      }],
    })
    handoffText = msg.content[0]?.text?.trim() || ''
    log(`Handoff done — ${msg.usage?.output_tokens ?? '?'} tokens`)
  } catch (err) { log(`ERROR: handoff API — ${err.message}`) }

  if (handoffText) {
    const localHandoff = path.join(TEMP_DIR, HANDOFF_FILENAME)
    try {
      fs.writeFileSync(localHandoff, handoffText)
      rcloneCopyTo(localHandoff, `${REMOTE}/Handoff/${HANDOFF_FILENAME}`)
      log(`Handoff uploaded → ${REMOTE}/Handoff/${HANDOFF_FILENAME}`)
    } catch (err) { log(`ERROR: handoff upload — ${err.message}`) }
  }

  // ── Memory update ─────────────────────────────────────────────────────────

  log('Memory update...')
  try {
    const currentMem = await (require('./lib/memory').loadMemoryById())
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
      await require('./lib/memory').writeMemoryById(updatedMem)
      log(`Memory uploaded via memory.js`)
    } else {
      log('WARNING: memory update missing header — skipping upload')
    }
  } catch (err) { log(`ERROR: memory API — ${err.message}`) }

  // ── Lounge content approval ────────────────────────────────────────────────

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
  } catch (err) { log(`WARNING: Lounge approval failed — ${err.message}`) }

  // Second inbox pass — catch any replies that arrived during the run
  await processTelegramInbox()

  await watchBlogAgent()

  log('━━━ chief-of-staff complete ━━━\n')
})()
