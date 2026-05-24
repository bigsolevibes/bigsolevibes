require('dotenv').config()

const Anthropic    = require('@anthropic-ai/sdk').default
const fs           = require('fs')
const path         = require('path')
const os           = require('os')
const crypto       = require('crypto')
const { execSync } = require('child_process')
const { sendTelegram } = require('./telegram')
const { addPendingItem, readDecisionFromDrive, archiveDecision, loadPendingItems, savePendingItems } = require('./telegram-queue')

const ROOT                  = path.join(__dirname, '..')
const LOG_FILE              = path.join(ROOT, 'logs', 'eng-bot.log')
const LOGS_DIR              = path.join(ROOT, 'logs')
const SEEN_FILE             = path.join(ROOT, 'logs', 'eng-seen.json')
const ALERT_STATE_FILE      = path.join(ROOT, 'logs', 'eng-bot-alert-state.json')
const ALERT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000
const GDRIVE_REMOTE         = 'big sole vibes'
const GDRIVE_REPORTS_FOLDER = '1vKaxZuhQy2tZ8cQQF1Vc8TSVJrq26PaP'
const GDRIVE_DRIVE_ROOT     = 'big sole vibes:Big Sole Vibes'
const ORG_CHART_TEMP        = path.join(os.tmpdir(), 'bsv-eng-bot')

// ─── Drive context loaders ────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${GDRIVE_DRIVE_ROOT}/BSV-Directive.md" "${ORG_CHART_TEMP}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(ORG_CHART_TEMP, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function loadMemory() {
  try {
    execSync(`rclone copy "${GDRIVE_DRIVE_ROOT}/BSV-Memory.md" "${ORG_CHART_TEMP}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(ORG_CHART_TEMP, 'BSV-Memory.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Log discovery ────────────────────────────────────────────────────────────

function collectLogFiles() {
  if (!fs.existsSync(LOGS_DIR)) return []
  return fs.readdirSync(LOGS_DIR)
    .filter(f => f.endsWith('.log') && f !== path.basename(LOG_FILE))
    .sort()
    .map(f => path.join(LOGS_DIR, f))
}

// Read only the last chunk of a log file — avoids OOM on large files like watch-drive.log.
// Reads up to maxBytes from the end; the first partial line is dropped.
function readTailBytes(filePath, maxBytes = 4 * 1024 * 1024) {
  const fd       = fs.openSync(filePath, 'r')
  const { size } = fs.fstatSync(fd)
  const readSize = Math.min(maxBytes, size)
  const buf      = Buffer.alloc(readSize)
  fs.readSync(fd, buf, 0, readSize, size - readSize)
  fs.closeSync(fd)
  const text = buf.toString('utf8')
  // If we didn't read from byte 0, the first line is likely partial — discard it
  return size > readSize ? text.slice(text.indexOf('\n') + 1) : text
}

// ─── Failure extraction ───────────────────────────────────────────────────────

// Strip all variable data so the same error always produces the same hash.
function normalizeMessage(msg) {
  return msg
    .replace(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]\s*/, '')   // leading [timestamp]
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>')       // embedded ISO timestamps
    .replace(/\[hash=[a-f0-9]+\]/g, '')                    // [hash=...] annotations
    .replace(/\/(?:Users|home|tmp|opt|var|usr)\/[^\s"'`\],]*/g, '<path>') // absolute paths
    .replace(/^[a-z][a-z0-9-]*:\s+/, '')                   // leading slug prefix (e.g. "mon-am: ")
    .replace(/\s+/g, ' ')
    .trim()
}

// Sources suppressed until they are properly configured — skip entirely, don't report failures.
const SUPPRESSED_SOURCES = [
  'reddit-agent.log',   // Reddit credentials + Puppeteer not yet configured
  'fetch-reddit.log',
]

// Log rotation lines from log-rotate.log are housekeeping, never failures.
const LOG_ROTATION_PATTERNS = [
  /^\[?[^\]]*\]?\s*Rotating\s+\S/,           // "Rotating media-director-error.log"
  /→.*\(\d+(?:\.\d+)?\s*MB archived\)/,      // "→ file.log.1 (0.0 MB archived)"
  /—\s*fresh file created\s*$/,              // "— fresh file created"
  /\.log\.\d+\s*→/,                          // ".log.1 →" rotation rename
]

function isLogRotationLine(line) {
  return LOG_ROTATION_PATTERNS.some(re => re.test(line))
}

// ─── Inactive agent triage ────────────────────────────────────────────────────

