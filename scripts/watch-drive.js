require('dotenv').config()
const { execSync, spawnSync } = require('child_process')
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
// Per-slug, per-platform tracking:
//   { "day2": { "bluesky": "success", "instagram": "success", "youtube": "pending" } }
// Paused platforms are never written. Archive only when all entries are "success".

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    // Migrate old { distributed: [...] } format
    if (Array.isArray(raw.distributed)) {
      const migrated = {}
      for (const slug of raw.distributed) migrated[slug] = { _migrated: 'success' }
      return migrated
    }
    return raw
  } catch { return {} }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// True when every recorded platform for this slug is 'success'.
// Keys starting with _ are internal sentinels and are ignored.
function isComplete(slugState) {
  if (!slugState) return false
  const platformEntries = Object.entries(slugState).filter(([k]) => !k.startsWith('_'))
  if (platformEntries.length === 0) return false
  return platformEntries.every(([, v]) => v === 'success')
}

// Platform names recorded as 'pending' for this slug.
function pendingPlatforms(slugState) {
  if (!slugState) return []
  return Object.entries(slugState).filter(([k, v]) => !k.startsWith('_') && v === 'pending').map(([k]) => k)
}

// Merge distribute-results.json into state for this slug.
// 'ok' / 'skip' → 'success'  |  'fail' → 'pending'  |  'pause' → omitted.
function mergeResults(state, base, distResults) {
  if (!state[base]) state[base] = {}
  for (const [platform, status] of Object.entries(distResults)) {
    if (status === 'pause') continue
    state[base][platform] = (status === 'ok' || status === 'skip') ? 'success' : 'pending'
  }
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function listDrive(remotePath) {
  try {
    // --max-depth 1 prevents rclone from recursing into subdirectories,
    // which would cause files to appear twice if Posted/ date folders exist.
    const out = execSync(`rclone ls --max-depth 1 "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
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

// ─── Caption header fields ────────────────────────────────────────────────────
// Both fields live in the top of each .md file, one per line, before the # title.
// They work per-slug — each caption file is read independently, so day2a and day2b
// can have different post_time and platform values with no interference.

// "post_time: HH:MM" — hold distribution until local time reaches this value.
function parsePostTime(content) {
  const m = content.match(/^post_time:\s*(\d{1,2}):(\d{2})/m)
  if (!m) return { postTime: null, ready: true }
  const postTime = `${m[1].padStart(2, '0')}:${m[2]}`
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const scheduledMins = parseInt(m[1]) * 60 + parseInt(m[2])
  return { postTime, ready: nowMins >= scheduledMins }
}

// "platform: <name>" — restrict this slug to a single platform.
// Returns ['<name>'] when present, null when absent (post to all active platforms).
function parsePlatformField(content) {
  const m = content.match(/^platform:\s*(\S+)/m)
  return m ? [m[1].trim().toLowerCase()] : null
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

function runCaptured(label, cmd) {
  // Run a child process and pipe both stdout and stderr through log() so all
  // output lands in watch-drive.log where eng-bot can see it.
  const result = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' })
  for (const line of (result.stdout || '').split('\n').filter(Boolean)) log(`  [${label}] ${line}`)
  for (const line of (result.stderr || '').split('\n').filter(Boolean)) log(`  [${label}:err] ${line}`)
  if (result.status !== 0) throw new Error(`${label} exited ${result.status}`)
}

function processMedia(base, mediaFile, localPath) {
  if (mediaFile.type === 'image') {
    clearOutputDir()
    log(`  running resize-post.js`)
    runCaptured('resize', `node "${path.join(__dirname, 'resize-post.js')}" "${localPath}"`)
  } else {
    const outFile = path.join(OUTPUT_DIR, `${base}-branded.mp4`)
    log(`  running brand-video.js → ${path.basename(outFile)}`)
    runCaptured('brand-video', `node "${path.join(__dirname, 'brand-video.js')}" --video "${localPath}" --output "${outFile}"`)
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

// ─── Timing ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15 * 60 * 1000  // 15 minutes between polls
const CRASH_RESTART_MS = 30 * 1000       // 30-second delay after a crash

// ─── Startup (runs once at process launch) ────────────────────────────────────

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
fs.mkdirSync(OUTPUT_DIR, { recursive: true })
fs.mkdirSync(TEMP_DIR,   { recursive: true })

if (process.argv.includes('--reset')) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({}, null, 2))
  log('State reset — all slug state cleared')
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

function run() {
  log('━━━ poll start ━━━')

  const state = loadState()
  const today = new Date().toISOString().slice(0, 10)

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
    if (isComplete(state[base])) {
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

      // Scheduling gate — only distribute at or after post_time.
      // Uses _hold_since to detect cross-day stale holds: if today's UTC date is
      // after the date this slug was first held, post_time is overdue — fire immediately.
      const { postTime, ready } = parsePostTime(captionText)
      if (!ready) {
        if (!state[base]) state[base] = {}
        const holdSince = state[base]._hold_since
        if (holdSince && holdSince < today) {
          log(`⏰ ${base}: post_time ${postTime} is overdue (held since ${holdSince}) — firing immediately`)
          // fall through to distribution
        } else {
          if (!holdSince) {
            state[base]._hold_since = today
            saveState(state)
          }
          const now = new Date()
          const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          log(`⏰ ${base}: scheduled for ${postTime} — current time ${currentTime}, waiting`)
          continue
        }
      } else if (state[base] && state[base]._hold_since) {
        // post_time reached normally — clear the hold sentinel
        delete state[base]._hold_since
      }

      const captions    = parseCaptions(captionText)
      const caption_str = captions.instagram || captions.twitter || captions.facebook || ''

      if (!caption_str) {
        log(`${base}: WARNING — caption file is empty, skipping`)
        continue
      }

      // Determine which platforms to attempt:
      //   caption-level "platform:" field locks this slug to one platform forever.
      //   Retry state (pending platforms) takes over on subsequent polls.
      //   null → all active platforms (first run, no platform field).
      const captionPlatforms = parsePlatformField(captionText)
      const pending          = pendingPlatforms(state[base])
      const retryPlatforms   = pending.length > 0 ? pending : null
      const effectivePlatforms = captionPlatforms || retryPlatforms

      if (captionPlatforms) {
        log(`${base}: platform lock — ${captionPlatforms[0]} only`)
      } else if (retryPlatforms) {
        log(`${base}: retrying pending platforms: ${retryPlatforms.join(', ')}`)
      } else {
        log(`${base}: full pipeline starting`)
      }

      try {
        distribute(caption_str, effectivePlatforms)
      } catch (err) {
        log(`${base}: ERROR during distribute: ${err.message}`)
        continue
      }

      // Merge distribute-results.json into per-platform state.
      // 'pause' entries are dropped. 'fail' → 'pending'. 'ok'/'skip' → 'success'.
      // If RESULTS_FILE is missing or empty, mark an internal sentinel as pending
      // so the slug is never silently archived.
      let distResults = null
      try { distResults = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) } catch {}

      if (!distResults || Object.keys(distResults).length === 0) {
        log(`${base}: WARNING — no distribute results found, not archiving`)
        if (!state[base]) state[base] = {}
        state[base]['_unknown'] = 'pending'
        saveState(state)
        continue
      }

      mergeResults(state, base, distResults)
      saveState(state)

      if (isComplete(state[base])) {
        log(`${base}: all active platforms succeeded — moving to Posted/${today}/`)
        moveToPosted(media.name,   today)
        moveToPosted(caption.name, today)
        log(`${base}: ✓ complete`)
      } else {
        const stillPending = pendingPlatforms(state[base])
        log(`${base}: ${stillPending.length} platform(s) pending — retry on next poll: ${stillPending.join(', ')}`)
      }
    }
  }

  log('━━━ poll end ━━━\n')

  // Run eng-bot after every poll so it catches errors while the log is fresh.
  // Inherits env so ANTHROPIC_API_KEY and ZOHO_SMTP_* are available.
  spawnSync(process.execPath, [path.join(__dirname, 'eng-bot.js')], {
    cwd:   ROOT,
    env:   process.env,
    stdio: 'inherit',
  })
}

// ─── Loop (crash guard + interval) ───────────────────────────────────────────
// launchd KeepAlive restarts the whole process if Node exits.
// This inner loop catches poll-level errors and retries after 30s without
// taking down the process, so transient failures don't interrupt the schedule.

function schedulePoll(delayMs) {
  setTimeout(function () {
    try {
      run()
    } catch (err) {
      log(`CRASH: unhandled error in poll — ${err.stack || err.message}`)
      log(`CRASH: restarting poll in ${CRASH_RESTART_MS / 1000}s`)
      schedulePoll(CRASH_RESTART_MS)
      return
    }
    schedulePoll(POLL_INTERVAL_MS)
  }, delayMs)
}

schedulePoll(0)  // first poll fires immediately on process start
