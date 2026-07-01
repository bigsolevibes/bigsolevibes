require('dotenv').config()
const Anthropic        = require('@anthropic-ai/sdk').default
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT                   = path.join(__dirname, '..')
const LOG_FILE               = path.join(ROOT, 'logs', 'media-director.log')
const TEMP_DIR               = path.join(os.homedir(), 'tmp', 'bsv-media-director')
const REMOTE                 = 'big sole vibes:Big Sole Vibes'
const CULTURAL_CALENDAR_FILE      = path.join(ROOT, 'scripts', 'data', 'cultural-calendar.json')
const EDITION_STATE_FILE          = path.join(ROOT, 'logs', 'edition-state.json')
const EDITION_VIGNETTE_INDEX_FILE = path.join(ROOT, 'logs', 'edition-vignette-index.json')

const { VOICES } = require('../config/bsv-voices')
const { connect: sheetConnect, readAllRows } = require('./sheets-client')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Week strategy ────────────────────────────────────────────────────────────
// Written by strategist.js on Sunday. Media director reads Content Direction
// so Sole Report topic selection and slot priorities align with the week's focus.

function loadWeekStrategy() {
  try {
    const p = path.join(ROOT, 'logs', 'strategy-active.md')
    if (!fs.existsSync(p)) return null
    const md = fs.readFileSync(p, 'utf8')
    const cd = md.match(/##\s+Content Direction[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)
    return cd ? cd[1].trim() : md.slice(0, 1000)
  } catch { return null }
}

// ─── Running audit log — media-director's self-memory ─────────────────────────

const MEDIA_AUDIT_LOG = path.join(ROOT, 'logs', 'media-director-audit.md')

function loadMediaAuditLog(n = 3) {
  try {
    if (!fs.existsSync(MEDIA_AUDIT_LOG)) return null
    const text = fs.readFileSync(MEDIA_AUDIT_LOG, 'utf8').trim()
    if (!text) return null
    const entries = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter(Boolean)
    return entries.slice(-n).join('\n\n').trim() || null
  } catch { return null }
}

function appendMediaAuditEntry(entry) {
  try {
    if (!fs.existsSync(MEDIA_AUDIT_LOG)) {
      fs.writeFileSync(MEDIA_AUDIT_LOG,
        '# BSV Media Director Audit Log\n' +
        'Running record of slot assignments, product rotations, and edition state. ' +
        'Read back at start of each run.\n\n')
    }
    fs.appendFileSync(MEDIA_AUDIT_LOG, entry.trim() + '\n\n')
  } catch {}
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
  professional:      ['#BigSoleVibes', '#mensgrooming', '#selfcare', '#menwellness'],
  athlete:           ['#BigSoleVibes', '#recovery', '#musclerecovery', '#mensgrooming', '#selfcare'],
  'style-conscious': ['#BigSoleVibes', '#mensgrooming', '#selfcaremen', '#groomingformen'],
}

const DOW_TO_SLUG = ['sun','mon','tue','wed','thu','fri','sat']
const VALID_DAYS  = ['mon','tue','wed','thu','fri','sat','sun']

// ─── Lounge social cadence ────────────────────────────────────────────────────
// Wednesday drops that retell the active Lounge chapter in campfire format.
// Indexed from launch week (week 0 = 2026-05-26). Runs wed-pm slot only.
const LOUNGE_LAUNCH_MONDAY = new Date('2026-05-26T00:00:00.000Z')

const LOUNGE_SOCIAL_CADENCE = [
  { week: 0, format: 'Tall Tale',         chapter: 1, articleType: 'hub',   ref: 'the-upgrade-path',   angle: 'The man in the evening light, the mirror, the soap in his hand at 9pm — the moment the reckoning began.' },
  { week: 1, format: 'The Scene',         chapter: 1, articleType: 'spoke', ref: 'the-cleanser',       angle: 'The soap watching from the edge of the tub. The new cleanser, the silence, the quality of it.' },
  { week: 2, format: 'Simple Modern Man', chapter: 1, articleType: 'spoke', ref: 'the-moisturizer',    angle: 'The oil-change observation. Maintenance is not vanity. Two minutes, the whole thing.' },
  { week: 3, format: 'Tall Tale',         chapter: 1, articleType: 'spoke', ref: 'the-label',          angle: 'He turned the bottle over. Sodium tallowate. The moment the soap stopped being a habit and became a question.' },
  { week: 4, format: 'The Scene',         chapter: 2, articleType: 'hub',   ref: 'the-one-bottle',     angle: 'Parking lot, two bottles. The wrong one he\'d been wearing for years. The right one, once.' },
  { week: 5, format: 'Simple Modern Man', chapter: 2, articleType: 'spoke', ref: 'the-man-who-packs',          angle: 'Two kinds of men at airport security. The second one had already thought about it.' },
  { week: 6, format: 'Tall Tale',         chapter: 2, articleType: 'spoke', ref: 'why-cologne-smells-different', angle: 'Same bottle. Different result on you. He thought that was coincidence. It was chemistry.' },
]

function getLoungeWedCadence(targetDateStr) {
  // targetDateStr is the day being briefed (e.g. "wed")
  if (targetDateStr !== 'wed') return null
  // Compute which Lounge week we're in based on today's date
  const today = new Date()
  const todayMonday = new Date(today)
  const dow = todayMonday.getDay()
  todayMonday.setDate(todayMonday.getDate() - (dow === 0 ? 6 : dow - 1))
  todayMonday.setHours(0, 0, 0, 0)
  const diffMs    = todayMonday.getTime() - LOUNGE_LAUNCH_MONDAY.getTime()
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 3600 * 1000))
  if (diffWeeks < 0 || diffWeeks >= LOUNGE_SOCIAL_CADENCE.length) return null
  return LOUNGE_SOCIAL_CADENCE[diffWeeks]
}

