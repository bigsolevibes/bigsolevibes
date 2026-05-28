require('dotenv').config()
const { execSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

const ROOT        = path.join(__dirname, '..')
const SCRIPTS_DIR = path.join(ROOT, 'scripts')
const LOG_FILE    = path.join(ROOT, 'logs', 'backup-scripts.log')
const REMOTE      = 'big sole vibes:Big Sole Vibes/Scripts Backup'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  log('━━━ backup-scripts start ━━━')

  const files = fs.readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort()

  let succeeded = 0
  let failed    = 0

  for (const file of files) {
    const filePath = path.join(SCRIPTS_DIR, file)
    const sizeKb   = (fs.statSync(filePath).size / 1024).toFixed(1)
    try {
      execSync(
        `rclone copyto "${filePath}" "${REMOTE}/${file}" --drive-upload-cutoff 0`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )
      log(`UPLOADED: ${file} (${sizeKb}kb)`)
      succeeded++
    } catch (err) {
      const errMsg = err.stderr?.toString().trim() || err.message
      log(`FAILED: ${file} — ${errMsg}`)
      failed++
    }
  }

  log(`SUMMARY: ${files.length} files | ${succeeded} succeeded | ${failed} failed`)
  log('━━━ backup-scripts complete ━━━\n')
})()
