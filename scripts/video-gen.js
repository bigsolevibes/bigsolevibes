require('dotenv').config()
const { GoogleGenAI } = require('@google/genai')
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT                 = path.join(__dirname, '..')
const LOG_FILE             = path.join(ROOT, 'logs', 'video-gen.log')
const TEMP_DIR             = path.join(os.homedir(), 'tmp', 'bsv-video-gen')
const REMOTE               = 'big sole vibes:Big Sole Vibes'
const GDRIVE_REMOTE        = 'big sole vibes'
const READY_TO_POST_FOLDER = '1WvLthTzvePf0GDJDDPPO3SkROyoFzhEI'

const VIDEO_MODEL   = 'veo-3.1-fast-generate-preview'
const POLL_INTERVAL = 10_000 // ms

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function listDriveFiles(remotePath) {
  try {
    const out = execSync(`rclone ls "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.trim().split('\n').filter(Boolean).map(line => {
      const m = line.trim().match(/^\d+\s+(.+)$/)
      return m ? m[1] : null
    }).filter(Boolean)
  } catch { return [] }
}

function downloadFile(remotePath, localDir) {
  execSync(`rclone copy "${remotePath}" "${localDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

// ─── Content plan loading ─────────────────────────────────────────────────────

function getLatestPlan() {
  const files = listDriveFiles(`${REMOTE}/Content Plan`)
  const plans = files.filter(f => f.match(/^week-\d{4}-\d{2}\.md$/)).sort()
  if (!plans.length) return null

  const latest = plans[plans.length - 1]
  log(`Latest plan: ${latest}`)
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  downloadFile(`${REMOTE}/Content Plan/${latest}`, TEMP_DIR)

  const localPath = path.join(TEMP_DIR, latest)
  if (!fs.existsSync(localPath)) return null
  return { filename: latest, content: fs.readFileSync(localPath, 'utf8') }
}

// ─── Day + video prompt parsing ───────────────────────────────────────────────
// Iterates ALL day sections (matching gemini-bridge.js day numbering exactly)
// so day1-video.mp4 always pairs with day1.md.

function parseDayPrompts(planContent) {
  const sections = planContent.split(/^(?=###\s)/m).filter(s => s.trim())
  const days = []
  let dayNum = 0

  for (const section of sections) {
    const headerMatch =
      section.match(/^###\s+(\w+)\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)/) ||
      section.match(/^###\s+(\w+)\s*[—–-]+\s*(\d{4}-\d{2}-\d{2})/)
    if (!headerMatch) continue

    dayNum++
    const label = headerMatch[1].trim()
    const date  = headerMatch[2].trim()

    const promptMatch = section.match(
      /\*\*video_prompt[:\*]*\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*|\n###|$)/i
    )
    if (!promptMatch) {
      log(`  day${dayNum} (${label} ${date}): no video_prompt — skipping`)
      continue
    }

    const rawPrompt = promptMatch[1]
      .split('\n').map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean).join(' ')

    if (!rawPrompt) {
      log(`  day${dayNum} (${label} ${date}): empty video_prompt — skipping`)
      continue
    }

    days.push({ dayNum, label, date, videoPrompt: rawPrompt })
  }

  return days
}

// ─── Veo video generation ─────────────────────────────────────────────────────

async function generateVideo(ai, apiKey, prompt) {
  let operation = await ai.models.generateVideos({
    model:  VIDEO_MODEL,
    prompt,
    config: { aspectRatio: '9:16' },
  })

  log(`    operation started: ${operation.name}`)

  while (!operation.done) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    operation = await ai.operations.getVideosOperation({ operation })
    log(`    polling... done=${operation.done}`)
  }

  const videos = operation.response?.generatedVideos
  if (!videos?.length) {
    throw new Error('No generated videos in operation response')
  }

  const uri = videos[0].video.uri
  if (!uri) throw new Error('generatedVideo.video.uri is empty')

  const fetchUrl = uri.includes('?') ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}`
  const res = await fetch(fetchUrl)
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`)

  return Buffer.from(await res.arrayBuffer())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ video-gen start ━━━')

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { log('ERROR: GEMINI_API_KEY not set'); process.exit(1) }

  const ai = new GoogleGenAI({ apiKey })

  const plan = getLatestPlan()
  if (!plan) { log('ERROR: No content plan found in Drive'); process.exit(1) }

  const days = parseDayPrompts(plan.content)
  if (!days.length) { log('ERROR: No video_prompt fields parsed from plan'); process.exit(1) }

  log(`Found ${days.length} day(s) with video prompts`)

  const existing = new Set(listDriveFiles(`${REMOTE}/Ready to Post`))

  let generated = 0
  let skipped   = 0
  let failed    = 0

  for (const day of days) {
    const filename = `day${day.dayNum}-video.mp4`

    if (existing.has(filename)) {
      log(`  day${day.dayNum} (${day.label} ${day.date}): already in Ready to Post — skipping`)
      skipped++
      continue
    }

    log(`  day${day.dayNum} (${day.label} ${day.date}): generating video...`)
    log(`    prompt: ${day.videoPrompt.slice(0, 120)}${day.videoPrompt.length > 120 ? '…' : ''}`)

    try {
      const buf       = await generateVideo(ai, apiKey, day.videoPrompt)
      const localPath = path.join(TEMP_DIR, filename)
      fs.writeFileSync(localPath, buf)
      execSync(
        `rclone copyto "${localPath}" "${GDRIVE_REMOTE}:${filename}" --drive-root-folder-id ${READY_TO_POST_FOLDER}`,
        { stdio: 'pipe' }
      )
      log(`    ✓ uploaded → folder:${READY_TO_POST_FOLDER}/${filename} (${Math.round(buf.length / 1024)}KB)`)
      generated++
    } catch (err) {
      log(`    ERROR: ${err.message}`)
      failed++
    }
  }

  log(`━━━ video-gen complete — ${generated} generated, ${skipped} skipped, ${failed} failed ━━━\n`)
})()