// ─── Drive context loaders ────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

async function loadMemory() {
  const { loadMemoryById } = require('./lib/memory')
  return loadMemoryById()
}

// ─── Social format map ────────────────────────────────────────────────────────
// Three social formats defined in BSV-Memory.md. Persona determines default.
const SOCIAL_FORMAT_MAP = {
  professional:      'Tall Tale',
  athlete:           'The Scene',
  'style-conscious': 'Simple Modern Man',
}

// ─── Chapter state ────────────────────────────────────────────────────────────
// media-director owns _chapter_state: reads on run, writes back at completion.

const CHAPTER_STATE_DEFAULTS_MD = {
  active:         1,
  name:           'The Bathroom Cabinet',
  productTease:   'The soap story. The man looked at it and for the first time actually looked at it.',
  campfireFormat: 'The Confession',
  loungeUrl:      'bigsolevibes.com/the-lounge/the-upgrade-path',
}

function loadChapterState() {
  try {
    const p = path.join(ROOT, 'logs', 'watch-drive-state.json')
    if (!fs.existsSync(p)) return { ...CHAPTER_STATE_DEFAULTS_MD }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    return raw._chapter_state
      ? { ...CHAPTER_STATE_DEFAULTS_MD, ...raw._chapter_state }
      : { ...CHAPTER_STATE_DEFAULTS_MD }
  } catch { return { ...CHAPTER_STATE_DEFAULTS_MD } }
}

function saveChapterState(cs) {
  try {
    const p   = path.join(ROOT, 'logs', 'watch-drive-state.json')
    const raw = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}
    raw._chapter_state = cs
    fs.writeFileSync(p, JSON.stringify(raw, null, 2))
  } catch (err) { log(`WARNING: could not save chapter state — ${err.message}`) }
}

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

// ─── Cultural moment override ─────────────────────────────────────────────────
// Checks the calendar first, then asks Claude to reason about the social report.
// Returns { override, source, moment, proprietor_take, hashtags }.

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log('WARNING: ANTHROPIC_API_KEY not set — cultural Claude reasoning unavailable')
    return '{"override": false, "reason": "API key not set"}'
  }
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  })
  return msg.content[0].text.trim()
}

