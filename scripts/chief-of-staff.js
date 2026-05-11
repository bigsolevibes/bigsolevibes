require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// chief-of-staff.js — BSV daily morning brief, handoff update, Telegram ping
//
// Runs every morning at 8:00AM via launchd.
// Reads everything. Synthesizes. Reports to the Proprietor.
//
// Required .env additions (add manually — this script never writes .env):
//   TELEGRAM_BOT_TOKEN=<your bot token from @BotFather>
//   TELEGRAM_CHAT_ID=<your personal chat ID — send /start to @userinfobot>
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'chief-of-staff.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-chief-of-staff')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
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

// ─── Local state collectors ───────────────────────────────────────────────────

function getRecentLog(filename, lines = 80) {
  try {
    const p = path.join(ROOT, 'logs', filename)
    if (!fs.existsSync(p)) return null
    const all = fs.readFileSync(p, 'utf8').trim().split('\n')
    return all.slice(-lines).join('\n')
  } catch { return null }
}

function getPostState() {
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function getOutputFiles() {
  try {
    return fs.readdirSync(path.join(ROOT, 'posts', 'output'))
      .filter(f => !f.startsWith('.'))
      .sort()
  } catch { return [] }
}

function getBriefFiles() {
  try {
    return fs.readdirSync(path.join(ROOT, 'posts', 'briefs'))
      .filter(f => f.endsWith('-brief.txt'))
      .sort()
  } catch { return [] }
}

// ─── Drive state collectors ───────────────────────────────────────────────────

function getReadyToPost() {
  try {
    const out = execSync(`rclone ls --max-depth 1 "${REMOTE}/Ready to Post/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (!out) return '(empty)'
    return out.split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(Boolean)
      .join(', ')
  } catch { return '(unavailable)' }
}

function getPostedLast24h() {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - 24)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
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

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Telegram error: ${JSON.stringify(data)}`)
  return data
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ chief-of-staff start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today    = new Date().toISOString().slice(0, 10)
  const dayName  = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const outFile  = `standup-${today}.md`

  // ── Collect context ──────────────────────────────────────────────────────────

  log('Collecting context...')

  const directive      = loadDriveFile(`${REMOTE}/BSV-Directive.md`, TEMP_DIR)
  const handoff        = loadDriveFile(`${REMOTE}/Handoff/BSV-Handoff-v5.md`, TEMP_DIR)
  const socialReport   = loadLatestReport('social-report')
  const brandReport    = loadLatestReport('brand-health')
  const marketingReport = loadLatestReport('marketing')
  const productResearch = loadLatestReport('research', 'Product Research')

  log(`Directive: ${directive ? 'loaded' : 'missing'}`)
  log(`Handoff: ${handoff ? 'loaded' : 'missing'}`)
  log(`Social report: ${socialReport?.filename || 'none'}`)
  log(`Brand report: ${brandReport?.filename || 'none'}`)
  log(`Marketing report: ${marketingReport?.filename || 'none'}`)
  log(`Product research: ${productResearch?.filename || 'none'}`)

  const watchLog       = getRecentLog('watch-drive.log', 150)
  const socialLog      = getRecentLog('social-listening.log', 40)
  const mediaLog       = getRecentLog('media-director.log', 40)
  const creativeLog    = getRecentLog('creative-agent.log', 40)
  const bridgeLog      = getRecentLog('gemini-bridge.log', 40)
  const imageLog       = getRecentLog('image-gen.log', 40)
  const videoLog       = getRecentLog('video-gen.log', 40)
  const engBotLog      = getRecentLog('eng-bot.log', 30)

  const postState      = getPostState()
  const outputFiles    = getOutputFiles()
  const briefFiles     = getBriefFiles()
  const readyToPost    = getReadyToPost()
  const postedLast24h  = getPostedLast24h()

  log(`Ready to Post: ${readyToPost}`)
  log(`Posted last 24h: ${postedLast24h}`)
  log(`Output files: ${outputFiles.join(', ') || 'none'}`)
  log(`Brief files: ${briefFiles.join(', ') || 'none'}`)

  // ── Stand-up generation ──────────────────────────────────────────────────────

  log('Calling Claude API for stand-up...')
  const client = new Anthropic({ apiKey })

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}You are the Chief of Staff for Big Sole Vibes. You report directly to the Proprietor (Big D).

## Your Mandate

You read everything. You synthesize it. You tell the Proprietor exactly where things stand — what ran, what posted, what's ready, what's broken, what needs a decision.

You are not a cheerleader. You are not a press release. You are a chief of staff. If something is broken, you name it. If something is missing, you flag it. If something is working, you confirm it and move on.

The Proprietor's morning is limited. Every line you write must earn its place.

## The Team You Manage (know their jobs)

- **social-listening.js** — runs 11:00PM, files social-report-YYYY-MM-DD.md to Drive/Reports/
- **media-director.js** — runs 11:30PM, picks themes from calendar, calls creative-agent × 2
- **creative-agent.js** — called by media-director, generates content brief per slot, saves to posts/briefs/
- **gemini-bridge.js** — called by media-director after briefs, uploads .md + prompt files to Drive/Ready to Post/
- **image-gen.js** — runs midnight, generates images from -prompt.txt files
- **video-gen.js** — runs 1:00AM, generates videos from -flow-prompt.txt files
- **watch-drive.js** — polls every 15 min, posts when .md + media are both present at post_time
- **brand-manager.js** — runs weekly, reviews content quality
- **marketing-manager.js** — tracks audience growth (Klaviyo)
- **product-research.js** — sources products for the shelf
- **eng-bot.js** — runs after every watch-drive poll, triages errors
- **update-handoff.js** — runs 11:00PM, rewrites handoff doc

## Output Format

Produce the daily stand-up in this exact structure, then a Telegram ping.

---

# BSV Daily Stand-Up — ${dayName}, ${today}

## Pipeline (Overnight)
One line per agent that ran. Status: ✓ ran clean | ⚠ ran with issues | ✗ failed | — not scheduled. Source from logs.

## What Posted
What went out in the last 24 hours. Which platforms. Any failures. Source from post-state.json and watch-drive.log.

## Queue Status
What is currently in Ready to Post/. What briefs exist. What's ready to distribute tonight.

## Brand Health
One paragraph from the latest brand report — voice compliance, top 3, any flags.

## Audience
From the latest marketing report — Lounge and Drop subscriber counts and weekly change. If unavailable, say so.

## Product Shelf
From the latest product research — how many pending in queue, any approved, any watchlist items. One sentence.

## Intelligence
Top 2–3 bullets from the latest social report. The ones that should inform tonight's content. Specific.

## Blockers / Proprietor Attention Required
Be direct. If something is broken and needs a human decision, name it. If credentials are expired, say so. If the queue is empty for an upcoming post_time, flag it. If nothing needs attention, say: "Nothing requires Proprietor action today."

## Tonight's Schedule
What the pipeline will run tonight at 11:00PM. Which day's slots will be generated (tomorrow = [day name]).

---

<!-- TELEGRAM -->
[Write a concise Telegram message for the Proprietor's phone. 8–12 lines max. Use *bold* for section labels. No walls of text. Cover: pipeline status, what posted, queue state, any blockers. End with the standup filename. Plain Markdown only — no HTML, no code blocks.]`

  const userPrompt = `Today is ${dayName} ${today}. Produce the BSV daily stand-up.

## Pipeline Logs (last 24h)

### watch-drive.log (last 150 lines)
\`\`\`
${watchLog || '(no log)'}
\`\`\`

### social-listening.log
\`\`\`
${socialLog || '(no log)'}
\`\`\`

### media-director.log
\`\`\`
${mediaLog || '(no log)'}
\`\`\`

### creative-agent.log
\`\`\`
${creativeLog || '(no log)'}
\`\`\`

### gemini-bridge.log
\`\`\`
${bridgeLog || '(no log)'}
\`\`\`

### image-gen.log
\`\`\`
${imageLog || '(no log)'}
\`\`\`

### video-gen.log
\`\`\`
${videoLog || '(no log)'}
\`\`\`

### eng-bot.log
\`\`\`
${engBotLog || '(no log)'}
\`\`\`

## Post State (post-state.json)
\`\`\`json
${postState || '(no post-state.json)'}
\`\`\`

## Local Files
Output files in posts/output/: ${outputFiles.join(', ') || '(none)'}
Brief files in posts/briefs/: ${briefFiles.join(', ') || '(none)'}

## Drive State
Ready to Post/: ${readyToPost}
Posted last 24h: ${postedLast24h}

## Latest Reports

### Social Intelligence (${socialReport?.filename || 'none'})
${socialReport ? socialReport.content.slice(0, 2000) + (socialReport.content.length > 2000 ? '\n[truncated]' : '') : '(not available)'}

### Brand Health (${brandReport?.filename || 'none'})
${brandReport ? brandReport.content.slice(0, 1500) + (brandReport.content.length > 1500 ? '\n[truncated]' : '') : '(not available)'}

### Marketing (${marketingReport?.filename || 'none'})
${marketingReport ? marketingReport.content.slice(0, 1200) + (marketingReport.content.length > 1200 ? '\n[truncated]' : '') : '(not available)'}

### Product Research (${productResearch?.filename || 'none'})
${productResearch ? productResearch.content.slice(0, 800) + (productResearch.content.length > 800 ? '\n[truncated]' : '') : '(not available)'}

## Current Handoff Doc (BSV-Handoff-v5.md)
${handoff ? handoff.slice(0, 2000) + (handoff.length > 2000 ? '\n[truncated]' : '') : '(not available)'}`

  let fullText = ''

  const stream = await client.messages.stream({
    model:      'claude-sonnet-4-6',
    max_tokens: 6000,
    thinking:   { type: 'adaptive' },
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  process.stdout.write('Generating stand-up')
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n')

  const finalMsg = await stream.finalMessage()
  log(`Stand-up done — ${finalMsg.usage?.output_tokens ?? '?'} tokens, stop: ${finalMsg.stop_reason}`)

  if (!fullText.trim()) { log('ERROR: empty stand-up response'); process.exit(1) }

  // Split stand-up body from Telegram ping
  const telegramDelimiter = '<!-- TELEGRAM -->'
  const delimIdx  = fullText.indexOf(telegramDelimiter)
  const standupMd = delimIdx >= 0 ? fullText.slice(0, delimIdx).trim() : fullText.trim()
  const telegramMsg = delimIdx >= 0 ? fullText.slice(delimIdx + telegramDelimiter.length).trim() : null

  // ── Save stand-up locally and upload to Drive ─────────────────────────────────

  const localStandup = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localStandup, standupMd)
  log(`Stand-up saved locally: ${localStandup}`)

  try {
    rcloneCopyTo(localStandup, `${REMOTE}/Reports/${outFile}`)
    log(`Stand-up uploaded → ${REMOTE}/Reports/${outFile}`)
  } catch (err) {
    log(`ERROR: stand-up upload failed: ${err.message}`)
  }

  // ── Handoff update ────────────────────────────────────────────────────────────

  log('Generating updated handoff doc...')
  const handoffPrompt = `You have just produced today's BSV daily stand-up (below). Now write the updated BSV-Handoff-v5.md.

The handoff is the living state document that every agent reads before executing. It must reflect current reality — not last week's state, not aspirations. What is true right now.

## Today's Stand-Up
${standupMd}

## Previous Handoff (for structure reference)
${handoff ? handoff.slice(0, 3000) + (handoff.length > 3000 ? '\n[truncated]' : '') : '(none — write fresh)'}

---

Write the complete BSV-Handoff-v5.md. Cover:

1. **What BSV Is** — one paragraph, the mission and the feeling (from directive, never changes)
2. **Current Pipeline State** — what's working, what's broken, what needs attention
3. **Content Queue** — what's in Ready to Post, what's been posted recently, what slots are next
4. **Platform Status** — per-platform health (Instagram, Bluesky, X, YouTube, TikTok, Facebook)
5. **Audience** — Lounge and Drop subscriber counts and recent trajectory
6. **Product Shelf** — shelf status, pending approvals, research pipeline
7. **Known Issues** — anything currently broken or degraded, with specific detail
8. **Tonight's Schedule** — what runs when
9. **Agent Team** — brief status on each agent (last run, any issues)

Write in Proprietor tone — direct, specific, no padding. This is an operational document, not a marketing document. Future agents reading this need to know exactly where things stand.`

  let handoffText = ''
  try {
    const handoffMsg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     directive ? `${directive}\n\n---\n\nYou are the BSV Chief of Staff updating the operational handoff document.` : 'You are the BSV Chief of Staff updating the operational handoff document.',
      messages:   [{ role: 'user', content: handoffPrompt }],
    })
    handoffText = handoffMsg.content[0]?.text?.trim() || ''
    log(`Handoff done — ${handoffMsg.usage?.output_tokens ?? '?'} tokens`)
  } catch (err) {
    log(`ERROR: handoff generation failed: ${err.message}`)
  }

  if (handoffText) {
    const localHandoff = path.join(TEMP_DIR, 'BSV-Handoff-v5.md')
    fs.writeFileSync(localHandoff, handoffText)
    try {
      rcloneCopyTo(localHandoff, `${REMOTE}/Handoff/BSV-Handoff-v5.md`)
      log(`Handoff uploaded → ${REMOTE}/Handoff/BSV-Handoff-v5.md`)
    } catch (err) {
      log(`ERROR: handoff upload failed: ${err.message}`)
    }
  }

  // ── Telegram ping ─────────────────────────────────────────────────────────────

  const telegramToken  = process.env.TELEGRAM_BOT_TOKEN
  const telegramChatId = process.env.TELEGRAM_CHAT_ID

  if (!telegramToken || !telegramChatId) {
    log('WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping Telegram ping')
    log('To enable: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env')
    log('  TELEGRAM_BOT_TOKEN — from @BotFather in Telegram')
    log('  TELEGRAM_CHAT_ID   — send /start to @userinfobot to get your chat ID')
  } else if (telegramMsg) {
    try {
      await sendTelegram(telegramToken, telegramChatId, telegramMsg)
      log('Telegram ping sent ✓')
    } catch (err) {
      log(`ERROR: Telegram ping failed: ${err.message}`)
    }
  } else {
    log('WARNING: no Telegram section found in stand-up output — ping skipped')
  }

  log('━━━ chief-of-staff complete ━━━\n')
})()
