require('dotenv').config()

// ─────────────────────────────────────────────────────────────────────────────
// telegram-webhook.js — persistent long-polling Telegram bot
//
// Polls getUpdates every 25 seconds. Filters to TELEGRAM_CHAT_ID only.
// Processes reply commands and routes decisions to Drive Inbox.
// Run standalone: node scripts/telegram-webhook.js
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs')
const path = require('path')
const os   = require('os')

const { sendTelegram } = require('./telegram')
const {
  loadPendingItems,
  savePendingItems,
  addPendingItem,
  readDecisionFromDrive,
  archiveDecision,
  INBOX_REMOTE,
} = require('./telegram-queue')
const { approveVideo, rejectVideo } = require('./video-gate-actions')

const { execSync } = require('child_process')

const ROOT         = path.join(__dirname, '..')
const LOG_FILE     = path.join(ROOT, 'logs', 'telegram-webhook.log')
const INBOX_FILE   = path.join(ROOT, 'logs', 'telegram-inbox.log')
const STATE_FILE   = path.join(ROOT, 'logs', 'telegram-webhook-state.json')
const LOGS_DIR     = path.join(ROOT, 'logs')
const POST_STATE   = path.join(ROOT, 'logs', 'post-state.json')

const POLL_TIMEOUT = 25   // seconds — long-poll window
const POLL_INTERVAL = 25  // seconds between poll cycles

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function logInbox(chatId, text) {
  const line = `[${new Date().toISOString()}] chat=${chatId} text=${JSON.stringify(text)}`
  fs.appendFileSync(INBOX_FILE, line + '\n')
}

// ─── State (offset persistence) ───────────────────────────────────────────────

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { offset: 0 }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { offset: 0 }
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function getUpdates(token, offset, timeout) {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=["message"]`
  const res  = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) })
  if (!res.ok) throw new Error(`getUpdates HTTP ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(`getUpdates error: ${data.description}`)
  return data.result || []
}

// ─── Drive decision writer ────────────────────────────────────────────────────

function writeDecisionToDrive(driveFile, decision, notes) {
  const tmpDir  = path.join(os.tmpdir(), 'bsv-telegram-webhook')
  fs.mkdirSync(tmpDir, { recursive: true })
  const content = [
    `decision: ${decision}`,
    `timestamp: ${new Date().toISOString()}`,
    notes ? `notes: ${notes}` : null,
  ].filter(Boolean).join('\n') + '\n'

  const localPath = path.join(tmpDir, driveFile)
  fs.writeFileSync(localPath, content)
  try {
    execSync(`rclone copyto "${localPath}" "${INBOX_REMOTE}/${driveFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
    log(`Decision written to Drive: ${driveFile} — ${decision}`)
  } catch (err) {
    log(`WARNING: could not write decision to Drive: ${err.message}`)
  }
}

// ─── Video-gate file actions ──────────────────────────────────────────────────
// video-gate items (from video-gen.js) point at a real staged file in Drive's
// Video Review folder — e.g. metadata.driveFile = "Video Review/mon-am.mp4" —
// not a decision-marker filename like every other gate type. Nothing polls
// Drive to read a decision back for this item type, so act on the actual file
// directly and synchronously here instead of round-tripping through
// writeDecisionToDrive (which expects a top-level item.driveFile that
// video-gen.js never sets, and which nothing downstream ever reads anyway).
// approveVideo/rejectVideo now live in video-gate-actions.js — shared with the
// dashboard's /api/dashboard/video-review route so both surfaces stay in sync.

// ─── "First active" queue helper ──────────────────────────────────────────────

function getFirstActive(items) {
  const now = new Date()
  return items.find(item => {
    if (!item.remindAfter) return true
    return new Date(item.remindAfter) <= now
  }) || null
}

// ─── Status commands ──────────────────────────────────────────────────────────

function handleStatus() {
  try {
    const logPath = path.join(LOGS_DIR, 'chief-of-staff.log')
    if (!fs.existsSync(logPath)) return 'No chief-of-staff.log found.'
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-15)
    return `*STATUS — chief-of-staff.log (last 15 lines)*\n\`\`\`\n${lines.join('\n')}\n\`\`\``
  } catch (err) {
    return `Error reading status: ${err.message}`
  }
}

function handleQueue() {
  try {
    if (!fs.existsSync(POST_STATE)) return 'No post-state.json found.'
    const entries = JSON.parse(fs.readFileSync(POST_STATE, 'utf8'))
    const pending = entries.filter(e => e.status === 'pending' || e.status === 'scheduled')
    if (!pending.length) return '*QUEUE* — No pending or scheduled entries.'
    const lines = pending.map(e => `• ${e.slot || e.id || 'unknown'} — ${e.status}`)
    return `*QUEUE* — ${pending.length} pending/scheduled\n${lines.join('\n')}`
  } catch (err) {
    return `Error reading queue: ${err.message}`
  }
}

function handleIssues(items) {
  const engItems = items.filter(i => i.type === 'eng')
  if (!engItems.length) return '*ISSUES* — No pending eng issues.'
  const lines = engItems.map(i => `• *${i.metadata?.script || 'unknown'}*: ${i.metadata?.problem || '(no detail)'}`)
  return `*ISSUES* — ${engItems.length} pending\n${lines.join('\n')}`
}

function handlePending(items) {
  if (!items.length) return '*PENDING* — Nothing in queue.'
  const lines = items.map(i => {
    let label = i.type
    if (i.type === 'blog') label = `blog: ${i.metadata?.title || i.id}`
    else if (i.type === 'eng') label = `eng: ${i.metadata?.script || i.id}`
    else if (i.type === 'chief') label = `chief: ${i.metadata?.title || i.id}`
    const remind = i.remindAfter ? ` (remind ${i.remindAfter.slice(0, 10)})` : ''
    return `• ${label}${remind}`
  })
  return `*PENDING* — ${items.length} item(s)\n${lines.join('\n')}`
}

// ─── Next-day 7:45AM reminder helper ─────────────────────────────────────────

function nextDayAt745() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(7, 45, 0, 0)
  return d.toISOString()
}

