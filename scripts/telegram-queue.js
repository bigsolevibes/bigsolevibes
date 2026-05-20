require('dotenv').config()

const fs           = require('fs')
const path         = require('path')
const os           = require('os')
const { execSync } = require('child_process')

const ROOT         = path.join(__dirname, '..')
const PENDING_FILE = path.join(ROOT, 'logs', 'telegram-pending.json')
const REMOTE       = 'big sole vibes:Big Sole Vibes'
const INBOX_REMOTE = REMOTE + '/Inbox'
const TEMP_DIR     = path.join(os.tmpdir(), 'bsv-telegram-queue')

// ─── Init ─────────────────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })
}

// ─── Pending queue ────────────────────────────────────────────────────────────

function loadPendingItems() {
  try {
    if (!fs.existsSync(PENDING_FILE)) return []
    return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))
  } catch {
    return []
  }
}

function savePendingItems(items) {
  ensureDirs()
  fs.writeFileSync(PENDING_FILE, JSON.stringify(items, null, 2))
}

function addPendingItem(item) {
  ensureDirs()
  const items = loadPendingItems()
  // Remove existing item with same id if present
  const filtered = items.filter(i => i.id !== item.id)
  filtered.push({
    id:              item.id,
    type:            item.type,
    driveFile:       item.driveFile,
    sentAt:          item.sentAt || new Date().toISOString(),
    remindAfter:     item.remindAfter || null,
    metadata:        item.metadata || {},
    originalMessage: item.originalMessage || '',
  })
  savePendingItems(filtered)
}

// ─── Drive decision file ──────────────────────────────────────────────────────

// Downloads Big Sole Vibes/Inbox/[driveFile] and parses key: value pairs.
// Returns { decision, timestamp, notes } or null if not found.
function readDecisionFromDrive(driveFile) {
  ensureDirs()
  try {
    const remotePath = `${INBOX_REMOTE}/${driveFile}`
    execSync(`rclone copy "${remotePath}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
    const localPath = path.join(TEMP_DIR, path.basename(driveFile))
    if (!fs.existsSync(localPath)) return null

    const content = fs.readFileSync(localPath, 'utf8')
    const parsed  = {}
    for (const line of content.split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/)
      if (m) parsed[m[1].toLowerCase()] = m[2].trim()
    }
    if (!parsed.decision) return null

    return {
      decision:  parsed.decision.toUpperCase(),
      timestamp: parsed.timestamp || new Date().toISOString(),
      notes:     parsed.notes || '',
    }
  } catch {
    return null
  }
}

// Moves processed file to Big Sole Vibes/Inbox/Processed/
function archiveDecision(driveFile) {
  try {
    const src  = `${INBOX_REMOTE}/${driveFile}`
    const dest = `${INBOX_REMOTE}/Processed/${driveFile}`
    execSync(`rclone moveto "${src}" "${dest}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
  } catch {
    // Non-fatal — log silently
  }
}

module.exports = {
  addPendingItem,
  loadPendingItems,
  savePendingItems,
  readDecisionFromDrive,
  archiveDecision,
  PENDING_FILE,
  INBOX_REMOTE,
  TEMP_DIR,
}
