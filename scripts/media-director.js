require('dotenv').config()
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT       = path.join(__dirname, '..')
const LOG_FILE   = path.join(ROOT, 'logs', 'media-director.log')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-media-director')
const REMOTE     = 'big sole vibes:Big Sole Vibes'

const { VOICES } = require('../config/bsv-voices')

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

// ─── Persona assignment ───────────────────────────────────────────────────────
// Three-persona rotating schedule. AM and PM can differ — both registers
// reach each audience across the week. No persona runs more than 5 of 14 slots.

const PERSONA_CALENDAR = {
  mon: { am: 'professional',    pm: 'athlete' },
  tue: { am: 'style-conscious', pm: 'professional' },
  wed: { am: 'athlete',         pm: 'style-conscious' },
  thu: { am: 'professional',    pm: 'athlete' },
  fri: { am: 'style-conscious', pm: 'professional' },
  sat: { am: 'athlete',         pm: 'style-conscious' },
  sun: { am: 'professional',    pm: 'athlete' },
}

// Voice locked to persona + register. No rotation — persona determines voice.
//   Professional → The Proprietor (AM) / The Nod (PM)
//   Athlete      → The Barber (AM) / The Callout (PM)
//   Style-Con.   → The Standard (AM) / The Nod (PM)
const PERSONA_VOICE_MAP = {
  professional:      { am: 'PROPRIETOR', pm: 'NOD' },
  athlete:           { am: 'BARBER',     pm: 'CALLOUT' },
  'style-conscious': { am: 'STANDARD',   pm: 'NOD' },
}

// Content strategy lane per persona
const PERSONA_LANE = {
  professional:      'Lane 1 — High-End Drop',
  athlete:           'Lane 3 — Well-Framed Audit',
  'style-conscious': 'Lane 2 — Style vs. Mechanics',
}

// Persona-matched hashtags (from the social-listening brief)
const PERSONA_HASHTAGS = {
  professional:      ['#mensstyle', '#bespoke', '#leathergoods', '#shoecare', '#gentlemanstyle'],
  athlete:           ['#recoverydays', '#athletelife', '#trainhard', '#crossfit', '#runnerscommunity'],
  'style-conscious': ['#menswear', '#ootd', '#streetstyle', '#complexstyle', '#highsnobiety'],
}

const DOW_TO_SLUG = ['sun','mon','tue','wed','thu','fri','sat']
const VALID_DAYS  = ['mon','tue','wed','thu','fri','sat','sun']

// ─── Daily directive loader ───────────────────────────────────────────────────
// Chief writes Plans/daily-directive-YYYY-MM-DD.md when Big D replies 1/2/3.
// Falls back to yesterday's directive if today's hasn't been chosen yet.

