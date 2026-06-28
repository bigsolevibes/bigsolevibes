// generate-locker-image.js — generate a single 16:9 cinematic scene image for a Locker Room product
// Usage: node scripts/generate-locker-image.js --slug spongelle-men-super-buffer --name "Spongelle Men Super Buffer"
//
// Output: public/posts/output/{slug}-scene.jpg  (also committed to preview/full-site)

require('dotenv').config({ quiet: true })
const fs   = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT      = path.join(__dirname, '..')
const OUT_DIR   = path.join(ROOT, 'public', 'posts', 'output')
const LOG_FILE  = path.join(ROOT, 'logs', 'generate-locker-image.log')

const GEMINI_API  = 'https://generativelanguage.googleapis.com/v1beta'
const IMAGE_MODEL = 'imagen-4.0-fast-generate-001'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Product definitions ──────────────────────────────────────────────────────
// Add entries here whenever a Sheet product needs a locker image.

const PRODUCTS = {
  'spongelle-men-super-buffer': {
    name:   'Spongelle Men Super Buffer',
    prompt: `Cinematic editorial still life, 16:9. A dense, luxurious loofah-style bath buffer sponge — round, thick, textured foam body — sits alone on the edge of a dark marble wet-room bench. Steam rises. A single shaft of amber light cuts across it from the left. The sponge is the only object in the frame. Rich dark tones, obsidian and bourbon palette. The sponge looks expensive — the kind a man places deliberately, not tosses. No razor. No blade. No text. No logos. No people. Dramatic, theatrical, slightly absurd in its reverence for a simple object.`,
  },
}

// ─── Gemini Imagen call ───────────────────────────────────────────────────────

async function generateImage(apiKey, prompt) {
  const url  = `${GEMINI_API}/models/${IMAGE_MODEL}:predict?key=${apiKey}`
  const body = { instances: [{ prompt }], parameters: { sampleCount: 1 } }
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Imagen API ${res.status}: ${data?.error?.message || JSON.stringify(data)}`)
  const prediction = data?.predictions?.[0]
  if (!prediction?.bytesBase64Encoded) throw new Error(`No image in response`)
  return Buffer.from(prediction.bytesBase64Encoded, 'base64')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // Slug from --slug arg or from request file (logs/.locker-image-request.json).
  // Presence of the request file also acts as a live-run override (bypasses --dry-run).
  const REQUEST_FILE = path.join(ROOT, 'logs', '.locker-image-request.json')
  let slug, forceLive = false

  if (fs.existsSync(REQUEST_FILE)) {
    try {
      const req = JSON.parse(fs.readFileSync(REQUEST_FILE, 'utf8'))
      slug = req.slug
      forceLive = true
      fs.unlinkSync(REQUEST_FILE)
      log(`Request file found — slug: ${slug}`)
    } catch { log('WARNING: could not parse request file') }
  }

  const slugIdx = process.argv.indexOf('--slug')
  if (!slug && slugIdx !== -1) slug = process.argv[slugIdx + 1]

  if (!slug) {
    log('ERROR: no slug. Write logs/.locker-image-request.json with {"slug":"..."} or pass --slug.')
    log('Available: ' + Object.keys(PRODUCTS).join(', '))
    process.exit(1)
  }

  const product = PRODUCTS[slug]
  if (!product) {
    log(`ERROR: unknown slug "${slug}". Available: ${Object.keys(PRODUCTS).join(', ')}`)
    process.exit(1)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { log('ERROR: GEMINI_API_KEY not set'); process.exit(1) }

  const outPath = path.join(OUT_DIR, `${slug}-scene.jpg`)
  log(`━━━ generate-locker-image ━━━`)
  log(`Product: ${product.name}`)
  log(`Output:  ${outPath}`)

  if (!forceLive && process.argv.includes('--dry-run')) {
    log('[dry-run] Skipping API call')
    process.exit(0)
  }

  log('Calling Gemini Imagen…')
  let buf
  try {
    buf = await generateImage(apiKey, product.prompt)
  } catch (err) {
    log(`ERROR: ${err.message}`)
    process.exit(1)
  }

  fs.writeFileSync(outPath, buf)
  log(`Written → ${outPath} (${buf.length} bytes)`)

  // Git commit + push to preview/full-site
  try {
    const rel = path.relative(ROOT, outPath)
    execSync(`git add ${rel}`, { cwd: ROOT, stdio: 'pipe' })
    execSync(`git commit -m "feat: locker image — ${product.name}"`, { cwd: ROOT, stdio: 'pipe' })
    require('./git-push-guard').safePushToPreview(ROOT, log)
    log('Pushed → preview/full-site')
  } catch (err) {
    log(`Git push failed — ${err.stderr?.toString().trim() || err.message}`)
  }

  log('━━━ complete ━━━')
})()
