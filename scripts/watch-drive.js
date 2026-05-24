require('dotenv').config()
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { connect, ensureHeaders, readAllRows } = require('./sheets-client')
const { sendTelegram } = require('./telegram')
const { addPendingItem } = require('./telegram-queue')

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT            = path.join(__dirname, '..')
const LOG_FILE        = path.join(ROOT, 'logs', 'watch-drive.log')
const STATE_FILE      = path.join(ROOT, 'logs', 'watch-drive-state.json')
const RESULTS_FILE    = path.join(ROOT, 'logs', 'distribute-results.json')
const POST_STATE_FILE = path.join(ROOT, 'logs', 'post-state.json')
const OUTPUT_DIR      = path.join(ROOT, 'posts', 'output')
const TEMP_DIR        = path.join(os.homedir(), 'tmp', 'bsv-ready')

const REMOTE_READY          = 'big sole vibes:Big Sole Vibes/Ready to Post'
const REMOTE_POSTED         = 'big sole vibes:Big Sole Vibes/Posted'
const APPROVED_SLOTS_FILE   = path.join(ROOT, 'logs', 'approved-slots.json')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── State ────────────────────────────────────────────────────────────────────
// watch-drive-state.json — per-slug scheduling (_hold_since) + per-platform outcomes.
// Platform statuses: pending | success | failed | exhausted | skipped

const ACTIVE_PLATFORMS  = ['instagram', 'bluesky']
const SKIPPED_PLATFORMS = ['tiktok', 'youtube', 'twitter', 'facebook']
const MAX_ATTEMPTS      = 3

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (Array.isArray(raw.distributed)) return {}  // legacy array format
    // Detect old string-value format (pre-per-platform-object model) — discard
    for (const val of Object.values(raw)) {
      if (val && typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          if (!k.startsWith('_') && typeof v === 'string') return {}
        }
      }
    }
    return raw
  } catch { return {} }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function loadApprovedSlots() {
  try { return JSON.parse(fs.readFileSync(APPROVED_SLOTS_FILE, 'utf8')) } catch { return {} }
}

// Initialize a slot's platform entries. Idempotent — never overwrites existing entries.
function initSlotPlatforms(state, base) {
  if (!state[base]) state[base] = {}
  for (const p of ACTIVE_PLATFORMS) {
    if (!state[base][p]) state[base][p] = { status: 'pending', attempts: 0 }
  }
  for (const p of SKIPPED_PLATFORMS) {
    if (!state[base][p]) state[base][p] = { status: 'skipped', attempts: 0 }
  }
}

// Returns platforms to attempt this cycle — always an explicit list, never null.
// Includes: pending platforms, and failed platforms still under MAX_ATTEMPTS.
function platformsToAttempt(platformMap) {
  return ACTIVE_PLATFORMS.filter(p => {
    const e = platformMap[p]
    if (!e) return false
    if (e.status === 'pending') return true
    if (e.status === 'failed' && e.attempts < MAX_ATTEMPTS) return true
    return false
  })
}

// All active platforms are success or exhausted — slot is done.
function isSlotDone(platformMap) {
  return ACTIVE_PLATFORMS.every(p => {
    const e = platformMap[p]
    return e && (e.status === 'success' || e.status === 'exhausted')
  })
}

// Apply distribute-results to state. Never downgrades a success.
function applyDistResults(state, base, distResults) {
  const now = new Date().toISOString()
  for (const [platform, outcome] of Object.entries(distResults)) {
    const e = state[base][platform]
    if (!e || e.status === 'success') continue  // unknown or already won — leave it
    if (outcome === 'ok' || outcome === 'skip') {
      state[base][platform] = { status: 'success', attempts: e.attempts + 1, timestamp: now }
    } else if (outcome === 'pause') {
      state[base][platform] = { status: 'skipped', attempts: e.attempts }
    } else {
      const attempts = e.attempts + 1
      state[base][platform] = {
        status: attempts >= MAX_ATTEMPTS ? 'exhausted' : 'failed',
        attempts,
        timestamp: now,
      }
    }
  }
}