function loadDailyDirective() {
  const today = new Date()
  for (let offset = 0; offset <= 1; offset++) {
    const d = new Date(today)
    d.setDate(d.getDate() - offset)
    const stamp = d.toISOString().slice(0, 10)
    const filename = `daily-directive-${stamp}.md`
    try {
      execSync(`rclone copy "${REMOTE}/Plans/${filename}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      const p = path.join(TEMP_DIR, filename)
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8')
        log(`Daily directive: loaded ${filename}`)
        return { filename, content }
      }
    } catch {}
  }
  log('Daily directive: none found — running persona defaults')
  return null
}

// ─── Social report loader ─────────────────────────────────────────────────────

function loadLatestSocialReport() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^social-report-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Social report parser ─────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractBulletValue(text, label) {
  const m = text.match(new RegExp(`[-*]\\s*${escapeRegex(label)}[^:\\n]*:\\s*(.+)`))
  return m ? m[1].trim() : null
}

function parseSocialReport(content, persona) {
  if (!content) return null

  const personaHeaders = {
    professional:      'MAN 1 — THE PROFESSIONAL',
    athlete:           'MAN 2 — THE ATHLETE',
    'style-conscious': 'MAN 3 — THE STYLE-CONSCIOUS',
  }
  const angleLabels = {
    professional:      'Angle 1',
    athlete:           'Angle 2',
    'style-conscious': 'Angle 3',
  }

  const result = { verbatimPhrases: [], storyAngle: null, hashtagSignal: '' }
  const header = personaHeaders[persona]
  if (!header) return result

  // Extract verbatim phrases from this persona's section
  const personaSection = content.match(
    new RegExp(`## ${escapeRegex(header)}[\\s\\S]*?(?=\\n## (?:MAN \\d|Story Angles|Hashtag)|$)`)
  )
  if (personaSection) {
    const verbMatch = personaSection[0].match(/### Verbatim Language\n([\s\S]*?)(?=\n###|\n##|$)/)
    if (verbMatch) {
      result.verbatimPhrases = verbMatch[1]
        .split('\n')
        .map(l => l.replace(/^[-*•]\s*"?/, '').replace(/"?\s*$/, '').trim())
        .filter(l => l.length > 3 && !l.startsWith('#') && !l.startsWith('*') && !l.startsWith('_'))
    }
  }

  // Extract the story angle for this persona
  const angleLabel = angleLabels[persona]
  const anglesSection = content.match(/## Story Angles for Media-Director[\s\S]*?(?=\n## Hashtag|$)/)
  if (anglesSection) {
    const angleMatch = anglesSection[0].match(
      new RegExp(`\\*\\*${escapeRegex(angleLabel)}[^*]*\\*\\*\\n([\\s\\S]*?)(?=\\n\\*\\*Angle \\d|$)`)
    )
    if (angleMatch) {
      const t = angleMatch[1]
      result.storyAngle = {
        hook:             extractBulletValue(t, 'Hook'),
        voiceTag:         extractBulletValue(t, 'BSV voice'),
        whyThisWeek:      extractBulletValue(t, 'Why this week'),
        draftOpeningLine: extractBulletValue(t, 'Draft opening line'),
      }
    }
  }

  // Hashtag performance section (truncated — full context passed to creative-agent)
  const hashtagSection = content.match(/## Hashtag Performance Signal[\s\S]*$/)
  if (hashtagSection) result.hashtagSignal = hashtagSection[0].slice(0, 600)

  return result
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

  const themes   = THEME_CALENDAR[targetDay]
  const personas = PERSONA_CALENDAR[targetDay]

  log('Loading daily directive...')
  const dailyDirective = loadDailyDirective()

  log('Loading social intelligence report...')
  const socialReport = loadLatestSocialReport()
  log(`Social report: ${socialReport ? socialReport.filename : 'none — persona context will use defaults'}`)

  for (const period of ['am', 'pm']) {
    const slug     = `${targetDay}-${period}`
    const theme    = themes[period]
    const persona  = personas[period]
    const voice    = PERSONA_VOICE_MAP[persona][period]
    const lane     = PERSONA_LANE[persona]
    const hashtags = PERSONA_HASHTAGS[persona]
    const voiceDef = VOICES[voice]

    const parsed = parseSocialReport(socialReport?.content, persona)
    const personaContext = {
      persona,
      lane,
      voice,
      hashtags,
      verbatimPhrases:  parsed?.verbatimPhrases  ?? [],
      storyAngle:       parsed?.storyAngle        ?? null,
      hashtagSignal:    parsed?.hashtagSignal      ?? '',
      directive:        dailyDirective?.content   ?? null,
    }

    log(`[${slug}] persona=${persona} voice=${voice} lane="${lane}" theme="${theme}"`)
    if (parsed?.storyAngle?.hook) log(`  angle: "${parsed.storyAngle.hook}"`)
    if (parsed?.verbatimPhrases?.length) log(`  verbatim phrases: ${parsed.verbatimPhrases.length}`)

    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'creative-agent.js'),
        '--slot',            slug,
        '--theme',           theme,
        '--voice',           voice,
        '--voice-def',       JSON.stringify(voiceDef),
        '--persona-context', JSON.stringify(personaContext),
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
