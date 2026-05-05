const sharp = require('sharp')
const path  = require('path')
const fs    = require('fs')

const ROOT       = path.join(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public', 'posts', 'output')

const BOURBON = '#C17D2E'
const STEEL   = '#4A6380'

// Mirror brand-video.js font resolution order
function findFont(...names) {
  const dirs = [
    path.join(require('os').homedir(), 'Library/Fonts'),
    '/Library/Fonts',
    '/System/Library/Fonts/Supplemental',
    '/System/Library/Fonts',
    '/opt/homebrew/share/fonts',
  ]
  for (const name of names) {
    for (const dir of dirs) {
      const p = path.join(dir, name)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

const FONT_PATH = findFont(
  'BebasNeue-Bold.ttf', 'BebasNeue-Regular.ttf',
  'Georgia Bold.ttf', 'Georgia.ttf'
)
if (!FONT_PATH) { console.error('brand-image: no brand font found'); process.exit(1) }
console.log(`brand-image: font = ${path.basename(FONT_PATH)}`)

// Embed font as data URI so librsvg resolves it reliably without fontconfig
const FONT_B64   = fs.readFileSync(FONT_PATH).toString('base64')
const FONT_MIME  = FONT_PATH.endsWith('.ttf') ? 'font/truetype' : 'font/opentype'

// Build a full-size transparent SVG overlay — mirrors brand-video.js layout:
//   steel inset border  x=20 y=20, 3px, iw-40 × ih-40
//   "BSV"               bourbon, bold, 80px, x=40, baseline at h-60
function buildOverlay(width, height) {
  const inset    = 20
  const thick    = 3
  const fontSize = 80
  const textX    = 40
  const textY    = height - 60  // baseline at h-60 matches ffmpeg drawtext y=h-140 at 80px

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face {
        font-family: 'BSVBrand';
        src: url('data:${FONT_MIME};base64,${FONT_B64}');
        font-weight: bold;
      }
    </style>
  </defs>
  <rect x="${inset}" y="${inset}"
        width="${width - inset * 2}" height="${height - inset * 2}"
        fill="none" stroke="${STEEL}" stroke-width="${thick}"/>
  <text x="${textX}" y="${textY}"
        font-family="BSVBrand, Georgia, serif"
        font-weight="bold"
        font-size="${fontSize}"
        fill="${BOURBON}">BSV</text>
</svg>`
  )
}

async function brandImage(imagePath) {
  const meta = await sharp(imagePath).metadata()
  const overlay = buildOverlay(meta.width, meta.height)
  const ext = path.extname(imagePath).toLowerCase()

  let pipeline = sharp(imagePath).composite([{ input: overlay, top: 0, left: 0 }])
  if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 95 })
  else pipeline = pipeline.png()

  const buf = await pipeline.toBuffer()
  fs.writeFileSync(imagePath, buf)

  // Keep public/ copy in sync so Cloudflare Pages serves the branded version
  const pubPath = path.join(PUBLIC_DIR, path.basename(imagePath))
  if (fs.existsSync(PUBLIC_DIR)) fs.writeFileSync(pubPath, buf)

  console.log(`  branded: ${path.basename(imagePath)}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async () => {
  const args = process.argv.slice(2)
  const dirIdx = args.indexOf('--dir')
  const inputDir = dirIdx !== -1 ? args[dirIdx + 1] : path.join(ROOT, 'posts', 'output')

  if (!fs.existsSync(inputDir)) {
    console.error(`brand-image: directory not found: ${inputDir}`)
    process.exit(1)
  }

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg'])
  const files = fs.readdirSync(inputDir)
    .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))

  if (!files.length) {
    console.log(`brand-image: no images found in ${inputDir}`)
    return
  }

  console.log(`brand-image: applying BSV branding to ${files.length} image(s)`)
  for (const file of files) {
    await brandImage(path.join(inputDir, file))
  }
  console.log('brand-image: done')
})()