// ─── Check and re-send due LATER reminders ────────────────────────────────────

async function checkDueReminders(items) {
  const now = new Date()
  let changed = false
  for (const item of items) {
    if (!item.remindAfter) continue
    if (new Date(item.remindAfter) > now) continue
    // Due — re-send original message
    log(`Re-sending LATER reminder for ${item.id}`)
    await sendTelegram(`⏰ *Reminder*\n\n${item.originalMessage}`)
    item.remindAfter = null
    changed = true
  }
  if (changed) savePendingItems(items)
}

// ─── Message processor ────────────────────────────────────────────────────────

async function processMessage(text) {
  const raw     = (text || '').trim()
  const upper   = raw.toUpperCase()
  const items   = loadPendingItems()

  // Status commands — don't touch queue
  if (upper === 'STATUS')  return handleStatus()
  if (upper === 'QUEUE')   return handleQueue()
  if (upper === 'ISSUES')  return handleIssues(items)
  if (upper === 'PENDING') return handlePending(items)

  // Approval commands — need an active item
  const active = getFirstActive(items)

  if (upper === 'APPROVE' || upper === 'FIX') {
    if (!active) return 'Nothing pending right now.'

    if (active.type === 'video-gate') {
      try {
        approveVideo(active.metadata.driveFile)
        log(`Video approved — moved ${active.metadata.driveFile} → Ready to Post`)
      } catch (err) {
        log(`ERROR approving video: ${err.message}`)
        return `⚠️ Couldn't move the file in Drive — ${err.message}. Still pending, reply APPROVE again to retry.`
      }
      const remaining = items.filter(i => i.id !== active.id)
      savePendingItems(remaining)
      return `✅ Approved — ${active.metadata.slot} moved to Ready to Post. Goes out on the next pipeline pass.`
    }

    // content-gate items have no driveFile — write directly to approved-slots.json
    if (active.type === 'content-gate') {
      const approvedPath = path.join(ROOT, 'logs', 'approved-slots.json')
      let approved = {}
      try { approved = JSON.parse(fs.readFileSync(approvedPath, 'utf8')) } catch {}
      approved[active.metadata.slot] = true
      fs.writeFileSync(approvedPath, JSON.stringify(approved, null, 2))
      log('Content gate approved for slot: ' + active.metadata.slot)
    } else {
      writeDecisionToDrive(active.driveFile, upper === 'FIX' ? 'FIX' : 'APPROVE', '')
    }
    const remaining = items.filter(i => i.id !== active.id)
    savePendingItems(remaining)
    return upper === 'FIX' ? '✅ Got it Big D. Logged.' : '✅ Got it Big D. Logged.'
  }

  if (upper === 'REJECT' || upper === 'DENY') {
    if (!active) return 'Nothing pending right now.'

    if (active.type === 'video-gate') {
      try {
        rejectVideo(active.metadata.driveFile)
        log(`Video rejected — deleted ${active.metadata.driveFile}`)
      } catch (err) {
        log(`ERROR deleting rejected video: ${err.message}`)
        return `⚠️ Couldn't delete the file in Drive — ${err.message}. Still pending, reply REJECT again to retry.`
      }
      const remaining = items.filter(i => i.id !== active.id)
      savePendingItems(remaining)
      return `🗑️ Rejected — ${active.metadata.slot} deleted from Video Review.`
    }

    writeDecisionToDrive(active.driveFile, 'REJECT', '')
    const remaining = items.filter(i => i.id !== active.id)
    savePendingItems(remaining)
    return '❌ Got it Big D. Logged.'
  }

  if (upper === 'SKIP') {
    if (!active) return 'Nothing pending right now.'
    // video-gate has no decision-file consumer to write to — just clear the nag
    if (active.type !== 'video-gate') writeDecisionToDrive(active.driveFile, 'SKIP', '')
    const remaining = items.filter(i => i.id !== active.id)
    savePendingItems(remaining)
    return '⏭ Skipped.'
  }

  if (upper === 'LATER') {
    if (!active) return 'Nothing pending right now.'
    active.remindAfter = nextDayAt745()
    savePendingItems(items)
    return '⏰ Got it. I\'ll remind you tomorrow morning.'
  }

  if (upper.startsWith('EDIT ')) {
    if (!active) return 'Nothing pending right now.'
    const notes = raw.slice(5).trim()
    if (active.type !== 'video-gate') writeDecisionToDrive(active.driveFile, 'EDIT', notes)
    const remaining = items.filter(i => i.id !== active.id)
    savePendingItems(remaining)
    return '✏️ Got it Big D. Notes logged.'
  }

  // Unknown
  return 'Got it Big D. Logged.\n\nFor the pending item, reply: FIX, APPROVE, REJECT (or DENY), SKIP, LATER, or EDIT [notes]'
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(LOGS_DIR, { recursive: true })

  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    log('ERROR: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — exiting')
    process.exit(1)
  }

  log('━━━ telegram-webhook start ━━━')

  // On startup: check for due LATER reminders
  const startItems = loadPendingItems()
  await checkDueReminders(startItems)

  const state = loadState()
  let offset  = state.offset || 0

  log(`Starting poll loop — offset=${offset}`)

  while (true) {
    try {
      const updates = await getUpdates(token, offset, POLL_TIMEOUT)

      for (const update of updates) {
        offset = update.update_id + 1

        const msg = update.message
        if (!msg || !msg.text) continue

        const fromId = String(msg.chat?.id || '')
        const text   = msg.text || ''

        // Log all incoming messages
        logInbox(fromId, text)

        // Filter to configured chat only
        if (fromId !== String(chatId)) {
          log(`Ignored message from unauthorized chat ${fromId}`)
          continue
        }

        log(`Received: ${JSON.stringify(text)}`)

        let reply
        try {
          reply = await processMessage(text)
        } catch (err) {
          log(`ERROR processing message: ${err.message}`)
          reply = `Error processing message: ${err.message}`
        }

        if (reply) {
          await sendTelegram(reply)
        }
      }

      saveState({ offset })

      // After processing, check for due reminders
      const currentItems = loadPendingItems()
      await checkDueReminders(currentItems)

    } catch (err) {
      if (err.name === 'TimeoutError' || err.message?.includes('abort')) {
        // Normal long-poll timeout — continue silently
      } else {
        log(`Poll error: ${err.message}`)
        // Back off briefly on errors
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    // Brief pause between cycles
    await new Promise(r => setTimeout(r, 1000))
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[telegram-webhook] Fatal: ${err.message}`)
    process.exit(1)
  })
}
