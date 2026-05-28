require('dotenv').config()
const { execSync }     = require('child_process')
const path             = require('path')
const fs               = require('fs')
const os               = require('os')
const { sendTelegram, fetchUpdates, parseInboxKeyword } = require('./telegram')
const {
  addPendingItem,
  loadPendingItems,
  savePendingItems,
} = require('./telegram-queue')

const ROOT           = path.join(__dirname, '..')
const LOG_FILE       = path.join(ROOT, 'logs', 'chief-of-staff.log')
const TEMP_DIR       = path.join(os.homedir(), 'tmp', 'bsv-chief-of-staff')
const REMOTE         = 'big sole vibes:Big Sole Vibes'
const ORG_CHART_FILE = path.join(ROOT, 'logs', 'org-chart-state.json')

const _now       = new Date()
const DATE_STAMP = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`
const DAY_NAME   = _now.toLocaleDateString('en-US', { weekday: 'long' })

const DAILY_API_CEILING = 2.00

// ─── Agent roster ─────────────────────────────────────────────────────────────
// tier 1: autonomous — runs and completes without approval
// tier 2: report and wait — output requires Big D review before downstream action
// tier 3: full stop — explicit Big D directive required before running

const AGENT_ROSTER = [
  { name: 'watch-drive',         tier: 1, essential: true,  weekly: false, role: 'pipeline orchestrator',         schedule: 'continuous'         },
  { name: 'eng-bot',             tier: 1, essential: true,  weekly: false, role: 'log triage + error alerts',     schedule: 'per-poll'           },
  { name: 'social-listening',    tier: 1, essential: false, weekly: false, role: 'persona intelligence',          schedule: 'daily'              },
  { name: 'media-director',      tier: 2, essential: true,  weekly: false, role: 'daily brief + creative chain',  schedule: 'daily 2AM'          },
  { name: 'creative-agent',      tier: 2, essential: true,  weekly: false, role: 'social brief writer',           schedule: 'via media-director' },
  { name: 'distribute',          tier: 2, essential: false, weekly: false, role: 'multi-platform distributor',    schedule: 'via watch-drive'    },
  { name: 'gemini-bridge',       tier: 2, essential: false, weekly: false, role: 'AI media generation bridge',    schedule: 'via media-director' },
  { name: 'image-gen',           tier: 2, essential: false, weekly: false, role: 'image generation',             schedule: 'on-demand'          },
  { name: 'video-gen',           tier: 2, essential: false, weekly: false, role: 'video generation + gate',      schedule: 'on-demand'          },
  { name: 'resize-post',         tier: 1, essential: false, weekly: false, role: 'platform image resizer',       schedule: 'via watch-drive'    },
  { name: 'brand-image',         tier: 1, essential: false, weekly: false, role: 'logo overlay on images',       schedule: 'via watch-drive'    },
  { name: 'brand-video',         tier: 1, essential: false, weekly: false, role: 'logo + audio on videos',       schedule: 'via watch-drive'    },
  { name: 'update-handoff',      tier: 1, essential: false, weekly: false, role: 'nightly handoff writer',       schedule: 'nightly 4AM'        },
  { name: 'change-agent',        tier: 1, essential: true,  weekly: false, role: 'commit monitor + issues',      schedule: 'on-commit'          },
  { name: 'brand-manager',       tier: 1, essential: false, weekly: true,  role: 'weekly brand audit',           schedule: 'weekly'             },
  { name: 'marketing-manager',   tier: 1, essential: false, weekly: true,  role: 'weekly marketing analysis',    schedule: 'weekly'             },
  { name: 'product-research',    tier: 2, essential: false, weekly: true,  role: 'affiliate product research',   schedule: 'weekly'             },
  { name: 'cj-research',         tier: 2, essential: false, weekly: true,  role: 'CJ affiliate research',        schedule: 'weekly'             },
  { name: 'blog-agent',          tier: 2, essential: false, weekly: true,  role: 'Sole Report article writer',   schedule: 'weekly Sunday'      },
  { name: 'promote-sole-report', tier: 1, essential: false, weekly: true,  role: 'Sole Report distribution',    schedule: 'weekly'             },
  { name: 'cost-report',         tier: 1, essential: false, weekly: false, role: 'daily API spend tracker',      schedule: 'daily'              },
  { name: 'product-development', tier: 3, essential: false, weekly: false, role: 'product strategy research',    schedule: 'on-directive'       },
  { name: 'sync-shop',           tier: 2, essential: false, weekly: false, role: 'Locker Room page generator',   schedule: 'on-approval'        },
]

// ─── Agent dependency map ─────────────────────────────────────────────────────

const AGENT_DEPENDENCIES = [
  {
    producer:    'social-listening',
    consumer:    'product-research',
    description: 'Social report feeds product search targets',
    checkPath:   'Big Sole Vibes/Reports/',
    filePattern: 'social-report-',
    maxAgeHours: 48,
  },
  {
    producer:    'social-listening',
    consumer:    'media-director',
    description: 'Social report feeds content brief',
    checkPath:   'Big Sole Vibes/Reports/',
    filePattern: 'social-report-',
    maxAgeHours: 24,
  },
  {
    producer:    'media-director',
    consumer:    'creative-agent',
    description: 'Media brief feeds caption generation',
    checkPath:   'Big Sole Vibes/Ready to Post/',
    filePattern: '.md',
    maxAgeHours: 26,
  },
  {
    producer:    'media-director',
    consumer:    'blog-agent',
    description: 'Sole Report brief feeds blog-agent Sunday run',
    checkPath:   null,
    localPath:   'logs/watch-drive-state.json',
    stateKey:    '_sole_report_state',
    maxAgeHours: 168,
  },
  {
    producer:    'product-research',
    consumer:    'sync-shop',
    description: 'Approved sheet rows feed Locker Room',
    checkPath:   null,
    localPath:   'logs/product-research.log',
    maxAgeHours: 168,
  },
]

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
      const idx = ok.indexOf('change-agent')
      if (idx !== -1) ok.splice(idx, 1)
    }
  } catch {}

  log(`Agent health: ${ok.length} OK, ${issues.length} issue(s)`)
  for (const i of issues) log(`  [${i.severity}] ${i.name}: ${i.msg}`)
  return { ok, issues }
}

// ─── Priority 4: Growth (live APIs) ──────────────────────────────────────────

async function checkGrowthMetrics() {
  const result = {
    klaviyo:   { lounge: null, drop: null },
    bluesky:   { followers: null },
    instagram: { followers: null },
  }

  const klaviyoKey   = process.env.KLAVIYO_API_KEY
  const loungeListId = process.env.KLAVIYO_LOUNGE_LIST_ID
  const dropListId   = process.env.KLAVIYO_DROP_LIST_ID

  if (klaviyoKey) {
    const fetchKlaviyoCount = async (listId) => {
      if (!listId) return null
      try {
        const res = await fetch(
          `https://a.klaviyo.com/api/lists/${listId}/?fields[list]=profile_count`,
          { headers: { 'Authorization': `Klaviyo-API-Key ${klaviyoKey}`, 'revision': '2024-10-15' } }
        )
        if (!res.ok) return null
        const data = await res.json()
        return data?.data?.attributes?.profile_count ?? null
      } catch { return null }
    }
    const [lounge, drop] = await Promise.all([
      fetchKlaviyoCount(loungeListId),
      fetchKlaviyoCount(dropListId),
    ])
    result.klaviyo.lounge = lounge
    result.klaviyo.drop   = drop
  }

  const bskyHandle = process.env.BLUESKY_HANDLE
  if (bskyHandle) {
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(bskyHandle)}`)
      if (res.ok) {
        const data = await res.json()
        result.bluesky.followers = data?.followersCount ?? null
      }
    } catch {}
  }

  const metaToken   = process.env.META_ACCESS_TOKEN
  const igAccountId = process.env.META_IG_ACCOUNT_ID
  if (metaToken && igAccountId) {
    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${igAccountId}?fields=followers_count&access_token=${metaToken}`)
      if (res.ok) {
        const data = await res.json()
        result.instagram.followers = data?.followers_count ?? null
      }
    } catch {}
  }

  log(`Growth: klaviyo lounge=${result.klaviyo.lounge ?? 'n/a'} drop=${result.klaviyo.drop ?? 'n/a'}, bluesky=${result.bluesky.followers ?? 'n/a'}, instagram=${result.instagram.followers ?? 'n/a'}`)
  return result
}