function loadOrgChartInactiveAgents() {
  try {
    fs.mkdirSync(ORG_CHART_TEMP, { recursive: true })
    execSync(`rclone copy "${GDRIVE_DRIVE_ROOT}/BSV-Org-Chart.svg" "${ORG_CHART_TEMP}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const svgPath = path.join(ORG_CHART_TEMP, 'BSV-Org-Chart.svg')
    if (!fs.existsSync(svgPath)) return []
    const svg = fs.readFileSync(svgPath, 'utf8')
    const inactive = []
    const re = />([^<]*\(inactive\)[^<]*)</g
    let m
    while ((m = re.exec(svg)) !== null) {
      const scriptMatch = m[1].trim().match(/^([\w.-]+\.js)\s*\(inactive\)/i)
      if (scriptMatch) inactive.push(scriptMatch[1])
    }
    return [...new Set(inactive)]
  } catch {
    return []
  }
}

function triageInactiveAgent(scriptName) {
  const logPath = path.join(LOGS_DIR, scriptName.replace('.js', '.log'))

  if (!fs.existsSync(logPath)) {
    return {
      script:         scriptName,
      lastEntry:      'no log file',
      lastStatus:     'unknown',
      assessment:     'no log file found — never ran or log was rotated away',
      recommendation: 'investigate — if this script should be running, check launchd and run manually',
    }
  }

  const content = readTailBytes(logPath, 8 * 1024)
  const lines   = content.split('\n').filter(Boolean)

  if (!lines.length) {
    return {
      script:         scriptName,
      lastEntry:      'empty',
      lastStatus:     'unknown',
      assessment:     'log file exists but is empty — likely just rotated',
      recommendation: 'no action needed',
    }
  }

  // Find last timestamped line
  let lastTimestamp = null
  for (let i = lines.length - 1; i >= 0; i--) {
    const tsMatch = lines[i].match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
    if (tsMatch) { lastTimestamp = tsMatch[1]; break }
  }

  if (!lastTimestamp) {
    return {
      script:         scriptName,
      lastEntry:      'no timestamps',
      lastStatus:     'unknown',
      assessment:     'log has entries but no timestamps — may be a helper/utility script',
      recommendation: 'no action needed',
    }
  }

  const daysSince    = (Date.now() - new Date(lastTimestamp).getTime()) / 86400000
  const lastDate     = lastTimestamp.slice(0, 10)
  const recentText   = lines.slice(-10).join('\n').toLowerCase()
  const hasError     = recentText.includes('error') || recentText.includes('failed') || recentText.includes('✗')
  const hasSuccess   = recentText.includes('complete') || recentText.includes('✓') || recentText.includes('success') || recentText.includes('done')

  let lastStatus, assessment, recommendation

  if (hasError && !hasSuccess) {
    lastStatus     = 'error'
    assessment     = `last run ended with errors (${Math.round(daysSince)}d ago) — Chief marked inactive based on log silence since then`
    recommendation = 'needs investigation — check full log for root cause'
  } else if (daysSince > 14) {
    lastStatus     = 'stale'
    assessment     = `genuinely stopped — no log activity in ${Math.round(daysSince)} days`
    recommendation = 'needs investigation — expected cadence has lapsed significantly'
  } else {
    lastStatus     = 'success'
    assessment     = `running fine — last activity ${Math.round(daysSince)}d ago, 7-day log-mtime window triggered inactive label`
    recommendation = 'no action needed'
  }

  return { script: scriptName, lastEntry: lastDate, lastStatus, assessment, recommendation }
}

// ─── Known-DOA platforms — EXHAUSTED lines for these are expected and need no action.
const KNOWN_DOA_PLATFORMS = ['tiktok', 'youtube', 'twitter', 'facebook']

// Parse structured EXHAUSTED: lines written by watch-drive.js when a slot runs out of retries.
// Format: EXHAUSTED: {slot} / {platform} — {N} attempts, all failed. Last error: {msg}
function extractExhaustedEntries(logContent, source) {
  const entries = []
  for (const line of logContent.split('\n')) {
    if (!line.includes('EXHAUSTED:')) continue
    const tsMatch  = line.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
    const bodyMatch = line.match(/EXHAUSTED:\s+([^/\s]+)\s*\/\s*([^\s—–-]+)\s*[—–-].*?Last error:\s*(.+)/)
    if (!bodyMatch) continue
    const [, slot, platform, lastError] = bodyMatch
    const known = KNOWN_DOA_PLATFORMS.includes(platform.trim().toLowerCase())
    entries.push({
      timestamp: tsMatch ? tsMatch[1] : 'unknown time',
      slot:      slot.trim(),
      platform:  platform.trim(),
      lastError: lastError.trim(),
      known,
      source,
    })
  }
  return entries
}

function extractFailures(logContent, source) {
  const failures = []
  const lines = logContent.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ll = line.toLowerCase()
    // EXHAUSTED: lines are handled separately — skip here to avoid double-counting
    if (line.includes('EXHAUSTED:')) continue
    // Log rotation housekeeping is never a failure regardless of filename content
    if (isLogRotationLine(line)) continue
    // Success metric lines like "END branded=N failed=0" contain "failed" but are not failures
    if (/\bfailed=0\b/i.test(line)) continue
    // Require a real failure signal — bare "error" matches filenames like media-director-error.log
    if (
      !line.includes('✗') &&
      !line.includes('Error:') &&
      !line.includes('ERROR:') &&
      !line.includes('Exception:') &&
      !ll.includes('fatal') &&
      !ll.includes('fail') &&
      !ll.includes('stderr') &&
      !/exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?[1-9]/.test(ll) &&
      !ll.includes('warning')
    ) continue

    // Grab up to 5 lines of context around each failure for diagnosis
    const contextStart = Math.max(0, i - 3)
    const contextEnd   = Math.min(lines.length - 1, i + 5)
    const context      = lines.slice(contextStart, contextEnd + 1).join('\n')

    // Extract a timestamp if present
    const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
    const timestamp = tsMatch ? tsMatch[1] : 'unknown time'

    // Extract the platform and error message
    const failMatch = line.match(/✗\s+([^:]+):\s+(.+)/)
    const platform  = failMatch ? failMatch[1].trim() : 'unknown'
    const message   = failMatch ? failMatch[2].trim() : normalizeMessage(line)

    failures.push({ timestamp, platform, message, context, source, lineIndex: i })
  }

  // Deduplicate within this run using normalized message (timestamp-stripped)
  const seen = new Set()
  return failures.filter(f => {
    const key = `${f.source}::${f.platform}::${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Seen-failure deduplication (hash-based, persists across restarts) ───────

function failureHash(failure) {
  const key = `${failure.source}::${failure.platform}::${normalizeMessage(failure.message)}`
  return crypto.createHash('md5').update(key).digest('hex')
}

function loadSeen() {
  try {
    const raw = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))
    // Migrate from old flat-array format
    if (Array.isArray(raw)) {
      return { baselineAt: null, hashes: Object.fromEntries(raw.map(h => [h, null])) }
    }
    return { baselineAt: raw.baselineAt || null, hashes: raw.hashes || {} }
  } catch {
    return { baselineAt: null, hashes: {} }
  }
}

function saveSeen({ baselineAt, hashes }) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify({ baselineAt, hashes }, null, 2))
}

// ─── Telegram alert deduplication (24h window) ────────────────────────────────

function alertKey(source, message) {
  const normalized = normalizeMessage(message || '')
  return crypto.createHash('md5').update(`${source}::${normalized}`).digest('hex')
}

function loadAlertState() {
  try { return JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf8')) }
  catch { return {} }
}

function saveAlertState(state) {
  fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(state, null, 2))
}

