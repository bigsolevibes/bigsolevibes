require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'brand-manager.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-brand-manager')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function getPostedLastNDays(n = 7) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - n)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  try {
    const dirs = execSync(`rclone lsd "${REMOTE}/Posted/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (!dirs) return '(no posted content found)'

    const lines = []
    for (const line of dirs.split('\n')) {
      const folder = line.trim().split(/\s+/).pop()
      if (!folder || folder < cutoffStr) continue
      try {
        const files = execSync(`rclone ls "${REMOTE}/Posted/${folder}"`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        lines.push(`\n### ${folder}`)
        for (const f of files.split('\n')) {
          const name = f.trim().split(/\s+/).slice(1).join(' ')
          if (name) lines.push(`- ${name}`)
        }
        // Pull caption text if .md files present
        for (const f of files.split('\n')) {
          const name = f.trim().split(/\s+/).slice(1).join(' ')
          if (name && name.endsWith('.md')) {
            try {
              fs.mkdirSync(TEMP_DIR, { recursive: true })
              execSync(`rclone copy "${REMOTE}/Posted/${folder}/${name}" "${TEMP_DIR}/"`, {
                stdio: ['pipe', 'pipe', 'pipe'],
              })
              const local = path.join(TEMP_DIR, name)
              if (fs.existsSync(local)) lines.push('\n```\n' + fs.readFileSync(local, 'utf8').trim() + '\n```')
            } catch {}
          }
        }
      } catch {}
    }
    return lines.join('\n') || '(no content posted in the last 7 days)'
  } catch { return '(rclone unavailable)' }
}

function getHandoff() {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Handoff/BSV-Handoff-v5.md" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, 'BSV-Handoff-v5.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ brand-manager start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `brand-health-${today}.md`

  log('Collecting posted content from last 7 days...')
  const postedContent = getPostedLastNDays(7)
  const handoff       = getHandoff()
  log(`Handoff: ${handoff ? handoff.length + ' chars' : 'not found'}`)

  const systemPrompt = `You are the Brand Manager for Big Sole Vibes (BSV) — a premium men's foot care brand.

Your role is quality control. You review everything that has gone out under the BSV name and hold it to a single standard: does this make a serious man respect the brand, or does it make him scroll past?

## BSV Brand Voices

BSV operates two distinct but equally valid content voices. Both are correct expressions of the brand. Your job is to confirm content is executing each voice cleanly — and that the week alternates between them.

**The Lounge** — Premium/Bourbon register
- Tone: Confident, unhurried, authoritative. The man who has already arrived.
- References: Bourbon, leather, barbershops, tailoring, late-night rituals. Quality as habit, not aspiration.
- Copy style: Dry wit, short declarative sentences, dark humor. Authority without arrogance.
- Visual energy: Dark, rich, still. Midnight and Bourbon palette dominant. Candlelight and shadow.
- Example line: "The Lounge has a standard. Anything less is a compromise."

**The Drop** — Streetwear/Sneaker Culture register
- Tone: Sharp, irreverent, culturally fluent. The man who knows what's next before it drops.
- References: Sneaker culture, limited releases, heat checks, grails, the fit. Foot care as part of the culture, not separate from it.
- Copy style: Clipped, punchy, insider vocabulary. Knows when to be serious and when to flex.
- Visual energy: High contrast, clean lines, product-focused. Sneakers in frame. Steel palette prominent.
- Example line: "You keep the crease. We keep the rest."

## Rules that apply to both voices
- **Visual identity:** Midnight (#0D1B2A), Bourbon (#C17D2E), Steel (#4A6380). No clutter. No stock-photo energy.
- **Hashtags:** Always #BigSoleVibes (plural, never #BigSoleVibe). Max 4 hashtags per post. No hashtag spam.
- **Message clarity:** Every post has one clear point. If you can't state it in one sentence, the post fails.
- **Platform fit:** TikTok = hook-first, punchy. Instagram = brand equity, visual-led. X = one sharp line. Facebook = community warmth within voice.
- **Voice mixing:** The two voices must never bleed into each other mid-post. A Lounge post that suddenly references sneaker drops is broken. A Drop post that starts quoting bourbon is broken.

## Weekly balance check
A healthy week alternates between The Lounge and The Drop. Consecutive days in the same voice are acceptable, but a full week in one register is a flag. The brand needs both audiences.

You output a Brand Health Report. Be direct and specific. Name what works and what doesn't. Never soften a criticism — this is an internal document, not a press release.`

  const userPrompt = `Review all BSV content posted in the last 7 days and produce a Brand Health Report.

## Content posted last 7 days
${postedContent}

${handoff ? `## Brand strategy context\n${handoff}` : ''}

---

Structure your report as follows:

# BSV Brand Health Report — ${today}

## Overall Score
Rate overall brand health this week: **Strong / Acceptable / Needs Work / Off-Brand**. One sentence explaining the rating.

## Voice Balance
Classify each piece of content as **The Lounge**, **The Drop**, or **Unclassifiable**. Count the split. Flag if the week ran entirely in one voice. Flag any posts where the two voices bled into each other mid-execution.

## Voice Execution
For each post: did it execute its intended voice cleanly? Quote specific lines that landed and specific lines that missed. A Lounge post judged on Lounge criteria, a Drop post on Drop criteria.

## Visual Compliance
Were the visual outputs (where identifiable from filenames/context) on-brand? Midnight/Bourbon/Steel palette? Clean composition? Flag anything that looks off.

## Hashtag Audit
Check every post: #BigSoleVibes present? Correct plural form? Count correct (≤4)? List any violations.

## Message Clarity
Did each post have one clear point? Identify any posts that felt muddled or tried to say too much.

## Platform Fit
Was each piece matched to the right platform with appropriate tone adjustment?

## Top 3 This Week
The three strongest pieces and why they worked.

## Fix List
Specific, actionable changes for next week. Not suggestions — directives.`

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  let fullText = ''

  const stream = await client.messages.stream({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    thinking:   { type: 'adaptive' },
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  process.stdout.write('Generating')
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n')

  const final = await stream.finalMessage()
  log(`Done — ${final.usage?.output_tokens ?? '?'} tokens, stop: ${final.stop_reason}`)

  if (!fullText.trim()) { log('ERROR: empty response'); process.exit(1) }

  const localPath = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localPath, fullText)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Reports/${outFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log(`Uploaded → ${REMOTE}/Reports/${outFile}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  log('━━━ brand-manager complete ━━━\n')
})()
