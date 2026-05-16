const sharp = require('sharp')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const GDRIVE_REMOTE  = 'big sole vibes'
const GDRIVE_OUTPUTS = `${GDRIVE_REMOTE}:Big Sole Vibes/Posts/Output`

function copyToGDrive(localPath) {
  try {
    execSync(`rclone copy "${localPath}" "${GDRIVE_OUTPUTS}"`, { stdio: 'pipe' })
    console.log(`  → synced to Google Drive: ${GDRIVE_OUTPUTS}`)
  } catch (err) {
    console.warn(`  ⚠ Google Drive upload failed: ${err.stderr?.toString().trim() || err.message}`)
  }
}

const platforms = [
  { name: 'instagram', width: 1080, height: 1080 },
  { name: 'facebook', width: 1080, height: 1080 },
  { name: 'twitter', width: 1600, height: 900 },
  { name: 'youtube', width: 1600, height: 900, format: 'jpeg', quality: 95 },
  { name: 'tiktok', width: 1080, height: 1920 },
]

const desktopDir = '/Users/davidgeer/Desktop/bsv-posts'

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

const outputDir  = path.join(__dirname, '..', 'posts', 'output')
const publicDir  = path.join(__dirname, '..', 'public', 'posts', 'output')
fs.mkdirSync(outputDir,  { recursive: true })
fs.mkdirSync(publicDir,  { recursive: true })
fs.mkdirSync(desktopDir, { recursive: true })

const baseName = path.basename(inputPath, path.extname(inputPath))
  .replace(/['\u2018\u2019]/g, '')   // strip apostrophes (breaks Cloudflare CDN URL matching)
  .replace(/\s+/g, '_')              // spaces → underscores
  .replace(/[^a-zA-Z0-9_\-]/g, '_') // any remaining non-URL-safe chars → underscore
const ext = path.extname(inputPath).toLowerCase()

;(async () => {
  // MP4 input — skip image resizing, copy directly to youtube and tiktok slots
  if (ext === '.mp4') {
    for (const slot of ['youtube', 'tiktok']) {
      const fileName    = `${baseName}-${slot}.mp4`
      const outputPath  = path.join(outputDir,  fileName)
      const desktopPath = path.join(desktopDir, fileName)
      const publicPath  = path.join(publicDir,  fileName)
      fs.copyFileSync(inputPath, outputPath)
      fs.copyFileSync(inputPath, desktopPath)
      fs.copyFileSync(inputPath, publicPath)
      console.log(`${slot}: ${outputPath}`)
      copyToGDrive(outputPath)
    }
  } else {
    // Log input metadata so colorspace / bit-depth / channel issues are visible
    try {
      const meta = await sharp(inputPath).metadata()
      console.log(`input: ${meta.width}×${meta.height} ${meta.format} space=${meta.space} channels=${meta.channels} depth=${meta.depth} hasAlpha=${meta.hasAlpha}`)
    } catch (err) {
      console.error(`ERROR: could not read input metadata — ${err.message}`)
      process.exit(1)
    }

    for (const platform of targets) {
      const outExt = platform.format === 'jpeg' ? '.jpg' : ext
      const fileName = `${baseName}-${platform.name}${outExt}`
      const outputPath = path.join(outputDir, fileName)
      const desktopPath = path.join(desktopDir, fileName)

      try {
        let pipeline = sharp(inputPath)
          .toColorspace('srgb')
          .resize(platform.width, platform.height, { fit: 'cover', position: 'centre' })
        if (platform.format === 'jpeg') pipeline = pipeline.jpeg({ quality: platform.quality })
        await pipeline.toFile(outputPath)
      } catch (err) {
        const msg = err.message || ''
        if (/corrupt|bogus huffman|invalid image|unexpected end of data/i.test(msg)) {
          console.error(`[resize:err] CORRUPT FILE — ${path.basename(inputPath)} — re-download from Gemini`)
        } else {
          console.error(`ERROR [${platform.name}]: sharp failed — ${msg}`)
        }
        process.exit(1)
      }

      console.log(`${platform.name}: ${outputPath}`)
      copyToGDrive(outputPath)
    }

    // Brand all output images first, then copy branded versions to publicDir and desktopDir
    execSync(`node "${path.join(__dirname, 'brand-image.js')}" --dir "${outputDir}"`, { stdio: 'inherit' })

    for (const platform of targets) {
      const outExt = platform.format === 'jpeg' ? '.jpg' : ext
      const fileName = `${baseName}-${platform.name}${outExt}`
      const outputPath  = path.join(outputDir,  fileName)
      const publicPath  = path.join(publicDir,  fileName)
      const desktopPath = path.join(desktopDir, fileName)
      fs.copyFileSync(outputPath, publicPath)
      fs.copyFileSync(outputPath, desktopPath)
      console.log(`  → copied to ${publicPath}`)
      console.log(`  → copied to ${desktopPath}`)
    }
  }

  // Deploy to Cloudflare Pages — public/posts/output/ is served at /posts/output/
  const root = path.join(__dirname, '..')
  try {
    execSync('git add posts/output/ public/posts/output/', { cwd: root, stdio: 'pipe' })
    let changed = true
    try {
      execSync('git diff --cached --quiet posts/output/ public/posts/output/', { cwd: root, stdio: 'pipe' })
      changed = false
    } catch { /* non-zero exit = there are staged changes */ }

    if (!changed) {
      execSync('git reset HEAD -- posts/output/ public/posts/output/', { cwd: root, stdio: 'pipe' })
      console.log('\ngit: output unchanged — skipping commit')
    } else {
      execSync('git commit -m "auto: add post output"', { cwd: root, stdio: 'pipe' })
      require('./git-push-guard').safePushToPreview(root, console.log)
    }
  } catch (err) {
    console.warn(`⚠ git deploy failed: ${err.message}`)
  }
})()
