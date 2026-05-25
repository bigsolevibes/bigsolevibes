require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'drive-sync.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-ready')

const REMOTE_READY = 'big sole vibes:Big Sole Vibes/Ready to Post'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

fs.mkdirSync(TEMP_DIR, { recursive: true })
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

log('drive-sync: pulling Ready to Post → ~/tmp/bsv-ready/')
try {
  execSync(
    `rclone copy "${REMOTE_READY}/" "${TEMP_DIR}/" --max-depth 1`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  const files = fs.readdirSync(TEMP_DIR)
  log(`drive-sync: done — ${files.length} file(s) in ${TEMP_DIR}`)
} catch (err) {
  log(`drive-sync: ERROR — ${err.stderr?.toString().trim() || err.message}`)
  process.exit(1)
}
