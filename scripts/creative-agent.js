require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT       = path.join(__dirname, '..')
const BRIEFS_DIR = path.join(ROOT, 'posts', 'briefs')
const LOG_FILE   = path.join(ROOT, 'logs', 'creative-agent.log')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-creative-agent')
const REMOTE     = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function loadLatestSocialReport() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^social-report-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR,   { recursive: true })
  fs.mkdirSync(BRIEFS_DIR, { recursive: true })

  // Parse args
  const slotArg  = process.argv.indexOf('--slot')
  const themeArg = process.argv.indexOf('--theme')
  const slot     = slotArg  !== -1 ? process.argv[slotArg  + 1] : null
  const theme    = themeArg !== -1 ? process.argv[themeArg + 1] : null

  if (!slot || !theme) {
    log('ERROR: --slot and --theme are required')
    log('Usage: creative-agent.js --slot mon-am --theme "The Standard"')
    process.exit(1)
  }

  log(`━━━ creative-agent: ${slot} / ${theme} ━━━`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading social intelligence report...')
  const socialReport = loadLatestSocialReport()
  log(`Social report: ${socialReport ? socialReport.filename : 'none'}`)

  const period    = slot.endsWith('-am') ? 'am' : 'pm'
  const postTime  = period === 'am' ? '09:00 CDT' : '19:00 CDT'
  const dayEnergy = period === 'am'
    ? 'Morning. The man before the world starts.'
    : 'Evening. The man who made it through.'

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}You are the BSV Creative Agent. One job: write the brief. Everything you produce must align with the Proprietor's Directive above.

## Proprietor Voice Rules

- Speaks in statements, never questions
- Deadpan, confident, slightly amused
- Never preachy, never explains itself
- The Lounge is the feeling, not the location
- Feet are evidence of the standard, not the subject
- The man is already arrived — BSV is what he reaches for, not what saves him

## Brief Format

Output EXACTLY this structure. No deviations, no additions, no commentary before or after.

SLOT: [slot]
THEME: [theme]
POST_TIME: [post time]
---
IMAGE BRIEF: [Atmospheric scene for Gemini Imagen 4. Dark wood, warm light, cinematic. No product placement. No people unless essential — mood first. Square 1:1. No text, no logos. Specific enough to generate without interpretation.]
VIDEO BRIEF: [Veo 3.1 motion prompt. 7–8 seconds, 9:16 vertical. Describe what moves and how. Same mood as image. End with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."]
ON-IMAGE COPY:
  Line 1 (Cream, Playfair Display): [short declarative statement — 4–8 words, no punctuation]
  Line 2 (Bourbon, Bebas Neue italic): [secondary line — 3–6 words, no punctuation]
INSTAGRAM: [Full caption. Proprietor voice. 3–5 sentences. One idea. No throat-clearing. #BigSoleVibes + 2–3 specific hashtags at end.]
BLUESKY: [2–3 punchy lines. No hashtags. Direct address. Reads like the Proprietor sent it personally.]
YOUTUBE: [Community post. 3–4 sentences. Slightly warmer, direct address. Ends with a reason to follow — not a generic CTA.]
TIKTOK: [Hook line for typewriter effect on screen. Then 1–2 line caption. 1–2 hashtags max. Hook should create a 3-second stop.]
---`

  const userPrompt = `Write the BSV content brief.

SLOT: ${slot}
THEME: ${theme}
POST TIME: ${postTime}
DAY ENERGY: ${dayEnergy}

${socialReport ? `## Intelligence (${socialReport.filename})\nUse if it sharpens the angle. Do not force it.\n\n${socialReport.content.slice(0, 1500)}${socialReport.content.length > 1500 ? '\n[truncated]' : ''}` : ''}

Write the brief. The image brief should make a creative director say yes. The captions should make a man stop scrolling and send it to someone who gets it.`

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const brief = msg.content[0].text.trim()
  log(`Done — ${msg.usage?.output_tokens ?? '?'} tokens, stop: ${msg.stop_reason}`)

  if (!brief) { log('ERROR: empty response'); process.exit(1) }

  if (!brief.includes('IMAGE BRIEF:') || !brief.includes('INSTAGRAM:')) {
    log('ERROR: brief missing expected sections')
    log(`Preview: ${brief.slice(0, 200)}`)
    process.exit(1)
  }

  const briefPath = path.join(BRIEFS_DIR, `${slot}-brief.txt`)
  fs.writeFileSync(briefPath, brief)
  log(`Saved → ${briefPath}`)

  log(`━━━ creative-agent complete: ${slot} ━━━\n`)
})()
