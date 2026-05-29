require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT      = path.join(__dirname, '..')
const LOG_FILE  = path.join(ROOT, 'logs', 'product-development.log')
const LOCK_FILE = path.join(ROOT, 'logs', 'product-development.lock')
const TEMP_DIR  = path.join(os.homedir(), 'tmp', 'bsv-product-development')
const REMOTE    = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Lockfile guard ───────────────────────────────────────────────────────────

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim()
    log(`Already running (PID ${pid}) — exiting to avoid double-instance`)
    process.exit(0)
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid))
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE) } catch {}
}

process.on('exit',            releaseLock)
process.on('SIGTERM',         () => process.exit(0))
process.on('SIGINT',          () => process.exit(0))
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.stack || err.message}`)
  process.exit(1)
})

// ─── Drive helpers ────────────────────────────────────────────────────────────

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

function getPreviousBrief() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Product Development"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^product-brief-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()

    if (!files.length) return null
    const latest = files[files.length - 1]
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Product Development/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  acquireLock()
  log('━━━ product-development start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `product-brief-${today}.md`

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const previous = getPreviousBrief()
  log(`Previous brief: ${previous ? previous.filename : 'none — starting fresh'}`)

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the Product Development Director for Big Sole Vibes (BSV) — a premium men's foot care brand preparing to launch its first private label product: Proprietor's Foot Balm.

## Ritual Positioning — The Foundation

This product is not a fix for a foot problem. It is an addition to a man's ritual. The same man who takes his skincare seriously, his grooming seriously, his recovery seriously. The Proprietor's Foot Balm earns its place on that counter — not in the medicine cabinet.

Every manufacturer, every formulation choice, every packaging decision must serve this positioning. If it looks like something you'd find under a drugstore shelf next to the bandaids, start over.

## Product Vision
- **Name:** Proprietor's Foot Balm
- **Positioning:** "Nothing goes on this shelf that hasn't earned its place. This earned it."
- **Target retail price:** $35–$50
- **Packaging:** Midnight (#0D1B2A) and Bourbon (#C17D2E) colorway. Heavy, substantial packaging. Not disposable-feeling.
- **Formulation:** Premium actives — shea butter, urea, tea tree, or equivalent. No synthetic fragrance as primary ingredient. Long-lasting moisture with fast absorption.
- **Launch condition:** When BSV audience is proven (10K+ engaged followers) and affiliate revenue is flowing.

Your job is to build and maintain a living product brief that gets more complete and actionable every week. You research real vendors, real MOQs, real prices, and real regulatory requirements. No vague guidance — this brief should be ready to hand to a manufacturer.

Each week you advance the brief by researching one or two specific areas in depth. You build on previous research rather than repeating it.`

  const researchFocus = previous
    ? `This week, advance the brief by researching areas that are incomplete or missing from the previous version. Prioritize whichever of these has the least coverage: (1) specific private label manufacturers with confirmed MOQs and pricing, (2) premium packaging suppliers for 1–5oz balm formats with Pantone color matching, (3) FDA compliance specifics for topical cosmetics (labeling requirements, ingredient restrictions, shelf-life testing), (4) competitive pricing analysis for $35–50 premium foot balms currently on market.`
    : `This is the first brief. Research all four areas: (1) private label foot balm manufacturers — find at least 3 real suppliers with MOQ and price range, (2) premium packaging options for a 2oz balm with custom colorway, (3) FDA requirements for topical cosmetic products sold in the US, (4) competitive landscape — what premium foot balms exist at $35–50 and how are they positioned.`

  const userPrompt = `Build the BSV Proprietor's Foot Balm product brief for ${today}.

${researchFocus}

${previous ? `## Previous brief (build on this — do not repeat, only advance)\n${previous.content}` : '## No previous brief — create the foundation.'}

---

Output a complete, updated product brief in this structure:

# Proprietor's Foot Balm — Product Brief
**Last updated:** ${today}

## Product Overview
Vision, positioning, target price, launch condition. (Keep stable unless new info changes it.)

## Formulation
Active ingredients, texture target, scent approach, absorption profile. Flag any FDA-restricted ingredients to avoid.

## Manufacturer Shortlist
For each: company name, website, MOQ, price per unit at MOQ, lead time, notes. Mark verified (found online) vs. unverified (needs confirmation).

## Packaging Specifications
Format options (jar, tube, tin), size, material, color matching capability, MOQ, cost per unit. Specific suppliers where found.

## Regulatory Checklist
FDA requirements for topical cosmetics: labeling, ingredient disclosure, shelf-life claims, prohibited ingredients. Status: Done / In Progress / Not Started.

## Competitive Landscape
Products at $35–50 currently on market. For each: name, price, key ingredients, positioning, what BSV does differently.

## Cost Model
Best-case unit economics at launch MOQ: COGS + packaging + fulfillment = landed cost. Target 60%+ gross margin at $39 retail.

## Open Questions
Specific things that need a phone call, sample order, or legal review before moving forward.

## Next Steps
Top 3 actions for next week, specific and actionable.`

  log('Calling Claude API with web search...')
  const client = new Anthropic({ apiKey })

  let messages = [{ role: 'user', content: userPrompt }]
  let fullText  = ''
  let turns     = 0
  const MAX_TURNS = 12

  while (turns < MAX_TURNS) {
    turns++
    log(`Turn ${turns}...`)

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8192,
      system:     systemPrompt,
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }],
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    const textBlocks = response.content.filter(b => b.type === 'text')
    if (textBlocks.length) fullText = textBlocks.map(b => b.text).join('\n')

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }))
      messages.push({ role: 'user', content: toolResults })
    } else {
      break
    }
  }

  log(`Complete — ${turns} turn(s)`)

  if (!fullText.trim()) { log('ERROR: empty response'); process.exit(1) }

  const localPath = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localPath, fullText)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Product Development/${outFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log(`Uploaded → ${REMOTE}/Product Development/${outFile}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  // ── Extract milestone state for Chief of Staff ────────────────────────────────

  log('Extracting milestone state...')
  const STATE_FILE = path.join(ROOT, 'logs', 'product-development-state.json')
  try {
    const stateMsg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     'Extract structured state from this product development brief. Return ONLY valid JSON — no markdown, no explanation — with these exact fields: last_run (string YYYY-MM-DD), brief_file (string filename), milestone (string, 3–6 words, current milestone name), opportunity (string, one sentence, the single most actionable finding — or empty string if none), action_needed (boolean, true if the Proprietor needs to make a decision this week).',
      messages:   [{ role: 'user', content: `Today: ${today}\nFile: ${outFile}\n\n${fullText.slice(0, 3000)}` }],
    })
    const raw = stateMsg.content[0]?.text?.trim() || ''
    let stateObj
    try {
      stateObj = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      stateObj = m ? JSON.parse(m[0]) : null
    }
    if (stateObj) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(stateObj, null, 2))
      log(`State JSON written → ${STATE_FILE}`)
      log(`  Milestone:     ${stateObj.milestone}`)
      log(`  Opportunity:   ${stateObj.opportunity || '(none)'}`)
      log(`  Action needed: ${stateObj.action_needed}`)
    } else {
      log('WARNING: could not parse state JSON — writing fallback')
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        last_run: today, brief_file: outFile,
        milestone: 'See brief', opportunity: '', action_needed: false,
      }, null, 2))
    }
  } catch (err) {
    log(`WARNING: state extraction failed: ${err.message}`)
  }

  log('━━━ product-development complete ━━━\n')
})()
