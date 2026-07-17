require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT             = path.join(__dirname, '..')
const BRIEFS_DIR       = path.join(ROOT, 'posts', 'briefs')
const LOG_FILE         = path.join(ROOT, 'logs', 'creative-agent.log')
const TEMP_DIR         = path.join(os.homedir(), 'tmp', 'bsv-creative-agent')
const REMOTE           = 'big sole vibes:Big Sole Vibes'
const DIRECTIVES_FILE  = path.join(ROOT, 'logs', 'creative-directives.json')

const { VOICES, AM_VOICE_POOL, PM_VOICE_POOL } = require('../config/bsv-voices')
const { connect: sheetConnect, readAllRows } = require('./sheets-client')
// 2026-07-17: this file wrote its own inline copy of the person-optional /
// no-default-setting doctrine instead of importing it, the same drift
// pattern already caught and fixed in gemini-bridge.js and video-gen.js
// (see lib/visual-doctrine.js's own header). creative-agent.js is the file
// that actually authors each post's IMAGE BRIEF, so its copy was also the
// one missing the "don't default to leather chair / dark wood study" line
// entirely — a stale pre-fix blog draft ("The Seven Steps Stop at the
// Ankle," generated 2026-07-13) showed exactly that failure mode. Wired in
// here so any future doctrine change reaches this file automatically.
const { PERSON_OPTIONAL, NO_DEFAULT_SETTING } = require('./lib/visual-doctrine')

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


// ── Prompt cache helper ───────────────────────────────────────────────────────
function buildCachedSystem(directive, memory, roleInstructions) {
  const staticText = [directive || '', memory || ''].filter(Boolean).join('\n\n---\n\n')
  if (!staticText) return roleInstructions
  return [
    { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: roleInstructions },
  ]
}

async function loadMemory() {
  const { loadMemoryById } = require('./lib/memory')
  return loadMemoryById()
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
  if (ctx.loungeOverride) {
    const lo = ctx.loungeOverride
    lines.push('')
    lines.push('### Lounge Campfire Retelling')
    lines.push(`This brief is a *campfire retelling* from The Lounge, Chapter ${lo.chapter} (${lo.ref}).`)
    lines.push(`Social format: **${lo.format}** — apply exactly as defined in BSV-Memory.md.`)
    lines.push(`Angle: ${lo.angle}`)
    lines.push('The post retells this specific moment in the assigned format. Short, specific, striking. This is not about foot care — it is about the man who looked at his cabinet and decided to do something about it. The product is the resolution, not the subject.')
  }
  return lines.join('\n')
}

// ─── Chapter mandate block ────────────────────────────────────────────────────