// Returns true if this alert key has not been sent in the last 24h.
function alertAllowed(key, state) {
  const sentAt = state[key]
  if (!sentAt) return true
  return (Date.now() - new Date(sentAt).getTime()) > ALERT_DEDUP_WINDOW_MS
}

// Prune stale entries (>48h) to prevent unbounded growth.
function pruneAlertState(state) {
  const cutoff = Date.now() - 2 * ALERT_DEDUP_WINDOW_MS
  for (const [key, ts] of Object.entries(state)) {
    if (new Date(ts).getTime() < cutoff) delete state[key]
  }
}

// ─── OMG Protocol — Missed Post First Responder ───────────────────────────────

async function checkMissedPosts() {
  const now      = new Date()
  const days     = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  // Yesterday's slots are always expected
  const yesterday  = new Date(now - 86400000)
  const ydAbbr     = days[yesterday.getDay()]
  const expected   = [`${ydAbbr}-am`, `${ydAbbr}-pm`]

  // Today's slots are expected once their post window has passed locally
  const todayAbbr  = days[now.getDay()]
  const localMins  = now.getHours() * 60 + now.getMinutes()
  if (localMins >= 10 * 60)  expected.push(`${todayAbbr}-am`)   // past 10:00 AM
  if (localMins >= 20 * 60)  expected.push(`${todayAbbr}-pm`)   // past 8:00 PM

  let postState = []
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    if (fs.existsSync(p)) postState = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {}

  const confirmed = new Set(postState.filter(e => e.status === 'success').map(e => e.slot))
  const gaps      = expected.filter(s => !confirmed.has(s))

  if (!gaps.length) {
    log(`Post check: ${expected.join(', ')} — all confirmed`)
    return
  }

  log(`OMG: missed posts — ${gaps.join(', ')}`)
  for (const slot of gaps) {
    const msg = [
      `🚨 *BSV — Eng: Missed Post*`,
      ``,
      `Slot *${slot}* has no success entry in post-state.json.`,
      ``,
      `*Check what's staged in Drive:*`,
      '```',
      `rclone ls "big sole vibes:Big Sole Vibes/Ready to Post/"`,
      '```',
      `*Force retry if media + caption are present:*`,
      '```',
      `node scripts/distribute.js --force`,
      '```',
    ].join('\n')
    const r = await sendTelegram(msg)
    if (r?.message_id) log(`OMG: missed-post alert (${slot}) — message_id: ${r.message_id}`)
    else log(`WARNING: OMG missed-post alert (${slot}) — no confirmation`)
  }
}

// ─── OMG Protocol — Critical Failure Targeted Alerts ─────────────────────────

async function sendCriticalAlerts(activeFailures, actionableExhausted, alertState) {
  for (const f of activeFailures) {
    const key = alertKey(f.source || 'unknown', f.message || '')
    if (!alertAllowed(key, alertState)) {
      log(`OMG: recurring-failure alert suppressed (24h dedup) — ${f.platform} / ${f.source}`)
      continue
    }
    const msg = [
      `🚨 *BSV — Recurring Failure (Active)*`,
      ``,
      `*Error:* ${(f.message || '').slice(0, 150)}`,
      `*Source:* \`${f.source || 'unknown'}\``,
      `*First seen:* ${f.timestamp}`,
      ``,
      `This failure was baselined and has recurred. It will not resolve on its own.`,
      ``,
      `*Inspect log:*`,
      '```',
      `tail -50 logs/${f.source || 'watch-drive.log'}`,
      '```',
    ].join('\n')
    const r = await sendTelegram(msg)
    if (r?.message_id) {
      log(`OMG: recurring-failure alert (${f.platform}) — message_id: ${r.message_id}`)
      alertState[key] = new Date().toISOString()
    } else {
      log(`WARNING: OMG recurring alert (${f.platform}) — no confirmation`)
    }
  }

  for (const e of actionableExhausted) {
    const key = alertKey(e.source || 'unknown', `EXHAUSTED:${e.slot}/${e.platform}`)
    if (!alertAllowed(key, alertState)) {
      log(`OMG: exhausted-slot alert suppressed (24h dedup) — ${e.slot}/${e.platform}`)
      continue
    }
    const msg = [
      `🚨 *BSV — Slot Exhausted: ${e.slot}/${e.platform}*`,
      ``,
      `*Last error:* ${(e.lastError || '').slice(0, 150)}`,
      ``,
      `All retries used. This slot will NOT post without manual intervention.`,
      ``,
      `*Force retry:*`,
      '```',
      `node scripts/distribute.js --force --platforms ${e.platform.toLowerCase()}`,
      '```',
    ].join('\n')
    const r = await sendTelegram(msg)
    if (r?.message_id) {
      log(`OMG: exhausted-slot alert (${e.slot}/${e.platform}) — message_id: ${r.message_id}`)
      alertState[key] = new Date().toISOString()
    } else {
      log(`WARNING: OMG exhausted alert (${e.slot}/${e.platform}) — no confirmation`)
    }
  }
}

// ─── Google Drive report ──────────────────────────────────────────────────────

function extractSlug(context) {
  const m = context.match(/\]\s+(\S+?):\s+(?:ERROR|WARNING)/)
  return m ? m[1] : null
}