// Mark a set of platforms as failed (used when distribute crashes before writing results).
function markAttemptedFailed(state, base, platforms) {
  const now = new Date().toISOString()
  for (const p of platforms) {
    const e = state[base][p]
    if (!e || e.status === 'success') continue
    const attempts = e.attempts + 1
    state[base][p] = { status: attempts >= MAX_ATTEMPTS ? 'exhausted' : 'failed', attempts, timestamp: now }
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

// Returns today's date as a local YYYY-MM-DD string (not UTC).
// Using toISOString() would return the UTC date, which flips 5–7 hours before
// local midnight in US timezones and causes _hold_since comparisons to misfire.
function localDateString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

// Removes leading key: value metadata lines (post_time, platform, etc.)
// and any blank lines before the caption body begins.
function stripHeader(content) {
  return content
    .replace(/^(?:[\w][\w-]*:[^\n]*\n)+/, '')  // strip leading key:value lines
    .replace(/^---[ \t]*\n/, '')                // strip optional --- separator
    .replace(/^\n+/, '')                        // strip leading blank lines
}

function parseCaptions(content) {
  const body = stripHeader(content)
  const platforms = ['instagram', 'twitter', 'facebook']
  const result = {}

  for (const p of platforms) {
    const re = new RegExp(`##\\s*${p}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i')
    const m = body.match(re)
    if (m) result[p] = m[1].trim()
  }

  if (Object.keys(result).length === 0) {
    // Strip optional leading # title line, use remainder as universal caption
    const text = body.replace(/^#[^\n]*\n/, '').trim()
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
      if (groups[base].caption) {
        const existing = groups[base].caption
        const keep = file.size >= existing.size ? file : existing
        const drop = file.size >= existing.size ? existing : file
        log(`WARNING: duplicate caption for ${base} — keeping ${keep.name} (${keep.size} bytes), ignoring ${drop.name} (${drop.size} bytes)`)
        groups[base].caption = keep
      } else {
        groups[base].caption = file
      }
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

function distribute(caption, platformsList, slot) {
  const platformsNote = platformsList ? ` [${platformsList.join(',')}]` : ''
  log(`  running distribute.js — caption: "${caption.slice(0, 60)}${caption.length > 60 ? '…' : ''}"${platformsNote}`)
  const spawnArgs = [
    path.join(__dirname, 'distribute.js'),
    '--caption', caption,
    '--image-dir', OUTPUT_DIR,
  ]
  if (platformsList) spawnArgs.push('--platforms', platformsList.join(','))
  if (slot) spawnArgs.push('--slot', slot)
  const result = spawnSync(process.execPath, spawnArgs, {
    stdio:    ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    env:      process.env,
  })
  const output = (result.stdout || '') + (result.stderr || '')
  for (const line of output.split('\n').filter(Boolean)) log(`  [distribute] ${line}`)
  if (result.status !== 0) throw new Error(`distribute.js exited with code ${result.status}`)
  return output
}

// Extract the most relevant error line from captured distribute output for a given platform.
function extractLastError(output, platform) {
  const lines = output.split('\n').filter(Boolean)
  const ll = lines.map(l => l.toLowerCase())
  // Prefer lines mentioning the platform + an error/fail keyword
  const specific = lines.filter((l, i) =>
    ll[i].includes(platform) && (ll[i].includes('error') || ll[i].includes('fail'))
  )
  if (specific.length) return specific[specific.length - 1].trim().slice(0, 160)
  // Fall back to any error/fail line
  const generic = lines.filter((_, i) => ll[i].includes('error') || ll[i].includes('fail'))
  if (generic.length) return generic[generic.length - 1].trim().slice(0, 160)
  return 'no error detail captured'
}

// ─── Post cleanup ─────────────────────────────────────────────────────────────

// Move all Drive files for a given slot base to Posted/YYYY-MM-DD/.
// Covers: {base}.png, {base}-flow.png, {base}.md, {base}-prompt.txt,
//         {base}-flow-prompt.txt, {base}-video.mp4, {base}-image.jpg, etc.
// Also deletes matching local copies from TEMP_DIR.
function archiveSlot(base, allDriveFiles, today) {
  const dest = `${REMOTE_POSTED}/${today}`
  const pattern = new RegExp(`^${base}(?:-flow|-video|-image|-prompt|-flow-prompt)?(?:\\.[a-z0-9]+)?$`, 'i')
  const matching = allDriveFiles.filter(f => {
    // strip extension for matching
    const noExt = f.name.replace(/\.[^.]+$/, '')
    return pattern.test(noExt)
  })
  for (const file of matching) {
    try {
      execSync(`rclone move "${REMOTE_READY}/${file.name}" "${dest}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      log(`  moved → ${dest}/${file.name}`)
    } catch (err) {
      log(`  ERROR: failed to move ${file.name}: ${err.stderr?.toString().trim() || err.message}`)
    }
    // Delete local copy if present
    const local = path.join(TEMP_DIR, file.name)
    if (fs.existsSync(local)) {
      try { fs.rmSync(local) } catch {}
    }
  }
}

// ─── Shop sync ────────────────────────────────────────────────────────────────
// Tracks the approved ASIN set between polls. null = not yet initialized.
// sync-shop.js fires on any change to the approved set (additions OR removals).

let prevApprovedAsins = null

async function checkAndSyncShop() {
  try {
    const conn = await connect()
    await ensureHeaders(conn)
    const rows = await readAllRows(conn)
    const currentApproved = new Set(
      rows.filter(r => (r['Status'] || '').trim().toLowerCase() === 'approved')
          .map(r => r['ASIN'])
          .filter(Boolean)
    )

    if (prevApprovedAsins === null) {
      // First poll — establish baseline, don't trigger deploy
      prevApprovedAsins = currentApproved
      log(`Shop sync: baseline set — ${currentApproved.size} approved product(s)`)
      return
    }

    const newApprovals  = [...currentApproved].filter(a => !prevApprovedAsins.has(a))
    const newRejections = [...prevApprovedAsins].filter(a => !currentApproved.has(a))
    prevApprovedAsins = currentApproved

    if (newApprovals.length === 0 && newRejections.length === 0) return

    if (newApprovals.length)  log(`Shop sync: ${newApprovals.length} new approval(s) — ${newApprovals.join(', ')}`)
    if (newRejections.length) log(`Shop sync: ${newRejections.length} rejection(s) detected — removing from shelf (${newRejections.join(', ')})`)

    log('Shop sync: running sync-shop.js')
    spawnSync(process.execPath, [path.join(__dirname, 'sync-shop.js')], {
      cwd:   ROOT,
      env:   process.env,
      stdio: 'inherit',
    })
  } catch (err) {
    log(`Shop sync: WARNING — could not check sheet: ${err.message}`)
  }
}

// ─── Startup (runs once at process launch) ────────────────────────────────────

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
fs.mkdirSync(OUTPUT_DIR, { recursive: true })
fs.mkdirSync(TEMP_DIR,   { recursive: true })

if (process.argv.includes('--reset')) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({}, null, 2))
  if (fs.existsSync(POST_STATE_FILE)) fs.writeFileSync(POST_STATE_FILE, JSON.stringify({}, null, 2))
  log('State reset — watch-drive-state.json cleared')
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function run() {
  log('━━━ poll start ━━━')

  const state = loadState()
  const today = localDateString()

  // Fetch raw list for archiving, then filter to post assets for grouping
  const IGNORE = /(-(prompt|flow-prompt)\.txt|gemini-(weekly-brief|brief-week-\d{4}-\d{2})\.md)$/i
  const allDriveFiles = listDrive(REMOTE_READY)
  const files = allDriveFiles.filter(f => !IGNORE.test(f.name))
  if (files.length === 0) {
    log('Ready to Post/ is empty — nothing to do')
    log('━━━ poll end ━━━\n')
    return
  }

  log(`${files.length} file(s) found: ${files.map(f => f.name).join(', ')}`)

  const groups = groupFiles(files)

  for (const [base, { media, caption }] of Object.entries(groups)) {
    initSlotPlatforms(state, base)

    if (isSlotDone(state[base])) {
      log(`${base}: already posted — skipping`)
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
      // Track how long caption has been missing — alert if post window is likely missed
      if (!state[base]._media_since) {
        state[base]._media_since = new Date().toISOString()
        saveState(state)
      }
      const hoursWaiting = (Date.now() - new Date(state[base]._media_since).getTime()) / (1000 * 60 * 60)
      if (hoursWaiting >= 3 && !state[base]._media_alerted) {
        const h = Math.round(hoursWaiting)
        log(`⚠️ ${base}: media ready for ${h}h with no caption — post window likely missed`)
        sendTelegram(`⚠️ BSV — ${base} has media ready but no caption for ${h}h. Caption file missing from Drive. Post window likely missed.`)
          .then(r => {
            if (r?.message_id) log(`Telegram missed-caption alert delivered — message_id: ${r.message_id}`)
            else log('WARNING: Telegram missed-caption alert returned no confirmation')
          })
        const finding = `[${new Date().toISOString()}] MISSED POST — ${base}: media ready for ${h}h, caption never arrived in Drive. Post window likely missed.\n`
        try { fs.appendFileSync(path.join(ROOT, 'logs', 'handoff-findings.md'), finding) } catch {}
        state[base]._media_alerted = true
        saveState(state)
      } else {
        log(`${base}: media present${hoursWaiting >= 1 ? ` for ${hoursWaiting.toFixed(1)}h` : ''}, no caption — processing media only`)
      }
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

      // Scheduling gate — hold every new slot for at least one full poll cycle before
      // distributing. This prevents the timezone race where the pipeline runs at ~10 PM
      // local time and sees post_time 09:00 as already passed, firing immediately with
      // whatever media happened to be in Drive at that moment (possibly stale/wrong image).
      // On first encounter: always hold regardless of ready state.
      // On subsequent encounters: fire if ready=true, or if held since a prior day (overdue).
      const { postTime, ready } = parsePostTime(captionText)
      if (!state[base]) state[base] = {}
      const holdSince = state[base]._hold_since

      if (!holdSince) {
        // First time we've seen this slot — hold for at least one cycle
        state[base]._hold_since = today
        saveState(state)
        const now = new Date()
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        log(`⏰ ${base}: first seen — holding until post_time ${postTime} confirmed on next poll (current time ${currentTime})`)
        continue
      } else if (holdSince < today) {
        // Held since a prior day and still not posted — overdue, fire immediately
        log(`⏰ ${base}: post_time ${postTime} is overdue (held since ${holdSince}) — firing immediately`)
        delete state[base]._hold_since
        // fall through to distribution
      } else if (!ready) {
        // Held today but post_time not yet reached — keep waiting
        const now = new Date()
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        log(`⏰ ${base}: scheduled for ${postTime} — current time ${currentTime}, waiting`)
        continue
      } else {
        // ready=true and held at least one cycle — clear sentinel and fire
        delete state[base]._hold_since
      }

      // Content approval gate — nothing distributes without Big D's explicit approval
      const approvedSlots = loadApprovedSlots()
      if (!approvedSlots[base]) {
        if (!state[base]._approval_requested) {
          const preview = captionText.slice(0, 200).replace(/[_*`[\]]/g, '').trim()
          sendTelegram(
            `🔒 *CONTENT GATE — REVIEW REQUIRED*\n*Slot:* \`${base}\`\n*Caption:*\n${preview}\n\nReply \`approve\` or \`deny\` to release or hold this slot.`
          ).catch(() => {})
          addPendingItem({ type: 'content-gate', id: `content-gate-${base}`, metadata: { slot: base } })
          state[base]._approval_requested = true
          saveState(state)
          log(`${base}: content gate — held, approval requested via Telegram`)
        } else {
          log(`${base}: content gate — awaiting Big D approval`)
        }
        continue
      }

      const captions    = parseCaptions(captionText)
      const caption_str = captions.instagram || captions.twitter || captions.facebook || ''

      if (!caption_str) {
        log(`${base}: WARNING — caption file is empty, skipping`)
        continue
      }

      // Compute platforms to attempt — always an explicit list.
      // A caption-level "platform:" field further narrows the list to one platform.
      const captionPlatforms  = parsePlatformField(captionText)
      let effectivePlatforms  = platformsToAttempt(state[base])

      if (captionPlatforms) {
        effectivePlatforms = effectivePlatforms.filter(p => captionPlatforms.includes(p))
        if (effectivePlatforms.length === 0) {
          log(`${base}: platform lock (${captionPlatforms[0]}) already done — skipping`)
          continue
        }
        log(`${base}: platform lock — ${captionPlatforms[0]} only`)
      } else if (effectivePlatforms.length === 0) {
        log(`${base}: no platforms to attempt — skipping`)
        continue
      } else {
        const fresh    = effectivePlatforms.filter(p => state[base][p]?.status === 'pending')
        const retrying = effectivePlatforms.filter(p => state[base][p]?.status === 'failed')
        const parts    = []
        if (fresh.length)    parts.push(`first attempt: ${fresh.join(', ')}`)
        if (retrying.length) {
          const maxAttempt = Math.max(...retrying.map(p => state[base][p].attempts)) + 1
          parts.push(`retry ${maxAttempt}/${MAX_ATTEMPTS}: ${retrying.join(', ')}`)
        }
        log(`${base}: ${parts.join(' | ')}`)
      }

      // Snapshot which platforms are already exhausted before this distribute run.
      // Used to detect transitions to exhausted that happen in this cycle.
      const preExhausted = new Set(ACTIVE_PLATFORMS.filter(p => state[base][p]?.status === 'exhausted'))

      let distributeOutput = ''
      try {
        distributeOutput = distribute(caption_str, effectivePlatforms, base)
      } catch (err) {
        log(`${base}: ERROR during distribute: ${err.message}`)
        markAttemptedFailed(state, base, effectivePlatforms)
        saveState(state)
        for (const p of effectivePlatforms) {
          if (state[base][p]?.status === 'exhausted' && !preExhausted.has(p)) {
            const errSummary = err.message.slice(0, 160)
            log(`EXHAUSTED: ${base} / ${p} — ${MAX_ATTEMPTS} attempts, all failed. Last error: ${errSummary}`)
            sendTelegram(`✗ *BSV distribute failure*\n*Slot:* ${base}\n*Platform:* ${p}\n*Error:* ${errSummary}`).catch(() => {})
          }
        }
        continue
      }

      // Apply per-platform results. State is written immediately — before next poll.
      let distResults = null
      try { distResults = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) } catch {}

      if (!distResults || Object.keys(distResults).length === 0) {
        log(`${base}: WARNING — no distribute results found, marking attempted platforms failed`)
        markAttemptedFailed(state, base, effectivePlatforms)
        saveState(state)
        for (const p of effectivePlatforms) {
          if (state[base][p]?.status === 'exhausted' && !preExhausted.has(p)) {
            log(`EXHAUSTED: ${base} / ${p} — ${MAX_ATTEMPTS} attempts, all failed. Last error: no distribute results written`)
            sendTelegram(`✗ *BSV distribute failure*\n*Slot:* ${base}\n*Platform:* ${p}\n*Error:* no distribute results written`).catch(() => {})
          }
        }
        continue
      }

      applyDistResults(state, base, distResults)
      saveState(state)

      // Log any platforms that just exhausted this cycle
      for (const p of ACTIVE_PLATFORMS) {
        if (state[base][p]?.status === 'exhausted' && !preExhausted.has(p)) {
          const lastError = extractLastError(distributeOutput, p)
          log(`EXHAUSTED: ${base} / ${p} — ${MAX_ATTEMPTS} attempts, all failed. Last error: ${lastError}`)
          sendTelegram(`✗ *BSV distribute failure*\n*Slot:* ${base}\n*Platform:* ${p}\n*Error:* ${lastError}`).catch(() => {})
        }
      }

      if (isSlotDone(state[base])) {
        const succeeded = ACTIVE_PLATFORMS.filter(p => state[base][p]?.status === 'success')
        const exhausted = ACTIVE_PLATFORMS.filter(p => state[base][p]?.status === 'exhausted')
        const parts = []
        if (succeeded.length) parts.push(`✓ ${succeeded.join(', ')}`)
        if (exhausted.length) parts.push(`✗ exhausted: ${exhausted.join(', ')}`)
        log(`${base}: done — ${parts.join(' | ')} — archiving to Posted/${today}/`)
        archiveSlot(base, allDriveFiles, today)
        delete state[base]
        saveState(state)
        log(`${base}: archived`)
      } else {
        const retryNext = ACTIVE_PLATFORMS
          .filter(p => state[base][p]?.status === 'failed')
          .map(p => `${p}(${state[base][p].attempts}/${MAX_ATTEMPTS})`)
        log(`${base}: ${retryNext.length} platform(s) will retry next poll — ${retryNext.join(', ')}`)
      }
    }
  }

  log('━━━ poll end ━━━\n')

  // Run eng-bot after every poll so it catches errors while the log is fresh.
  // stdio:'pipe' keeps eng-bot output out of watch-drive.log (eng-bot writes its
  // own log to logs/eng-bot.log — piping it here causes a recursive feedback loop
  // where eng-bot's own output lines get re-read as new failures on the next poll).
  spawnSync(process.execPath, [path.join(__dirname, 'eng-bot.js')], {
    cwd:   ROOT,
    env:   process.env,
    stdio: 'pipe',
  })

  // Check product queue — triggers sync-shop.js on any approval or rejection change.
  await checkAndSyncShop()
}

// ─── FSEvents trigger ─────────────────────────────────────────────────────────
// drive-sync.js (run every 5 min via launchd StartInterval plist) pulls Drive
// files into TEMP_DIR. fs.watch detects the new files and fires run() within
// 3 seconds without this process needing to poll Drive directly.
// launchd KeepAlive: true restarts this process if it ever exits.

let runPending = false
let runActive  = false

async function triggerRun() {
  if (runActive) { runPending = true; return }
  runActive = true
  try {
    await run()
  } catch (err) {
    log(`CRASH: unhandled error in run — ${err.stack || err.message}`)
  } finally {
    runActive = false
    if (runPending) {
      runPending = false
      setTimeout(triggerRun, 0)
    }
  }
}

let debounceTimer = null
function onDirChange() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(triggerRun, 3000)
}

// Fire once at startup to process anything already in TEMP_DIR
triggerRun()

const watcher = fs.watch(TEMP_DIR, { persistent: true }, onDirChange)
watcher.on('error', err => log(`fs.watch error: ${err.message}`))

process.on('SIGTERM', () => { watcher.close(); process.exit(0) })
process.on('SIGINT',  () => { watcher.close(); process.exit(0) })

log(`Watching ${TEMP_DIR} for changes (drive-sync.js feeds this via launchd)`)
