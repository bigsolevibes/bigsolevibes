require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT                   = path.join(__dirname, '..')
const LOG_FILE               = path.join(ROOT, 'logs', 'image-gen.log')
const TEMP_DIR               = path.join(os.homedir(), 'tmp', 'bsv-image-gen')
const READY_DIR              = path.join(os.homedir(), 'tmp', 'bsv-ready')
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

// ─── Drive sync ───────────────────────────────────────────────────────────────

function syncFromDrive() {
  log(`Syncing prompt files from ${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post → ${READY_DIR}`)
  try {
    execSync(
      `rclone copy "${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post" "${READY_DIR}/" --include "*-prompt.txt"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    log('  rclone sync complete')
  } catch (err) {
    log(`  WARNING: rclone sync failed — ${err.stderr?.toString().trim() || err.message}`)
  }
}

// ─── Prompt file scanning ─────────────────────────────────────────────────────
// Reads *-prompt.txt files from ~/tmp/bsv-ready/ (rclone download temp).
// Each file's name minus "-prompt.txt" becomes the output slot (e.g. mon-pm).

function scanPromptFiles() {
  if (!fs.existsSync(READY_DIR)) {
    log(`READY_DIR not found: ${READY_DIR}`)
    return []
  }

  const entries = fs.readdirSync(READY_DIR).filter(f => f.endsWith('-prompt.txt'))
  const prompts = []

  for (const filename of entries) {
    const slot    = filename.replace(/-prompt\.txt$/, '')
    const content = fs.readFileSync(path.join(READY_DIR, filename), 'utf8').trim()
    if (!content) {
      log(`  ${filename}: empty — skipping`)
      continue
    }
    prompts.push({ slot, filename, visualPrompt: content })
  }

  return prompts
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

  syncFromDrive()

  const prompts = scanPromptFiles()
  if (!prompts.length) { log(`No *-prompt.txt files found in ${READY_DIR}`); process.exit(0) }

  log(`Found ${prompts.length} prompt file(s): ${prompts.map(p => p.filename).join(', ')}`)

  let generated = 0
  let skipped   = 0
  let failed    = 0

  for (let i = 0; i < prompts.length; i++) {
    const { slot, filename: promptFile, visualPrompt } = prompts[i]
    const outFilename = `${slot}.png`
    const localPath   = path.join(TEMP_DIR, outFilename)

    // Skip if the output image is already in Drive Ready to Post
    const alreadyInDrive = listDriveFiles(
      `${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post`
    ).includes(outFilename)

    if (alreadyInDrive) {
      log(`  ${slot}: already in Ready to Post — skipping`)
      skipped++
      continue
    }

    log(`  ${slot}: generating image...`)
    log(`    prompt: ${visualPrompt.slice(0, 120)}${visualPrompt.length > 120 ? '…' : ''}`)

    const finalPrompt = [
      'PHOTOGRAPHY RULES — STRICT:',
      'ONE image. ONE person. ONE location. ONE moment in time.',
      'This is a single full-bleed photograph, not a composite.',
      'FORBIDDEN: collage, grid, 2x2 panel, split-screen, mood board, multiple frames, multiple poses, multiple outfits, multiple settings, before/after, side-by-side.',
      'If you are about to generate more than one frame or panel, STOP. Generate only the primary scene.',
      'Style: dark cinematic editorial photography. Shot on 35mm. One consistent color grade.',
      'Subject: ' + visualPrompt,
    ].join('\n')

    try {
      const buf = await generateImage(apiKey, finalPrompt)
      fs.writeFileSync(localPath, buf)
      execSync(
        `rclone copyto "${localPath}" "${GDRIVE_REMOTE}:${outFilename}" --drive-root-folder-id ${READY_TO_POST_FOLDER}`,
        { stdio: 'pipe' }
      )
      log(`    ✓ uploaded → ${outFilename} (${Math.round(buf.length / 1024)}KB)`)
      generated++
    } catch (err) {
      log(`    ERROR: ${err.message}`)
      failed++
    }

    // Pause between calls to stay within free-tier rate limits
    if (i < prompts.length - 1) await new Promise(r => setTimeout(r, 3000))
  }

  log(`━━━ image-gen complete — ${generated} generated, ${skipped} skipped, ${failed} failed ━━━\n`)
})()
