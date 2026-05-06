// Manual full-pipeline trigger.
// Generates a content plan from today through the nearest Saturday,
// then runs the full processing stack. Idempotent — each downstream
// script skips files already present in Ready to Post/.
//
// Usage: node scripts/run-now.js

require('dotenv').config()
const { spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'run-now.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function step(label, scriptPath, args = []) {
  const divider = '─'.repeat(54)
  log(divider)
  log(`STEP ${label}`)
  log(divider)

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    env:   process.env,
    cwd:   ROOT,
  })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(scriptPath)} exited with code ${result.status}`)
  log(`${path.basename(scriptPath)} finished OK`)
}

;(function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

  const now     = new Date()
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()]
  const date    = now.toISOString().slice(0, 10)

  const banner = '━'.repeat(54)
  log(banner)
  log(`run-now: starting full pipeline`)
  log(`today: ${dayName} ${date}`)
  log(`plan covers: today through nearest Saturday`)
  log(banner)

  try {
    step('1/4  media-director  (generate content plan)',
      path.join(__dirname, 'media-director.js'),
      ['--plan-only', '--start-today'])

    step('2/4  gemini-bridge   (captions + image prompts)',
      path.join(__dirname, 'gemini-bridge.js'))

    step('3/4  image-gen       (Imagen 4 — skips existing)',
      path.join(__dirname, 'image-gen.js'))

    step('4/4  video-gen       (Veo 3.1 — skips existing)',
      path.join(__dirname, 'video-gen.js'))

    log(banner)
    log('run-now: pipeline complete')
    log('watch-drive.js will pick up output on its next poll (every 15 min)')
    log(banner)
  } catch (err) {
    log(`ERROR: pipeline stopped — ${err.message}`)
    process.exit(1)
  }
})()