function writeReport(date, failures, diagnosis, exhaustedEntries = [], inactiveTriage = []) {
  const timestamp = new Date().toISOString()

  const slugs = [...new Set(failures.map(f => extractSlug(f.context)).filter(Boolean))]
  const slugLine = slugs.length ? slugs.join(', ') : 'unknown'

  const actionableExhausted = exhaustedEntries.filter(e => !e.known)
  const knownExhausted      = exhaustedEntries.filter(e => e.known)

  const exhaustedSection = exhaustedEntries.length ? [
    '## Exhausted Slots',
    '',
    ...(actionableExhausted.length ? [
      '### ⚠️ Actionable — slot failed completely, requires investigation',
      '',
      ...actionableExhausted.map(e =>
        `- **${e.slot} / ${e.platform}** — ${e.timestamp}\n  Last error: \`${e.lastError}\``
      ),
      '',
    ] : []),
    ...(knownExhausted.length ? [
      '### ℹ️ Known platform limitation — no action needed',
      '',
      ...knownExhausted.map(e => `- ${e.slot} / ${e.platform} — expected (platform not active)`),
      '',
    ] : []),
    '---',
    '',
  ].join('\n') : ''

  const failureSections = failures.map((f, i) => [
    `## Failure ${i + 1}: ${f.platform}${f.active ? ' 🔁 ACTIVE' : ''}`,
    '',
    f.active ? '> ⚠️ **Active — recurring since baseline.** This error was known at baseline and has reappeared in a log line written after the baseline timestamp.' : '',
    `**Log:** \`${f.source}\``,
    `**Slug(s):** ${extractSlug(f.context) || 'unknown'}`,
    `**Timestamp:** ${f.timestamp}`,
    '',
    '**Error:**',
    '```',
    f.message,
    '```',
    '',
    '**Full context from log:**',
    '```',
    f.context,
    '```',
    '',
    `**Status:** ${f.active ? '🔁 Active recurring — Chief escalation sent' : '⏳ Queued — see diagnosis section'}`,
  ].filter(l => l !== '').join('\n')).join('\n\n---\n\n')

  const triageSection = inactiveTriage.length ? [
    '## Inactive Agent Triage',
    '',
    '_Source: BSV-Org-Chart.svg — agents marked inactive by Chief of Staff_',
    '',
    ...inactiveTriage.map(t => [
      `### ${t.script} — marked inactive by Chief`,
      `- **Last log entry:** ${t.lastEntry}`,
      `- **Last known status:** ${t.lastStatus}`,
      `- **Assessment:** ${t.assessment}`,
      `- **Recommendation:** ${t.recommendation}`,
    ].join('\n')),
    '',
    '---',
    '',
  ].join('\n') : ''

  const content = [
    `# BSV Eng Report — ${date}`,
    '',
    `**Generated:** ${timestamp}`,
    `**Failures:** ${failures.length}`,
    `**Exhausted slots:** ${actionableExhausted.length} actionable, ${knownExhausted.length} known`,
    `**Inactive agents triaged:** ${inactiveTriage.length}`,
    `**Affected slugs:** ${slugLine}`,
    '',
    '---',
    '',
    triageSection,
    exhaustedSection,
    failureSections,
    '',
    '---',
    '',
    '## Diagnosis & Suggested Fixes',
    '',
    diagnosis || '_No diagnosis available — check ANTHROPIC_API_KEY._',
    '',
  ].join('\n')

  const fileName = `eng-report-${date}.md`
  const tmpFile  = path.join(os.tmpdir(), fileName)
  fs.writeFileSync(tmpFile, content)

  try {
    execSync(
      `rclone copyto "${tmpFile}" "${GDRIVE_REMOTE}:${fileName}" --drive-root-folder-id ${GDRIVE_REPORTS_FOLDER}`,
      { stdio: 'pipe' }
    )
    log(`Report written to Google Drive: ${fileName}`)
  } catch (err) {
    log(`ERROR: Google Drive report upload failed: ${err.stderr?.toString().trim() || err.message}`)
  }

  try { fs.unlinkSync(tmpFile) } catch {}
}

// ─── Issue categorization ─────────────────────────────────────────────────────

// Returns 'autonomous' | 'chief' | 'big-d'
// autonomous — eng-bot fixes immediately; reversible, contained, no output effect
// chief      — affects what posts/when/how, or site/shelf; Chief decides
// big-d      — revenue, brand output, affiliate, strategic/irreversible; Chief surfaces to Big D
function categorizeIssue(failure, diagnosisText) {
  const msg    = (failure.message || '').toLowerCase()
  const source = (failure.source  || '').toLowerCase()
  const diag   = (diagnosisText   || '').toLowerCase()

  // Autonomous: operational housekeeping with no effect on post output
  if (
    /log.?rotat/i.test(msg) ||
    /duplicate.?log/i.test(msg) ||
    /state.?file.?(corrupt|malform|empty)/i.test(msg) ||
    source === 'log-rotate.log' ||
    /missing.?plist|plist.?not.?loaded/i.test(msg) ||
    /dormant.?agent|agent.?dormant/i.test(msg) ||
    /orphan.*(?:file|image|asset)/i.test(msg) ||
    /smtp.*(auth|reject)|zoho.*fail/i.test(msg)
  ) return 'autonomous'

  // Big D: revenue, affiliate, brand output, strategic — irreversible
  if (
    /affiliate|revenue|product.?decision|org.?change/i.test(msg) ||
    /caption.?change|image.?delet|brand.?output/i.test(msg) ||
    /affiliate|revenue|product.?decision/i.test(diag)
  ) return 'big-d'

  // Chief: everything else that could affect what posts, when, or how
  return 'chief'
}

function buildIssueId(failure) {
  const scriptSlug = (failure.source || 'unknown')
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()
    .slice(0, 30)
  const dateStr = new Date().toISOString().slice(0, 10)
  return `eng-${scriptSlug}-${dateStr}`
}

// ─── Autonomous Fix Engine ─────────────────────────────────────────────────────

// Proactive: install any config/ plists that aren't in LaunchAgents yet.
// Called at startup. Commits fixes with [BSV-AUTO] prefix.
async function checkMissingPlists() {
  const LAUNCH_AGENTS = path.join(os.homedir(), 'Library', 'LaunchAgents')
  const CONFIG_DIR    = path.join(ROOT, 'config')
  try {
    const configPlists  = fs.readdirSync(CONFIG_DIR).filter(f => f.startsWith('com.bsv.') && f.endsWith('.plist'))
    const installedSet  = new Set(fs.existsSync(LAUNCH_AGENTS) ? fs.readdirSync(LAUNCH_AGENTS) : [])
    const missing       = configPlists.filter(p => !installedSet.has(p))
    if (!missing.length) { log(`Plist check: all ${configPlists.length} installed`); return [] }

    log(`AUTO-FIX: ${missing.length} plist(s) not in LaunchAgents — installing`)
    const fixed = []
    for (const plist of missing) {
      const src  = path.join(CONFIG_DIR, plist)
      const dest = path.join(LAUNCH_AGENTS, plist)
      try {
        fs.copyFileSync(src, dest)
        execSync(`launchctl load "${dest}"`, { stdio: 'pipe' })
        log(`  AUTO-FIX: installed + loaded ${plist}`)
        fixed.push(plist)
      } catch (err) {
        log(`  AUTO-FIX: failed to install ${plist}: ${err.message}`)
      }
    }
    if (fixed.length) {
      await sendTelegram([
        `✅ *BSV — Eng: Auto-Fix Applied*`,
        ``,
        `Installed ${fixed.length} missing plist(s) into LaunchAgents:`,
        ...fixed.map(p => `• ${p}`),
        ``,
        `Agents now active. No action needed.`,
      ].join('\n'))
    }
    return fixed
  } catch (err) {
    log(`WARNING: checkMissingPlists failed: ${err.message}`)
    return []
  }
}

