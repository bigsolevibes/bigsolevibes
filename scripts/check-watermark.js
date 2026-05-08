const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const flagIndex = args.indexOf('--video')
const videoPath = flagIndex !== -1 ? args[flagIndex + 1] : null

if (!videoPath) {
  console.error('Usage: node scripts/check-watermark.js --video /path/video.mp4')
  process.exit(1)
}

if (!fs.existsSync(videoPath)) {
  console.error(`✗ Video not found: ${videoPath}`)
  process.exit(1)
}

const OUTPUT = '/tmp/watermark-check.jpg'

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log(`\nChecking: ${path.basename(videoPath)}`)
console.log('Extracting bottom-right corner frame (3s from end)...\n')

try {
  // -sseof -3  → seek to 3 seconds before end (avoids black end frames)
  // -vframes 1 → grab exactly one frame
  // crop=400:220:iw-400:ih-220 → bottom-right 400×220px region
  // -q:v 2     → high JPEG quality for clear watermark inspection
  execSync(
    `ffmpeg -y -sseof -3 -i "${videoPath}" -vframes 1 ` +
    `-vf "crop=400:220:iw-400:ih-220" -q:v 2 "${OUTPUT}"`,
    { stdio: 'pipe' }
  )
} catch (err) {
  console.error(`✗ ffmpeg failed: ${err.stderr?.toString().trim() || err.message}`)
  process.exit(1)
}

if (!fs.existsSync(OUTPUT)) {
  console.error('✗ Frame extraction produced no output — check the video file')
  process.exit(1)
}

const sizeKB = Math.round(fs.statSync(OUTPUT).size / 1024)
console.log(`✓ Saved: ${OUTPUT} (${sizeKB}KB)`)
console.log('Opening for inspection...\n')

try {
  execSync(`open "${OUTPUT}"`)
} catch {
  console.log(`Could not open automatically — view manually: ${OUTPUT}`)
}

console.log('Check for any platform watermarks in the bottom-right corner.')
console.log('If clean, proceed with: node scripts/youtube-post.js --video ...\n')
