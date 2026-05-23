const sharp = require('sharp')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'resize-post.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {}
}

const GDRIVE_REMOTE  = 'big sole vibes'
const GDRIVE_OUTPUTS = `${GDRIVE_REMOTE}:Big Sole Vibes/Posts/Output`

function waitForFile(filePath, retries = 3, intervalMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const stat = fs.statSync(filePath)
      if (stat.size > 0) return true
    } catch {}
    if (i < retries - 1) {
      const deadline = Date.now() + intervalMs
      while (Date.now() < deadline) {} // sync busy-wait — keeps this outside async context
    }
  }
  return false
}

function copyToGDrive(localPath) {
  if (!waitForFile(localPath)) {
    log(`  ERROR: upload skipped — ${path.basename(localPath)} missing or empty after 3 checks`)
    return
  }
  try {
    execSync(`rclone copy "${localPath}" "${GDRIVE_OUTPUTS}"`, { stdio: 'pipe' })
    log(`  → synced to Google Drive: ${GDRIVE_OUTPUTS}`)
  } catch (err) {
    log(`  ⚠ Google Drive upload failed: ${err.stderr?.toString().trim() || err.message}`)
  }
}

const platforms = [
  { name: 'instagram', width: 1080, height: 1080 },
  { name: 'youtube', width: 1600, height: 900, format: 'jpeg', quality: 95 },
  // facebook, twitter, tiktok omitted — paused or no API access
]

const desktopDir = '/Users/davidgeer/Desktop/bsv-posts'

const args = process.argv.slice(2)
const inputPath = args[0]
if (!inputPath) {
  log('ERROR: no input file — Usage: node scripts/resize-post.js /path/to/image.png [--platform <name>]')
  process.exit(1)
}

const platformFlagIndex = args.indexOf('--platform')
const platformFilter = platformFlagIndex !== -1 ? args[platformFlagIndex + 1] : null

if (platformFilter && !platforms.find(p => p.name === platformFilter)) {
  log(`ERROR: unknown platform: ${platformFilter}. Available: ${platforms.map(p => p.name).join(', ')}`)
  process.exit(1)
}

const targets = platformFilter ? platforms.filter(p => p.name === platformFilter) : platforms

const outputDir  = path.join(ROOT, 'posts', 'output')
const publicDir  = path.join(ROOT, 'public', 'posts', 'output')
fs.mkdirSync(outputDir,  { recursive: true })
fs.mkdirSync(publicDir,  { recursive: true })
fs.mkdirSync(desktopDir, { recursive: true })

const baseName = path.basename(inputPath, path.extname(inputPath))
  .replace(/['‘’]/g, '')   // strip apostrophes (breaks Cloudflare CDN URL matching)
  .replace(/\s+/g, '_')              // spaces → underscores
  .replace(/[^a-zA-Z0-9_\-]/g, '_') // any remaining non-URL-safe chars → underscore
const ext = path.extname(inputPath).toLowerCase()

;(async () => {
  const startTime = new Date().toISOString()
  log(`START input=${path.basename(inputPath)} type=${ext === '.mp4' ? 'video' : 'image'} platforms=${targets.map(p => p.name).join(',')}`)

  // MP4 input — skip image resizing, copy directly to youtube slot
  if (ext === '.mp4') {
    for (const slot of ['youtube']) {
      const fileName    = `${baseName}-${slot}.mp4`
      const outputPath  = path.join(outputDir,  fileName)
      const desktopPath = path.join(desktopDir, fileName)
      const publicPath  = path.join(publicDir,  fileName)
      fs.copyFileSync(inputPath, outputPath)
      fs.copyFileSync(inputPath, desktopPath)
      fs.copyFileSync(inputPath, publicPath)
      log(`${slot}: ${outputPath}`)
      copyToGDrive(outputPath)
    }
  } else {
    // Log input metadata so colorspace / bit-depth / channel issues are visible
    try {
      const meta = await sharp(inputPath).metadata()
      log(`input: ${meta.width}×${meta.height} ${meta.format} space=${meta.space} channels=${meta.channels} depth=${meta.depth} hasAlpha=${meta.hasAlpha}`)
    } catch (err) {
      log(`ERROR: could not read input metadata — ${err.message}`)
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
          log(`ERROR [${platform.name}]: CORRUPT FILE — ${path.basename(inputPath)} — re-download from Gemini`)
        } else {
          log(`ERROR [${platform.name}]: sharp failed — ${msg}`)
        }
        process.exit(1)
      }

      log(`${platform.name}: ${outputPath}`)
    }

    // Brand all output images first, then copy branded versions to publicDir and desktopDir
    log('running brand-image.js...')
    execSync(`node "${path.join(__dirname, 'brand-image.js')}" --dir "${outputDir}"`, { stdio: 'inherit' })
    log('brand-image.js done')

    for (const platform of targets) {
      const outExt = platform.format === 'jpeg' ? '.jpg' : ext
      const fileName = `${baseName}-${platform.name}${outExt}`
      const outputPath  = path.join(outputDir,  fileName)
      const publicPath  = path.join(publicDir,  fileName)
      const desktopPath = path.join(desktopDir, fileName)
      fs.copyFileSync(outputPath, publicPath)
      fs.copyFileSync(outputPath, desktopPath)
      // Upload branded file to Drive — existence check inside copyToGDrive
      copyToGDrive(outputPath)
    }
    log(`copied ${targets.length} variant(s) to public/ and Desktop`)
  }

  // Deploy to Cloudflare Pages — public/posts/output/ is served at /posts/output/
  try {
    execSync('git add posts/output/ public/posts/output/', { cwd: ROOT, stdio: 'pipe' })
    let changed = true
    try {
      execSync('git diff --cached --quiet posts/output/ public/posts/output/', { cwd: ROOT, stdio: 'pipe' })
      changed = false
    } catch { /* non-zero exit = there are staged changes */ }

    if (!changed) {
      execSync('git reset HEAD -- posts/output/ public/posts/output/', { cwd: ROOT, stdio: 'pipe' })
      log('git: output unchanged — skipping commit')
    } else {
      execSync('git commit -m "auto: add post output [skip cf-pages]"', { cwd: ROOT, stdio: 'pipe' })
      require('./git-push-guard').safePushToPipeline(ROOT, log)
      log('git: committed and pushed post output')
    }
  } catch (err) {
    log(`ERROR: git deploy failed — ${err.message}`)
  }

  log(`END input=${path.basename(inputPath)}`)
})()