// ─── Ecosystem integrity ──────────────────────────────────────────────────────

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

  const allGreen = checks.every(c => c.ok) && orphanedBriefs.length === 0
  log(`Ecosystem: ${allGreen ? 'all green' : checks.filter(c => !c.ok).length + ' break(s), orphaned=' + orphanedBriefs.join(',') || 'none'}`)
  return { checks, allGreen, orphanedBriefs }
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
  return lines.join('\n')
}

// ─── Chapter state ────────────────────────────────────────────────────────────
// Reads _chapter_state from watch-drive-state.json.
// Write ownership belongs to media-director.

const CHAPTER_STATE_DEFAULTS = {
  active:         1,
  name:           'The Bathroom Cabinet',
  productTease:   'The soap story. The man looked at it and for the first time actually looked at it.',
  articlesLive:   'hub, spoke 1, spoke 2 (spoke 3 pending)',
  campfireFormat: 'The Confession',
  loungeUrl:      'bigsolevibes.com/the-lounge/the-upgrade-path',
}

function loadChapterState() {
  try {
    const p = path.join(ROOT, 'logs', 'watch-drive-state.json')
    if (!fs.existsSync(p)) return { ...CHAPTER_STATE_DEFAULTS }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    return raw._chapter_state
      ? { ...CHAPTER_STATE_DEFAULTS, ...raw._chapter_state }
      : { ...CHAPTER_STATE_DEFAULTS }
  } catch { return { ...CHAPTER_STATE_DEFAULTS } }
}

