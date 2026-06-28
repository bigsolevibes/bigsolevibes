require('dotenv').config()
const fs   = require('fs')
const path = require('path')

const ROOT        = path.join(__dirname, '..')
const OUT_DIR     = path.join(ROOT, 'public', 'crawl')
const IMAGE_MODEL = 'imagen-4.0-fast-generate-001'
const GEMINI_API  = 'https://generativelanguage.googleapis.com/v1beta'

// One-off generator for the OpeningCrawl background images.
// Style progression across the 5 eras: oldest = most stylized/animated
// (Monty Python flat-cutout collage), newest = fully photorealistic cinematic —
// each step blends a little more dimensional realism in than the last.
//
// Run: node scripts/gen-crawl-images.js
// Writes to public/crawl/{cave,roman,victorian,midcentury,modern}.jpg
// Then update OpeningCrawl.tsx BG_IMAGES to point at /crawl/<name>.jpg

const SCENES = [
  {
    name: 'cave',
    prompt: `Flat 2D cutout collage animation in the style of Monty Python's Flying Circus (Terry Gilliam). Crude hand-drawn cave painting figures of a man rendered in ochre, rust-red, and charcoal pigment on a rough limestone cave wall texture. Stiff paper-cutout limbs, intentionally primitive proportions, visible torn-paper edges, flat blocks of earth-tone color, no shading or depth. Dim torchlight flicker. Absurdist deadpan humor — the figure looks vaguely confused about his own feet. Wide cinematic aspect ratio, muted ochre and umber palette, grainy stone texture background.`,
  },
  {
    name: 'roman',
    prompt: `2D cutout collage animation, Monty Python Flying Circus style, one step more refined than primitive cave art — flat painted cutout figures with marble-white togas, laurel crowns, and sandals, set against a painted fresco backdrop of Roman columns. Slightly more dimensional shading than pure flat color, subtle painterly brushwork on the cutout edges, deadpan absurdist tone. Warm terracotta, marble white, and faded fresco-blue palette. Wide cinematic aspect ratio.`,
  },
  {
    name: 'victorian',
    prompt: `Hand-tinted Victorian engraving brought softly to life — halfway between illustration and photograph. Cross-hatched linework rendered in sepia and muted gaslight-amber tones, a gentleman in waistcoat and top hat on a foggy cobblestone London street, gas lamps glowing. Subtle painterly dimensionality, soft photographic depth beginning to emerge from the linework, like a colorized 19th-century print. Cinematic wide aspect ratio, warm sepia and deep navy fog palette.`,
  },
  {
    name: 'midcentury',
    prompt: `Hand-tinted 1950s photograph aesthetic — mostly photographic and realistic with a thin nostalgic color-grade overlay. A well-dressed man in a suit and fedora on a sunlit American street with a chrome classic car, soft Kodachrome warmth, fine film grain, gentle vignette. Photographic depth and realism dominate, only a faint vintage illustration quality remains at the edges. Wide cinematic aspect ratio, warm amber and dusty teal palette.`,
  },
  {
    name: 'modern',
    prompt: `SINGLE FRAME ONLY. Fully photorealistic 35mm cinematic film still — no illustration, no animation, no stylization whatsoever. A modern man in tailored clothing caught mid-thought in a dim, upscale lounge interior — dark wood, warm leather, low amber light. Cinematic grain, shallow depth of field, lived-in not staged, deadpan and slightly amused mood. Warm amber (#C17D2E) and deep navy (#0D1B2A) palette. Wide cinematic aspect ratio.`,
  },
]

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

  for (const scene of SCENES) {
    try {
      console.log(`Generating: ${scene.name}...`)
      const buf = await generateImage(apiKey, scene.prompt)
      const outPath = path.join(OUT_DIR, `${scene.name}.jpg`)
      fs.writeFileSync(outPath, buf)
      console.log(`  ✓ saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`)
    } catch (err) {
      console.error(`  ✗ ${scene.name}: ${err.message}`)
    }
  }

  console.log('\nDone. Next: update OpeningCrawl.tsx BG_IMAGES to use /crawl/{cave,roman,victorian,midcentury,modern}.jpg')
})()
