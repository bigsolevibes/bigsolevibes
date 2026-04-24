const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node scripts/make-video.js /path/to/image.png')
  process.exit(1)
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`)
  process.exit(1)
}

// Check ffmpeg is available
const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
  console.error('ffmpeg is not installed or not in PATH.')
  console.error('Install it with: brew install ffmpeg')
  process.exit(1)
}

const outputDir = path.join(__dirname, '..', 'posts', 'output')
const desktopDir = '/Users/davidgeer/Desktop/bsv-posts'
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(desktopDir, { recursive: true })

const baseName = path.basename(inputPath, path.extname(inputPath))
const outputFile = `${baseName}-tiktok.mp4`
const outputPath = path.join(outputDir, outputFile)
const desktopPath = path.join(desktopDir, outputFile)

const W = 1080
const H = 1920
const duration = 7
// Zoom from 1.0 to 1.05 over the duration (5% Ken Burns zoom)
const zoomStep = (1.05 - 1.0) / (duration * 25) // per frame at 25fps

const vf = [
  `scale=${W * 2}:${H * 2},`,
  `zoompan=`,
  `z='min(zoom+${zoomStep.toFixed(6)},1.05)':`,
  `x='iw/2-(iw/zoom/2)':`,
  `y='ih/2-(ih/zoom/2)':`,
  `d=${duration * 25}:`,
  `s=${W}x${H}:`,
  `fps=25`,
].join('')

console.log(`Generating ${W}x${H} video (${duration}s, Ken Burns zoom)...`)

execSync(
  `ffmpeg -y -loop 1 -i "${inputPath}" -vf "${vf}" -c:v libx264 -t ${duration} -pix_fmt yuv420p "${outputPath}"`,
  { stdio: 'inherit' }
)

fs.copyFileSync(outputPath, desktopPath)
console.log(`tiktok/shorts: ${outputPath}`)
console.log(`  → copied to ${desktopPath}`)
