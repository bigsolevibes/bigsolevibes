require('dotenv').config()
const { execSync } = require('child_process')
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

    // ── Image prompt → Drive Ready to Post ───────────────────────────────────
    const imagePrompt = fields.image_brief
    if (imagePrompt) {
      const promptLocal = path.join(TEMP_DIR, `${slug}-prompt.txt`)
      fs.writeFileSync(promptLocal, imagePrompt)
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
      fs.writeFileSync(flowLocal, videoPrompt)
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

  log('━━━ gemini-bridge complete ━━━\n')
})()
