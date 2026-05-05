require('dotenv').config()

const Anthropic    = require('@anthropic-ai/sdk').default
const fs           = require('fs')
const path         = require('path')
const os           = require('os')
const crypto       = require('crypto')
const { execSync } = require('child_process')

const ROOT                  = path.join(__dirname, '..')
const LOG_FILE              = path.join(ROOT, 'logs', 'eng-bot.log')
const WATCH_LOG             = path.join(ROOT, 'logs', 'watch-drive.log')
const WATCH_ERR_LOG         = path.join(ROOT, 'logs', 'watch-drive-error.log')
const SEEN_FILE             = path.join(ROOT, 'logs', 'eng-seen.json')
const GDRIVE_REMOTE         = 'big sole vibes'
const GDRIVE_REPORTS_FOLDER = '1vKaxZuhQy2tZ8cQQF1Vc8TSVJrq26PaP'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
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

function extractFailures(logContent) {
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

    failures.push({ timestamp, platform, message, context, lineIndex: i })
  }

  // Deduplicate within this run using normalized message (timestamp-stripped)
  const seen = new Set()
  return failures.filter(f => {
    const key = `${f.platform}::${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Seen-failure deduplication (hash-based, persists across restarts) ───────

function failureHash(failure) {
  const key = `${failure.platform}::${normalizeMessage(failure.message)}`
  return crypto.createHash('md5').update(key).digest('hex')
}

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))) } catch { return new Set() }
}

function saveSeen(seen) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2))
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
    `## Failure ${i + 1}: ${f.platform}`,
    '',
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
  ].join('\n')).join('\n\n---\n\n')

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

  const userContent = `The following failures were detected in watch-drive.log. For each one:
1. Explain in plain English what broke and why (2-3 sentences max)
2. Propose one specific fix — exact code change, config step, or API action required

Format each diagnosis as:

### [Platform]
**What broke:** ...
**Why:** ...
**Fix:** ...

Here are the failures:

${failureText}`

  log(`Sending diagnosis request — ${dedupedFailures.length} failure(s), ${userContent.length} chars`)

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1000,
    system: `You are the engineering bot for Big Sole Vibes (BSV) — a solo-operated social media automation system running on a Mac via launchd. The stack is: Node.js scripts, Cloudflare Pages (Next.js), Klaviyo, Meta Graph API, TikTok API, Bluesky ATP, YouTube Data API v3, and rclone for Google Drive.

Your job is to diagnose posting failures extracted from watch-drive.log and propose one specific, actionable fix per failure. Be direct and technical. The operator is a developer — no hand-holding.`,
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

  const today = new Date().toISOString().slice(0, 10)

  log('━━━ eng-bot start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  // Read watch-drive.log + watch-drive-error.log (stderr from child processes)
  if (!fs.existsSync(WATCH_LOG) && !fs.existsSync(WATCH_ERR_LOG)) {
    log('No watch-drive logs found — nothing to diagnose')
    log('━━━ eng-bot complete (no log) ━━━\n')
    return
  }

  let logContent = ''
  if (fs.existsSync(WATCH_LOG))     logContent += fs.readFileSync(WATCH_LOG,     'utf8')
  if (fs.existsSync(WATCH_ERR_LOG)) logContent += '\n' + fs.readFileSync(WATCH_ERR_LOG, 'utf8')

  const failures = extractFailures(logContent)

  if (!failures.length) {
    log('No failures found in watch-drive.log')
    log('━━━ eng-bot complete (no failures) ━━━\n')
    return
  }

  log(`Found ${failures.length} unique failure(s):`)
  failures.forEach(f => log(`  ✗ ${f.platform}: ${f.message}`))

  // Skip failures already seen (hash-based, persists across restarts)
  const seen        = loadSeen()
  const newFailures = failures.filter(f => !seen.has(failureHash(f)))

  if (!newFailures.length) {
    log('All failures already in eng-seen.json — nothing new to report')
    log('━━━ eng-bot complete (no new failures) ━━━\n')
    return
  }

  log(`${newFailures.length} new failure(s) to report`)

  // Diagnose with Claude
  log('Calling Claude API for diagnosis...')
  const client = new Anthropic({ apiKey })
  let diagnosis
  try {
    diagnosis = await diagnose(client, newFailures)
    log(`Diagnosis complete (${diagnosis.length} chars)`)
  } catch (err) {
    log(`ERROR: Claude diagnosis failed: ${err.message}`)
    diagnosis = null
  }

  // Write report to Google Drive
  writeReport(today, newFailures, diagnosis)

  // Mark failures as seen
  newFailures.forEach(f => seen.add(failureHash(f)))
  saveSeen(seen)
  log(`Saved ${newFailures.length} new hash(es) to eng-seen.json`)

  log('━━━ eng-bot complete ━━━\n')
})()
