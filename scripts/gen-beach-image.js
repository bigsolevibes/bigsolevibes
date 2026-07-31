require('dotenv').config()
const fs   = require('fs')
const path = require('path')

const ROOT        = path.join(__dirname, '..')
const OUT_DIR     = path.join(ROOT, 'public', 'crawl')
const IMAGE_MODEL = 'imagen-4.0-fast-generate-001'
const GEMINI_API  = 'https://generativelanguage.googleapis.com/v1beta'

// One-off generator for a new OpeningCrawl frame: "the convergence" —
// the four BSV archetypes (Chef, Athlete, Professional, Style-Conscious)
// arriving on the same stretch of beach, barefoot, at golden hour.
// Matches the photorealistic register of the "modern" frame (the present-day beat).
//
// Run: node scripts/gen-beach-image.js
// Writes to public/crawl/beach.jpg
//
// NOT PIPELINE / NOT A DOCTRINE CONFLICT — reviewed 2026-07-31 after chief-
// of-staff's findContentOverrideRisks() flagged this file's hardcoded
// "photorealistic 35mm cinematic" prompt as a potential conflict with the
// current flat-2D-cutout-collage visual doctrine. It isn't one: this is a
// manual, already-run, one-off site-asset generator, not part of the daily
// watch-drive/media-director/creative-agent/gemini-bridge pipeline, and its
// output (public/crawl/beach.jpg) is live in OpeningCrawl.tsx's BG_IMAGES
// alongside modern.jpg. Both are the cited reference images for "Full
// photorealistic cinematic, 35mm film still" — still one of the four valid,
// actively-offered techniques in creative-agent.js's own VISUAL_TECHNIQUE_RANGE
// (that constant names beach.jpg and modern.jpg by path). The flat-2D-cutout
// push is about the DAILY post pipeline's technique mix, not a ban on
// photorealism site-wide. Leaving the automated scan flagging this file as
// "expected recurring" (same pattern as gemini-bridge.js's
// BSV_VISUAL_PREAMBLE) rather than disabling it — the script itself is
// harmless since nothing calls it automatically.

const SCENE = {
  name: 'beach',
  prompt: `SINGLE FRAME ONLY. Fully photorealistic 35mm cinematic film still — no illustration, no animation, no stylization whatsoever. Golden hour on a quiet beach, warm low sun, long soft shadows on wet sand. Four distinct men stand barefoot near the waterline, trousers and sleeves rolled, shoes in hand or set aside in the sand — each reads as a different type who clearly didn't plan to end up in the same place: one in chef's whites with an apron string still tied at the waist, one in athletic recovery gear mid-stretch, one in tailored trousers cuffed once with loafers dangling from two fingers, one in elevated streetwear who looks like he thought carefully about "beach casual." They are arranged loosely, caught mid-conversation or glance, observed rather than posed — like someone just happened upon this moment. Cinematic grain, shallow depth of field, lived-in not staged, deadpan and quietly amused mood. Warm amber (#C17D2E) and deep navy (#0D1B2A) accents within a natural golden-hour palette. Wide cinematic aspect ratio.`,
}

async function generateImage(apiKey, prompt) {
  const url  = `${GEMINI_API}/models/${IMAGE_MODEL}:predict?key=${apiKey}`
  const body = { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: '16:9' } }
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Imagen API ${res.status}: ${data?.error?.message || JSON.stringify(data)}`)
  const prediction = data?.predictions?.[0]
  if (!prediction?.bytesBase64Encoded) throw new Error(`No image in response — keys: ${JSON.stringify(Object.keys(prediction || data))}`)
  return Buffer.from(prediction.bytesBase64Encoded, 'base64')
}

;(async function run() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { console.error('GEMINI_API_KEY not found in .env'); process.exit(1) }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  try {
    console.log(`Generating: ${SCENE.name}...`)
    const buf = await generateImage(apiKey, SCENE.prompt)
    const outPath = path.join(OUT_DIR, `${SCENE.name}.jpg`)
    fs.writeFileSync(outPath, buf)
    console.log(`  ✓ saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`)
  } catch (err) {
    console.error(`  ✗ ${SCENE.name}: ${err.message}`)
    process.exit(1)
  }

  console.log('\nDone. Next: add /crawl/beach.jpg to OpeningCrawl.tsx BG_IMAGES + matching crawl paragraph.')
})()
