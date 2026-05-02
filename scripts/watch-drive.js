require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT            = path.join(__dirname, '..')
const LOG_FILE        = path.join(ROOT, 'logs', 'watch-drive.log')
const STATE_FILE      = path.join(ROOT, 'logs', 'watch-drive-state.json')
const RESULTS_FILE    = path.join(ROOT, 'logs', 'distribute-results.json')
const OUTPUT_DIR      = path.join(ROOT, 'posts', 'output')
const TEMP_DIR        = path.join(os.homedir(), 'tmp', 'bsv-ready')

const REMOTE_READY  = 'big sole vibes:Big Sole Vibes/Ready to Post'
const REMOTE_POSTED = 'big sole vibes:Big Sole Vibes/Posted'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── State ────────────────────────────────────────────────────────────────────
// Tracks base names that have been fully distributed + moved to Posted/

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  catch { return { distributed: [] } }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Per-day failure tracking ─────────────────────────────────────────────────
// Stores which platforms failed so the next poll retries only those.

function failedFilePath(base) {
  return path.join(ROOT, 'logs', `${base}.failed.json`)
}

function loadFailed(base) {
  try { return JSON.parse(fs.readFileSync(failedFilePath(base), 'utf8')) }
  catch { return null }
}

function saveFailed(base, platforms) {
  fs.writeFileSync(failedFilePath(base), JSON.stringify({ platforms }, null, 2))
}