// Reactive: attempt an autonomous fix for a specific failure.
// Returns { applied: bool, description: string }
async function attemptAutonomousFix(failure) {
  const msg    = (failure.message || '').toLowerCase()
  const source = failure.source   || ''

  // SMTP/Zoho down → Telegram is already the primary channel — no switch needed
  if (/smtp|zoho|mail/i.test(msg)) {
    log(`AUTO-FIX: SMTP failure — Telegram already primary, no action`)
    return { applied: true, description: 'SMTP failure — Telegram already active as primary channel' }
  }

  // Log rotation issue → trigger log-rotate.js
  if (/log.?rotat/i.test(msg) || source === 'log-rotate.log') {
    try {
      execSync(`node "${path.join(__dirname, 'log-rotate.js')}"`, { cwd: ROOT, stdio: 'pipe' })
      log(`AUTO-FIX: log rotation triggered`)
      return { applied: true, description: 'Log rotation triggered via log-rotate.js' }
    } catch (err) {
      return { applied: false, description: `log-rotate.js failed: ${err.message.slice(0, 100)}` }
    }
  }

  // Corrupt/empty state file → wipe to empty object (watch-drive re-initializes on next run)
  if (/state.?file.?(corrupt|malform|empty)/i.test(msg)) {
    const stateFile = path.join(ROOT, 'logs', 'watch-drive-state.json')
    if (fs.existsSync(stateFile)) {
      try {
        fs.writeFileSync(stateFile, JSON.stringify({}, null, 2))
        log(`AUTO-FIX: watch-drive-state.json reset`)
        return { applied: true, description: 'watch-drive-state.json reset to empty object' }
      } catch (err) {
        return { applied: false, description: `state file reset failed: ${err.message}` }
      }
    }
  }

  // Missing plist: if config/ has it but LaunchAgents doesn't — install it
  const scriptInMsg = msg.match(/(?:com\.bsv\.|scripts\/)([\w-]+)(?:\.plist|\.js)?/)
  if (scriptInMsg) {
    const slug      = scriptInMsg[1].replace(/^com\.bsv\./, '')
    const plistName = `com.bsv.${slug}.plist`
    const src       = path.join(ROOT, 'config', plistName)
    const dest      = path.join(os.homedir(), 'Library', 'LaunchAgents', plistName)
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.copyFileSync(src, dest)
        execSync(`launchctl load "${dest}"`, { stdio: 'pipe' })
        log(`AUTO-FIX: installed + loaded ${plistName}`)
        return { applied: true, description: `Installed and loaded ${plistName} into LaunchAgents` }
      } catch (err) {
        return { applied: false, description: `plist install failed: ${err.message}` }
      }
    }
  }

  return { applied: false, description: 'no autonomous fix pattern matched' }
}

// Escalate a chief-level failure — affects posts/schedule/content; Chief decides.
async function escalateToChief(failure, proposedFix, alertState) {
  const key = alertKey(failure.source || 'unknown', failure.message || '')
  if (!alertAllowed(key, alertState)) {
    const scriptName = failure.source ? failure.source.replace(/\.log$/, '.js') : 'unknown'
    log(`Chief escalation suppressed (24h dedup) — ${scriptName}`)
    return
  }
  const today      = new Date().toISOString().slice(0, 10)
  const scriptName = failure.source ? failure.source.replace(/\.log$/, '.js') : 'unknown'
  const msg = [
    `⚠️ *BSV — Chief: Action Required*`,
    ``,
    `*Source:* \`${scriptName}\``,
    `*Problem:* ${(failure.message || '').slice(0, 120)}`,
    proposedFix ? `*Proposed fix:* ${proposedFix.slice(0, 120)}` : null,
    ``,
    `This affects what posts, when, or how. Eng-bot cannot fix autonomously.`,
    `Review — fix if within authority, or surface to Big D if it affects revenue or brand.`,
    ``,
    `*Full report:* Drive → eng-report-${today}.md`,
  ].filter(Boolean).join('\n')
  const r = await sendTelegram(msg)
  if (r?.message_id) {
    log(`Chief escalation sent — ${scriptName} — message_id: ${r.message_id}`)
    alertState[key] = new Date().toISOString()
  } else {
    log(`WARNING: Chief escalation — no Telegram confirmation for ${scriptName}`)
  }
}

// Handles a FIX-authorized issue that requires manual or code work — logs ticket
async function attemptSimpleFix(item) {
  const { script, problem, fix, issueId } = item.metadata || {}
  log(`FIX authorized: ${issueId || item.id} — ${problem || '(no description)'} — manual execution required`)
  log(`  Proposed fix: ${fix || '(no fix specified)'}`)
  const tgFix = await sendTelegram(`✅ Fix authorized for *${script || item.id}*.\n\n${fix || 'Check eng-bot.log for details.'}\n\nManual execution required.`)
  if (tgFix?.message_id) log(`Telegram delivered — message_id: ${tgFix.message_id}`)
  else log('WARNING: Telegram fix alert returned no confirmation')
}