async function checkCulturalOverride(socialReport, today) {
  // Calendar check first — hard-coded takes, no AI cost
  if (fs.existsSync(CULTURAL_CALENDAR_FILE)) {
    const calendar    = JSON.parse(fs.readFileSync(CULTURAL_CALENDAR_FILE, 'utf8'))
    const todayMMDD   = today.toISOString().slice(5, 10)
    const calendarMatch = calendar.find(e => e.date === todayMMDD)
    if (calendarMatch) {
      return {
        override:       true,
        source:         'calendar',
        moment:         calendarMatch.name,
        chapter:        calendarMatch.chapter,
        proprietor_take: calendarMatch.proprietor_take,
        hashtags:       calendarMatch.hashtags,
      }
    }
  }

  // No calendar match — ask Claude to reason about the social report
  try {
    const response = await callClaude(`
You are media-director for Big Sole Vibes — a premium men's grooming brand.
Today is ${today.toDateString()}.

Here is today's social intelligence report summary:
${socialReport.slice(0, 2000)}

Is there a dominant cultural moment happening today that warrants overriding
the standard chapter content brief? A cultural moment qualifies if:
- It is a major sporting event (championship, finals, major race)
- It is a trending national conversation that the BSV man would care about
- It would be conspicuous for a premium men's brand NOT to acknowledge it

Respond in JSON only:
{
  "override": true/false,
  "moment": "name of the moment or null",
  "reason": "one sentence why or why not",
  "proprietor_take": "two sentence Proprietor voice take on the moment — deadpan, no product, or null if no override",
  "hashtags": "5 relevant hashtags or null"
}`)
    const cleaned = response.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return { source: 'claude', ...parsed }
  } catch (err) {
    log(`WARNING: cultural override check failed — ${err.message}`)
    return { override: false, source: 'error', reason: err.message }
  }
}

// ─── Sole Report brief (Saturday only) ───────────────────────────────────────

function getISOWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7)
}

// ─── Product shelf assignment ─────────────────────────────────────────────────
// Sequential rotation: each brief generation advances to the next shelf product.
// Counter persisted in logs/product-rotation-index.json so it survives restarts.
// Shelf source: scripts/data/shelf-products.json (all live shelf products).
// Falls back to sheet approved products if shelf JSON is missing or empty.

const ROTATION_INDEX_FILE = path.join(ROOT, 'logs', 'product-rotation-index.json')
const SHELF_PRODUCTS_FILE = path.join(ROOT, 'scripts', 'data', 'shelf-products.json')

function loadShelfProducts() {
  try {
    if (!fs.existsSync(SHELF_PRODUCTS_FILE)) return []
    return JSON.parse(fs.readFileSync(SHELF_PRODUCTS_FILE, 'utf8'))
  } catch { return [] }
}

function pickNextProduct(pool) {
  if (!pool.length) return null
  let state = { index: 0 }
  try {
    if (fs.existsSync(ROTATION_INDEX_FILE)) {
      state = JSON.parse(fs.readFileSync(ROTATION_INDEX_FILE, 'utf8'))
    }
  } catch {}
  const current = state.index ?? 0
  const product = pool[current % pool.length]
  const next = { index: (current + 1) % pool.length, lastUpdated: new Date().toISOString() }
  try { fs.writeFileSync(ROTATION_INDEX_FILE, JSON.stringify(next, null, 2)) } catch {}
  return product
}

function assignProductToSlot(sheetProducts) {
  const shelf = loadShelfProducts()
  const pool  = shelf.length ? shelf : sheetProducts
  return pickNextProduct(pool)
}

// ─── Edition state helpers ────────────────────────────────────────────────────
// When an approved edition exists, posts draw from edition vignettes instead of
// the standard shelf rotation. Vignette index cycles through edition.vignettes[].

function loadEditionState() {
  try {
    if (!fs.existsSync(EDITION_STATE_FILE)) return null
    return JSON.parse(fs.readFileSync(EDITION_STATE_FILE, 'utf8'))
  } catch { return null }
}

