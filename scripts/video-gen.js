require('dotenv').config()
const { GoogleGenAI } = require('@google/genai')
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT                 = path.join(__dirname, '..')
const LOG_FILE             = path.join(ROOT, 'logs', 'video-gen.log')
const TEMP_DIR             = path.join(os.homedir(), 'tmp', 'bsv-video-gen')
const READY_DIR            = path.join(os.homedir(), 'tmp', 'bsv-ready')
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

// ─── Drive sync ───────────────────────────────────────────────────────────────

function syncFromDrive() {
  log(`Syncing prompt files from ${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post → ${READY_DIR}`)
  try {
    execSync(
      `rclone copy "${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post" "${READY_DIR}/" --include "*-flow-prompt.txt"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    log('  rclone sync complete')
  } catch (err) {
    log(`  WARNING: rclone sync failed — ${err.stderr?.toString().trim() || err.message}`)
  }
}

// ─── Prompt file scanning ─────────────────────────────────────────────────────
// Reads *-flow-prompt.txt files from ~/tmp/bsv-ready/ (rclone download temp).
// Each file's name minus "-flow-prompt.txt" becomes the output slot (e.g. mon-pm).

function scanPromptFiles() {
  if (!fs.existsSync(READY_DIR)) {
    log(`READY_DIR not found: ${READY_DIR}`)
    return []
  }

  const entries = fs.readdirSync(READY_DIR).filter(f => f.endsWith('-flow-prompt.txt'))
  const prompts = []

  for (const filename of entries) {
    const slot    = filename.replace(/-flow-prompt\.txt$/, '')
    const content = fs.readFileSync(path.join(READY_DIR, filename), 'utf8').trim()
    if (!content) {
      log(`  ${filename}: empty — skipping`)
      continue
    }
    prompts.push({ slot, filename, videoPrompt: content })
  }

  return prompts
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

  syncFromDrive()

  const prompts = scanPromptFiles()
  if (!prompts.length) { log(`No *-flow-prompt.txt files found in ${READY_DIR}`); process.exit(0) }

  log(`Found ${prompts.length} prompt file(s): ${prompts.map(p => p.filename).join(', ')}`)

  let generated = 0
  let skipped   = 0
  let failed    = 0

  for (const { slot, filename: promptFile, videoPrompt } of prompts) {
    const outFilename = `${slot}.mp4`
    const localPath   = path.join(TEMP_DIR, outFilename)

    const alreadyInDrive = listDriveFiles(
      `${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post`
    ).includes(outFilename)

    if (alreadyInDrive) {
      log(`  ${slot}: already in Ready to Post — skipping`)
      skipped++
      continue
    }

    log(`  ${slot}: generating video...`)
    log(`    prompt: ${videoPrompt.slice(0, 120)}${videoPrompt.length > 120 ? '…' : ''}`)

    try {
      const buf = await generateVideo(ai, apiKey, videoPrompt)
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
  }

  log(`━━━ video-gen complete — ${generated} generated, ${skipped} skipped, ${failed} failed ━━━\n`)
})()
