require('dotenv').config()

const Anthropic    = require('@anthropic-ai/sdk').default
const fs           = require('fs')
const path         = require('path')
const os           = require('os')
const crypto       = require('crypto')
const { execSync } = require('child_process')

const ROOT                  = path.join(__dirname, '..')
const LOG_FILE              = path.join(ROOT, 'logs', 'eng-bot.log')
const LOGS_DIR              = path.join(ROOT, 'logs')
const SEEN_FILE             = path.join(ROOT, 'logs', 'eng-seen.json')
const GDRIVE_REMOTE         = 'big sole vibes'
const GDRIVE_REPORTS_FOLDER = '1vKaxZuhQy2tZ8cQQF1Vc8TSVJrq26PaP'

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

function extractFailures(logContent, source) {
  const failures = []
  const lines = logContent.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const ll = line.toLowerCase()
    if (
      !line.includes('✗') &&
      !ll.includes('error') &&
      !ll.includes('failed') &&
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

function writeReport(date, failures, diagnosis) {
  const timestamp = new Date().toISOString()

  const slugs = [...new Set(failures.map(f => extractSlug(f.context)).filter(Boolean))]
  const slugLine = slugs.length ? slugs.join(', ') : 'unknown'

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

  const content = [
    `# BSV Eng Report — ${date}`,
    '',
    `**Generated:** ${timestamp}`,
    `**Failures:** ${failures.length}`,
    `**Affected slugs:** ${slugLine}`,
    '',
    '---',
    '',
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
    model:      'claude-sonnet-4-6',
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

  // Discover all log files in logs/ (excluding eng-bot.log itself)
  const logFiles = collectLogFiles()
  log(`Scanning ${logFiles.length} log file(s): ${logFiles.map(f => path.basename(f)).join(', ')}`)

  if (!logFiles.length) {
    log('No log files found — nothing to diagnose')
    log('━━━ eng-bot complete (no log) ━━━\n')
    return
  }

  // Extract failures from the tail of every log file (last 4MB each — avoids OOM on large logs)
  const failures = []
  for (const logPath of logFiles) {
    try {
      const content  = readTailBytes(logPath)
      const source   = path.basename(logPath)
      const found    = extractFailures(content, source)
      if (found.length) log(`  ${source}: ${found.length} failure(s)`)
      failures.push(...found)
    } catch (err) {
      log(`WARNING: could not read ${path.basename(logPath)} — ${err.message}`)
    }
  }

  if (!failures.length) {
    log('No failures found across all logs')
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

  // Use → not ✗ here — log() writes to stdout which launchd pipes into watch-drive.log,
  // and ✗ would trigger extractFailures on the next run, creating a prefix snowball.
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

  if (!allFailures.length) {
    log('All failures already in eng-seen.json — nothing new to report')
    log('━━━ eng-bot complete (no new failures) ━━━\n')
    return
  }

  if (newFailures.length)    log(`${newFailures.length} new failure(s) to report`)
  if (activeFailures.length) log(`${activeFailures.length} active recurring failure(s) detected (post-baseline)`)

  // Diagnose with Claude
  log('Calling Claude API for diagnosis...')
  const client = new Anthropic({ apiKey })
  let diagnosis
  try {
    diagnosis = await diagnose(client, allFailures)
    log(`Diagnosis complete (${diagnosis.length} chars)`)
  } catch (err) {
    log(`ERROR: Claude diagnosis failed: ${err.message}`)
    diagnosis = null
  }

  // Write report to Google Drive
  writeReport(today, allFailures, diagnosis)

  // Mark genuinely new failures as seen (active ones already have a hash entry)
  const now = new Date().toISOString()
  newFailures.forEach(f => { seenData.hashes[failureHash(f)] = now })
  saveSeen(seenData)
  log(`Saved ${newFailures.length} new hash(es) to eng-seen.json`)

  log('━━━ eng-bot complete ━━━\n')
})()
