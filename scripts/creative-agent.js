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

const { VOICES, AM_VOICE_POOL, PM_VOICE_POOL } = require('../config/bsv-voices')
const { connect: sheetConnect, readAllRows } = require('./sheets-client')

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

function loadMemory() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Memory.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Memory.md')
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

// ─── Persona context block builder ───────────────────────────────────────────

function buildPersonaBlock(ctx) {
  if (!ctx) return ''
  const label = ctx.persona.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const lines = [
    `## Audience Persona: ${label}`,
    `**Content Lane:** ${ctx.lane}`,
    '',
  ]
  if (ctx.directive) {
    lines.push('### Today\'s Directive (chosen by Big D this morning)')
    lines.push(ctx.directive.replace(/^#[^\n]*\n/, '').trim())
    lines.push('')
  }
  if (ctx.storyAngle && (ctx.storyAngle.hook || ctx.storyAngle.draftOpeningLine)) {
    lines.push('### Story Angle — from today\'s social intelligence report')
    lines.push('This is the specific angle media-director is briefing for this slot. Execute it.')
    if (ctx.storyAngle.hook)             lines.push(`- **Hook:** ${ctx.storyAngle.hook}`)
    if (ctx.storyAngle.whyThisWeek)      lines.push(`- **Why this week:** ${ctx.storyAngle.whyThisWeek}`)
    if (ctx.storyAngle.voiceTag)         lines.push(`- **Voice tag:** ${ctx.storyAngle.voiceTag}`)
    if (ctx.storyAngle.draftOpeningLine) lines.push(`- **Draft opening line:** "${ctx.storyAngle.draftOpeningLine}"`)
    lines.push('')
  }
  if (ctx.verbatimPhrases?.length) {
    lines.push('### Verbatim Language — write with their words, not BSV\'s words imposed on them')
    lines.push('These phrases come directly from the community this week. Use them:')
    ctx.verbatimPhrases.slice(0, 8).forEach(p => lines.push(`- "${p}"`))
    lines.push('')
  }
  if (ctx.hashtags?.length) {
    lines.push(`### Persona Hashtags: ${ctx.hashtags.join(' ')} #BigSoleVibes`)
  }
  return lines.join('\n')
}

// ─── Voice block builder ──────────────────────────────────────────────────────

function buildVoiceBlock(voiceDef) {
  const lines = [
    `## Assigned Voice: ${voiceDef.name}`,
    '',
    `**What this voice is:** ${voiceDef.description}`,
    '',
    '**Tone rules:**',
    ...voiceDef.tone.map(t => `- ${t}`),
    '',
    `**Example caption:** "${voiceDef.example}"`,
    '',
    '**HARD GUARDRAILS — what this voice must never do:**',
    ...voiceDef.negative.map(n => `- ${n}`),
    '',
    `**Best suited for:** ${voiceDef.suitedFor}`,
  ]
  return lines.join('\n')
}

// ─── Four confirmed visual scenes ─────────────────────────────────────────────

const SCENE_BLOCK = `FOUR CANONICAL SCENES — every IMAGE BRIEF must name one:
(1) THE TRANSITION: suit, leather chair, whiskey or rocks glass, city skyline visible, one shoe coming off. End of day. Still composed. The hook is what held up all day except what was inside those shoes.
(2) THE ATHLETE'S TOLL: post-game locker room. Dirty uniforms. Cleats off on the bench. Brotherhood around him — teammates in background. He's looking at his feet or wrapping something. He did all of this on those today.
(3) THE CHEF: still in whites after a long service. Recliner or beat-up couch backstage. Shoes on the floor beside him, feet finally up. The kitchen is done. He's not.
(4) THE INTIMATE MOMENT: couple close on a couch, evening. Shoes coming off. Everything about him is right except one thing. Foot care is the gap between his standard and reality. The moment is honest, not embarrassing.`

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR,   { recursive: true })
  fs.mkdirSync(BRIEFS_DIR, { recursive: true })

  // Parse args
  const slotArg        = process.argv.indexOf('--slot')
  const themeArg       = process.argv.indexOf('--theme')
  const voiceArg       = process.argv.indexOf('--voice')
  const voiceDefArg    = process.argv.indexOf('--voice-def')
  const personaCtxArg  = process.argv.indexOf('--persona-context')

  const slot      = slotArg  !== -1 ? process.argv[slotArg  + 1] : null
  const theme     = themeArg !== -1 ? process.argv[themeArg + 1] : null
  const voiceName = voiceArg !== -1 ? process.argv[voiceArg + 1] : null

  const personaContext = personaCtxArg !== -1
    ? (() => { try { return JSON.parse(process.argv[personaCtxArg + 1]) } catch { return null } })()
    : null

  if (!slot || !theme) {
    log('ERROR: --slot and --theme are required')
    log('Usage: creative-agent.js --slot mon-am --theme "The Standard" --voice PROPRIETOR')
    process.exit(1)
  }

  // Resolve voice definition — prefer inline JSON from media-director, fallback to config lookup
  let voiceDef = null
  if (voiceDefArg !== -1) {
    try { voiceDef = JSON.parse(process.argv[voiceDefArg + 1]) } catch {}
  }
  if (!voiceDef && voiceName && VOICES[voiceName]) {
    voiceDef = VOICES[voiceName]
  }
  // Final fallback: period-based default
  if (!voiceDef) {
    const period = slot.endsWith('-am') ? 'am' : 'pm'
    const defaultName = period === 'am' ? AM_VOICE_POOL[0] : PM_VOICE_POOL[0]
    voiceDef = VOICES[defaultName]
    log(`WARNING: no valid --voice supplied, defaulting to ${defaultName}`)
  }

  const personaLabel = personaContext?.persona ?? 'unassigned'
  log(`━━━ creative-agent: ${slot} / ${theme} / ${voiceDef.name} / persona=${personaLabel} ━━━`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory = loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  log('Loading social intelligence report...')
  const socialReport = loadLatestSocialReport()
  log(`Social report: ${socialReport ? socialReport.filename : 'none'}`)

  log('Loading strategy brief...')
  const contentDirection = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'strategy-active.md')
      if (!fs.existsSync(p)) return null
      const md = fs.readFileSync(p, 'utf8')
      const m  = md.match(/##\s+Content Direction[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)
      return m ? m[1].trim() : null
    } catch { return null }
  })()
  log(`Content direction: ${contentDirection ? contentDirection.length + ' chars' : 'none'}`)

  // Check sheet for an approved Narrative matching this theme — use as brief source if found
  let approvedNarrative = null
  try {
    const conn      = await sheetConnect()
    const sheetRows = await readAllRows(conn)
    const themeLower = theme.toLowerCase()
    const match = sheetRows.find(row => {
      if (row['Status'] !== 'Approved') return false
      const narrative = (row['Narrative'] || '').trim()
      if (!narrative || narrative.startsWith('[DRAFT]')) return false
      const nameLower = (row['Product Name'] || '').toLowerCase()
      return nameLower && (themeLower.includes(nameLower) || nameLower.includes(themeLower))
    })
    if (match) {
      approvedNarrative = { name: match['Product Name'], text: match['Narrative'].trim() }
      log(`Narrative source: matched "${match['Product Name']}" — using approved shelf narrative`)
    } else {
      log('Narrative source: no matching approved narrative for this theme')
    }
  } catch (err) {
    log(`Narrative source: sheet unavailable (${err.message}) — generating from scratch`)
  }

  const period    = slot.endsWith('-am') ? 'am' : 'pm'
  const postTime  = period === 'am' ? '09:00 CDT' : '19:00 CDT'
  const dayEnergy = period === 'am'
    ? 'Morning. The man before the world starts.'
    : 'Evening. The man who made it through.'

  const socialFormat = personaContext?.socialFormat ?? 'Tall Tale'
  log(`Social format: ${socialFormat}`)

  const voiceBlock   = buildVoiceBlock(voiceDef)
  const personaBlock = buildPersonaBlock(personaContext)

  // Caption hashtag guidance — use persona-matched tags when available
  const personaHashtags = personaContext?.hashtags?.length
    ? personaContext.hashtags.slice(0, 3).join(' ') + ' #BigSoleVibes'
    : '#BigSoleVibes'
  const igGuidance   = `${voiceDef.name} VOICE: Apply the tone rules and example above. Hard guardrails apply. 3–5 sentences. Hashtags: ${personaHashtags}`
  const bskyGuidance = `${voiceDef.name} VOICE: 2–3 lines max. No hashtags. Apply the tone rules strictly.`

  const systemPrompt = `## ASSIGNED VOICE FOR THIS POST: ${voiceDef.name}
THIS OVERRIDES EVERYTHING BELOW. If any prior document describes a different default voice, ignore it for this post.

${voiceBlock}

---

${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the BSV Creative Agent. One job: write the brief. Everything you produce must align with the Proprietor's Directive above.

## Standing Rules (apply to every brief regardless of voice)

- Feet appear as evidence of the standard — never the subject
- No empty rooms. No objects without a person. No stock photo compositions. No generic lifestyle.
- Every image has a person, a story, a specific moment
- Four hashtag cap — #BigSoleVibes counts as one
- Banned phrases (never use): "Start from the ground up" / "stopped settling for average" / "you put in the work" / "the grind is real"

${SCENE_BLOCK}

## Assigned Social Format: ${socialFormat}
This format is assigned by media-director based on the audience persona for this slot. The three formats are defined in BSV-Memory.md above — follow the one assigned here exactly.
- **Tall Tale** — narrative arc, specific scene, a man in a moment. The detail does the work. Reads like a short story in two sentences.
- **Simple Modern Man** — minimal language, declarative, no ornamentation. Every word earns its place. Reads like a product label written by someone who reads Hemingway.
- **The Scene** — visual and kinetic. Set the stage, describe the moment, name the feeling. Reads like the opening of a film.
Apply ${socialFormat} to the INSTAGRAM and BLUESKY captions. The format governs rhythm and structure, not content — voice guardrails still apply.

## Brief Format

Output EXACTLY this structure. No deviations, no additions, no commentary before or after.

SLOT: [slot]
THEME: [theme]
VOICE: ${voiceDef.name}
VOICE_USED: ${voiceDef.name}
POST_TIME: [post time]
VOICE_GUIDANCE: ${voiceDef.name} — ${voiceDef.description} Hard guardrails active.
---
IMAGE BRIEF: [Gemini Imagen 4. Square 1:1. No text, no logos. No product placement. MANDATORY: name the scene (THE TRANSITION / THE ATHLETE'S TOLL / THE CHEF / THE INTIMATE MOMENT), name the setting, time of day, what the man is doing, what he's feeling. Film still specificity — a DP could light it from this description alone. REJECTED without appeal if: no human subject, empty room, floating objects, stock photo energy.]
VIDEO BRIEF: [Veo 3.1 motion prompt. 7–8 seconds, 9:16 vertical. Describe what moves and how. Same mood as image. End with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."]
ON-IMAGE COPY:
  Line 1 (Cream, Playfair Display): [short declarative statement — 4–8 words, no punctuation]
  Line 2 (Bourbon, Bebas Neue italic): [secondary line — 3–6 words, no punctuation]
INSTAGRAM: [${igGuidance}]
BLUESKY: [${bskyGuidance}]
YOUTUBE: [Community post. 3–4 sentences. Slightly warmer, direct address. Ends with a reason to follow — not a generic CTA.]
TIKTOK: [Hook line for typewriter effect on screen. Then 1–2 line caption. Max 2 hashtags. Hook creates a 3-second stop — names something specific, not a question.]
---`

  const narrativeBlock = approvedNarrative
    ? `## Approved Shelf Narrative — use as brief source
Product: ${approvedNarrative.name}
This narrative is live on the BSV shelf. Pull the scene from it. Adapt to platform format. Maintain voice — do not paraphrase into lifestyle copy.

"${approvedNarrative.text}"
`
    : ''

  // Social report fallback — only used when no persona context was passed
  const socialFallback = !personaContext && socialReport
    ? `## Intelligence (${socialReport.filename})\nUse if it sharpens the angle. Do not force it.\n\n${socialReport.content.slice(0, 1500)}${socialReport.content.length > 1500 ? '\n[truncated]' : ''}`
    : ''

  const userPrompt = `Write the BSV content brief.

SLOT: ${slot}
THEME: ${theme}
VOICE: ${voiceDef.name}
POST TIME: ${postTime}
DAY ENERGY: ${dayEnergy}

${personaBlock ? `${personaBlock}\n\n` : ''}${narrativeBlock}${contentDirection ? `## This Week's Content Direction\nFrom the Sunday Strategy Brief — the three angles for this week. Match your brief to one of them:\n\n${contentDirection}\n\n` : ''}${socialFallback}

Write the brief. Apply the ${voiceDef.name} voice hard — the guardrails above are not suggestions. The image brief should make a creative director say yes. The captions should make a man stop scrolling and send it to someone who gets it.`

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
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

  if (!brief.includes('VOICE_USED:')) {
    log('WARNING: VOICE_USED field missing from brief output')
  }

  const briefPath = path.join(BRIEFS_DIR, `${slot}-brief.txt`)
  fs.writeFileSync(briefPath, brief)
  log(`Saved → ${briefPath}`)

  log(`━━━ creative-agent complete: ${slot} / ${voiceDef.name} ━━━\n`)
})()