// Write a structured code ticket to Drive
async function fileCodeTicket(item, today) {
  const { script, problem, fix, issueId } = item.metadata || {}
  const ticketName    = `code-ticket-${today}.md`
  const tmpDir        = path.join(os.tmpdir(), 'bsv-eng-bot-tickets')
  fs.mkdirSync(tmpDir, { recursive: true })
  const ticketContent = [
    `# Code Ticket — ${today}`,
    ``,
    `**Issue ID:** ${issueId || item.id}`,
    `**Script:** ${script || 'unknown'}`,
    `**Problem:** ${problem || '(not specified)'}`,
    `**Proposed Fix:** ${fix || '(not specified)'}`,
    `**Complexity:** Needs Code session`,
    `**Filed:** ${new Date().toISOString()}`,
    ``,
    `---`,
    `*Filed automatically by eng-bot after Big D authorized FIX.*`,
  ].join('\n')

  const localTicket = path.join(tmpDir, ticketName)
  fs.writeFileSync(localTicket, ticketContent)
  try {
    execSync(
      `rclone copyto "${localTicket}" "${GDRIVE_DRIVE_ROOT}/Inbox/${ticketName}"`,
      { stdio: 'pipe' }
    )
    log(`Code ticket filed: ${ticketName}`)
  } catch (err) {
    log(`WARNING: could not upload code ticket: ${err.message}`)
  }
}

// ─── Claude diagnosis ─────────────────────────────────────────────────────────

