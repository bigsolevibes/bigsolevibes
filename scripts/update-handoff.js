require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { TAGLINE } = require('./lib/brand-copy')
const { PALETTE } = require('./lib/visual-doctrine')

const ROOT           = path.join(__dirname, '..')
const LOG_FILE       = path.join(ROOT, 'logs', 'update-handoff.log')
const TEMP_DIR       = path.join(os.homedir(), 'tmp', 'bsv-handoff')
const REMOTE_HANDOFF = 'big sole vibes:Big Sole Vibes/Handoff'
const REMOTE         = 'big sole vibes:Big Sole Vibes'

const today     = new Date()
const dateStamp = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
const HANDOFF_FILE = `BSV-Handoff-${dateStamp}.md`

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive context loaders ────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

async function loadMemory() {
  const { loadMemoryById } = require('./lib/memory')
  return loadMemoryById()
}

// ─── Project state collectors ─────────────────────────────────────────────────

function getEnvKeyNames() {
  try {
    return fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim())
      .filter(Boolean)
  } catch { return [] }
}

async function checkMetaTokenExpiry() {
  try {
    const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    const get = key => { const m = envContent.match(new RegExp(`^${key}=(.+)$`, 'm')); return m ? m[1].trim() : null }
    const token     = get('META_ACCESS_TOKEN')
    const appId     = get('META_APP_ID')
    const appSecret = get('META_APP_SECRET')
    if (!token || !appId || !appSecret) return null
    const res  = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`)
    const data = await res.json()
    if (!res.ok || data.error) return null
    const expiresAt = data.data?.expires_at
    if (!expiresAt || expiresAt === 0) return { neverExpires: true }
    const daysLeft = Math.floor((expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24))
    return { daysLeft, expiresAt: new Date(expiresAt * 1000).toISOString() }
  } catch { return null }
}

function getRecentLogs(n = 30) {
  try {
    const content = fs.readFileSync(path.join(ROOT, 'logs', 'watch-drive.log'), 'utf8')
    return content.trim().split('\n').slice(-n).map(l => l.slice(0, 200)).join('\n')
  } catch { return '(no log file found)' }
}

function getPipelineState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'watch-drive-state.json'), 'utf8'))
  } catch { return {} }
}

function getCostState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'cost-state.json'), 'utf8'))
  } catch { return null }
}

function getOutputFiles() {
  try {
    return fs.readdirSync(path.join(ROOT, 'posts', 'output')).filter(f => !f.startsWith('.')).sort()
  } catch { return [] }
}

function getGitLog() {
  try {
    return execSync('git log --oneline -10', { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch { return '(git log unavailable)' }
}

function getDriveStructure() {
  try {
    return execSync('rclone lsd "big sole vibes:Big Sole Vibes"', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim()
  } catch { return '(rclone unavailable)' }
}

function getAvailableScripts() {
  try {
    return fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).sort()
  } catch { return [] }
}

function getLatestBrandHealth() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] })
      .trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^brand-health-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe','pipe','pipe'] })
    const p = path.join(TEMP_DIR, latest)
    if (!fs.existsSync(p)) return null
    const content = fs.readFileSync(p, 'utf8')
    const start = content.indexOf('## Growth Metrics')
    if (start === -1) return { filename: latest, metrics: null }
    const end = content.indexOf('\n## ', start + 1)
    return { filename: latest, metrics: (end !== -1 ? content.slice(start, end) : content.slice(start, start + 600)).trim() }
  } catch { return null }
}

function getHandoffFindings() {
  try {
    const p = path.join(ROOT, 'logs', 'handoff-findings.md')
    if (!fs.existsSync(p)) return null
    return fs.readFileSync(p, 'utf8').trim() || null
  } catch { return null }
}

function clearHandoffFindings() {
  try {
    const p = path.join(ROOT, 'logs', 'handoff-findings.md')
    if (fs.existsSync(p)) fs.writeFileSync(p, '')
  } catch {}
}

// ─── Pipeline state analysis (no LLM needed) ─────────────────────────────────

function analysePipeline(state) {
  const slots     = Object.entries(state)
  const pending   = slots.filter(([, v]) => ['instagram','bluesky'].some(p => v[p]?.status === 'pending'))
  const success   = slots.filter(([, v]) => ['instagram','bluesky'].every(p => v[p]?.status === 'success'))
  const held      = slots.filter(([, v]) => v._hold_since)
  const approval  = slots.filter(([, v]) => v._approval_requested)
  const exhausted = slots.filter(([, v]) => ['instagram','bluesky'].some(p => v[p]?.status === 'exhausted'))

  const statusLine = pending.length === 0
    ? '✓ Queue clear — uo pending slots'
    : `⚠ ${pending.length} slot(s) pending distribution`

  return { pending, success, held, approval, exhausted, statusLine }
}

// ─── Template builder ─────────────────────────────────────────────────────────

function buildHandoff({
  now, dateStamp, envKeys, tokenExpiry, recentLogs, pipelineState, pipeline,
  outputFiles, gitLog, driveStructure, scripts, brandHealth, handoffFindings,
  costState, memory, directive,
}) {
  const tokenLine = tokenExpiry?.neverExpires
    ? 'META_ACCESS_TOKEN: long-lived, no expiry ✓'
    : tokenExpiry?.daysLeft !== undefined
      ? `META_ACCESS_TOKEN: expires in ${tokenExpiry.daysLeft}d (${tokenExpiry.expiresAt})${tokenExpiry.daysLeft <= 7 ? ' ⚠ EXPIRING SOON' : ''}`
      : 'META_ACCESS_TOKEN: expiry unknown'

  const costLine = costState
    ? `Balance: $${(costState.balance ?? 0).toFixed(2)} | Avg burn: $${(costState.avg_daily_burn ?? 0).toFixed(4)}/day | Runway: ${costState.runway_hours ? costState.runway_hours.toFixed(1) + 'h' : 'unknown'}`
    : 'Cost state unavailable — run cost-report.js'

  const approvedSlots = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'approved-slots.json'), 'utf8')) } catch { return {} }
  })()

  const slotRows = Object.entries(pipelineState).map(([slot, v]) => {
    const ig  = v.instagram?.status ?? '—'
    const bsky = v.bluesky?.status ?? '—'
    const flags = [
      v._hold_since       ? `hold:${v._hold_since}` : null,
      v._approval_requested ? 'APPROVAL PENDING' : null,
      approvedSlots[slot]   ? 'approved' : null,
    ].filter(Boolean).join(' ')
    return `| ${slot.padEnd(18)} | ${ig.padEnd(10)} | ${bsky.padEnd(10)} | ${flags} |`
  }).join('\n')

  const sections = [
    `# BSV Handoff — ${dateStamp}`,
    `_Generated: ${now} — template-rendered, no LLM_`,
    ``,
    `---`,
    ``,
    `## System Overview`,
    ``,
    `Big Sole Vibes (BSV) is a premium men's grooming brand. This pipeline automates social content creation, image generation, branding, and distribution to Instagram and Bluesky.`,
    ``,
    '**Pipeline chain:** social-listening → media-director → creative-agent → gemini-bridge → image-gen → watch-drive → distribute',
    ``,
    `**Scheduled via launchd** on MacBook Air (24GB M-series). All agents are Node.js scripts.`,
    ``,
    `---`,
    ``,
    `## Current Status`,
    ``,
    `**Date:** ${now}`,
    `**Token:** ${tokenLine}`,
    `**Cost:** ${costLine}`,
    ``,
    `**Pipeline:** ${pipeline.statusLine}`,
    pipeline.approval.length ? `**⚠ Approval required:** ${pipeline.approval.map(([s]) => s).join(', ')}` : '',
    pipeline.held.length     ? `**Held slots:** ${pipeline.held.map(([s, v]) => `${s} (since ${v._hold_since})`).join(', ')}` : '',
    pipeline.exhausted.length ? `**Exhausted:** ${pipeline.exhausted.map(([s]) => s).join(', ')}` : '',
    ``,
    handoffFindings ? `### Pipeline Alerts\n\`\`\`\n${handoffFindings}\n\`\`\`` : '',
    ``,
    `---`,
    ``,
    `## Slot Queue`,
    ``,
    `| Slot               | Instagram  | Bluesky    | Notes |`,
    `|--------------------|------------|------------|-------|`,
    slotRows || '_(no slots in state)_',
    ``,
    `---`,
    ``,
    `## Recent Pipeline Activity`,
    ``,
    '```',
    recentLogs,
    '```',
    ``,
    `---`,
    ``,
    `## Environment`,
    ``,
    `**Configured keys (values never logged):**`,
    envKeys.map(k => `- ${k}`).join('\n'),
    ``,
    `---`,
    ``,
    `## Git Log`,
    ``,
    '```',
    gitLog,
    '```',
    ``,
    `---`,
    ``,
    `## posts/output/ Contents`,
    ``,
    outputFiles.length ? outputFiles.map(f => `- ${f}`).join('\n') : '_(empty)_',
    ``,
    `---`,
    ``,
    `## Google Drive Structure`,
    ``,
    '```',
    driveStructure,
    '```',
    ``,
    `---`,
    ``,
    `## Available Scripts`,
    ``,
    scripts.map(s => `- scripts/${s}`).join('\n'),
    ``,
    `---`,
    ``,
    `## Audience`,
    ``,
    brandHealth?.metrics ?? '_(no brand-health report found)_',
    ``,
    `---`,
    ``,
    `## Phase 2 — Product Strategy`,
    ``,
    `- **First product:** Proprietor\\u2019s Foot Balm — private label, custom formulation`,
    `- **Packaging:** Midnight ${PALETTE.NAVY} + Bourbon ${PALETTE.AMBER} colorway`,
    `- **Tagline:** "${TAGLINE} This earned it."`,
    `- **Price target:** $35–50 retail`,
    `- **Launch condition:** 10K+ engaged followers AND affiliate revenue flowing`,
    `- **Revenue path:** Amazon Associates → CJ/Impact affiliate → private label → full BSV line`,
    `- **Drive folder:** Big Sole Vibes/Product Development/`,
    ``,
    `---`,
    ``,
    `## Strategic Memory`,
    ``,
    memory ? memory.slice(0, 8000) + (memory.length > 8000 ? '\n\n_[truncated]_' : '') : '_(BSV-Memory.md not found)_',
  ].filter(s => s !== null && s !== undefined)

  return sections.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ update-handoff start ━━━')

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  log('Collecting project state...')
  const envKeys        = getEnvKeyNames()
  const recentLogs     = getRecentLogs(30)
  const pipelineState  = getPipelineState()
  const outputFiles    = getOutputFiles()
  const gitLog         = getGitLog()
  const driveStructure = getDriveStructure()
  const scripts        = getAvailableScripts()
  const tokenExpiry    = await checkMetaTokenExpiry()
  const brandHealth    = getLatestBrandHealth()
  const handoffFindings = getHandoffFindings()
  const costState      = getCostState()
  const now            = new Date().toISOString()

  log(`Env keys: ${envKeys.length}`)
  log(`Output files: ${outputFiles.length}`)
  log(`Scripts: ${scripts.length}`)
  log(`Brand health: ${brandHealth?.filename ?? 'none'}`)
  log(`Cost state: ${costState ? 'loaded' : 'unavailable'}`)

  if (tokenExpiry?.daysLeft !== undefined) {
    log(tokenExpiry.daysLeft <= 7
      ? `⚠ META_ACCESS_TOKEN expires in ${tokenExpiry.daysLeft} day(s) — regenerate now`
      : `META_ACCESS_TOKEN expires in ${tokenExpiry.daysLeft} day(s)`)
  }

  const pipeline = analysePipeline(pipelineState)
  log(`Pipeline: ${pipeline.statusLine}`)
  if (pipeline.approval.length) log(`Approval pending: ${pipeline.approval.map(([s]) => s).join(', ')}`)
  if (pipeline.held.length)     log(`Held: ${pipeline.held.map(([s]) => s).join(', ')}`)

  log('Building handoff document...')
  const fullText = buildHandoff({
    now, dateStamp, envKeys, tokenExpiry, recentLogs, pipelineState, pipeline,
    outputFiles, gitLog, driveStructure, scripts, brandHealth, handoffFindings,
    costState, memory, directive,
  })
  log(`Document built: ${fullText.length} chars`)

  // Save locally
  const localOutput = path.join(TEMP_DIR, HANDOFF_FILE)
  fs.writeFileSync(localOutput, fullText)
  log(`Saved locally: ${localOutput}`)

  // Upload dated handoff
  try {
    execSync(`rclone copyto "${localOutput}" "${REMOTE_HANDOFF}/${HANDOFF_FILE}"`, { stdio: ['pipe','pipe','pipe'] })
    log(`Uploaded → ${REMOTE_HANDOFF}/${HANDOFF_FILE}`)
    if (handoffFindings) {
      clearHandoffFindings()
      log('Cleared logs/handoff-findings.md')
    }
  } catch (err) {
    log(`ERROR: handoff upload failed — ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  // Build and upload BSV-Session-Context.md
  log('Building BSV-Session-Context.md...')
  try {
    const latestStandup = (() => {
      try {
        const files = fs.readdirSync(path.join(ROOT, 'logs'))
          .filter(f => /^standup-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort()
        if (!files.length) return null
        return fs.readFileSync(path.join(ROOT, 'logs', files[files.length - 1]), 'utf8')
      } catch { return null }
    })()

    const sessionContext = [
      `# BSV Session Context`,
      `**Generated:** ${now}`,
      `**Next update:** Tonight 4AM`,
      ``,
      `---`,
      `## Brand Directive`,
      directive || '_(BSV-Directive.md not found on Drive)_',
      ``,
      `---`,
      `## Strategic Memory`,
      memory || '_(BSV-Memory.md not found)_',
      ``,
      `---`,
      `## Morning Standup`,
      latestStandup || '_(no standup found in logs/)_',
      ``,
      `---`,
      `## Pipeline State`,
      fullText,
    ].join('\n')

    const sessionPath = path.join(TEMP_DIR, 'BSV-Session-Context.md')
    fs.writeFileSync(sessionPath, sessionContext)
    execSync(`rclone copyto "${sessionPath}" "${REMOTE_HANDOFF}/BSV-Session-Context.md"`, { stdio: ['pipe','pipe','pipe'] })
    log('Uploaded → BSV-Session-Context.md')
  } catch (err) {
    log(`WARNING: BSV-Session-Context.md upload failed — ${err.message}`)
  }

  log('━━━ update-handoff complete ━━━\n')
})()
