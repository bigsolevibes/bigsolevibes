require('dotenv').config()
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT       = path.join(__dirname, '..')
const BRIEFS_DIR = path.join(ROOT, 'posts', 'briefs')
const LOG_FILE   = path.join(ROOT, 'logs', 'gemini-bridge.log')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-gemini-bridge')
const REMOTE     = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function uploadFile(localPath, remotePath) {
  execSync(`rclone copyto "${localPath}" "${remotePath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

// ─── Brief parser ─────────────────────────────────────────────────────────────
// Parses the structured brief written by creative-agent.js:
//
//   SLOT: mon-am
//   THEME: The Standard
//   POST_TIME: 09:00 CDT
//   ---
//   IMAGE BRIEF: [...]
//   VIDEO BRIEF: [...]
//   ON-IMAGE COPY:
//     Line 1 ...: [...]
//     Line 2 ...: [...]
//   INSTAGRAM: [...]
//   BLUESKY: [...]
//   YOUTUBE: [...]
//   TIKTOK: [...]
//   ---

function parseBrief(text) {
  const fields = {}

  // Split on first --- to separate header from body
  const dashIdx = text.indexOf('\n---\n')
  const header  = dashIdx >= 0 ? text.slice(0, dashIdx) : ''
  const body    = dashIdx >= 0 ? text.slice(dashIdx + 5) : text

  // Header: SLOT, THEME, POST_TIME
  for (const line of header.split('\n')) {
    const m = line.match(/^(SLOT|THEME|POST_TIME):\s*(.+)$/)
    if (m) fields[m[1].toLowerCase().replace('_', '')] = m[2].trim()
  }

  // Normalize post time to HH:MM
  if (fields.posttime) {
    const tm = fields.posttime.match(/(\d{1,2}:\d{2})/)
    fields.posttime = tm ? tm[1] : fields.posttime
  }

  // Body: split on block keys at line start
  const BODY_KEY_RE = /^(?=IMAGE BRIEF:|VIDEO BRIEF:|ON-IMAGE COPY:|INSTAGRAM:|BLUESKY:|YOUTUBE:|TIKTOK:)/m
  const chunks = body.split(BODY_KEY_RE)

  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const m = chunk.match(/^(IMAGE BRIEF|VIDEO BRIEF|ON-IMAGE COPY|INSTAGRAM|BLUESKY|YOUTUBE|TIKTOK):\s*([\s\S]*)/)
    if (!m) continue
    const key = m[1].toLowerCase().replace(/[\s-]+/g, '_')  // "IMAGE BRIEF"→"image_brief"
    const val = m[2].replace(/\n---\s*$/, '').trim()         // strip trailing ---
    fields[key] = val
  }

  return fields
}

// Builds the caption .md that watch-drive.js expects:
// post_time header + ## instagram / ## twitter / ## facebook sections.
function buildCaptionMd(fields) {
  const slot     = fields.slot  || 'unknown'
  const theme    = fields.theme || ''
  const postTime = fields.posttime || ''
  const header   = postTime ? `post_time: ${postTime}\n` : ''

  const ig = fields.instagram     || ''
  const tw = fields.bluesky       || ''  // punchy/short — appropriate for X
  const fb = fields.instagram     || ''

  return `${header}# ${slot} — ${theme}\n\n## instagram\n${ig}\n\n## twitter\n${tw}\n\n## facebook\n${fb}\n`
}

// ─── BSV visual preamble ──────────────────────────────────────────────────────
// Prepended to every image and video prompt before it reaches Gemini/Imagen.
// ONE scene only. The brief selects the scene — this preamble sets the rules.
//
// Fixed 2026-06-29 (see BSV-BigC-Audit-Log.md): this preamble used to assert
// "the product... is a prop, not the hero" and "Dark wood, leather, low light"
// as flat, unconditional rules — directly contradicting per-slot briefs from
// creative-agent.js that name a specific product and explicitly require it to
// be the visual focus in a specific (often non-leather) setting. Confirmed via
// tue-pm-brief.txt: the brief correctly demanded the Brickell Clarifying Gel
// Face Wash bottle be the hero on a bathroom counter, but the rendered image
// came back as a generic dark-leather-chair scene with no product visible —
// because this preamble's flat rules sat upstream of the brief and won. Big D
// had already filed three corrections on this exact symptom via learn.js
// (2026-06-13, 06-20, 06-28) that all reached creative-agent.js's brief
// quality but never this file, which is why the actual images never improved.
// Both rules below are now explicitly conditional, and a precedence statement
// makes the brief authoritative whenever it conflicts with this preamble.

const BSV_VISUAL_PREAMBLE = `SINGLE FRAME ONLY. ONE photograph. ONE person. ONE moment. ONE location.
DO NOT generate a collage, grid, panel layout, mood board, contact sheet, or multiple images.
DO NOT show more than one version of the same scene. If you are about to produce multiple frames, STOP and produce only the first.

BIG SOLE VIBES — VISUAL STANDARD

PRECEDENCE: The SCENE brief below is written for this specific product and story. If anything in it conflicts with the defaults in this standard — including the product's role in the shot or the setting described — the brief wins. Everything below is a fallback for when the brief doesn't specify otherwise, not a rule layered on top of it.

The brand is deadpan, confident, slightly amused. Not brooding. Not aspirational. The man has already made up his mind — we are catching him mid-thought, not mid-pose. Think Monty Python seriousness applied to a very specific grooming gap. The gap is real. The man is real. The humor is in the recognition, not the joke.

WHAT THE IMAGE IS: A single cinematic film still. The kind of frame that holds a full story in one shot. The man is the subject — head to toe in frame wherever possible. Default: the product or category appears as a prop in the scene, not the hero of the shot. EXCEPTION: if the brief below names a specific product and instructs that it be the visual focus, follow the brief — the product is the hero, composed so the eye lands on it first, clearly identifiable, never reduced to background dressing. The foot appears somewhere in frame — edge of shot, soft focus, corner — as the quiet punchline, unless the brief calls for it to be the subject.

VISUAL LANGUAGE: Warm amber (#C17D2E) and deep navy (#0D1B2A) anchor the palette in every shot, regardless of setting. Cinematic grain. 35mm editorial feel. No stock photo energy. No product labels unless the brief calls for a specific product's label to be readable. No logos. No text in the image. Dark wood and leather are one recurring BSV environment, not the only one — use the actual setting the brief describes (bathroom counter, locker room, kitchen, office, outdoors, wherever) instead of defaulting to a leather chair when the brief says otherwise.

TONE: Lived-in, not staged. Slightly caught, not posed. A story is happening just outside the frame. The man looks like he just thought of something — not like he is being photographed.

HEAD TO TOE: The full body should be visible or strongly implied. Head, torso, hands, feet — the whole man. This is a head-to-toe brand. The foot is the wink at the bottom of the frame. When foot care is the featured product, bring the foot to center frame, sharp focus, fully lit. Otherwise: foot is present, incidental, the period at the end of the sentence.

SCENE (from the brief below — this is the actual assignment; everything above is fallback context only):
`

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ gemini-bridge start ━━━')

  const VALID_DAYS = ['mon','tue','wed','thu','fri','sat','sun']
  const dayArg = process.argv.indexOf('--day')
  if (dayArg === -1) {
    log('ERROR: --day <slug> required (e.g. --day mon)')
    process.exit(1)
  }

  const targetDay = (process.argv[dayArg + 1] || '').toLowerCase()
  if (!VALID_DAYS.includes(targetDay)) {
    log(`ERROR: --day requires a valid slug (${VALID_DAYS.join('|')})`)
    process.exit(1)
  }

  const targetSlots = [`${targetDay}-am`, `${targetDay}-pm`]

  for (const slug of targetSlots) {
    const briefPath = path.join(BRIEFS_DIR, `${slug}-brief.txt`)

    if (!fs.existsSync(briefPath)) {
      log(`  ${slug}: brief file not found at ${briefPath} — skipping`)
      continue
    }

    log(`  ${slug}: reading brief...`)
    const briefText = fs.readFileSync(briefPath, 'utf8')
    const fields    = parseBrief(briefText)

    // ── Caption .md → Drive Ready to Post ────────────────────────────────────
    const captionContent = buildCaptionMd(fields)
    const captionLocal   = path.join(TEMP_DIR, `${slug}.md`)
    fs.writeFileSync(captionLocal, captionContent)
    try {
      uploadFile(captionLocal, `${REMOTE}/Ready to Post/${slug}.md`)
      log(`    ✓ uploaded → Ready to Post/${slug}.md`)
    } catch (err) {
      log(`    ERROR: caption upload failed: ${err.stderr?.toString().trim() || err.message}`)
    }

    // ── Flow caption .md → Drive Ready to Post ───────────────────────────────
    // The -flow slot (video/story format) needs its own caption file so
    // watch-drive can distribute it. Same caption as the still — watch-drive
    // won't distribute until BOTH the media and this caption file are present.
    const flowCaptionLocal = path.join(TEMP_DIR, `${slug}-flow.md`)
    fs.writeFileSync(flowCaptionLocal, captionContent)
    try {
      uploadFile(flowCaptionLocal, `${REMOTE}/Ready to Post/${slug}-flow.md`)
      log(`    ✓ uploaded → Ready to Post/${slug}-flow.md`)
    } catch (err) {
      log(`    ERROR: flow caption upload failed: ${err.stderr?.toString().trim() || err.message}`)
    }

    // ── Image prompt → Drive Ready to Post ───────────────────────────────────
    const imagePrompt = fields.image_brief
    if (imagePrompt) {
      const promptLocal = path.join(TEMP_DIR, `${slug}-prompt.txt`)
      fs.writeFileSync(promptLocal, BSV_VISUAL_PREAMBLE + imagePrompt)
      try {
        uploadFile(promptLocal, `${REMOTE}/Ready to Post/${slug}-prompt.txt`)
        log(`    ✓ uploaded → Ready to Post/${slug}-prompt.txt`)
      } catch (err) {
        log(`    ERROR: image prompt upload failed: ${err.stderr?.toString().trim() || err.message}`)
      }
    } else {
      log(`    WARNING: no IMAGE BRIEF in brief for ${slug}`)
    }

    // ── Video prompt → Drive Ready to Post ───────────────────────────────────
    const videoPrompt = fields.video_brief
    if (videoPrompt) {
      const flowLocal = path.join(TEMP_DIR, `${slug}-flow-prompt.txt`)
      fs.writeFileSync(flowLocal, BSV_VISUAL_PREAMBLE + videoPrompt)
      try {
        uploadFile(flowLocal, `${REMOTE}/Ready to Post/${slug}-flow-prompt.txt`)
        log(`    ✓ uploaded → Ready to Post/${slug}-flow-prompt.txt`)
      } catch (err) {
        log(`    ERROR: video prompt upload failed: ${err.stderr?.toString().trim() || err.message}`)
      }
    } else {
      log(`    WARNING: no VIDEO BRIEF in brief for ${slug}`)
    }

    log(`    ${slug} ✓`)
  }

  log('Spawning image-gen...')
  const igen = spawnSync(process.execPath, [path.join(__dirname, 'image-gen.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 300000
  })
  if (igen.status !== 0) log('WARNING: image-gen exited ' + igen.status)

  log('━━━ gemini-bridge complete ━━━\n')
})()
