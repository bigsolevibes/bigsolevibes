require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT       = path.join(__dirname, '..')
const LOG_FILE   = path.join(ROOT, 'logs', 'media-director.log')
const STATE_FILE = path.join(ROOT, 'logs', 'voice-state.json')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-media-director')
const REMOTE     = 'big sole vibes:Big Sole Vibes'

const { VOICES, AM_VOICE_POOL, PM_VOICE_POOL } = require('../config/bsv-voices')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Theme calendar ───────────────────────────────────────────────────────────

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

// ─── Voice rotation ───────────────────────────────────────────────────────────
// AM = Lounge register: PROPRIETOR → BARBER → STANDARD (cycle)
// PM = Drop register:   CALLOUT → NOD → PROPRIETOR (cycle)
// Never assign the same voice to consecutive slots across AM/PM boundaries.

function loadVoiceState() {
  try {
    return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {}
  } catch { return {} }
}

function saveVoiceState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function pickVoice(pool, lastVoice, indexKey, state) {
  let idx = state[indexKey] ?? 0
  let voice = pool[idx % pool.length]
  // Advance once if this would repeat the last slot's voice
  if (voice === lastVoice) {
    idx++
    voice = pool[idx % pool.length]
  }
  state[indexKey] = idx + 1
  return voice
}

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

  // Load rotation state and assign voices
  const state    = loadVoiceState()
  const lastVoice = state.lastVoice || null

  const amVoice = pickVoice(AM_VOICE_POOL, lastVoice, 'amIndex', state)
  const pmVoice = pickVoice(PM_VOICE_POOL, amVoice,   'pmIndex', state)

  state.lastVoice = pmVoice
  saveVoiceState(state)

  log(`Themes  — AM: "${themes.am}"  PM: "${themes.pm}"`)
  log(`Voices  — AM: ${amVoice}  PM: ${pmVoice}`)

  // Call creative-agent for each slot with theme + assigned voice
  const slotVoices = { am: amVoice, pm: pmVoice }
  for (const period of ['am', 'pm']) {
    const slug       = `${targetDay}-${period}`
    const theme      = themes[period]
    const voiceName  = slotVoices[period]
    const voiceDef   = VOICES[voiceName]

    // Serialize the full voice definition so creative-agent has it at execution time
    const voiceJson = JSON.stringify(voiceDef)

    log(`Spawning creative-agent --slot ${slug} --theme "${theme}" --voice ${voiceName}...`)
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'creative-agent.js'),
        '--slot',  slug,
        '--theme', theme,
        '--voice', voiceName,
        '--voice-def', voiceJson,
      ],
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