function buildChapterBlock(cs, isWedPm) {
  if (!cs) return ''
  const lines = [
    `## Chapter Mandate — Active Arc: Chapter ${cs.active} — ${cs.name}`,
    '',
    `CHAPTER CONTEXT: Chapter ${cs.active} — ${cs.name}. ${cs.productTease}`,
    `BRIEF MANDATE: Every post this cycle is a breadcrumb, not a standalone. The scene teases the chapter. The chapter lives at ${cs.loungeUrl}. When a Featured Product is assigned (see below), name it — tell its story, the moment it earns its place, and end with a direct CTA to the shelf URL. When no product is assigned, drive to the bio link. Product posts are the primary revenue path — they take priority over abstract chapter teasing.`,
  ]
  if (isWedPm) {
    lines.push(`WEDNESDAY PM: Campfire retelling — ${cs.campfireFormat}. Distill the active chapter beat into the ${cs.campfireFormat} format as defined in BSV-Memory.md. If a Featured Product is assigned, the retelling ends at that product on the shelf.`)
  }
  lines.push('')
  lines.push(`QUALITY GATE: Every caption must be a scene that could only exist inside Chapter ${cs.active}'s world. If the caption could run without this chapter existing, it has failed — reject it and rewrite.`)
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

// ─── Product block builder ────────────────────────────────────────────────────

function buildProductBlock(product) {
  if (!product) return ''
  const shelfUrl = 'https://bigsolevibes.com/shop/'
  const lines = [
    '## Featured Product — Wire Into This Brief',
    '',
    `**Product Name:** ${product['Product Name']}`,
  ]
  if (product['Price'])    lines.push(`**Price:** ${product['Price']}`)
  if (product['Category']) lines.push(`**Category:** ${product['Category']}`)
  if (product['Narrative']) {
    lines.push('')
    lines.push('**Narrative (Proprietor voice — pull the scene from this):**')
    lines.push(product['Narrative'])
  }
  lines.push('')
  lines.push(`**Affiliate Link:** ${product['Affiliate Link']}`)
  lines.push(`**Shelf URL:** ${shelfUrl}`)
  lines.push('')
  lines.push('IMAGE: This product must be physically visible and identifiable in the frame — not implied, not abstracted into "a product on the counter." Describe its actual container/shape/color (infer from the Narrative or Category above if not stated) and give it a specific place in the scene: in his hand, open beside the sink, on the counter where the light catches it. This is the visual focus of the shot — composed so the eye lands on it first, even within the full head-to-toe frame of the man.')
  lines.push('CAPTION: Tell this product\'s story. The man who needs it, the moment it earns its place. End with a BSV-voice CTA linking to the shelf URL above — not "link in bio".')
  return lines.join('\n')
}

// ─── Edition vignette block ───────────────────────────────────────────────────

function buildEditionVignetteBlock(ev) {
  if (!ev) return ''
  return [
    '## This Month\'s Edition — Pre-Written Scene',
    '',
    'The story engine wrote this scene specifically for this product this month.',
    'Use it. Do not discard it. Do not paraphrase it into lifestyle copy.',
    '',
    '**Social Hook — open the Instagram caption with this exact line (or a variation of it in the same rhythm):**',
    `"${ev.socialHook}"`,
    '',
    '**Scene Vignette — the 3-sentence setup. Expand from this in the caption body:**',
    ev.vignette,
    '',
    '**Image Brief — USE THIS INSTEAD of the four canonical scenes. This is the Gemini Imagen 4 prompt:**',
    ev.imageBrief,
    '',
    `The caption structure: Social Hook → 2–3 sentence vignette expansion → CTA to ${ev.loungeUrl ? `the full edition story at ${ev.loungeUrl}` : `the affiliate link at ${ev.affiliateLink}`} → hashtags.`,
    'The image: execute the brief above exactly as written.',
  ].join('\n')
}

// ─── Creative directives (feedback loop) ─────────────────────────────────────
// Loaded from logs/creative-directives.json — written by brand-manager (weekly Fix List)
// and learn.js (immediate Big D corrections). Applied to every brief so course
// corrections propagate on the next run, not after a Sunday strategist cycle.

function loadCreativeDirectives() {
  try {
    if (!fs.existsSync(DIRECTIVES_FILE)) return null
    return JSON.parse(fs.readFileSync(DIRECTIVES_FILE, 'utf8'))
  } catch { return null }
}

function buildDirectivesBlock(directives) {
  if (!directives) return ''
  const lines = ['## Active Corrections — Apply to This Brief']
  lines.push('These come from quality review, direct feedback, and content Big D has already rejected. They override your defaults.')
  lines.push('')

  const bm = directives.brand_manager
  if (bm?.directives?.length) {
    lines.push(`### From Brand Review (${bm.reportDate}, score: ${bm.score})`)
    bm.directives.forEach(d => lines.push(`- ${d}`))
    lines.push('')
  }

  const bd = directives.big_d
  if (bd?.corrections?.length) {
    lines.push('### From Big D (direct — non-negotiable)')
    bd.corrections.forEach(c => lines.push(`- [${c.date}] ${c.note}`))
    lines.push('')
  }

  // Recent denials — what Big D actually rejected from the dashboard
  const denials = directives.denials
  if (denials?.length) {
    const recent = denials.slice(0, 8) // last 8 denials
    lines.push('### Recently Denied Content — Do Not Repeat These Patterns')
    lines.push('Big D rejected these directly. Study the patterns — avoid them.')
    recent.forEach(d => {
      const reasonStr = d.reason ? ` (reason: ${d.reason})` : ''
      lines.push(`- [${d.date}] slot ${d.slot}${reasonStr}`)
      if (d.instagram) lines.push(`  Caption was: "${d.instagram.slice(0, 120)}..."`)
      if (d.imageBrief) lines.push(`  Image was: "${d.imageBrief.slice(0, 120)}..."`)
    })
    lines.push('')
  }

  if (lines.length <= 3) return '' // nothing substantive
  lines.push('ENFORCE THESE. They exist because something slipped. Do not repeat it.')
  return lines.join('\n')
}

// Removed 2026-07-16: this file used to also define a CANONICAL_SCENES_REFERENCE
// constant (the same four-archetype leather-chair/locker-room/chef/couple list
// that was still live and forcing every blog post into one of four generic
// scenes over in blog-agent.js — fixed there same day, see BSV-BigC-Audit-Log.md).
// Here it was already dead code — declared but never referenced anywhere in
// this file, so it wasn't actually influencing generation — just a leftover
// landmine of exactly the pattern Big D keeps having to flag. Deleted rather
// than left as an unused "reference." buildSceneBlock() below is the real,
// active, product-first scene logic.

// Added 2026-07-10 per Big D — the tone the image and caption both need to
// land: absurdist, deadpan-committed, sarcastic but never mean, funny enough
// that the reader laughs, and underneath the joke a straight-faced case that
// this is a need, not a want. Same register as the PROPRIETOR voice's "Monty
// Python straight-faced officer" energy, applied consistently rather than
// left to whichever voice happens to be assigned.
const COMEDIC_REGISTER = `TONE: Absurdist and deadpan — commit to the bit completely, never wink at the camera or explain the joke. Sarcastic, not mean; the target of the joke is the absurdity of resisting the standard, never the man himself. The logic should feel like: "why WOULDN'T a serious man have this" — treat the product as an obvious, faintly ridiculous inevitability, delivered completely straight-faced. The reader should laugh, and underneath the laugh, feel the actual argument that this is a need, not a want. Not brooding, not earnest, not a lifestyle ad.`;

function buildSceneBlock(product) {
  if (product) {
    return `SCENE CONSTRUCTION — BUILD AROUND THE ASSIGNED PRODUCT.

The setting must come from the product's own story — its category, its Narrative above, the specific moment it belongs to. A body wash belongs in a bathroom at a particular hour. A cologne belongs at the mirror before he walks out. A recovery tool belongs wherever recovery actually happens. Do not reach for a default setting — build the one this product earns. ${NO_DEFAULT_SETTING}

VISUAL FOCUS: The product and its story are the anchor — the image exists to make someone stop and want to know what this is. ${PERSON_OPTIONAL}

${COMEDIC_REGISTER}`
  }

  return `SCENE CONSTRUCTION — PRODUCT-FREE POST.

Build a scene that makes the man stop scrolling — not because it shows him anything explicit, but because it poses a question. The image opens a door; the caption is the handle.

A person may or may not appear, and if one does, however much of them the scene calls for — full figure, partial, a hand, a foot. That's a creative choice serving the story, not a checklist item.

${COMEDIC_REGISTER}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR,   { recursive: true })
  fs.mkdirSync(BRIEFS_DIR, { recursive: true })

  // Parse args
  const slotArg             = process.argv.indexOf('--slot')
  const themeArg            = process.argv.indexOf('--theme')
  const voiceArg            = process.argv.indexOf('--voice')
  const voiceDefArg         = process.argv.indexOf('--voice-def')
  const personaCtxArg       = process.argv.indexOf('--persona-context')
  const productArg          = process.argv.indexOf('--product')
  const editionVignetteArg  = process.argv.indexOf('--edition-vignette')

  const slot      = slotArg  !== -1 ? process.argv[slotArg  + 1] : null
  const theme     = themeArg !== -1 ? process.argv[themeArg + 1] : null
  const voiceName = voiceArg !== -1 ? process.argv[voiceArg + 1] : null

  const personaContext = personaCtxArg !== -1
    ? (() => { try { return JSON.parse(process.argv[personaCtxArg + 1]) } catch { return null } })()
    : null

  const product = productArg !== -1
    ? (() => { try { return JSON.parse(process.argv[productArg + 1]) } catch { return null } })()
    : null

  // Edition vignette — pre-written scene from this month's edition-agent run.
  // When present: social hook opens the caption, vignette is the scene, imageBrief replaces SCENE_BLOCK.
  const editionVignette = editionVignetteArg !== -1
    ? (() => { try { return JSON.parse(process.argv[editionVignetteArg + 1]) } catch { return null } })()
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
  const memory = await loadMemory()
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

  const socialFormat  = personaContext?.socialFormat ?? 'Tall Tale'
  log(`Social format: ${socialFormat}`)

  const isWedPm      = slot === 'wed-pm'
  const chapterBlock = buildChapterBlock(personaContext?.chapterState ?? null, isWedPm)
  if (personaContext?.chapterState) {
    log(`Chapter mandate: Chapter ${personaContext.chapterState.active} — ${personaContext.chapterState.name}`)
  }

  const voiceBlock   = buildVoiceBlock(voiceDef)
  const personaBlock = buildPersonaBlock(personaContext)
  const productBlock = buildProductBlock(product)
  if (product) log(`Product context: "${product['Product Name']}"`)
  const editionVignetteBlock = buildEditionVignetteBlock(editionVignette)
  if (editionVignette) log(`Edition vignette: "${editionVignette.productName}" — social hook loaded`)

  const creativeDirectives = loadCreativeDirectives()
  const directivesBlock    = buildDirectivesBlock(creativeDirectives)
  if (creativeDirectives?.brand_manager?.directives?.length || creativeDirectives?.big_d?.corrections?.length) {
    const bmCount = creativeDirectives.brand_manager?.directives?.length ?? 0
    const bdCount = creativeDirectives.big_d?.corrections?.length ?? 0
    log(`Active corrections: ${bmCount} from brand-manager, ${bdCount} from Big D`)
  }

  // Caption hashtag guidance — use persona-matched tags when available
  const personaHashtags = personaContext?.hashtags?.length
    ? personaContext.hashtags.slice(0, 3).join(' ') + ' #BigSoleVibes'
    : '#BigSoleVibes'
  // CTA hierarchy: Lounge edition page > affiliate link > shelf
  const ctaUrl = editionVignette?.loungeUrl || editionVignette?.affiliateLink || 'https://bigsolevibes.com/shop/'
  const ctaLabel = editionVignette?.loungeUrl ? 'the full edition story' : 'the shelf'
  const igGuidance = editionVignette
    ? `${voiceDef.name} VOICE: Apply the tone rules and example above. Hard guardrails apply. Open with the Social Hook from the edition scene block (exact line or same rhythm). 2–4 more sentences expanding the vignette. End with a BSV-voice CTA driving to ${ctaLabel}: ${ctaUrl}. Hashtags: ${personaHashtags}`
    : product
      ? `${voiceDef.name} VOICE: Apply the tone rules and example above. Hard guardrails apply. 3–5 sentences. Tell the product's story — the man who needs it, the moment it earns its place. End with a BSV-voice CTA linking to https://bigsolevibes.com/shop/ — not "link in bio". Hashtags: ${personaHashtags}`
      : `${voiceDef.name} VOICE: Apply the tone rules and example above. Hard guardrails apply. 3–5 sentences. Hashtags: ${personaHashtags}`
  const bskyGuidance = `${voiceDef.name} VOICE: 2–3 lines max. No hashtags. Apply the tone rules strictly.`

  // Visual approach — REARCHITECTED 2026-07-10 per Big D: assigning one of N
  // enumerated styles before the model ever saw the product or story was
  // still a forced rotation, no matter how many buckets it had ("I was hoping
  // creative was really creative"). media-director.js no longer assigns
  // anything here. The technique range below (the same vocabulary proven on
  // bigsolevibes.com's OpeningCrawl, public/crawl/*.jpg) is handed to the
  // model as a reference palette, not a menu to be mechanically rotated
  // through — it picks, blends, or invents beyond it, based on what this
  // specific product's story actually needs to say without words.
  //
  // FURTHER CORRECTED same day, same conversation: Big D also didn't want a
  // human figure mandated in every frame ("i dont think we need full body or
  // face in each pic... its a possibility... its about the product and the
  // story and the picture that tells the compelling story"). Dropped that
  // requirement entirely — a person, and how much of one, is now a creative
  // choice like everything else. What's non-negotiable: the product (when
  // one's assigned) and STORY_COHESION (the image depicts the exact beat the
  // caption tells, not a separately invented scene). COMEDIC_REGISTER
  // (defined above) carries the absurdist-deadpan-sarcastic-not-mean tone
  // into the image too.
  const PRIORITY_ORDER = `THE ANCHOR: the product and the story it's telling — that's what has to land, and what makes someone want to go see it for themselves.${product ? ` ${product['Product Name']} should be physically visible and identifiable somewhere in the frame — the eye should find it.` : ''} Whether a person appears at all, how much of them, whether a face is shown — all of that is a creative choice serving the story, not a fixed requirement in either direction.`

  const STORY_COHESION = `STORY COHESION: This image must depict the exact same specific comedic beat/moment that the INSTAGRAM caption below tells — not a separately invented scene. Decide the one moment first, then write both around it. If someone could read the caption and look at this image and not immediately recognize them as the same joke, this fails.`

  const VISUAL_TECHNIQUE_RANGE = `VISUAL TECHNIQUE — this is a creative decision, not an assignment. Choose whichever rendering technique actually serves this specific product's story — the thing that tells it without words. Reference range, all proven live on bigsolevibes.com's OpeningCrawl (public/crawl/*.jpg) — you are not limited to these four, blend between them or go elsewhere entirely if the story calls for it:
- Flat 2D cutout collage (Monty Python Flying Circus / Terry Gilliam — public/crawl/cave.jpg, roman.jpg): stiff paper-cutout shapes, flat color blocks, torn-paper edges, no shading. Suits a beat that's flatly absurd and wants total commitment to the bit.
- Hand-tinted engraving (public/crawl/victorian.jpg): cross-hatched linework in sepia and muted tones, painterly, like a colorized 19th-century print, photographic depth just beginning to emerge. Suits a beat about heritage, ritual, or gravity.
- Hand-tinted photograph (public/crawl/midcentury.jpg): Kodachrome warmth, fine film grain, gentle vignette — mostly photographic with a faint vintage-illustration quality at the edges. Suits a beat that's warm, nostalgic, lived-in.
- Full photorealistic cinematic, 35mm film still (public/crawl/modern.jpg, beach.jpg): cinematic grain, shallow depth of field, lived-in not staged. Suits a beat that's specific and modern, happening right now.
Whichever technique you land on, anchor it in the warm amber (#C17D2E) and deep navy (#0D1B2A) palette.`

  const imageBriefInstruction = editionVignette
    ? `Use the Image Brief from the Edition Scene block above. Format it as a Gemini Imagen 4 prompt. Square 1:1. No text, no logos. ${PRIORITY_ORDER} ${STORY_COHESION} Single frame only. Adapt wording for Imagen prompt style but keep the scene, mood, and composition intact.`
    : `Gemini Imagen 4. Square 1:1. No text, no logos. SINGLE FRAME ONLY — one scene, no panels, no collage layout of multiple moments. ${VISUAL_TECHNIQUE_RANGE} ${PRIORITY_ORDER} ${STORY_COHESION} Write the scene depicting the one specific absurd beat — describe the exact setting, the light, and whatever is actually in it (a person and how much of them, an object, a detail — whichever tells this story)${product ? `, including exactly where and how ${product['Product Name']} appears (its actual container, shape, color) as the visual focus` : ''}. Specific enough that whoever renders it could light it from this description alone. ${COMEDIC_REGISTER} REJECTED without appeal if: multiple frames or panels, any text or logo, the scene doesn't match the caption's specific beat${product ? `, or the product missing/not identifiable in the chosen style` : ''}.`

  const roleInstructions = `${directivesBlock ? `${directivesBlock}\n\n---\n\n` : ''}## THE PROPRIETOR'S TEST — apply before writing a single word

BSV stocks what has earned its place — not what already has a famous name. The Proprietor finds it before anyone is talking about it, and brings it to the man who should know.

Before you write this brief, ask: **Is this something BSV's man doesn't know about yet?** If the product is already famous, the angle must be the discovery — not the product. If the content could run on any men's grooming account, it fails. "The usual" is disqualified before it starts.

A brief that passes: specific product, specific man, specific moment. Something the reader didn't know he was missing until he read it.
A brief that fails: generic lifestyle imagery, a posed product-ad shot with no story, "take care of yourself" messaging that earns no one's attention.

---

## ASSIGNED VOICE FOR THIS POST: ${voiceDef.name}
THIS OVERRIDES EVERYTHING BELOW. If any prior document describes a different default voice, ignore it for this post.

${voiceBlock}
${productBlock ? `\n---\n\n${productBlock}` : ''}

---

${chapterBlock ? `${chapterBlock}\n\n---\n\n` : ''}You are the BSV Creative Agent.\`
One job: write the brief. Everything you produce must align with the Proprietor's Directive above.

## Standing Rules (apply to every brief regardless of voice)

- ${PERSON_OPTIONAL}
- ${NO_DEFAULT_SETTING}
- No stock photo compositions. No generic lifestyle. No empty, meaningless scenes.
- Every image has a story and a specific moment — that's the requirement.
- Four hashtag cap — #BigSoleVibes counts as one
- Banned phrases (never use): "Start from the ground up" / "stopped settling for average" / "you put in the work" / "the grind is real"

${buildSceneBlock(product)}

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
IMAGE BRIEF: [${imageBriefInstruction}]
VIDEO BRIEF: [Veo 3.1 motion prompt. 7–8 seconds, 9:16 vertical. Describe what moves and how. Same mood and same scene as the image brief.${product ? ` The assigned product (${product['Product Name']}) must stay visible and identifiable across the motion — not just present in a static first frame. Describe how it's seen: held, set down, light catching it, etc. REJECTED without appeal if the product is absent or unrecognizable in the described motion.` : ''} End with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."]
ON-IMAGE COPY:
  Line 1 (Cream, Playfair Display): [short declarative statement — 4–8 words, no punctuation]
  Line 2 (Bourbon, Bebas Neue italic): [secondary line — 3–6 words, no punctuation]
INSTAGRAM: [${igGuidance}]
BLUESKY: [${bskyGuidance}]
YOUTUBE: [Community post. 3–4 sentences. Slightly warmer, direct address. Ends with a reason to follow — not a generic CTA.]
TIKTOK: [Hook line for typewriter effect on screen. Then 1–2 line caption. Max 2 hashtags. Hook creates a 3-second stop — names something specific, not a question.]
---`

  const systemPrompt = buildCachedSystem(directive, memory, roleInstructions)

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

${personaBlock ? `${personaBlock}\n\n` : ''}${editionVignetteBlock ? `${editionVignetteBlock}\n\n` : ''}${narrativeBlock}${contentDirection ? `## This Week's Content Direction\nFrom the Sunday Strategy Brief — the three angles for this week. Match your brief to one of them:\n\n${contentDirection}\n\n` : ''}${socialFallback}

Write the brief. Apply the ${voiceDef.name} voice hard — the guardrails above are not suggestions. The image brief should make a creative director say yes. The captions should make a man stop scrolling and send it to someone who gets it.`

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6', // reverted early — claude-fable-5 trial was crashing Saturday slot generation
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

  // ── Pre-post quality gate ──────────────────────────────────────────────────
  // Fast Haiku check: does this brief violate any active creative directive?
  // Never blocks — flags to Telegram so Big D can deny before it posts.
  ;(async () => {
    try {
      const { sendTelegram } = require('./telegram')
      const activeDirectives = loadCreativeDirectives()
      const bmDirectives = activeDirectives?.brand_manager?.directives ?? []
      const bdCorrections = activeDirectives?.big_d?.corrections ?? []
      const allRules = [...bmDirectives, ...bdCorrections]
      if (!allRules.length) return  // nothing to check against

      const qaClient = new Anthropic({ apiKey })
      const qaMsg = await qaClient.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages:   [{
          role: 'user',
          content: `You are a strict QA reviewer for Big Sole Vibes (BSV) social content.

Active directives (things that must NOT appear):
${allRules.slice(0, 10).map((r, i) => `${i + 1}. ${r}`).join('\n')}

Content brief to check:
${brief.slice(0, 1200)}

Does this brief violate any of the directives above? Reply with:
- PASS — if no violations
- CONCERN: [specific directive violated] — [which part of the brief triggers it]

One line only. No explanation unless it's a CONCERN.`,
        }],
      })

      const qaResult = (qaMsg.content[0]?.text ?? '').trim()
      log(`Brief QA: ${qaResult}`)

      if (qaResult.startsWith('CONCERN')) {
        const tgMsg = `⚠️ BSV — Brief QA flag\n*Slot:* ${slot}\n*Voice:* ${voiceDef.name}\n${qaResult}\n\nPost proceeds on schedule unless you deny it in the dashboard.`
        await sendTelegram(tgMsg)
        log(`Brief QA concern sent to Telegram`)
      }
    } catch (err) {
      log(`WARNING: brief QA check failed — ${err.message}`)
    }
  })()

  // Save to Drive for editorial record
  const dateStamp   = new Date().toISOString().slice(0, 10)
  const draftName   = `social-draft-${dateStamp}-${slot}.md`
  const draftLocal  = path.join(TEMP_DIR, draftName)
  fs.writeFileSync(draftLocal, brief)
  // Retry + longer timeout added 2026-07-16 — this was a single attempt at
  // 30s, which produced 9 "spawnSync /bin/sh ETIMEDOUT" warnings over the
  // last ~5 weeks (roughly weekly). This save is non-critical (an editorial
  // record copy, not the post itself), so a slow rclone/Drive-API moment
  // shouldn't need a person's attention — one retry after a short pause and
  // a longer ceiling covers the transient case without masking a real outage
  // (it'll still warn if both attempts fail).
  let driveSaveOk = false
  for (let attempt = 1; attempt <= 2 && !driveSaveOk; attempt++) {
    try {
      execSync(`rclone copyto "${draftLocal}" "${REMOTE}/Lounge/Social Drafts/${draftName}"`, {
        stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
      })
      log(`Drive: saved social draft → Lounge/Social Drafts/${draftName}`)
      driveSaveOk = true
    } catch (err) {
      if (attempt === 1) {
        await new Promise(r => setTimeout(r, 3000))
      } else {
        log(`WARNING: Drive save failed — ${err.message}`)
      }
    }
  }

  log(`━━━ creative-agent complete: ${slot} / ${voiceDef.name} ━━━\n`)
})()