function clearFailed(base) {
  try { fs.unlinkSync(failedFilePath(base)) } catch {}
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function listDrive(remotePath) {
  try {
    const out = execSync(`rclone ls "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.trim().split('\n').filter(Boolean).map(line => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/)
      return match ? { size: parseInt(match[1]), name: match[2] } : null
    }).filter(Boolean)
  } catch {
    return []
  }
}

function downloadFile(remotePath, localDir) {
  try {
    execSync(`rclone copy "${remotePath}" "${localDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch (err) {
    log(`ERROR: rclone copy failed for ${remotePath}: ${err.stderr?.toString().trim() || err.message}`)
    return false
  }
}

function moveToPosted(filename, today) {
  const dest = `${REMOTE_POSTED}/${today}`
  try {
    execSync(`rclone move "${REMOTE_READY}/${filename}" "${dest}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    log(`  moved → ${dest}/${filename}`)
  } catch (err) {
    log(`  ERROR: failed to move ${filename}: ${err.stderr?.toString().trim() || err.message}`)
  }
}

// ─── Caption parsing ──────────────────────────────────────────────────────────
// Supports platform sections (## instagram / ## twitter / ## facebook)
// or plain text applied to all platforms.

function parseCaptions(content) {
  const platforms = ['instagram', 'twitter', 'facebook']
  const result = {}

  for (const p of platforms) {
    const re = new RegExp(`##\\s*${p}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i')
    const m = content.match(re)
    if (m) result[p] = m[1].trim()
  }

  if (Object.keys(result).length === 0) {
    // Strip optional leading # title line, use remainder as universal caption
    const text = content.replace(/^#[^\n]*\n/, '').trim()
    for (const p of platforms) result[p] = text
  }

  return result
}

// ─── File grouping ────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv'])

function groupFiles(files) {
  const groups = {}
  for (const file of files) {
    const ext      = path.extname(file.name).toLowerCase()
    const fullBase = path.basename(file.name, ext)
    // Strip -video / -image suffixes so day1-video.mp4 pairs with day1.md
    const base = fullBase.replace(/-(?:video|image)$/, '')
    if (!groups[base]) groups[base] = { media: null, caption: null }

    if (ext === '.md') {
      groups[base].caption = file
    } else if (IMAGE_EXTS.has(ext)) {
      groups[base].media = { ...file, type: 'image' }
    } else if (VIDEO_EXTS.has(ext)) {
      groups[base].media = { ...file, type: 'video' }
    }
  }
  return groups
}

// ─── Processing ───────────────────────────────────────────────────────────────

function clearOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) return
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    fs.rmSync(path.join(OUTPUT_DIR, f), { force: true })
  }
  log(`  cleared ${OUTPUT_DIR}`)
}

function processMedia(base, mediaFile, localPath) {
  if (mediaFile.type === 'image') {
    clearOutputDir()
    log(`  running resize-post.js`)
    execSync(`node "${path.join(__dirname, 'resize-post.js')}" "${localPath}"`, { stdio: 'inherit' })
  } else {
    const outFile = path.join(OUTPUT_DIR, `${base}-branded.mp4`)
    log(`  running brand-video.js → ${path.basename(outFile)}`)
    execSync(
      `node "${path.join(__dirname, 'brand-video.js')}" --video "${localPath}" --output "${outFile}"`,
      { stdio: 'inherit' }
    )
  }
}

function distribute(caption, platformsList) {
  const safe = caption.replace(/"/g, '\\"').replace(/\n/g, ' ')
  const platformsFlag = platformsList ? ` --platforms "${platformsList.join(',')}"` : ''
  const platformsNote = platformsList ? ` [retry: ${platformsList.join(',')}]` : ''
  log(`  running distribute.js — caption: "${safe.slice(0, 60)}${safe.length > 60 ? '…' : ''}"${platformsNote}`)
  execSync(
    `node "${path.join(__dirname, 'distribute.js')}" --caption "${safe}" --image-dir "${OUTPUT_DIR}"${platformsFlag}`,
    { stdio: 'inherit' }
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.mkdirSync(TEMP_DIR,   { recursive: true })

  // --reset: wipe distributed state for a clean run
  if (process.argv.includes('--reset')) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ distributed: [] }, null, 2))
    log('State reset — distributed list cleared')
  }

  log('━━━ poll start ━━━')

  const state        = loadState()
  const distributed  = new Set(state.distributed)
  const today        = new Date().toISOString().slice(0, 10)

  // Filter out supporting files that are not post assets
  const IGNORE = /(-(prompt|flow-prompt)\.txt|gemini-(weekly-brief|brief-week-\d{4}-\d{2})\.md)$/i
  const files = listDrive(REMOTE_READY).filter(f => !IGNORE.test(f.name))
  if (files.length === 0) {
    log('Ready to Post/ is empty — nothing to do')
    log('━━━ poll end ━━━\n')
    return
  }

  log(`${files.length} file(s) found: ${files.map(f => f.name).join(', ')}`)

  const groups = groupFiles(files)

  for (const [base, { media, caption }] of Object.entries(groups)) {
    if (distributed.has(base)) {
      log(`${base}: already distributed, skipping`)
      continue
    }

    log(`${base}: media=${media ? media.name : 'none'}, caption=${caption ? caption.name : 'none'}`)

    // Caption only — wait for matching media
    if (caption && !media) {
      log(`${base}: caption present, waiting for media`)
      continue
    }

    // Media only — process but don't distribute yet
    if (media && !caption) {
      log(`${base}: media present, no caption — processing media only`)
      if (!downloadFile(`${REMOTE_READY}/${media.name}`, TEMP_DIR)) continue
      const localPath = path.join(TEMP_DIR, media.name)
      try {
        processMedia(base, media, localPath)
        log(`${base}: media processed — waiting for caption to distribute`)
      } catch (err) {
        log(`${base}: ERROR during media processing: ${err.message}`)
      }
      continue
    }

    // Both media + caption — full pipeline
    if (media && caption) {
      // Check for previously failed platforms to limit this run to retries only
      const prevFailed = loadFailed(base)
      const retryPlatforms = prevFailed ? prevFailed.platforms : null
      if (retryPlatforms) {
        log(`${base}: retrying failed platforms: ${retryPlatforms.join(', ')}`)
      } else {
        log(`${base}: full pipeline starting`)
      }

      const ok1 = downloadFile(`${REMOTE_READY}/${media.name}`,   TEMP_DIR)
      const ok2 = downloadFile(`${REMOTE_READY}/${caption.name}`, TEMP_DIR)
      if (!ok1 || !ok2) { log(`${base}: download failed, skipping`); continue }

      const localMedia   = path.join(TEMP_DIR, media.name)
      const localCaption = path.join(TEMP_DIR, caption.name)

      try {
        processMedia(base, media, localMedia)
      } catch (err) {
        log(`${base}: ERROR during media processing: ${err.message}`)
        continue
      }

      const captionText = fs.readFileSync(localCaption, 'utf8')
      const captions    = parseCaptions(captionText)
      const caption_str = captions.instagram || captions.twitter || captions.facebook || ''

      if (!caption_str) {
        log(`${base}: WARNING — caption file is empty, skipping distribute`)
      } else {
        try {
          distribute(caption_str, retryPlatforms)
        } catch (err) {
          log(`${base}: ERROR during distribute: ${err.message}`)
          continue
        }
      }

      // Read per-platform results written by distribute.js
      let distResults = {}
      try { distResults = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) } catch {}
      const failedPlatforms = Object.entries(distResults)
        .filter(([, status]) => status === 'fail')
        .map(([platform]) => platform)

      if (failedPlatforms.length > 0) {
        log(`${base}: ${failedPlatforms.length} platform(s) failed — keeping in Ready to Post/ for retry: ${failedPlatforms.join(', ')}`)
        saveFailed(base, failedPlatforms)
        // Do NOT archive or mark distributed — next poll will retry only the failed platforms
      } else {
        clearFailed(base)
        // Move files to Posted/YYYY-MM-DD/
        log(`${base}: all platforms succeeded — moving to Posted/${today}/`)
        moveToPosted(media.name,   today)
        moveToPosted(caption.name, today)
        state.distributed.push(base)
        saveState(state)
        log(`${base}: ✓ complete`)
      }
    }
  }

  log('━━━ poll end ━━━\n')
})()