function buildActiveChapterBlock(cs) {
  return [
    '## ACTIVE CHAPTER ARC',
    `ACTIVE CHAPTER: Chapter ${cs.active} — ${cs.name}`,
    `ACTIVE PRODUCT TEASE: ${cs.productTease}`,
    `CHAPTER ARTICLES LIVE: ${cs.articlesLive}`,
    `CAMPFIRE FORMAT THIS WEEK: ${cs.campfireFormat}`,
    `LOUNGE URL: ${cs.loungeUrl}`,
  ].join('\n')
}

// ─── Sole Report state ────────────────────────────────────────────────────────

const SOLE_REPORT_DEFAULTS = {
  week:       1,
  topic_area: 'Face',
  title:      'The Bar of Soap Is Not Fine: What Men\'s Face Care Actually Looks Like in 2026',
  status:     'DRAFT NEEDED',
  updated:    new Date().toISOString().slice(0, 10),
}

function loadSoleReportState() {
  try {
    const p = path.join(ROOT, 'logs', 'watch-drive-state.json')
    if (!fs.existsSync(p)) return { ...SOLE_REPORT_DEFAULTS }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    return raw._sole_report_state
      ? { ...SOLE_REPORT_DEFAULTS, ...raw._sole_report_state }
      : { ...SOLE_REPORT_DEFAULTS }
  } catch { return { ...SOLE_REPORT_DEFAULTS } }
}

function buildSoleReportBlock(srs) {
  const daysSince = Math.floor((Date.now() - new Date(srs.updated || '2026-01-01').getTime()) / 86400000)
  const overdue   = srs.status === 'DRAFT NEEDED' && daysSince >= 7
  return [
    '## SOLE REPORT QUEUE',
    `Week ${srs.week} | Topic: ${srs.topic_area}`,
    `Title: ${srs.title}`,
    `Status: ${srs.status}${overdue ? ` ⚠️ OVERDUE (${daysSince}d)` : ''}`,
  ].join('\n')
}

// ─── Cost state ───────────────────────────────────────────────────────────────

function readCostState() {
  try {
    const p = path.join(ROOT, 'logs', 'cost-state.json')
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
  } catch { return null }
}

// ─── Org chart state ──────────────────────────────────────────────────────────

