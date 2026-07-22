require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const Anthropic = require('@anthropic-ai/sdk').default

const ROOT                   = path.join(__dirname, '..')
const LOG_FILE               = path.join(ROOT, 'logs', 'image-gen.log')
const TEMP_DIR               = path.join(os.homedir(), 'tmp', 'bsv-image-gen')
const READY_DIR              = path.join(os.homedir(), 'tmp', 'bsv-ready')
const GDRIVE_REMOTE          = 'big sole vibes'
const READY_TO_POST_FOLDER   = '1WvLthTzvePf0GDJDDPPO3SkROyoFzhEI'

const IMAGE_MODEL = 'imagen-4.0-fast-generate-001'
const GEMINI_API  = 'https://generativelanguage.googleapis.com/v1beta'

// QA_MODEL/QA_FLAGS_FILE — see "Visual QA" section below.
const QA_MODEL     = 'claude-haiku-4-5-20251001'
const QA_FLAGS_FILE = path.join(ROOT, 'logs', 'visual-qa-flags.json')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

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

async function generateImageOnce(apiKey, prompt) {
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
    // Fixed 2026-07-16 — the old error only logged Object.keys(), which for a
    // genuinely empty `{}` body (the actual, repeated failure mode for this
    // slot) always printed the useless "keys: []" seen ~8x in the eng
    // backlog with zero diagnostic value. Logging the raw body (truncated)
    // instead so a persistent failure is actually debuggable next time —
    // e.g. distinguishing a real empty response from a safety-filter block
    // (which Imagen sometimes reports via predictions[0].raiFilteredReason
    // rather than omitting bytesBase64Encoded outright).
    throw new Error(`No image in response — raw body: ${JSON.stringify(data).slice(0, 300)}`)
  }
  return Buffer.from(prediction.bytesBase64Encoded, 'base64')
}

// Retry wrapper added 2026-07-16 — generateImageOnce() previously had zero
// retries, so any transient API hiccup was indistinguishable in the logs
// from a deterministic failure (e.g. a persistently safety-filtered prompt).
// One retry after a short delay is enough to tell the two apart without
// meaningfully slowing down a run that's mostly succeeding.
async function generateImage(apiKey, prompt, attempts = 2) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      return await generateImageOnce(apiKey, prompt)
    } catch (err) {
      lastErr = err
      if (i < attempts) await new Promise(r => setTimeout(r, 2000))
    }
  }
  throw lastErr
}

// ─── Visual QA (Claude vision check) ───────────────────────────────────────────
// Added 2026-07-22. Context: text briefs from creative-agent.js have been fully
// doctrine-compliant since 06-13 (explicit "no person in frame", specific
// technique instructions, etc. — verified against logs/creative-directives.json),
// and this file passes that text to Imagen untouched (see finalPrompt note
// above — no reference image, no override). But the *rendered* images kept
// showing the exact pattern the briefs explicitly banned: a man's face,
// wood-paneled study, leather chesterfield chair. Imagen 4 Fast has a strong
// trained prior toward that composition that survives explicit negative
// instructions when they're buried in a long narrative prompt.
//
// Nothing in the pipeline ever looked at the *rendered* image before this —
// brand-manager.js's QA only ever reads brief text (see its
// loadDenialPatterns/buildDirectivesBlock — image bytes never enter that
// file), so Big D was the only visual QA gate, catching this by eye on the
// dashboard every time. This closes that gap: right after Imagen returns
// bytes, ask Claude (vision, Haiku — this is a classification/triage task,
// not creative work, same tier as eng-bot's diagnosis) whether the image
// actually complies with its own brief, and flag it if not.
//
// Deliberately does NOT block the upload or auto-retry generation — a
// automated check can have false positives, and auto-retrying on every FAIL
// risks burning Gemini image credits in a runaway loop for a slot that's
// borderline. It flags, loudly, to logs/visual-qa-flags.json, which
// chief-of-staff.js surfaces in agent-output-digest.md (local-only, so it
// survives a credit outage same as everything else in that file) — so a
// flagged image is visible before Big D approves it on the dashboard,
// instead of silently shipping.
async function visualQaCheck(anthropicKey, imageBuffer, brief) {
  if (!anthropicKey) return { checked: false, reason: 'ANTHROPIC_API_KEY not set' }

  try {
    const client = new Anthropic({ apiKey: anthropicKey })
    const base64Image = imageBuffer.toString('base64')

    const response = await client.messages.create({
      model: QA_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Image } },
          {
            type: 'text',
            text: `You are checking whether a generated image complies with the brief that was used to generate it. Treat explicit negative instructions as hard constraints, not suggestions — for example "no person in frame," "no leather chair / dark wood study as a default setting," "no product-application gesture," or a specific visual technique like an engraving/illustration style instead of a photograph.

BRIEF (this is exactly what was sent to the image model):
${brief}

Look at the attached image and check it against every explicit instruction above — especially whether a person appears when the brief said not to, whether a leather chair or wood-paneled study appears as a default the brief didn't call for, whether any banned product-application gesture appears, and whether the requested visual technique was actually used.

Respond in exactly this format, nothing else:
VERDICT: PASS or FAIL
REASON: one sentence, specific about what matches or what's wrong`,
          },
        ],
      }],
    })

    const text = response.content?.[0]?.text || ''
    const verdictMatch = text.match(/VERDICT:\s*(PASS|FAIL)/i)
    const reasonMatch  = text.match(/REASON:\s*(.+)/i)
    return {
      checked: true,
      pass:    verdictMatch ? verdictMatch[1].toUpperCase() === 'PASS' : null,
      reason:  reasonMatch ? reasonMatch[1].trim() : text.slice(0, 200) || '(empty response)',
    }
  } catch (err) {
    // Anthropic credit-balance-exhausted and any other API failure land here —
    // never let a QA failure block the actual image pipeline. Worst case an
    // image ships unchecked, same as every run before this feature existed.
    return { checked: false, reason: err.message }
  }
}

