// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/memory.js — shared BSV-Memory.md loader/writer
//
// Primary path: googleapis + service account, fetches/writes by file ID.
// Fallback path: rclone (used until Drive API is enabled for the service account).
//
// To enable the primary path:
//   1. Enable Drive API: https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=389116397035
//   2. Share Big Sole Vibes Drive folder with: bsv-sheets@gen-lang-client-0889892842.iam.gserviceaccount.com (Editor)
//   3. Run: node scripts/_consolidate-memory.js  (writes to canonical ID, deletes duplicates)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()
const { google }     = require('googleapis')
const { execSync }   = require('child_process')
const fs             = require('fs')
const os             = require('os')
const path           = require('path')

// Canonical BSV-Memory.md file ID — hardcoded, no filename search
const MEMORY_FILE_ID = '1KbpRvtgBD-W9SeQ49HOcCb8SB4l_cyIW'
const DRIVE_REMOTE   = 'big sole vibes:Big Sole Vibes'

function getAuth() {
  const svcPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  if (!svcPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_PATH not set in .env')
  const credentials = JSON.parse(fs.readFileSync(svcPath, 'utf8'))
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

// loadMemoryById() — fetches BSV-Memory.md content by file ID
// Returns string content or null on failure
// Falls back to rclone if Drive API is not yet enabled for the service account
async function loadMemoryById() {
  // Primary: googleapis by file ID
  try {
    const auth  = getAuth()
    const drive = google.drive({ version: 'v3', auth })
    const res   = await drive.files.get(
      { fileId: MEMORY_FILE_ID, alt: 'media' },
      { responseType: 'text' },
    )
    if (typeof res.data === 'string' && res.data.length > 0) return res.data
  } catch { /* fall through to rclone */ }

  // Fallback: rclone (picks most recently modified when duplicates exist)
  try {
    const tmpDir = path.join(os.tmpdir(), 'bsv-memory-lib')
    fs.mkdirSync(tmpDir, { recursive: true })
    execSync(`rclone copy "${DRIVE_REMOTE}/BSV-Memory.md" "${tmpDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const local = path.join(tmpDir, 'BSV-Memory.md')
    return fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null
  } catch (err) {
    console.error(`[memory.js] loadMemoryById rclone fallback failed: ${err.message}`)
    return null
  }
}

// writeMemoryById(content) — updates the canonical file content by file ID
// Falls back to rclone copyto if Drive API is not yet enabled
async function writeMemoryById(content) {
  // Primary: googleapis by file ID
  try {
    const auth  = getAuth()
    const drive = google.drive({ version: 'v3', auth })
    await drive.files.update({
      fileId: MEMORY_FILE_ID,
      media:  { mimeType: 'text/plain', body: content },
    })
    return
  } catch { /* fall through to rclone */ }

  // Fallback: rclone copyto
  const tmpFile = path.join(os.tmpdir(), 'bsv-memory-write.md')
  fs.writeFileSync(tmpFile, content)
  execSync(`rclone copyto "${tmpFile}" "${DRIVE_REMOTE}/BSV-Memory.md"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

module.exports = { MEMORY_FILE_ID, loadMemoryById, writeMemoryById }