function updateOrgChartState() {
  const now = Date.now()
  const agents = {}

  for (const agent of AGENT_ROSTER) {
    const logPath = path.join(ROOT, 'logs', `${agent.name}.log`)
    let status   = 'never-run'
    let lastSeen = null
    let lastError = null

    if (fs.existsSync(logPath)) {
      const mtime = fs.statSync(logPath).mtimeMs
      lastSeen    = new Date(mtime).toISOString()
      const ageMins   = (now - mtime) / 60000
      const staleMins = agent.weekly ? 7 * 24 * 60 : 120

      try {
        const lines  = fs.readFileSync(logPath, 'utf8').trim().split('\n')
        const errors = lines.slice(-60).filter(l => /^\[[^\]]+\]\s*(ERROR|CRASH|FATAL)/i.test(l))
        if (errors.length) {
          status    = 'error'
          lastError = errors[errors.length - 1].replace(/^\[[^\]]+\]\s*/, '').slice(0, 100)
        } else {
          status = ageMins > staleMins ? 'stale' : 'active'
        }
      } catch {
        status = 'active'
      }
    }

    agents[agent.name] = {
      tier:     agent.tier,
      role:     agent.role,
      schedule: agent.schedule,
      status,
      lastSeen,
      ...(lastError ? { lastError } : {}),
    }
  }

  const state = { lastUpdated: new Date().toISOString(), agents }
  fs.writeFileSync(ORG_CHART_FILE, JSON.stringify(state, null, 2))
  log(`Org chart updated: ${Object.keys(agents).length} agents`)
  return state
}

// ─── Breach detection ─────────────────────────────────────────────────────────
// Tier 3 agents that ran in the last 24h without explicit directive.

function detectBreach(orgChartState) {
  const H24      = 24 * 3600000
  const breaches = []

  for (const [name, info] of Object.entries(orgChartState.agents)) {
    if (info.tier !== 3) continue
    if (!info.lastSeen)  continue
    if (Date.now() - new Date(info.lastSeen).getTime() < H24) {
      breaches.push(`${name} ran autonomously — Tier 3 requires Big D directive`)
    }
  }

  if (breaches.length) log(`BREACH: ${breaches.join('; ')}`)
  return breaches
}

// ─── Lounge article approval → MDX write + git push ──────────────────────────

