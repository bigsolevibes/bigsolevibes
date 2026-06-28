// learn.js — Big D correction → pipeline memory
//
// When Big D flags something wrong in chat, Big C runs this script.
// Two things happen simultaneously:
//   1. The correction is appended to BSV-Directive.md on Drive (read by ALL pipeline agents)
//   2. The correction is written to logs/creative-directives.json (read by creative-agent on every run)
//
// Usage:
//   node scripts/learn.js --note "image briefs are generating stock-photo energy"
//   node scripts/learn.js --note "captions are not naming the product"
//   node scripts/learn.js --list    (show all active Big D corrections)
//   node scripts/learn.js --clear   (clear Big D corrections — use when issue is resolved)
//
// Big C: call this any time Big D expresses dissatisfaction with creative output.
// The correction takes effect on the NEXT creative-agent run — no restart needed.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { execSync } = require('child_process')
const path         = require('path')
const fs           = require('fs')
const os           = require('os')

const ROOT            = path.join(__dirname, '..')
const DIRECTIVES_FILE = path.join(ROOT, 'logs', 'creative-directives.json')
const LOG_FILE        = path.join(ROOT, 'logs', 'learn.log')
const TEMP_DIR        = path.join(os.tmpdir(), 'bsv-learn')
const REMOTE          = 'big sole vibes:Big Sole Vibes'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function loadDirectives() {
  try {
    if (fs.existsSync(DIRECTIVES_FILE)) return JSON.parse(fs.readFileSync(DIRECTIVES_FILE, 'utf8'))
  } catch {}
  return {}
}

function saveDirectives(d) {
  fs.mkdirSync(path.dirname(DIRECTIVES_FILE), { recursive: true })
  fs.writeFileSync(DIRECTIVES_FILE, JSON.stringify(d, null, 2))
}

async function appendToDirectiveDoc(note, dateStr) {
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  const localPath = path.join(TEMP_DIR, 'BSV-Directive.md')

  // Pull current BSV-Directive.md from Drive
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {}

  let content = ''
  if (fs.existsSync(localPath)) {
    content = fs.readFileSync(localPath, 'utf8')
  } else {
    content = `# BSV Directive\n\nThis document is read by all pipeline agents. It takes precedence over BSV-Memory.md on operational decisions.\n`
  }

  // Find or create a ## Corrections section
  const correctionEntry = `- [${dateStr}] ${note}`
  if (content.includes('## Big D Corrections')) {
    // Append under existing section
    content = content.replace(
      /(## Big D Corrections[\s\S]*?)(\n##\s|\n#\s|$)/,
      (match, section, next) => `${section.trimEnd()}\n${correctionEntry}\n${next}`
    )
  } else {
    content = content.trimEnd() + `\n\n## Big D Corrections\n\nThe following are direct corrections from Big D. They are non-negotiable and apply immediately to all content production.\n\n${correctionEntry}\n`
  }

  fs.writeFileSync(localPath, content)

  // Push back to Drive
  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/BSV-Directive.md"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch (err) {
    log(`WARNING: Drive upload failed — ${err.message}`)
    return false
  }
}

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })

  const args  = process.argv.slice(2)
  const list  = args.includes('--list')
  const clear = args.includes('--clear')
  const noteIdx = args.indexOf('--note')
  const note    = noteIdx !== -1 ? args[noteIdx + 1] : null

  // ── List mode ────────────────────────────────────────────────────────────────
  if (list) {
    const d = loadDirectives()
    const corrections = d.big_d?.corrections ?? []
    if (!corrections.length) {
      console.log('No active Big D corrections.')
    } else {
      console.log(`\nActive Big D corrections (${corrections.length}):\n`)
      corrections.forEach((c, i) => console.log(`  ${i + 1}. [${c.date}] ${c.note}`))
      console.log('')
    }
    return
  }

  // ── Clear mode ───────────────────────────────────────────────────────────────
  if (clear) {
    const d = loadDirectives()
    const count = d.big_d?.corrections?.length ?? 0
    d.big_d = { corrections: [], clearedAt: new Date().toISOString() }
    saveDirectives(d)
    log(`Cleared ${count} Big D correction(s)`)
    console.log(`Cleared ${count} correction(s) from creative-directives.json.`)
    console.log('Note: BSV-Directive.md on Drive still has the entries — remove manually if needed.')
    return
  }

  // ── Add correction ───────────────────────────────────────────────────────────
  if (!note) {
    console.error('Usage: node scripts/learn.js --note "what was wrong"')
    console.error('       node scripts/learn.js --list')
    console.error('       node scripts/learn.js --clear')
    process.exit(1)
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  log(`Recording correction: "${note}"`)

  // 1. Write to creative-directives.json immediately
  const d = loadDirectives()
  if (!d.big_d) d.big_d = { corrections: [] }
  if (!Array.isArray(d.big_d.corrections)) d.big_d.corrections = []
  d.big_d.corrections.push({ date: dateStr, note })
  d.big_d.updatedAt = new Date().toISOString()
  saveDirectives(d)
  log(`creative-directives.json updated — ${d.big_d.corrections.length} Big D correction(s) active`)

  // 2. Append to BSV-Directive.md on Drive
  const driveOk = await appendToDirectiveDoc(note, dateStr)
  log(`BSV-Directive.md on Drive: ${driveOk ? 'updated' : 'failed (local copy updated)'}`)

  // 3. Telegram confirm
  try {
    const { sendTelegram } = require('./telegram')
    await sendTelegram(`📝 *Correction recorded*\n\n"${note}"\n\nActive in creative-agent from next run.`)
  } catch {}

  console.log(`\n✅ Correction recorded: "${note}"`)
  console.log(`   → creative-directives.json: active immediately`)
  console.log(`   → BSV-Directive.md (Drive): ${driveOk ? 'updated' : 'FAILED — check Drive manually'}`)
  console.log(`\nAll future briefs will enforce this correction until you run --clear.\n`)
})()
