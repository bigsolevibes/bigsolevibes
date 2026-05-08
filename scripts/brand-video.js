require('dotenv').config()
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

const FONT_BSV = findFont(
  'BebasNeue-Bold.ttf', 'BebasNeue-Regular.ttf',
  'Georgia Bold.ttf', 'Georgia.ttf'
)
const FONT_SUBTITLE = findFont(
  'PlayfairDisplay-Regular.ttf', 'Playfair Display Regular.ttf',
  'Georgia.ttf'
)
const FONT_NUMERAL = findFont(
  'BebasNeue-Regular.ttf', 'BebasNeue.ttf',
  'Impact.ttf'
)

if (!FONT_BSV)      { console.error('✗ No bold serif font found'); process.exit(1) }
if (!FONT_SUBTITLE) { console.error('✗ No serif font found');      process.exit(1) }
if (!FONT_NUMERAL)  { console.error('✗ No display font found');    process.exit(1) }

console.log(`Fonts: ${path.basename(FONT_BSV)}, ${path.basename(FONT_SUBTITLE)}, ${path.basename(FONT_NUMERAL)}`)

// ─── ffmpeg escaping ──────────────────────────────────────────────────────────

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] || null : null
}

const videoPath  = getArg('--video')
const numeral    = getArg('--numeral') || ''
const outputArg  = getArg('--output')

if (!videoPath) {
  console.error('Usage: node scripts/brand-video.js --video /path/to/input.mp4 [--numeral XIV] [--output posts/output/branded.mp4]')
  process.exit(1)
}
if (!fs.existsSync(videoPath)) {
  console.error(`Video not found: ${videoPath}`)
  process.exit(1)
}

const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
  console.error('ffmpeg not found. Install with: brew install ffmpeg')
  process.exit(1)
}

// ─── Output path ──────────────────────────────────────────────────────────────

let outputPath
if (outputArg) {
  outputPath = path.isAbsolute(outputArg)
    ? outputArg
    : path.join(process.cwd(), outputArg)
} else {
  const outputDir = path.join(__dirname, '..', 'posts', 'output')
  fs.mkdirSync(outputDir, { recursive: true })
  const base = path.basename(videoPath, path.extname(videoPath))
  outputPath = path.join(outputDir, `${base}-branded.mp4`)
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })

const desktopDir = '/Users/davidgeer/Desktop/bsv-posts'
fs.mkdirSync(desktopDir, { recursive: true })
const desktopPath = path.join(desktopDir, path.basename(outputPath))

// ─── Branding filter chain ────────────────────────────────────────────────────
//
// Layout (y increases downward, origin top-left):
//   BSV (80px bold serif)       — x=40, bottom at h-60  → y = h-140
//   BIG SOLE VIBES (22px serif) — x=40, bottom at h-30  → y = h-52
//   Numeral blackout rect       — absolute bottom-right corner, 200x80px filled black
//   Numeral (60px display)      — x=w-60, y=h-40 (bottom-right corner over Veo watermark)

const BOURBON = '0xC17D2E'
const CREAM   = '0xF5ECD7'
const STEEL   = '0x4A6380'

const brandFilters = [
  // Steel inset border
  `drawbox=x=20:y=20:w=iw-40:h=ih-40:color=${STEEL}:t=3`,

  // "BSV" — bold serif, 80px, bottom left
  `drawtext=fontfile='${esc(FONT_BSV)}':text='BSV':fontcolor=${BOURBON}:fontsize=80:x=40:y=h-140`,

]

// Black rectangle covering the bottom-right Veo watermark zone
brandFilters.push(
  `drawbox=x=iw-200:y=ih-80:w=200:h=80:color=0x000000:t=fill`
)

const vf = brandFilters.join(',')

// ─── Render ───────────────────────────────────────────────────────────────────

const label = numeral ? ` [${numeral}]` : ''
console.log(`Branding video${label}: ${path.basename(videoPath)} → ${path.basename(outputPath)}`)

// Re-encode video to burn filters; copy audio stream untouched
execSync(
  `ffmpeg -y -i "${videoPath}" -vf "${vf}" -c:v libx264 -crf 18 -preset fast -c:a copy "${outputPath}"`,
  { stdio: 'inherit' }
)

fs.copyFileSync(outputPath, desktopPath)
console.log(`\nOutput: ${outputPath}`)
console.log(`  → copied to ${desktopPath}`)
copyToGDrive(outputPath)