async function approveLoungeArticle(pendingItem) {
  const meta      = pendingItem.metadata || {}
  const slug      = meta.slug
  const draftFile = pendingItem.driveFile
  const tempDir   = path.join(os.homedir(), 'tmp', 'bsv-chief-lounge')
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
  const titleMatch   = draftContent.match(/^#\s+(.+)$/m)
  const title        = titleMatch ? titleMatch[1].trim() : meta.title || slug
  const h1End        = draftContent.indexOf('\n', draftContent.indexOf(title))
  const body         = draftContent.slice(h1End + 1).replace(/^\n+/, '')

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

// ─── Telegram inbox ───────────────────────────────────────────────────────────

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
        const slot       = target.metadata?.slot || ''
        const briefDir   = path.join(ROOT, 'posts', 'briefs')
        const pendingDir = path.join(briefDir, 'pending')
        const pendingPath = path.join(pendingDir, `${slot}-brief.txt`)
        const livePath    = path.join(briefDir, `${slot}-brief.txt`)
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

// ─── Agent dependency validation ─────────────────────────────────────────────

async function validateAgentDependencies() {
  const rcloneRemote = REMOTE.split(':')[0] + ':'
  const results      = []

  for (const dep of AGENT_DEPENDENCIES) {
    let status = 'DISCONNECTED'
    let detail = ''

    try {
      if (dep.checkPath !== null) {
        const remotePath = rcloneRemote + dep.checkPath
        let items = []
        try {
          const raw = execSync(`rclone lsjson "${remotePath}"`, {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000,
          })
          items = JSON.parse(raw || '[]')
        } catch { items = [] }

        const matches = items.filter(item => !item.IsDir && item.Name.includes(dep.filePattern))
        if (!matches.length) {
          detail = `no file matching "${dep.filePattern}" in Drive`
        } else {
          const newest = matches.reduce((a, b) => (a.ModTime > b.ModTime ? a : b))
          const ageH   = (Date.now() - new Date(newest.ModTime).getTime()) / 3600000
          if (ageH > dep.maxAgeHours) {
            detail = `stale ${Math.round(ageH)}h ago (limit: ${dep.maxAgeHours}h)`
          } else {
            status = 'CONNECTED'
            detail = `fresh ${Math.round(ageH)}h ago`
          }
        }
      } else if (dep.localPath) {
        const localPath = path.join(ROOT, dep.localPath)
        if (!fs.existsSync(localPath)) {
          detail = `${dep.localPath} not found`
        } else {
          const ageH = (Date.now() - fs.statSync(localPath).mtimeMs) / 3600000
          if (dep.stateKey) {
            let json = {}
            try { json = JSON.parse(fs.readFileSync(localPath, 'utf8')) } catch {}
            if (!json[dep.stateKey]) {
              detail = `${dep.stateKey} missing from state file`
            } else if (ageH > dep.maxAgeHours) {
              detail = `${dep.stateKey} stale ${Math.round(ageH / 24)}d ago`
            } else {
              status = 'CONNECTED'
              detail = 'brief current'
            }
          } else {
            if (ageH > dep.maxAgeHours) {
              detail = `log stale ${Math.round(ageH / 24)}d — check if weekly run completed`
            } else {
              status = 'CONNECTED'
              detail = `fresh ${Math.round(ageH)}h ago`
            }
          }
        }
      }
    } catch (err) {
      detail = `check error: ${err.message.slice(0, 60)}`
    }

    results.push({ producer: dep.producer, consumer: dep.consumer, status, detail })
  }

  const connected = results.filter(r => r.status === 'CONNECTED').length
  log(`Dependency audit: ${connected}/${results.length} connected`)
  return results
}

// ─── Standup builder (programmatic — no Claude) ───────────────────────────────

function buildStandupTelegram({ breach, ecosystem, posts, revenue, growth, agents, costState, pendingItems, chapterState, soleReportState, depResults }) {
  const parts = []

  // BREACH leads the entire message
  if (breach.length) {
    parts.push(`🚨 *BREACH DETECTED*`)
    for (const b of breach) parts.push(`• ${b}`)
    parts.push('')
  }

  parts.push(`*BSV — ${DAY_NAME} ${DATE_STAMP}*`, '')

  // 0 — Ecosystem
  const ecosystemFails = ecosystem.checks.filter(c => !c.ok)
  const ecosystemLine  = ecosystem.allGreen && !ecosystem.orphanedBriefs.length
    ? 'Ecosystem intact. All agents connected.'
    : ecosystemFails.map(c => `❌ ${c.label}: ${c.issue}`).join('\n')
      + (ecosystem.orphanedBriefs.length ? `\n⚠️ Orphaned: ${ecosystem.orphanedBriefs.join(', ')}` : '')
  parts.push('*0 — ECOSYSTEM*', ecosystemLine, '')

  // 1 — Pipeline (posts + gates)
  const pendingGates     = pendingItems.filter(i => ['content-gate', 'video-gate'].includes(i.type))
  const pendingEditorial = pendingItems.filter(i => ['lounge-draft', 'social-draft'].includes(i.type))

  const postLine = posts.gaps.length
    ? `⚠️ Missed: ${posts.gaps.join(', ')}`
    : posts.confirmed.length
      ? `✓ Posted: ${posts.confirmed.join(', ')}`
      : 'No slots expected in window'

  parts.push('*1 — PIPELINE*', postLine)

  if (posts.stuckMediaSlots.length) {
    parts.push(`⚠️ Stuck (media, no caption): ${posts.stuckMediaSlots.join(', ')}`)
  }

  if (pendingGates.length) {
    parts.push('')
    parts.push('*🔴 HOLDING FOR YOUR REVIEW*')
    for (const g of pendingGates) {
      const ageH  = Math.floor((Date.now() - new Date(g.sentAt).getTime()) / 3600000)
      const emoji = g.type === 'video-gate' ? '🎬' : '🔒'
      parts.push(`${emoji} ${g.metadata?.slot} (${ageH}h) — reply APPROVE or DENY`)
    }
  }

  if (pendingEditorial.length) {
    parts.push('')
    parts.push('*🟡 EDITORIAL PENDING*')
    for (const e of pendingEditorial) {
      const ageH  = Math.floor((Date.now() - new Date(e.sentAt).getTime()) / 3600000)
      const emoji = e.type === 'lounge-draft' ? '📖' : '📣'
      const flag  = ageH > 48 ? ' ⚠️ OVERDUE' : ''
      parts.push(`${emoji} ${e.metadata?.title || e.id} (${ageH}h)${flag}`)
    }
    parts.push('Reply APPROVE or DENY.')
  }
  parts.push('')

  // DEP — Agent dependency audit
  parts.push('*DEP — AGENT DEPENDENCIES*')
  if (depResults && depResults.length) {
    const depFails = depResults.filter(r => r.status === 'DISCONNECTED')
    if (depFails.length === 0) {
      parts.push('All handoffs connected.')
    } else {
      for (const r of depResults) {
        const mark = r.status === 'CONNECTED' ? '✓' : '✗'
        parts.push(`${mark} ${r.producer} → ${r.consumer} (${r.detail})`)
      }
    }
  } else {
    parts.push('Dependency audit unavailable.')
  }
  parts.push('')

  // 2 — Revenue
  const revLine = revenue.available
    ? `Yesterday: $${revenue.yesterday.amount.toFixed(2)} (${revenue.yesterday.commissions} commissions) | Week: $${revenue.week.amount.toFixed(2)}`
    : `Revenue data: ${revenue.error || 'unavailable'}`
  const linksLine = revenue.linksDeployed
    ? `Links: live (${revenue.shopLinkCount} in shop)`
    : 'Links: ⚠️ NOT deployed'
  parts.push('*2 — REVENUE*', revLine, linksLine)
  if (revenue.action) parts.push(`→ ${revenue.action}`)
  parts.push('')

  // 3 — Growth
  const gLines = []
  const kLounge = growth.klaviyo.lounge
  const kDrop   = growth.klaviyo.drop
  if (kLounge !== null || kDrop !== null) {
    gLines.push(`Klaviyo: Lounge ${kLounge !== null ? kLounge.toLocaleString() : '?'} | Drop ${kDrop !== null ? kDrop.toLocaleString() : '?'}`)
  } else {
    gLines.push('Klaviyo: no data')
  }
  if (growth.instagram.followers !== null) gLines.push(`Instagram: ${growth.instagram.followers.toLocaleString()} followers`)
  if (growth.bluesky.followers !== null)   gLines.push(`Bluesky: ${growth.bluesky.followers.toLocaleString()} followers`)
  parts.push('*3 — GROWTH*', ...gLines, '')

  // 4 — Agents
  parts.push('*4 — AGENTS*')
  if (agents.issues.length) {
    for (const i of agents.issues.slice(0, 5)) {
      parts.push(`${i.severity === 'error' ? '❌' : '⚠️'} ${i.name}: ${i.msg.slice(0, 80)}`)
    }
    if (agents.issues.length > 5) parts.push(`...and ${agents.issues.length - 5} more — check chief-of-staff.log`)
  } else {
    parts.push(`All ${agents.ok.length} agents OK`)
  }
  parts.push('')

  // 5 — Cost
  parts.push('*5 — COST*')
  if (costState) {
    const balance  = costState.balance   != null ? `$${costState.balance.toFixed(2)}`   : 'unknown'
    const runway   = costState.runway_hours != null ? `${costState.runway_hours.toFixed(0)}h` : 'unknown'
    const todayCost = costState.today_cost != null ? `$${costState.today_cost.toFixed(4)}` : 'unknown'
    const avgBurn  = costState.avg_daily_burn != null ? `$${costState.avg_daily_burn.toFixed(4)}/day` : null
    parts.push(`Balance: ${balance} | Runway: ${runway}`)
    parts.push(`Today: ${todayCost}${avgBurn ? ` | Avg: ${avgBurn}` : ''}`)
  } else {
    parts.push('Cost data unavailable — run cost-report.js')
  }
  parts.push('')

  // 6 — Chapter Arc
  parts.push('*6 — CHAPTER ARC*')
  parts.push(`Chapter ${chapterState.active} — ${chapterState.name}`)
  parts.push(chapterState.productTease)
  parts.push(`Articles: ${chapterState.articlesLive}`)
  parts.push(`Campfire: ${chapterState.campfireFormat} | ${chapterState.loungeUrl}`)
  parts.push('')

  // 7 — Sole Report
  const daysSince = Math.floor((Date.now() - new Date(soleReportState.updated || '2026-01-01').getTime()) / 86400000)
  const overdue   = soleReportState.status === 'DRAFT NEEDED' && daysSince >= 7
  parts.push('*7 — SOLE REPORT*')
  parts.push(`Week ${soleReportState.week} | ${soleReportState.topic_area}`)
  parts.push(`Status: ${soleReportState.status}${overdue ? ` ⚠️ OVERDUE (${daysSince}d)` : ''}`)
  parts.push('')

  // 8 — Blockers
  const blockers = []
  if (breach.length)          blockers.push(`BREACH: ${breach[0]}`)
  if (!revenue.linksDeployed) blockers.push('Affiliate links not deployed — zero revenue possible')
  if (posts.gaps.length)      blockers.push(`Missed slots: ${posts.gaps.join(', ')} — caption files missing from Drive`)
  for (const i of agents.issues.filter(i => i.severity === 'error' && AGENT_ROSTER.find(a => a.name === i.name)?.essential).slice(0, 2)) {
    blockers.push(`${i.name} down — ${i.msg.slice(0, 60)}`)
  }

  parts.push('*8 — BLOCKERS*')
  parts.push(blockers.length ? blockers.map(b => `• ${b}`).join('\n') : 'No decisions needed today.')

  return parts.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ chief-of-staff start ━━━')

  // Telegram inbox first — gate replies may have arrived overnight
  await processTelegramInbox()

  // ── Data collection ───────────────────────────────────────────────────────

  log('P0: Ecosystem integrity...')
  const agents    = checkAgentHealth()
  const ecosystem = checkEcosystemIntegrity(agents)
  log(`Ecosystem: ${ecosystem.allGreen ? 'all green' : ecosystem.checks.filter(c => !c.ok).length + ' break(s)'}`)

  log('P1: Revenue...')
  const revenue = await checkRevenue()

  log('P2: Posts...')
  const posts = checkPosts()

  log('P3: Growth metrics...')
  const growth = await checkGrowthMetrics()

  log('P4: State...')
  const costState       = readCostState()
  const chapterState    = loadChapterState()
  const soleReportState = loadSoleReportState()
  const allPendingItems = loadPendingItems()

  log('P5: Agent dependency audit...')
  const depResults = await validateAgentDependencies()

  log(`Chapter state: Chapter ${chapterState.active} — ${chapterState.name}`)
  log(`Sole Report: Week ${soleReportState.week} — ${soleReportState.status}`)
  log(`Cost state: balance=${costState?.balance ?? 'n/a'}, runway=${costState?.runway_hours ?? 'n/a'}h, today=${costState?.today_cost ?? 'n/a'}`)

  // ── Org chart update ──────────────────────────────────────────────────────
  log('Updating org chart...')
  const orgChartState = updateOrgChartState()

  // ── Breach detection ──────────────────────────────────────────────────────
  const breach = detectBreach(orgChartState)

  // ── Standup ───────────────────────────────────────────────────────────────
  log('Building standup...')
  const standupText = buildStandupTelegram({
    breach,
    ecosystem,
    posts,
    revenue,
    growth,
    agents,
    costState,
    pendingItems:    allPendingItems,
    chapterState,
    soleReportState,
    depResults,
  })

  const tgResult = await sendTelegram(standupText)
  if (tgResult?.message_id) log(`Standup Telegram delivered — message_id: ${tgResult.message_id}`)
  else log('WARNING: Standup Telegram returned no confirmation')

  // Alert essential agent failures individually
  for (const issue of agents.issues.filter(i => i.severity === 'error' && AGENT_ROSTER.find(a => a.name === i.name)?.essential)) {
    const tgAlert = await sendTelegram(`🚨 BSV — ${issue.name} error\n${issue.msg}\n\nFix: \`${issue.fix}\``)
    if (tgAlert?.message_id) log(`Telegram agent alert (${issue.name}) — message_id: ${tgAlert.message_id}`)
    else log(`WARNING: Telegram agent alert returned no confirmation (${issue.name})`)
  }

  // Save standup to logs for reference
  const standupPath = path.join(ROOT, 'logs', `standup-${DATE_STAMP}.txt`)
  try { fs.writeFileSync(standupPath, standupText) } catch {}

  // Second inbox pass — catch any replies that arrived during the run
  await processTelegramInbox()

  await watchBlogAgent()

  log('━━━ chief-of-staff complete ━━━\n')
})()
