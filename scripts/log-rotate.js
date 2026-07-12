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
    const p = path.join(LOGS_DIR, f)
    // FIXED 2026-07-11: this used to rotate every log unconditionally, including
    // already-empty ones — fs.writeFileSync(base, '') on a 0-byte file still
    // resets its mtime to "now" every single day. chief-of-staff.js's agent
    // health check uses log mtime to detect stale agents, so a silent agent's
    // log looked freshly-touched every morning and never tripped staleness —
    // exactly how brand-manager went 26 days without running while still
    // showing "Healthy" (see bigc-brief.md 2026-07-11, chief-of-staff.js fix
    // same date). Skipping empty files preserves the true last-activity mtime.
    let size = 0
    try { size = fs.statSync(p).size } catch { /* doesn't exist yet — nothing to rotate */ }
    if (size === 0) {
      log(`Skipping ${f} — already empty, no new content since last rotation`)
      continue
    }
    log(`Rotating ${f}`)
    rotateOne(p)
  }

  log('━━━ log-rotate complete ━━━\n')
})()
