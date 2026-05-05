require('dotenv').config()
const Anthropic  = require('@anthropic-ai/sdk').default
const nodemailer = require('nodemailer')
const fs         = require('fs')
const path       = require('path')
const os         = require('os')
const crypto     = require('crypto')
const { execSync } = require('child_process')

const ROOT                  = path.join(__dirname, '..')
const LOG_FILE              = path.join(ROOT, 'logs', 'eng-bot.log')
const WATCH_LOG             = path.join(ROOT, 'logs', 'watch-drive.log')
const WATCH_ERR_LOG         = path.join(ROOT, 'logs', 'watch-drive-error.log')
const SENT_FILE             = path.join(ROOT, 'logs', 'eng-bot-sent.json')
const SEEN_FILE             = path.join(ROOT, 'logs', 'eng-seen.json')
const ADMIN_EMAIL           = 'admin@bigsolevibes.com'
const GDRIVE_REMOTE         = 'big sole vibes'
const GDRIVE_REPORTS_FOLDER = '1vKaxZuhQy2tZ8cQQF1Vc8TSVJrq26PaP'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Failure extraction ───────────────────────────────────────────────────────

// Strip leading ISO timestamp so "same error, different time" dedups correctly.
function normalizeMessage(msg) {
  return msg.replace(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\]\s*/, '').trim()
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

// ─── Already-sent tracking (human-readable record, secondary) ─────────────────

function loadSent() {
  try { return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')) } catch { return [] }
}

function saveSent(sent) {
  fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2))
}

// ─── Google Drive report ──────────────────────────────────────────────────────

function extractSlug(context) {
  // Matches lines like "[timestamp] day2a: ERROR ..." or "[timestamp] day2a: WARNING ..."
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

async function diagnose(client, failures) {
  const failureText = failures.map((f, i) =>
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

  log(`Sending diagnosis request — ${failures.length} failure(s), ${userContent.length} chars`)

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    thinking:   { type: 'adaptive' },
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

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(failures, diagnosis) {
  const { ZOHO_SMTP_HOST, ZOHO_SMTP_USER, ZOHO_SMTP_PASSWORD } = process.env

  if (!ZOHO_SMTP_HOST || !ZOHO_SMTP_USER || !ZOHO_SMTP_PASSWORD) {
    log('ERROR: Missing ZOHO_SMTP_HOST, ZOHO_SMTP_USER, or ZOHO_SMTP_PASSWORD — cannot send email')
    return false
  }

  const transporter = nodemailer.createTransport({
    host:   ZOHO_SMTP_HOST,
    port:   465,
    secure: true,
    auth: {
      user: ZOHO_SMTP_USER,
      pass: ZOHO_SMTP_PASSWORD,
    },
  })

  const failureSummary = failures.map(f =>
    `• ${f.platform}: ${f.message} (${f.timestamp})`
  ).join('\n')

  const subject = `[BSV Eng Bot] ${failures.length} posting failure${failures.length > 1 ? 's' : ''} detected — approval required`

  const body = `BSV Engineering Bot detected ${failures.length} posting failure${failures.length > 1 ? 's' : ''} in watch-drive.log.

━━━ FAILURES DETECTED ━━━

${failureSummary}

━━━ DIAGNOSIS & PROPOSED FIXES ━━━

${diagnosis}

━━━ APPROVAL REQUIRED ━━━

The bot has taken NO action. It will not retry, modify code, or touch any other agent without your explicit approval.

To approve the proposed fix(es), reply to this email with:
  APPROVE

To deny and take no action, reply with:
  DENY

The bot will check for your reply every 15 minutes for up to 24 hours.
If no reply is received, no action will be taken.

━━━━━━━━━━━━━━━━━━━━━━━━━━

This email was generated automatically by scripts/eng-bot.js
Log: logs/eng-bot.log`

  const info = await transporter.sendMail({
    from:    `"BSV Eng Bot" <${ZOHO_SMTP_USER}>`,
    to:      ADMIN_EMAIL,
    subject,
    text:    body,
  })

  log(`Email sent — messageId: ${info.messageId}`)
  return true
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
    log(`No watch-drive logs found — nothing to diagnose`)
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
  failures.forEach(f => log(`  ✗ ${f.platform}: ${f.message} [hash=${failureHash(f)}]`))

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
  const client    = new Anthropic({ apiKey })
  let diagnosis
  try {
    diagnosis = await diagnose(client, newFailures)
    log(`Diagnosis complete (${diagnosis.length} chars)`)
  } catch (err) {
    log(`ERROR: Claude diagnosis failed: ${err.message}`)
    diagnosis = null
  }

  // Write report to Google Drive (independent of email)
  writeReport(today, newFailures, diagnosis)

  if (!diagnosis) process.exit(1)

  // Send email
  log(`Sending email to ${ADMIN_EMAIL}...`)
  const emailSent = await sendEmail(newFailures, diagnosis)

  // Mark failures as seen regardless of email outcome — Drive report was already written
  newFailures.forEach(f => seen.add(failureHash(f)))
  saveSeen(seen)
  log(`Saved ${newFailures.length} new hash(es) to eng-seen.json`)

  if (emailSent) {
    // Also write human-readable record to eng-bot-sent.json
    const sent      = loadSent()
    const updatedSent = [
      ...sent,
      ...newFailures.map(f => ({
        platform:   f.platform,
        message:    f.message,
        timestamp:  f.timestamp,
        hash:       failureHash(f),
        reportedAt: new Date().toISOString(),
      })),
    ]
    saveSent(updatedSent)
  }

  log('Bot has taken no further action. Waiting for admin reply.')
  log('━━━ eng-bot complete ━━━\n')
})()
