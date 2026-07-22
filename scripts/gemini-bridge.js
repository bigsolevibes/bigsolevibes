require('dotenv').config()
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { PALETTE, PERSON_OPTIONAL, NO_DEFAULT_SETTING, FOOT_CAMEO, precedence } = require('./lib/visual-doctrine')

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

  // Verify the file actually landed — added 2026-07-17 after tue-pm.md was
  // logged as "✓ uploaded" (rclone copyto exited 0) but was never actually
  // discoverable in Drive afterward, in either Ready to Post or the Posted
  // archive. That silent Drive-side failure slipped past every caller's
  // try/catch because copyto itself reported success — the caption was
  // simply gone, and the slot sat stuck for 34+ hours with no visible error
  // anywhere. Confirm the destination actually shows the file immediately
  // after the copy; throw if it doesn't, so the caller's existing
  // try/catch logs a real ERROR instead of trusting a false positive.
  const verify = execSync(`rclone lsf "${remotePath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    .toString()
    .trim()
  if (!verify) {
    throw new Error(`upload reported success but file not found at destination: ${remotePath}`)
  }
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
// Prepended to every image prompt before it reaches Gemini/Imagen.
// ONE scene only. The brief selects the scene — this preamble sets the rules.
//
// Refactored 2026-07-16 (see BSV-BigC-Audit-Log.md): the shared doctrine
// paragraphs (precedence, person-optional, brand tone, foot cameo, palette)
// used to be hardcoded here AND separately in video-gen.js AND separately in
// blog-agent.js. Each had drifted from the others and each had to be found
// and fixed independently, three separate times (2026-06-29, 2026-07-01,
// 2026-07-13) after Big D kept seeing the same "leather chair" symptom — his
// point exactly: "we shouldnt have direction in each file or agent...it
// should be its own single file or agent that they are linked to." Those
// shared paragraphs now live once in ./lib/visual-doctrine.js; everything
// below that's still local to this file is genuinely image-specific
// mechanics (text-free/single-frame rules, the cinematic-still framing, the
// visual-language/grain details) that don't apply to video or blog.

// Rewritten 2026-07-22 for Imagen's 480-token input limit — see the note on
// PERSON_OPTIONAL in lib/visual-doctrine.js for the measurement that drove
// this. Old version alone was ~888 estimated tokens, before the per-post
// assignment was even added; a real combined prompt measured ~1400 tokens,
// ~3x the limit, meaning anything near the end (routinely the "no person in
// frame" line) was very likely being silently truncated before Imagen ever
// saw it. This version measures ~172 tokens, leaving the assignment below
// enough of the 480-token budget to actually fit. Dropped BRAND_TONE and the
// generic "cinematic/lived-in" mood language — that's caption voice, not
// something a diffusion model reads as brand tone, and it's fallback-only
// content the assignment overrides anyway; every consumer of this preamble
// (image, video, blog) benefits from the cut, not just Imagen's token limit.
const BSV_VISUAL_PREAMBLE = `TEXT-FREE. SINGLE FRAME — no panels, collage, or grid.

${precedence('the assignment below')} ${PERSON_OPTIONAL} ${NO_DEFAULT_SETTING} Amber (${PALETTE.AMBER}) + navy (${PALETTE.NAVY}) palette. No stock-photo staging, no logos. ${FOOT_CAMEO}

ASSIGNMENT (mandatory, follows):
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
