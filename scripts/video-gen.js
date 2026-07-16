require('dotenv').config()
const { GoogleGenAI } = require('@google/genai')
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { addPendingItem } = require('./telegram-queue')
const { PERSON_OPTIONAL, FOOT_CAMEO, precedence } = require('./lib/visual-doctrine')

const ROOT                 = path.join(__dirname, '..')
const LOG_FILE             = path.join(ROOT, 'logs', 'video-gen.log')
const TEMP_DIR             = path.join(os.homedir(), 'tmp', 'bsv-video-gen')
const READY_DIR            = path.join(os.homedir(), 'tmp', 'bsv-ready')
const GDRIVE_REMOTE        = 'big sole vibes'
const READY_TO_POST_FOLDER = '1WvLthTzvePf0GDJDDPPO3SkROyoFzhEI'
const VIDEO_REVIEW_REMOTE  = `${GDRIVE_REMOTE}:Big Sole Vibes/Video Review`

const VIDEO_MODEL   = 'veo-3.1-fast-generate-preview'
const POLL_INTERVAL = 10_000 // ms
const DRY_RUN       = process.argv.includes('--dry-run')

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

// ─── BSV video preamble ───────────────────────────────────────────────────────
// Prepended to every Veo prompt. Shares its doctrine with gemini-bridge.js and
// blog-agent.js via ./lib/visual-doctrine.js so the campaign visual language
// can't drift between media the way it did before 2026-07-16 (see
// BSV-BigC-Audit-Log.md — this preamble, gemini-bridge.js's, and blog-agent.js's
// each carried their own copy of the same doctrine and each had to be
// independently caught and fixed as the same "leather chair" symptom kept
// resurfacing: 2026-07-01, 2026-07-13, 2026-07-16).

const BSV_VIDEO_PREAMBLE = `BSV VIDEO VISUAL RULE:

${precedence('The VIDEO BRIEF below')}

THE FOOT CAMEO (fallback only): ${FOOT_CAMEO}
TONE (fallback only): Lived-in, not staged. The man looks complete but slightly caught. Casual confidence, never try-hard. ${PERSON_OPTIONAL}

VIDEO BRIEF (from below — this is the actual assignment; everything above is fallback context only):
`

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

  log(`━━━ video-gen start${DRY_RUN ? ' [DRY RUN]' : ''} ━━━`)

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { log('ERROR: GEMINI_API_KEY not set'); process.exit(1) }

  const ai = DRY_RUN ? null : new GoogleGenAI({ apiKey })

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

    // Fixed 2026-07-16: this used to check Ready to Post for outFilename, but
    // generated videos are staged to Video Review (line below), never to Ready
    // to Post — so this check could never match and video-gen would happily
    // regenerate (and re-spend ~$0.15/sec of Veo cost on) a slot that was
    // already sitting in Video Review awaiting Big D's approval. Now checks
    // the folder the video actually lands in.
    const alreadyStaged = listDriveFiles(VIDEO_REVIEW_REMOTE).includes(outFilename)

    if (alreadyStaged) {
      log(`  ${slot}: already staged in Video Review — skipping`)
      skipped++
      continue
    }

    log(`  ${slot}: ${DRY_RUN ? '[DRY RUN] would generate video' : 'generating video...'}`)
    log(`    prompt: ${videoPrompt.slice(0, 120)}${videoPrompt.length > 120 ? '…' : ''}`)

    if (DRY_RUN) {
      log(`    [DRY RUN] would upload → ${outFilename}`)
      generated++
      continue
    }

    try {
      const buf = await generateVideo(ai, apiKey, BSV_VIDEO_PREAMBLE + videoPrompt)
      fs.writeFileSync(localPath, buf)

      // Upload to Video Review staging folder — not Ready to Post — pending Big D approval
      execSync(
        `rclone copyto "${localPath}" "${VIDEO_REVIEW_REMOTE}/${outFilename}"`,
        { stdio: 'pipe' }
      )
      log(`    ✓ staged → Video Review/${outFilename} (${Math.round(buf.length / 1024)}KB) — awaiting approval`)

      // Fixed 2026-07-16: the source *-flow-prompt.txt (and its sibling -prompt.txt)
      // was never removed from Drive's Ready to Post/ after being consumed here —
      // rclone copy (not move) in syncFromDrive() only ever added a local copy.
      // The file then sat in Ready to Post indefinitely: still physically present
      // (so it kept showing up in chief-of-staff's raw Ready to Post listing) while
      // functionally done/orphaned (video already generated and moved on to Video
      // Review) — the "shows up in both Ready to Post and stale" report Big D
      // flagged for tue-am-flow-prompt.txt / tue-pm-flow-prompt.txt. Clearing it
      // from Drive here mirrors how distribute.js archives consumed post assets.
      try {
        execSync(
          `rclone delete "${GDRIVE_REMOTE}:Big Sole Vibes/Ready to Post" --include "${slot}-flow-prompt.txt" --include "${slot}-prompt.txt"`,
          { stdio: 'pipe' }
        )
        log(`    cleared ${slot}-flow-prompt.txt (+ -prompt.txt) from Ready to Post`)
      } catch (err) {
        log(`    WARNING: could not clear ${slot} prompt file(s) from Drive — ${err.message}`)
      }

      // Telegram notification removed 2026-07-15 per Big D: "the approval is
      // always on dashboard from now on" — /dashboard/video-review reads this
      // same addPendingItem() queue directly (app/api/dashboard/video-review),
      // so the item shows up there with no Telegram round-trip needed. Keeping
      // addPendingItem() below — that's the actual queue write, not a nag.
      const promptSnippet = videoPrompt.slice(0, 180).replace(/[_*`[\]]/g, '').trim()
      addPendingItem({
        type:     'video-gate',
        id:       `video-gate-${slot}`,
        metadata: { slot, driveFile: `Video Review/${outFilename}`, promptSnippet },
      })

      generated++
    } catch (err) {
      log(`    ERROR: ${err.message}`)
      failed++
    }
  }

  log(`━━━ video-gen complete${DRY_RUN ? ' [DRY RUN]' : ''} — ${generated} generated, ${skipped} skipped, ${failed} failed ━━━\n`)
})()
