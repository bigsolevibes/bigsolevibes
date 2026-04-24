const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const platforms = [
  { name: 'instagram', width: 1080, height: 1080 },
  { name: 'facebook', width: 1080, height: 1080 },
  { name: 'twitter', width: 1600, height: 900 },
  { name: 'youtube', width: 1280, height: 720, format: 'jpeg', quality: 90 },
  { name: 'tiktok', width: 1080, height: 1920 },
]

const args = process.argv.slice(2)
const inputPath = args[0]
if (!inputPath) {
  console.error('Usage: node scripts/resize-post.js /path/to/image.png [--platform <name>]')
  process.exit(1)
}

const platformFlagIndex = args.indexOf('--platform')
const platformFilter = platformFlagIndex !== -1 ? args[platformFlagIndex + 1] : null

if (platformFilter && !platforms.find(p => p.name === platformFilter)) {
  console.error(`Unknown platform: ${platformFilter}`)
  console.error(`Available: ${platforms.map(p => p.name).join(', ')}`)
  process.exit(1)
}

const targets = platformFilter ? platforms.filter(p => p.name === platformFilter) : platforms

const outputDir = path.join(__dirname, '..', 'posts', 'output')
fs.mkdirSync(outputDir, { recursive: true })

const baseName = path.basename(inputPath, path.extname(inputPath))
const ext = path.extname(inputPath) || '.png'

;(async () => {
  for (const platform of targets) {
    const outExt = platform.format === 'jpeg' ? '.jpg' : ext
    const outputPath = path.join(outputDir, `${baseName}-${platform.name}${outExt}`)
    let pipeline = sharp(inputPath)
      .resize(platform.width, platform.height, { fit: 'cover', position: 'centre' })
    if (platform.format === 'jpeg') pipeline = pipeline.jpeg({ quality: platform.quality })
    await pipeline.toFile(outputPath)
    console.log(`${platform.name}: ${outputPath}`)
  }
})()
