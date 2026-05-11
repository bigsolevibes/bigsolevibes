require('dotenv').config()
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'media-director.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-media-director')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Theme calendar ───────────────────────────────────────────────────────────
// One theme per slot per day. Creative-agent executes it.

const THEME_CALENDAR = {
  mon: { am: 'The Standard',   pm: 'Street' },
  tue: { am: 'The Ritual',     pm: 'The Callout' },
  wed: { am: 'The Product',    pm: 'The Lounge' },
  thu: { am: 'The Story',      pm: 'Culture' },
  fri: { am: 'The Week',       pm: 'The Contrast' },
  sat: { am: 'Recovery',       pm: 'The Proprietor' },
  sun: { am: 'The Standard',   pm: 'The Invite' },
}

const DOW_TO_SLUG = ['sun','mon','tue','wed','thu','fri','sat']
const VALID_DAYS  = ['mon','tue','wed','thu','fri','sat','sun']

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ media-director start ━━━')

  // Determine target day — explicit --day flag or default to tomorrow
  let targetDay
  const dayArg = process.argv.indexOf('--day')
  if (dayArg !== -1) {
    targetDay = (process.argv[dayArg + 1] || '').toLowerCase()
    if (!VALID_DAYS.includes(targetDay)) {
      log(`ERROR: --day requires a valid slug (${VALID_DAYS.join('|')})`)
      process.exit(1)
    }
    log(`--day flag: ${targetDay}`)
  } else {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    targetDay = DOW_TO_SLUG[tomorrow.getDay()]
    log(`Defaulting to tomorrow: ${targetDay}`)
  }

  const themes = THEME_CALENDAR[targetDay]
  log(`Themes — AM: "${themes.am}"  PM: "${themes.pm}"`)

  // Call creative-agent for each slot
  for (const period of ['am', 'pm']) {
    const slug  = `${targetDay}-${period}`
    const theme = themes[period]
    log(`Spawning creative-agent --slot ${slug} --theme "${theme}"...`)
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'creative-agent.js'), '--slot', slug, '--theme', theme],
      { stdio: 'inherit', env: process.env }
    )
    if (result.status !== 0) log(`ERROR: creative-agent exited ${result.status} for ${slug}`)
  }

  // Chain to gemini-bridge — reads briefs, uploads caption + prompt files to Drive
  log(`Spawning gemini-bridge --day ${targetDay}...`)
  const bridge = spawnSync(
    process.execPath,
    [path.join(__dirname, 'gemini-bridge.js'), '--day', targetDay],
    { stdio: 'inherit', env: process.env }
  )
  if (bridge.status !== 0) log(`ERROR: gemini-bridge exited ${bridge.status}`)

  log('━━━ media-director complete ━━━\n')
})()
