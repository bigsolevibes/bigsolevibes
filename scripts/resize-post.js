const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const platforms = [
  { name: 'instagram', width: 1080, height: 1080 },
  { name: 'facebook', width: 1080, height: 1080 },
  { name: 'twitter', width: 1600, height: 900 },
  { name: 'youtube', width: 1280, height: 720 },
  { name: 'tiktok', width: 1080, height: 1920 },
]

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node scripts/resize-post.js /path/to/image.png')
  process.exit(1)
}

const outputDir = path.join(__dirname, '..', 'posts', 'output')
fs.mkdirSync(outputDir, { recursive: true })

const baseName = path.basename(inputPath, path.extname(inputPath))
const ext = path.extname(inputPath) || '.png'

;(async () => {
  for (const platform of platforms) {
    const outputPath = path.join(outputDir, `${baseName}-${platform.name}${ext}`)
    await sharp(inputPath)
      .resize(platform.width, platform.height, { fit: 'cover', position: 'centre' })
      .toFile(outputPath)
    console.log(`${platform.name}: ${outputPath}`)
  }
})()
