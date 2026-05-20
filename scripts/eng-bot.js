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
const GDRIVE_REMOTE         = 'big sole vibes'
const GDRIVE_REPORTS_FOLDER = '1vKaxZuhQy2tZ8cQQF1Vc8TSVJrq26PaP'
const GDRIVE_DRIVE_ROOT     = 'big sole vibes:Big Sole Vibes'
const ORG_CHART_TEMP        = path.join(os.tmpdir(), 'bsv-eng-bot')

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
    '**Status:** ⏳ Awaiting Big D approval before any fix is applied.',
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

// Returns 'auto-fix' | 'simple' | 'code'
function categorizeIssue(failure, diagnosisText) {
  const msg    = (failure.message || '').toLowerCase()
  const source = (failure.source  || '').toLowerCase()
  const diag   = (diagnosisText   || '').toLowerCase()

  // auto-fix: log rotation, duplicate entries, minor state file housekeeping
  if (
    /log.?rotat/i.test(msg) ||
    /duplicate.?log/i.test(msg) ||
    /state.?file.?(corrupt|malform|empty)/i.test(msg) ||
    source === 'log-rotate.log'
  ) {
    return 'auto-fix'
  }

  // simple: credentials expired, service restart needed, config file missing
  if (
    /token.?(expired|revoked|invalid)/i.test(msg) ||
    /credential.?(expired|invalid|missing)/i.test(msg) ||
    /refresh.?token/i.test(msg) ||
    /config.?(file|missing|not.?found)/i.test(msg) ||
    /service.*(restart|down)/i.test(msg) ||
    /smtp.*(auth|reject)/i.test(msg) ||
    /ssl.*(handshake|error)/i.test(msg) ||
    /unauthorized/i.test(msg) ||
    /token.*(expired|revoked|invalid)/i.test(diag)
  ) {
    return 'simple'
  }

  // code: logic errors, missing features, pipeline behavior changes
  return 'code'
}

function buildIssueId(failure) {
  const scriptSlug = (failure.source || 'unknown')
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()
    .slice(0, 30)
  const dateStr = new Date().toISOString().slice(0, 10)
  return `eng-${scriptSlug}-${dateStr}`
}

// Handles a FIX-authorized simple issue — logs action needed, no code changes
async function attemptSimpleFix(item) {
  const { script, problem, fix, issueId } = item.metadata || {}
  log(`FIX authorized: ${issueId || item.id} — ${problem || '(no description)'} — manual execution required`)
  log(`  Proposed fix: ${fix || '(no fix specified)'}`)
  await sendTelegram(`✅ Fix authorized for *${script || item.id}*.\n\n${fix || 'Check eng-bot.log for details.'}\n\nManual execution required.`)
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

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: `You are the engineering bot for Big Sole Vibes (BSV) — a solo-operated social media automation system running on a Mac via launchd. The stack is: Node.js scripts, Cloudflare Pages (Next.js), Klaviyo, Meta Graph API, TikTok API, Bluesky ATP, YouTube Data API v3, and rclone for Google Drive. Scripts include: watch-drive.js, distribute.js, sync-shop.js, eng-bot.js, brand-video.js, brand-image.js, product-research.js, product-development.js, update-handoff.js, social-listening.js, marketing-manager.js, media-director.js, brand-manager.js, cost-report.js.

Your job is to diagnose failures extracted from any of these pipeline logs and propose one specific, actionable fix per failure. Be direct and technical. The operator is a developer — no hand-holding. Never say a fix has been applied — all fixes go through Big D approval first. The eng report IS the fix queue.`,
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

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  if (!text) log('WARNING: no text blocks in API response — diagnosis will be empty')
  return text.trim()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

  const today    = new Date().toISOString().slice(0, 10)
  const baseline = process.argv.includes('--baseline')

  log(`━━━ eng-bot start${baseline ? ' [baseline]' : ''} ━━━`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey && !baseline) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

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
          await sendTelegram(`✅ Code ticket filed for *${item.metadata?.script || item.id}*. Will action next session.`)
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

  // ── Per-failure Telegram approval requests ────────────────────────────────
  try {
    for (const failure of allFailures.slice(0, 10)) {
      const category = categorizeIssue(failure, diagnosis)
      if (category === 'auto-fix') {
        log(`Auto-fix: ${failure.platform} — ${failure.message.slice(0, 100)}`)
        continue
      }

      const issueId    = buildIssueId(failure)
      const complexity = category === 'simple' ? 'Simple' : 'Needs Code session'

      // Extract a proposed fix from the diagnosis text
      let proposedFix = 'See eng report for details'
      if (diagnosis) {
        const fixMatch = diagnosis.match(/\*\*Fix:\*\*\s*([^\n]+)/)
        if (fixMatch) proposedFix = fixMatch[1].trim().slice(0, 120)
      }

      const scriptName = failure.source ? failure.source.replace(/\.log$/, '.js') : 'unknown'
      const problem    = failure.message.slice(0, 120)

      const issueMsg = [
        `🔧 *ENG ISSUE DETECTED*`,
        `*Script:* ${scriptName}`,
        `*Problem:* ${problem}`,
        `*Fix:* ${proposedFix}`,
        `*Complexity:* ${complexity}`,
        ``,
        `Reply *FIX* to authorize`,
        `Reply *SKIP* to ignore this time`,
        `Reply *LATER* to remind tomorrow`,
      ].join('\n')

      addPendingItem({
        id:              issueId,
        type:            'eng',
        driveFile:       `${issueId}-decision.md`,
        sentAt:          new Date().toISOString(),
        remindAfter:     null,
        metadata:        { script: scriptName, problem, fix: proposedFix, complexity, issueId },
        originalMessage: issueMsg,
      })

      // Fire and continue — don't await
      sendTelegram(issueMsg).catch(err => log(`WARNING: issue Telegram failed: ${err.message}`))
      log(`Issue notification sent for ${issueId} (${complexity})`)
    }
  } catch (err) {
    log(`WARNING: per-failure notification failed: ${err.message}`)
  }

  // Mark genuinely new failures as seen (active ones already have a hash entry)
  const now = new Date().toISOString()
  newFailures.forEach(f => { seenData.hashes[failureHash(f)] = now })
  saveSeen(seenData)
  log(`Saved ${newFailures.length} new hash(es) to eng-seen.json`)

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
    await sendTelegram(lines.join('\n'))
    log('Telegram digest sent ✓')
  } catch (tgErr) {
    log(`WARNING: Telegram digest failed: ${tgErr.message}`)
  }

  log('━━━ eng-bot complete ━━━\n')
})()
