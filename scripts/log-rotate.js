require('dotenv').config()

const fs   = require('fs')
const path = require('path')

const ROOT     = path.join(__dirname, '..')
const LOGS_DIR = path.join(ROOT, 'logs')
const LOG_FILE = path.join(LOGS_DIR, 'log-rotate.log')
const KEEP     = 2  // keep .1 and .2; delete .3+

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function rotateOne(logPath) {
  const base = logPath

  // Delete the oldest archived copy first
  const oldest = `${base}.${KEEP + 1}`
  if (fs.existsSync(oldest)) {
    fs.unlinkSync(oldest)
    log(`  deleted ${path.basename(oldest)}`)
  }

  // Shift existing archives: .2 → .3, .1 → .2
  for (let i = KEEP; i >= 1; i--) {
    const from = `${base}.${i}`
    const to   = `${base}.${i + 1}`
    if (fs.existsSync(from)) {
      fs.renameSync(from, to)
      log(`  ${path.basename(from)} → ${path.basename(to)}`)
    }
  }

  // Rotate the live log: .log → .log.1
  if (fs.existsSync(base)) {
    const sizeMB = (fs.statSync(base).size / 1024 / 1024).toFixed(1)
    fs.renameSync(base, `${base}.1`)
    log(`  ${path.basename(base)} → ${path.basename(base)}.1  (${sizeMB} MB archived)`)
  }

  // Start a fresh empty log
  fs.writeFileSync(base, '')
  log(`  ${path.basename(base)} — fresh file created`)
}

;(function run() {
  fs.mkdirSync(LOGS_DIR, { recursive: true })

  log('━━━ log-rotate start ━━━')

  const logFiles = fs.readdirSync(LOGS_DIR)
    .filter(f => f.endsWith('.log') && !f.includes('.log.'))
    .sort()

  log(`Found ${logFiles.length} log file(s) to rotate`)

  for (const f of logFiles) {
    log(`Rotating ${f}`)
    rotateOne(path.join(LOGS_DIR, f))
  }

  log('━━━ log-rotate complete ━━━\n')
})()