function recordQaFlag(slot, reason, briefSnippet) {
  let flags = []
  try { flags = JSON.parse(fs.readFileSync(QA_FLAGS_FILE, 'utf8')) } catch {}
  flags.unshift({ slot, reason, briefSnippet, flaggedAt: new Date().toISOString() })
  flags = flags.slice(0, 100) // keep most recent 100 — this file is a rolling log, not an archive
  try {
    fs.writeFileSync(QA_FLAGS_FILE, JSON.stringify(flags, null, 2))
  } catch (err) {
    log(`    WARNING: failed to write visual-qa-flags.json — ${err.message}`)
  }
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

    // Skip only if a local image already exists AND is newer than the prompt file.
    // This ensures regeneration when gemini-bridge writes a fresh prompt for the slot.
    const localImagePath  = path.join(READY_DIR, outFilename)
    const promptLocalPath = path.join(READY_DIR, promptFile)
    if (fs.existsSync(localImagePath)) {
      const imageMtime  = fs.statSync(localImagePath).mtimeMs
      const promptMtime = fs.existsSync(promptLocalPath) ? fs.statSync(promptLocalPath).mtimeMs : 0
      if (imageMtime >= promptMtime) {
        log(`  ${slot}: image up to date (image newer than prompt) — skipping`)
        skipped++
        continue
      }
      log(`  ${slot}: prompt is newer than image — regenerating`)
    }

    log(`  ${slot}: generating image...`)
    log(`    prompt: ${visualPrompt.slice(0, 120)}${visualPrompt.length > 120 ? '…' : ''}`)

    // NOTE: visualPrompt already = BSV_VISUAL_PREAMBLE + the slot's actual IMAGE BRIEF
    // (built by gemini-bridge.js from creative-agent.js's brief). The preamble already
    // carries the single-frame instruction and a "brief wins" precedence-scoped style
    // fallback. Do NOT staple another unconditional style/format block on here — that
    // was the same bug fixed in gemini-bridge.js (57d3ce86) and creative-agent.js
    // (e00d20de): a flat style directive with no precedence sitting downstream of the
    // brief and winning over it. This file is the last mile before the API call, so a
    // hardcoded block here is the hardest one to notice and the most damaging.
    const finalPrompt = visualPrompt

    try {
      const buf = await generateImage(apiKey, finalPrompt)
      fs.writeFileSync(localPath, buf)

      const qa = await visualQaCheck(process.env.ANTHROPIC_API_KEY, buf, finalPrompt)
      if (!qa.checked) {
        log(`    visual QA: skipped — ${qa.reason}`)
      } else if (qa.pass === false) {
        log(`    visual QA: FAIL — ${qa.reason}`)
        recordQaFlag(slot, qa.reason, finalPrompt.slice(0, 200))
      } else if (qa.pass === true) {
        log(`    visual QA: pass — ${qa.reason}`)
      } else {
        log(`    visual QA: unparseable response — ${qa.reason}`)
      }

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