function pickEditionVignette(editionState) {
  if (!editionState?.approved || !editionState?.vignettes?.length) return null
  let idx = 0
  try {
    if (fs.existsSync(EDITION_VIGNETTE_INDEX_FILE)) {
      idx = JSON.parse(fs.readFileSync(EDITION_VIGNETTE_INDEX_FILE, 'utf8')).index ?? 0
    }
  } catch {}
  const vignette = editionState.vignettes[idx % editionState.vignettes.length]
  const next = (idx + 1) % editionState.vignettes.length
  try {
    fs.writeFileSync(
      EDITION_VIGNETTE_INDEX_FILE,
      JSON.stringify({ index: next, lastUpdated: new Date().toISOString() }, null, 2)
    )
  } catch {}
  return vignette
}

async function generateSoleReportBrief({ bsvDirective, socialReport, bsvMemory }) {
  const weekNum   = getISOWeek(new Date())
  const statePath = path.join(ROOT, 'logs', 'watch-drive-state.json')

  // Idempotent — skip if already briefed this week
  try {
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
    if (state._sole_report_state?.week === weekNum && state._sole_report_state?.status === 'BRIEFED') {
      log(`Sole Report: already briefed for week ${weekNum} — skipping`)
      return
    }
  } catch {}

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('WARNING: Sole Report brief skipped — ANTHROPIC_API_KEY not set'); return }

  const client = new Anthropic({ apiKey })

  const prompt = `You are Big Sole Vibes media director. Generate the Sole Report article brief for this week.

The Sole Report is a weekly editorial article — GQ register, not lifestyle blog. One clear argument, delivered with Proprietor authority. 800–1,200 words. Direct, intelligent, no storytelling frame.

BSV topic universe: men's skincare (face), fragrance, foot care, grooming tools, body care, recovery. Always tied to the head-to-toe standard serious men should hold.

${bsvDirective ? `## BSV Directive\n${bsvDirective.slice(0, 1000)}\n\n` : ''}${bsvMemory ? `## Brand memory\n${bsvMemory.slice(0, 600)}\n\n` : ''}${weekStrategy ? `## This Week's Content Direction\nPrioritize a topic that aligns with this week's strategic focus.\n\n${weekStrategy}\n\n` : ''}${socialReport ? `## Current social signals\n${socialReport.content.slice(0, 800)}\n\n` : ''}Pick the topic with the highest editorial potential this week — something trending in the social signals that BSV can say something authoritative about, or a gap in the head-to-toe argument that hasn't been named clearly.

