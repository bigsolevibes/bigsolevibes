const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const GDRIVE_REMOTE = 'big sole vibes'
const GDRIVE_VIDEOS = `${GDRIVE_REMOTE}:Big Sole Vibes/Videos`

function copyToGDrive(localPath) {
  try {
    execSync(`rclone copy "${localPath}" "${GDRIVE_VIDEOS}"`, { stdio: 'pipe' })
    console.log(`  → synced to Google Drive: ${GDRIVE_VIDEOS}`)
  } catch (err) {
    console.warn(`  ⚠ Google Drive upload failed: ${err.stderr?.toString().trim() || err.message}`)
  }
}

// ─── Font resolution ──────────────────────────────────────────────────────────

function findFont(...names) {
  const dirs = [
    path.join(os.homedir(), 'Library/Fonts'),
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

const FONT_DISPLAY = findFont(
  'BebasNeue-Regular.ttf', 'Bebas Neue Regular.ttf', 'BebasNeue.ttf',
  'Impact.ttf'
)
const FONT_SERIF = findFont(
  'PlayfairDisplay-Regular.ttf', 'Playfair Display Regular.ttf',
  'Georgia.ttf'
)

if (!FONT_DISPLAY) { console.error('✗ No display font found (tried Bebas Neue, Impact)'); process.exit(1) }
if (!FONT_SERIF)   { console.error('✗ No serif font found (tried Playfair Display, Georgia)'); process.exit(1) }

console.log(`Fonts: ${path.basename(FONT_DISPLAY)}, ${path.basename(FONT_SERIF)}`)

// ─── ffmpeg filter string escaping ───────────────────────────────────────────
// Colons and backslashes are special in ffmpeg filter option values.

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const inputPath = args[0]
const numIdx  = args.indexOf('--numeral')
const numeral = numIdx !== -1 ? args[numIdx + 1] || '' : ''

if (!inputPath) {
  console.error('Usage: node scripts/make-video.js /path/to/image.png [--numeral XIV]')
  process.exit(1)
}
if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`)
  process.exit(1)
}

const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
  console.error('ffmpeg is not installed. Install with: brew install ffmpeg')
  process.exit(1)
}

// ─── Output paths ─────────────────────────────────────────────────────────────

const outputDir  = path.join(__dirname, '..', 'posts', 'output')
const desktopDir = '/Users/davidgeer/Desktop/bsv-posts'
fs.mkdirSync(outputDir,  { recursive: true })
fs.mkdirSync(desktopDir, { recursive: true })

const baseName   = path.basename(inputPath, path.extname(inputPath))
const outputFile = `${baseName}-tiktok.mp4`
const outputPath = path.join(outputDir, outputFile)
const desktopPath = path.join(desktopDir, outputFile)

// ─── Video filter chain ───────────────────────────────────────────────────────

const W = 1080
const H = 1920
const duration = 7
const zoomStep = (1.05 - 1.0) / (duration * 25)

const BOURBON = '0xC17D2E'
const STEEL   = '0x4A6380'

// Vertical layout (from bottom, y increases downward):
//   h-40        → bottom margin / border
//   h-64        → top of BIG SOLE VIBES (24px)
//   h-72        → bottom of BSV gap (8px gap)
//   h-144       → top of BSV (72px)

const brandFilters = [
  // Steel inset border
  `drawbox=x=20:y=20:w=iw-40:h=ih-40:color=${STEEL}:t=3`,

  // BSV mark — bottom left, display font, 72px
  `drawtext=fontfile='${esc(FONT_DISPLAY)}':text='BSV':fontcolor=${BOURBON}:fontsize=72:x=40:y=h-144`,

  // BIG SOLE VIBES — below BSV, serif, 24px
  `drawtext=fontfile='${esc(FONT_SERIF)}':text='BIG SOLE VIBES':fontcolor=${BOURBON}:fontsize=24:x=40:y=h-64`,
]

// Roman numeral — bottom right, display font, 48px (only if provided)
if (numeral) {
  brandFilters.push(
    `drawtext=fontfile='${esc(FONT_DISPLAY)}':text='${numeral}':fontcolor=${BOURBON}:fontsize=48:x=w-tw-40:y=h-th-40`
  )
}

const zoompan = [
  `scale=${W * 2}:${H * 2}`,
  `zoompan=z='min(zoom+${zoomStep.toFixed(6)},1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${W}x${H}:fps=25`,
].join(',')

const vf = [zoompan, ...brandFilters].join(',')

// ─── Render ───────────────────────────────────────────────────────────────────

const label = numeral ? ` [${numeral}]` : ''
console.log(`Generating ${W}x${H} video (${duration}s, Ken Burns + BSV branding${label})...`)

execSync(
  `ffmpeg -y -loop 1 -i "${inputPath}" -vf "${vf}" -c:v libx264 -t ${duration} -pix_fmt yuv420p "${outputPath}"`,
  { stdio: 'inherit' }
)

fs.copyFileSync(outputPath, desktopPath)
console.log(`tiktok/shorts: ${outputPath}`)
console.log(`  → copied to ${desktopPath}`)
copyToGDrive(outputPath)
