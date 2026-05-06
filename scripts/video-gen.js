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
// Parses flat day: N blocks produced by the new media-director format.
// day1-video.mp4 pairs with day1.md via the day: field, not array position.

const KNOWN_KEYS = new Set(['day','date','theme','world','post_time','platform','image_prompt','video_prompt','audio_prompt','caption'])

function parseFields(block) {
  const fields = {}
  let key = null
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/)
    if (m && KNOWN_KEYS.has(m[1])) { key = m[1]; fields[key] = m[2].trim() }
    else if (key && line.trim())    fields[key] += ' ' + line.trim()
  }
  return fields
}

function parseDayPrompts(planContent) {
  const blocks = planContent.split(/^(?=day:\s*\d+\b)/m).filter(s => s.trim())
  const days = []

  for (const block of blocks) {
    const f = parseFields(block)
    if (!f.day) continue

    const dayNum    = parseInt(f.day, 10)
    const dateMatch = (f.date || '').match(/(\w+)[,\s]+(\d{4}-\d{2}-\d{2})/)
    const label     = dateMatch ? dateMatch[1] : `Day${dayNum}`
    const date      = dateMatch ? dateMatch[2] : (f.date || '').trim()

    if (!f.video_prompt) {
      log(`  day${dayNum} (${label} ${date}): no video_prompt — skipping`)
      continue
    }

    days.push({ dayNum, label, date, videoPrompt: f.video_prompt })
  }

  return days
}

// ─── Veo video generation ─────────────────────────────────────────────────────

// Submits one generation operation and polls until done. Returns the
// generatedVideos array (may be empty if Veo produced nothing).
async function runOperation(ai, prompt) {
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

  return operation.response?.generatedVideos ?? []
}

async function generateVideo(ai, apiKey, prompt) {
  let videos = await runOperation(ai, prompt)

  if (!videos.length) {
    log('    operation completed with no videos — retrying once...')
    videos = await runOperation(ai, prompt)
    if (!videos.length) {
      throw new Error('No generated videos after retry')
    }
    log('    retry succeeded')
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