Return JSON only — no markdown fences:
{
  "topic_area": "Face|Fragrance|Foot|Body|Grooming|Recovery",
  "title": "editorial article title — concept-first, argument leads. Not a product review title.",
  "angle": "GQ or Gilt",
  "slug": "kebab-case-slug"
}`

  let brief
  try {
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    })
    const raw      = msg.content[0].text.trim()
    const stripped = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
    const start    = stripped.indexOf('{')
    const end      = stripped.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('no JSON in response')
    brief = JSON.parse(stripped.slice(start, end + 1))
    if (!brief.title || !brief.slug) throw new Error('missing title or slug')
  } catch (err) {
    log(`WARNING: Sole Report brief generation failed — ${err.message}`)
    return
  }

  try {
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
    state._sole_report_state = {
      topic_area: brief.topic_area,
      title:      brief.title,
      angle:      brief.angle || 'GQ',
      slug:       brief.slug,
      week:       weekNum,
      status:     'BRIEFED',
      updated:    new Date().toISOString().slice(0, 10),
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    log(`Sole Report brief written: week ${weekNum} — "${brief.title}" [${brief.topic_area}]`)
  } catch (err) {
    log(`WARNING: could not write Sole Report state — ${err.message}`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ media-director start ━━━')

  log('Loading directive...')
  const bsvDirective = loadDirective()
  log(`Directive: ${bsvDirective ? bsvDirective.length + ' chars' : 'not found'}`)
  log('Loading memory...')
  const bsvMemory = await loadMemory()
  log(`Memory: ${bsvMemory ? bsvMemory.length + ' chars' : 'not found'}`)

  log('Loading week strategy...')
  const weekStrategy = loadWeekStrategy()
  log(`Week strategy: ${weekStrategy ? weekStrategy.length + ' chars' : 'none — strategist may not have run'}`)

  log('Loading media director audit log...')
  const mediaAuditLog = loadMediaAuditLog(3)
  log(`Media audit log: ${mediaAuditLog ? 'history loaded' : 'no history yet'}`)

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

  log('Loading chapter state...')
  const chapterState = loadChapterState()
  log(`Chapter state: Chapter ${chapterState.active} — ${chapterState.name}`)

  log('Loading approved products from sheet...')
  let approvedProducts = []
  try {
    const conn = await sheetConnect()
    const rows = await readAllRows(conn)
    approvedProducts = rows.filter(r => r['Status'] === 'Approved' && r['Affiliate Link'])
    log(`Approved products: ${approvedProducts.length}`)
  } catch (err) {
    log(`WARNING: sheet unavailable — product assignment skipped (${err.message})`)
  }

  for (const period of ['am', 'pm']) {
    const slug     = `${targetDay}-${period}`
    const theme    = themes[period]
    const persona  = personas[period]
    const voice    = PERSONA_VOICE_MAP[persona][period]
    const lane     = PERSONA_LANE[persona]
    const hashtags = PERSONA_HASHTAGS[persona]
    const voiceDef = VOICES[voice]

    const parsed = parseSocialReport(socialReport?.content, persona)

    // Lounge social cadence override — applies to wed-pm only when within cadence window
    const loungeSlot = period === 'pm' ? getLoungeWedCadence(targetDay) : null
    if (loungeSlot) {
      log(`[${slug}] Lounge cadence: Week ${loungeSlot.week} — ${loungeSlot.ref} (${loungeSlot.format})`)
    }

    const personaContext = {
      persona,
      lane,
      voice,
      hashtags,
      socialFormat:     loungeSlot ? loungeSlot.format : (SOCIAL_FORMAT_MAP[persona] ?? 'Tall Tale'),
      verbatimPhrases:  parsed?.verbatimPhrases  ?? [],
      storyAngle:       parsed?.storyAngle        ?? null,
      hashtagSignal:    parsed?.hashtagSignal      ?? '',
      directive:        dailyDirective?.content   ?? null,
      chapterState,
      ...(loungeSlot ? {
        loungeOverride: {
          chapter:     loungeSlot.chapter,
          articleType: loungeSlot.articleType,
          ref:         loungeSlot.ref,
          angle:       loungeSlot.angle,
          format:      loungeSlot.format,
        },
      } : {}),
    }

    const effectiveTheme = loungeSlot
      ? `The Lounge — Chapter ${loungeSlot.chapter} campfire retelling`
      : theme

    log(`[${slug}] persona=${persona} voice=${voice} lane="${lane}" theme="${effectiveTheme}"`)
    log(`[${slug}] chapter mandate: Chapter ${chapterState.active} — ${chapterState.name} | campfire: ${chapterState.campfireFormat}`)
    if (parsed?.storyAngle?.hook) log(`  angle: "${parsed.storyAngle.hook}"`)
    if (parsed?.verbatimPhrases?.length) log(`  verbatim phrases: ${parsed.verbatimPhrases.length}`)

    // Cultural moment override — fires before creative-agent; skips chapter brief if true
    const culturalCheck = await checkCulturalOverride(socialReport?.content || '', new Date())
    if (culturalCheck.override) {
      log(`[${slug}] CULTURAL OVERRIDE: ${culturalCheck.moment} (source: ${culturalCheck.source})`)

      const captionText = `${culturalCheck.proprietor_take}\n\n${culturalCheck.hashtags}`
      const localCaption = path.join(TEMP_DIR, `${slug}.md`)
      fs.writeFileSync(localCaption, captionText)

      try {
        execSync(
          `rclone copyto "${localCaption}" "${REMOTE}/Ready to Post/${slug}.md"`,
          { stdio: ['pipe', 'pipe', 'pipe'] }
        )
        log(`[${slug}] Cultural caption → Drive/Ready to Post/${slug}.md`)
      } catch (err) {
        log(`ERROR: [${slug}] Drive upload failed — ${err.message}`)
      }

      // Log override to watch-drive-state.json
      try {
        const statePath = path.join(ROOT, 'logs', 'watch-drive-state.json')
        const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
        if (!state._cultural_override) state._cultural_override = {}
        state._cultural_override[slug] = {
          moment:    culturalCheck.moment,
          source:    culturalCheck.source,
          timestamp: new Date().toISOString(),
        }
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
        log(`[${slug}] Cultural override logged to watch-drive-state.json`)
      } catch (err) {
        log(`WARNING: [${slug}] Could not log cultural override — ${err.message}`)
      }

      continue // skip creative-agent; chapter brief resumes next slot
    }

    // Edition vignettes take priority over shelf rotation when an approved edition exists
    const edition = loadEditionState()
    let assignedProduct   = null
    let editionVignette   = null
    if (edition?.approved) {
      editionVignette = pickEditionVignette(edition)
      if (editionVignette) {
        // Attach the Lounge URL if the edition has been published
        if (edition.loungeUrl) editionVignette = { ...editionVignette, loungeUrl: edition.loungeUrl }
        assignedProduct = {
          'Product Name':   editionVignette.productName,
          'Affiliate Link': editionVignette.affiliateLink,
          'Category':       editionVignette.category,
          'Price':          editionVignette.price || '',
        }
        log(`[${slug}] Edition #${edition.editionNumber} vignette: "${editionVignette.productName}"${edition.loungeUrl ? ` → ${edition.loungeUrl}` : ''}`)
      }
    }
    if (!assignedProduct) {
      assignedProduct = assignProductToSlot(approvedProducts)
      if (assignedProduct) log(`[${slug}] Product (shelf rotation): "${assignedProduct['Product Name']}"`)
    }

    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'creative-agent.js'),
        '--slot',             slug,
        '--theme',            effectiveTheme,
        '--voice',            voice,
        '--voice-def',        JSON.stringify(voiceDef),
        '--persona-context',  JSON.stringify(personaContext),
        '--product',          JSON.stringify(assignedProduct ?? null),
        '--edition-vignette', JSON.stringify(editionVignette ?? null),
      ],
      { stdio: 'inherit', env: process.env }
    )
    if (result.status !== 0) log(`ERROR: creative-agent exited ${result.status} for ${slug}`)
  }

  // Persist chapter state — media-director owns this write
  saveChapterState(chapterState)
  log(`Chapter state saved: Chapter ${chapterState.active} — ${chapterState.name}`)

  // ── Append to running audit log ───────────────────────────────────────────
  try {
    const dateStr = new Date().toISOString().slice(0, 10)
    const edition = loadEditionState()
    const auditEntry = [
      `## ${dateStr} — ${targetDay}`,
      `**Chapter:** ${chapterState.active} — ${chapterState.name}`,
      `**Strategy loaded:** ${weekStrategy ? 'yes' : 'no'}`,
      `**Edition:** ${edition?.approved ? `#${edition.editionNumber} approved — vignettes active` : edition ? `#${edition.editionNumber} pending approval` : 'none'}`,
      `**Slots assigned:** ${['am','pm'].map(p => `${targetDay}-${p}`).join(', ')}`,
    ].join('\n')
    appendMediaAuditEntry(auditEntry)
  } catch (err) {
    log(`WARNING: media audit log append failed — ${err.message}`)
  }

  // Saturday: generate Sole Report brief for Sunday night's blog-agent --sole-report run
  if (targetDay === 'sat') {
    log('Saturday run — generating Sole Report brief...')
    try {
      await generateSoleReportBrief({ bsvDirective: dailyDirective?.content, socialReport, bsvMemory })
    } catch (err) {
      log(`WARNING: Sole Report brief Drive upload failed — ${err.message} — continuing to gemini-bridge`)
    }
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