// Collapse failures that normalize to the same message, then cap at max.
function dedupForDiagnosis(failures, max = 10) {
  const seen = new Set()
  const result = []
  for (const f of failures) {
    const key = `${f.platform}::${normalizeMessage(f.message)}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(f)
      if (result.length >= max) break
    }
  }
  return result
}

async function diagnose(client, failures) {
  const dedupedFailures = dedupForDiagnosis(failures, 10)
  if (dedupedFailures.length < failures.length) {
    log(`Diagnosis: collapsed ${failures.length} failures → ${dedupedFailures.length} unique for API call`)
  }

  const failureText = dedupedFailures.map((f, i) =>
    `## Failure ${i + 1}\nPlatform: ${f.platform}\nError: ${f.message}\nTimestamp: ${f.timestamp}\n\nContext from log:\n\`\`\`\n${f.context}\n\`\`\``
  ).join('\n\n')

  const userContent = `The following failures were detected across BSV pipeline logs. For each one:
1. Identify which script/log it came from
2. Explain in plain English what broke and why (2-3 sentences max)
3. Propose one specific fix — exact code change (file path + the change), config step, or API action required
4. Do NOT mark anything as resolved — fixes require Big D approval before implementation

Format each diagnosis as:

### [Platform] — [log filename]
**What broke:** ...
**Why:** ...
**Fix:** (include exact file path and code change if applicable)
**Approval required:** Yes — do not implement without Big D sign-off.

Here are the failures:

${failureText}`

  log(`Sending diagnosis request — ${dedupedFailures.length} failure(s), ${userContent.length} chars`)

  const engBotSystem = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the engineering bot for Big Sole Vibes (BSV) — a solo-operated social media automation system running on a Mac via launchd. The stack is: Node.js scripts, Cloudflare Pages (Next.js), Klaviyo, Meta Graph API, TikTok API, Bluesky ATP, YouTube Data API v3, and rclone for Google Drive. Scripts include: watch-drive.js, distribute.js, sync-shop.js, eng-bot.js, brand-video.js, brand-image.js, product-research.js, product-development.js, update-handoff.js, social-listening.js, marketing-manager.js, media-director.js, brand-manager.js, cost-report.js.

Your job is to diagnose failures extracted from any of these pipeline logs and propose one specific, actionable fix per failure. Be direct and technical. The operator is a developer — no hand-holding. Never say a fix has been applied — all fixes go through Big D approval first. The eng report IS the fix queue.`

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    system:     engBotSystem,
    messages: [{ role: 'user', content: userContent }],
  })

  log(`API response: id=${response.id} stop_reason=${response.stop_reason} blocks=${response.content.length}`)
  response.content.forEach((block, i) => {
    if (block.type === 'text') {
      log(`  content[${i}]: text len=${block.text.length}`)
    } else if (block.type === 'thinking') {
      log(`  content[${i}]: thinking len=${(block.thinking || '').length}`)
    } else {
      log(`  content[${i}]: type=${block.type}`)
    }
  })

  if (response.stop_reason === 'max_tokens') {
    log('WARNING: diagnosis hit max_tokens limit — response was truncated')
  }

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  if (!text) log('WARNING: no text blocks in API response — diagnosis will be empty')

  const result = text.trim()
  if (response.stop_reason === 'max_tokens') {
    return result + '\n\n_(Diagnosis truncated — max token limit reached. Some failures above may be missing a fix recommendation.)_'
  }
  return result
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

  const today    = new Date().toISOString().slice(0, 10)
  const baseline = process.argv.includes('--baseline')

  log(`━━━ eng-bot start${baseline ? ' [baseline]' : ''} ━━━`)

  fs.mkdirSync(ORG_CHART_TEMP, { recursive: true })
  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)
  log('Loading memory...')
  const memory = loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const alertState = loadAlertState()
  pruneAlertState(alertState)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey && !baseline) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  // ── Proactive: install any missing plists ───────────────────────────────────
  if (!baseline) {
    try { await checkMissingPlists() } catch (err) { log(`WARNING: checkMissingPlists failed: ${err.message}`) }
  }

  // ── OMG: First responder — check missed posts immediately ────────────────────
  if (!baseline) {
    try { await checkMissedPosts() } catch (err) { log(`WARNING: checkMissedPosts failed: ${err.message}`) }
  }

  // ── Process any pending eng decisions from Drive Inbox ───────────────────────
  try {
    const allPending = loadPendingItems()
    const engPending = allPending.filter(i => i.type === 'eng')
    for (const item of engPending) {
      const decision = readDecisionFromDrive(item.driveFile)
      if (!decision) continue
      log(`Decision for ${item.id}: ${decision.decision}`)

      if (decision.decision === 'FIX') {
        const complexity = item.metadata?.complexity || 'Needs Code session'
        if (complexity === 'Simple') {
          await attemptSimpleFix(item)
        } else {
          await fileCodeTicket(item, today)
          const tgTicket = await sendTelegram(`✅ Code ticket filed for *${item.metadata?.script || item.id}*. Will action next session.`)
          if (tgTicket?.message_id) log(`Telegram delivered — message_id: ${tgTicket.message_id}`)
          else log('WARNING: Telegram ticket alert returned no confirmation')
        }
        archiveDecision(item.driveFile)
      } else if (decision.decision === 'SKIP') {
        log(`Skipped per Big D: ${item.id}`)
        archiveDecision(item.driveFile)
      } else {
        archiveDecision(item.driveFile)
      }
      savePendingItems(loadPendingItems().filter(i => i.id !== item.id))
    }
    if (engPending.length) log(`Processed ${engPending.length} pending eng decision(s)`)
  } catch (err) {
    log(`WARNING: inbox processing failed: ${err.message}`)
  }

  // ── Inactive agent triage — runs on every execution ─────────────────────────
  log('Loading org chart inactive agents...')
  const inactiveAgents = loadOrgChartInactiveAgents()
  log(`Inactive agents in org chart: ${inactiveAgents.length}${inactiveAgents.length ? ` — ${inactiveAgents.join(', ')}` : ''}`)
  const inactiveTriage = inactiveAgents.map(triageInactiveAgent)
  inactiveTriage.forEach(t => log(`  ${t.script}: ${t.lastStatus} — ${t.assessment}`))

  // Discover all log files in logs/ (excluding eng-bot.log itself)
  const logFiles = collectLogFiles()
  log(`Scanning ${logFiles.length} log file(s): ${logFiles.map(f => path.basename(f)).join(', ')}`)

  if (!logFiles.length) {
    log('No log files found — nothing to diagnose')
    log('━━━ eng-bot complete (no log) ━━━\n')
    return
  }

  // Extract failures and exhausted entries from the tail of every log file
  const failures        = []
  const exhaustedAll    = []
  for (const logPath of logFiles) {
    const source = path.basename(logPath)
    if (SUPPRESSED_SOURCES.includes(source)) {
      log(`  ${source}: suppressed — skipping until configured`)
      continue
    }
    try {
      const content  = readTailBytes(logPath)
      const found    = extractFailures(content, source)
      const exhausted = extractExhaustedEntries(content, source)
      if (found.length)    log(`  ${source}: ${found.length} failure(s)`)
      if (exhausted.length) log(`  ${source}: ${exhausted.length} EXHAUSTED entr${exhausted.length === 1 ? 'y' : 'ies'} (${exhausted.filter(e => !e.known).length} actionable)`)
      failures.push(...found)
      exhaustedAll.push(...exhausted)
    } catch (err) {
      log(`WARNING: could not read ${path.basename(logPath)} — ${err.message}`)
    }
  }

  const actionableExhausted = exhaustedAll.filter(e => !e.known)
  const knownExhausted      = exhaustedAll.filter(e => e.known)
  if (knownExhausted.length)      log(`${knownExhausted.length} known-DOA exhausted slot(s) — no action needed (${knownExhausted.map(e => `${e.slot}/${e.platform}`).join(', ')})`)
  if (actionableExhausted.length) log(`${actionableExhausted.length} ACTIONABLE exhausted slot(s): ${actionableExhausted.map(e => `${e.slot}/${e.platform}`).join(', ')}`)

  if (!failures.length && !actionableExhausted.length && !inactiveTriage.length) {
    log('No failures, exhausted slots, or inactive agents — nothing to report')
    log('━━━ eng-bot complete (no failures) ━━━\n')
    return
  }

  log(`Found ${failures.length} unique failure(s) across all logs`)

  // Baseline mode: start fresh — rewrite eng-seen.json entirely with current formula.
  // Never merges with old data so stale hashes from previous formula versions don't persist.
  if (baseline) {
    const now    = new Date().toISOString()
    const hashes = {}
    failures.forEach(f => { hashes[failureHash(f)] = now })
    saveSeen({ baselineAt: now, hashes })
    log(`Baseline: ${Object.keys(hashes).length} hash(es) written to eng-seen.json, baselineAt=${now}`)
    log('━━━ eng-bot complete (baseline) ━━━\n')
    return
  }

  failures.forEach(f => log(`  → [${f.source}] ${f.platform}: ${f.message}`))

  // Classify failures: new (never seen), active (baselined but recurring after baseline), or old (skip)
  const seenData    = loadSeen()
  const { baselineAt, hashes } = seenData
  const newFailures    = []
  const activeFailures = []

  for (const f of failures) {
    const h = failureHash(f)
    if (!(h in hashes)) {
      newFailures.push(f)
    } else if (
      baselineAt &&
      f.timestamp !== 'unknown time' &&
      f.timestamp > (hashes[h] || baselineAt)
    ) {
      activeFailures.push({ ...f, active: true })
    }
  }

  const allFailures = [...newFailures, ...activeFailures]

  if (!allFailures.length && !actionableExhausted.length && !inactiveTriage.length) {
    log('All failures already in eng-seen.json — nothing new to report')
    log('━━━ eng-bot complete (no new failures) ━━━\n')
    return
  }

  if (newFailures.length)         log(`${newFailures.length} new failure(s) to report`)
  if (activeFailures.length)      log(`${activeFailures.length} active recurring failure(s) detected (post-baseline)`)
  if (actionableExhausted.length) log(`${actionableExhausted.length} actionable exhausted slot(s) to include in report`)

  // Diagnose with Claude — include actionable exhausted slots in the prompt
  log('Calling Claude API for diagnosis...')
  const client = new Anthropic({ apiKey })
  let diagnosis
  const diagnosisInput = [
    ...allFailures,
    ...actionableExhausted.map(e => ({
      timestamp: e.timestamp,
      platform:  e.platform,
      message:   `Slot ${e.slot} exhausted all ${MAX_ATTEMPTS ?? 3} attempts on ${e.platform}. Last error: ${e.lastError}`,
      context:   `EXHAUSTED: ${e.slot} / ${e.platform} — retried to the limit. This slot will not post to ${e.platform} without manual intervention.`,
      source:    e.source,
    })),
  ]
  try {
    diagnosis = await diagnose(client, diagnosisInput)
    log(`Diagnosis complete (${diagnosis.length} chars)`)
  } catch (err) {
    log(`ERROR: Claude diagnosis failed: ${err.message}`)
    diagnosis = null
  }

  // Write report to Google Drive
  writeReport(today, allFailures, diagnosis, exhaustedAll, inactiveTriage)

  // ── OMG: Critical alerts fire first, targeted, awaited ───────────────────────
  try {
    await sendCriticalAlerts(activeFailures, actionableExhausted, alertState)
  } catch (err) {
    log(`WARNING: sendCriticalAlerts failed: ${err.message}`)
  }

  // ── Per-failure dispatch: autonomous fix / chief escalation / Big D queue ────
  try {
    for (const failure of allFailures.slice(0, 10)) {
      const category = categorizeIssue(failure, diagnosis)

      // Extract proposed fix from diagnosis for all paths
      let proposedFix = 'See eng report for details'
      if (diagnosis) {
        const fixMatch = diagnosis.match(/\*\*Fix:\*\*\s*([^\n]+)/)
        if (fixMatch) proposedFix = fixMatch[1].trim().slice(0, 120)
      }

      // ── Tier 1: Autonomous — fix now, no approval needed ──────────────────
      if (category === 'autonomous') {
        const result = await attemptAutonomousFix(failure)
        log(`AUTONOMOUS ${result.applied ? 'FIXED' : 'ATTEMPTED'}: ${failure.platform} — ${result.description}`)
        if (result.applied) {
          const tg = await sendTelegram([
            `✅ *BSV — Eng: Auto-Fix Applied*`,
            ``,
            `*Script:* ${failure.source || 'unknown'}`,
            `*Issue:* ${(failure.message || '').slice(0, 100)}`,
            `*Fixed:* ${result.description}`,
          ].join('\n'))
          if (tg?.message_id) log(`  Auto-fix Telegram delivered — message_id: ${tg.message_id}`)
          else log('  WARNING: auto-fix Telegram returned no confirmation')
        }
        continue
      }

      // ── Tier 2: Chief — affects posts/schedule/content; Chief decides ─────
      if (category === 'chief') {
        try { await escalateToChief(failure, proposedFix, alertState) } catch (err) {
          log(`WARNING: escalateToChief failed: ${err.message}`)
        }
        continue
      }

      // ── Tier 3: Big D — revenue/brand/strategic; Chief surfaces to Big D ──
      const issueId    = buildIssueId(failure)
      const scriptName = failure.source ? failure.source.replace(/\.log$/, '.js') : 'unknown'
      const problem    = failure.message.slice(0, 120)

      const issueMsg = [
        `🚨 *BSV — Chief → Big D: Decision Required*`,
        `*Script:* ${scriptName}`,
        `*Problem:* ${problem}`,
        `*Proposed fix:* ${proposedFix}`,
        ``,
        `This affects revenue, brand output, or is irreversible.`,
        `Chief cannot authorize — requires Big D sign-off.`,
        ``,
        `Reply *FIX* to authorize`,
        `Reply *SKIP* to defer`,
      ].join('\n')

      addPendingItem({
        id:              issueId,
        type:            'eng',
        driveFile:       `${issueId}-decision.md`,
        sentAt:          new Date().toISOString(),
        remindAfter:     null,
        metadata:        { script: scriptName, problem, fix: proposedFix, complexity: 'Big D decision', issueId },
        originalMessage: issueMsg,
      })

      sendTelegram(issueMsg).then(r => {
        if (r?.message_id) log(`Big-D escalation delivered — message_id: ${r.message_id}`)
        else log(`WARNING: Big-D escalation — no Telegram confirmation for ${issueId}`)
      })
      log(`Big-D escalation queued: ${issueId}`)
    }
  } catch (err) {
    log(`WARNING: per-failure dispatch failed: ${err.message}`)
  }

  // Mark genuinely new failures as seen (active ones already have a hash entry)
  const now = new Date().toISOString()
  newFailures.forEach(f => { seenData.hashes[failureHash(f)] = now })
  saveSeen(seenData)
  log(`Saved ${newFailures.length} new hash(es) to eng-seen.json`)
  saveAlertState(alertState)
  log(`Alert state saved → eng-bot-alert-state.json`)

  // Telegram digest — send alongside (not replacing) the Drive report
  try {
    const lines = [`⚠️ *BSV Eng Report — ${today}*`]
    if (newFailures.length)         lines.push(`*New failures:* ${newFailures.length}`)
    if (activeFailures.length)      lines.push(`*Active recurring:* ${activeFailures.length}`)
    if (actionableExhausted.length) lines.push(`*Exhausted slots:* ${actionableExhausted.length}`)
    if (inactiveTriage.length)      lines.push(`*Inactive agents triaged:* ${inactiveTriage.length}`)
    lines.push('')
    for (const f of allFailures.slice(0, 5)) {
      lines.push(`✗ *${f.platform}* (${f.source}): ${f.message.slice(0, 120)}`)
    }
    if (allFailures.length > 5) lines.push(`…and ${allFailures.length - 5} more`)
    for (const e of actionableExhausted.slice(0, 3)) {
      lines.push(`⛔ *${e.slot}/${e.platform}* exhausted — ${e.lastError.slice(0, 100)}`)
    }
    if (inactiveTriage.length) {
      lines.push('')
      lines.push(`*INACTIVE AGENT TRIAGE*`)
      for (const t of inactiveTriage) {
        const icon = t.recommendation.startsWith('no action') ? '✓' : '⚠️'
        lines.push(`${icon} ${t.script} — ${t.lastEntry} — ${t.recommendation}`)
      }
    }
    lines.push('')
    lines.push(`Full report: Drive → eng-report-${today}.md`)
    const tgDigest = await sendTelegram(lines.join('\n'))
    if (tgDigest?.message_id) {
      log(`Telegram digest delivered — message_id: ${tgDigest.message_id}`)
    } else {
      log('WARNING: Telegram digest returned no confirmation — check console for API error')
    }
  } catch (tgErr) {
    log(`WARNING: Telegram digest failed: ${tgErr.message}`)
  }

  log('━━━ eng-bot complete ━━━\n')
})()
