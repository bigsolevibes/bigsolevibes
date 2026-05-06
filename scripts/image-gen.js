require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT                   = path.join(__dirname, '..')
const LOG_FILE               = path.join(ROOT, 'logs', 'image-gen.log')
const TEMP_DIR               = path.join(os.homedir(), 'tmp', 'bsv-image-gen')
const REMOTE                 = 'big sole vibes:Big Sole Vibes'
const GDRIVE_REMOTE          = 'big sole vibes'
const READY_TO_POST_FOLDER   = '1WvLthTzvePf0GDJDDPPO3SkROyoFzhEI'

const IMAGE_MODEL = 'imagen-4.0-fast-generate-001'
const GEMINI_API  = 'https://generativelanguage.googleapis.com/v1beta'

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

function uploadFile(localPath, remoteDestination) {
  execSync(`rclone copyto "${localPath}" "${remoteDestination}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
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

// ─── Day + visual prompt parsing ─────────────────────────────────────────────
// Parses flat day: N blocks produced by the new media-director format.
// day1-image.png pairs with day1.md via the day: field, not array position.

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

    if (!f.image_prompt) {
      log(`  day${dayNum} (${label} ${date}): no image_prompt — skipping`)
      continue
    }

    days.push({ dayNum, label, date, visualPrompt: f.image_prompt })
  }

  return days
}

// ─── Gemini image generation ──────────────────────────────────────────────────

async function generateImage(apiKey, prompt) {
  const url  = `${GEMINI_API}/models/${IMAGE_MODEL}:predict?key=${apiKey}`
  const body = {
    instances:  [{ prompt }],
    parameters: { sampleCount: 1 },
  }
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Imagen API ${res.status}: ${data?.error?.message || JSON.stringify(data)}`)
  }
  const prediction = data?.predictions?.[0]
  if (!prediction?.bytesBase64Encoded) {
    throw new Error(`No image in response — keys: ${JSON.stringify(Object.keys(prediction || data))}`)
  }
  return Buffer.from(prediction.bytesBase64Encoded, 'base64')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ image-gen start ━━━')

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { log('ERROR: GEMINI_API_KEY not set'); process.exit(1) }

  const plan = getLatestPlan()
  if (!plan) { log('ERROR: No content plan found in Drive'); process.exit(1) }

  const days = parseDayPrompts(plan.content)
  if (!days.length) { log('ERROR: No visual prompts parsed from plan'); process.exit(1) }

  log(`Found ${days.length} day(s) with visual prompts`)

  // Skip days already uploaded — avoids re-generating on repeat runs
  const existing = new Set(listDriveFiles(`${REMOTE}/Ready to Post`))

  let generated = 0
  let skipped   = 0
  let failed    = 0

  for (let i = 0; i < days.length; i++) {
    const day      = days[i]
    const filename = `day${day.dayNum}-image.png`
    const remote   = `${REMOTE}/Ready to Post/${filename}`

    if (existing.has(filename)) {
      log(`  day${day.dayNum} (${day.label} ${day.date}): already in Ready to Post — skipping`)
      skipped++
      continue
    }

    log(`  day${day.dayNum} (${day.label} ${day.date}): generating image...`)
    log(`    prompt: ${day.visualPrompt.slice(0, 120)}${day.visualPrompt.length > 120 ? '…' : ''}`)

    try {
      const buf       = await generateImage(apiKey, day.visualPrompt)
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

    // Pause between calls to stay within free-tier rate limits
    if (i < days.length - 1) await new Promise(r => setTimeout(r, 3000))
  }

  log(`━━━ image-gen complete — ${generated} generated, ${skipped} skipped, ${failed} failed ━━━\n`)
})()
