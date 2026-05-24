require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// strategist.js — BSV weekly strategy brief generator
//
// Runs Sunday 7:00 AM via launchd — before chief-of-staff, before media-director,
// before anything else. Sets the week's direction.
//
// Reads: BSV-Memory.md, BSV-Directive.md, brand-health, social-report, standup,
//        Google Sheet (full approved/pending shelf), newsletter-state.json, post-state.json
//
// Writes:
//   logs/strategy-active.md  — local cache read by downstream agents this week
//   Drive → Plans/strategy-YYYY-MM-DD.md  — picked up by blog-agent, product-research
//   Telegram → Big D for awareness (not approval)
//
// One rule: never reports on failures, never triages errors, never monitors
// the pipeline. That is eng-bot and chief's job. Only looks forward.
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic    = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path         = require('path')
const fs           = require('fs')
const os           = require('os')
const { connect, readAllRows } = require('./sheets-client')
const { sendTelegram }         = require('./telegram')

const ROOT       = path.join(__dirname, '..')
const LOG_FILE   = path.join(ROOT, 'logs', 'strategist.log')
const ACTIVE_FILE = path.join(ROOT, 'logs', 'strategy-active.md')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-strategist')
const REMOTE     = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDriveFile(remotePath) {
  try {
    const filename = path.basename(remotePath)
    execSync(`rclone copy "${remotePath}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const local = path.join(TEMP_DIR, filename)
    return fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null
  } catch { return null }
}

function loadLatestReport(prefix, folder = 'Reports') {
  try {
    const files = execSync(`rclone ls "${REMOTE}/${folder}"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.startsWith(prefix + '-') && f.endsWith('.md'))
      .sort()
    if (!files.length) return null
    const latest  = files[files.length - 1]
    const content = loadDriveFile(`${REMOTE}/${folder}/${latest}`)
    return content ? { filename: latest, content } : null
  } catch { return null }
}

// ─── Section extraction ───────────────────────────────────────────────────────

function extractSection(markdown, heading) {
  const re = new RegExp(
    `##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|\\n#\\s|$)`,
    'i'
  )
  const m = markdown.match(re)
  return m ? m[1].trim() : null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ strategist start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `strategy-${today}.md`

  // ─── Load all inputs ───────────────────────────────────────────────────────

  log('Loading BSV-Directive.md...')
  const directive = loadDriveFile(`${REMOTE}/BSV-Directive.md`)
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading BSV-Memory.md...')
  const memory = await (require('./lib/memory').loadMemoryById())
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  log('Loading brand-health report...')
  const brandHealth = loadLatestReport('brand-health')
  log(`Brand health: ${brandHealth ? brandHealth.filename : 'none'}`)

  log('Loading social report...')
  const socialReport = loadLatestReport('social-report')
  log(`Social report: ${socialReport ? socialReport.filename : 'none'}`)

  log('Loading latest standup...')
  const standup = loadLatestReport('standup')
  log(`Standup: ${standup ? standup.filename : 'none'}`)

  log('Reading Google Sheet...')
  let shelfProducts = []
  try {
    const conn = await connect()
    const rows = await readAllRows(conn)
    shelfProducts = rows.filter(r => {
      const status = (r['Status'] || '').trim().toLowerCase()
      return status === 'approved' || status === 'pending'
    })
    log(`Sheet: ${shelfProducts.length} product(s) (approved + pending)`)
  } catch (err) {
    log(`WARNING: sheet read failed — ${err.message}`)
  }

  log('Reading newsletter-state.json...')
  let newsletterState = null
  try {
    const p = path.join(ROOT, 'logs', 'newsletter-state.json')
    if (fs.existsSync(p)) newsletterState = JSON.parse(fs.readFileSync(p, 'utf8'))
    log(`Newsletter state: ${newsletterState ? 'loaded' : 'none'}`)
  } catch { log('Newsletter state: none') }

  log('Reading post-state.json...')
  let postState = []
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    if (fs.existsSync(p)) postState = JSON.parse(fs.readFileSync(p, 'utf8'))
    log(`Post state: ${postState.length} entries`)
  } catch { log('Post state: none') }

  // ─── Build context blocks ──────────────────────────────────────────────────

  // Shelf grouped by category with tier classification
  const shelfByCategory = {}
  for (const r of shelfProducts) {
    const cat = r['Category'] || 'Uncategorized'
    if (!shelfByCategory[cat]) shelfByCategory[cat] = []
    const price = parseFloat((r['Price'] || '').replace(/[^0-9.]/g, '')) || 0
    const tier  = price >= 200 ? 'Aspiration ($200–500)'
      : price >= 40            ? 'Standard ($40–100)'
      : price > 0              ? 'Entry ($15–40)'
      : 'Unknown tier'
    shelfByCategory[cat].push(
      `${r['Product Name']} — ${r['Price'] || '?'} [${tier}] [${r['Status']}] score: ${r['Score'] || '?'}`
    )
  }
  const shelfSummary = Object.entries(shelfByCategory)
    .map(([cat, items]) => `**${cat}**\n${items.map(i => `  • ${i}`).join('\n')}`)
    .join('\n\n') || 'No products loaded.'

  // Newsletter rotation
  const loungeRotation = (newsletterState?.lounge?.featured || [])
  const dropRotation   = (newsletterState?.drop?.featured   || [])
  const newsletterCtx  = [
    `Lounge featured so far this rotation: ${loungeRotation.length ? loungeRotation.join(', ') : 'none yet'}`,
    `Drop featured so far this rotation:   ${dropRotation.length   ? dropRotation.join(', ')   : 'none yet'}`,
  ].join('\n')

  // Recent content slots
  const successEntries = postState.filter(e => e.status === 'success')
  const recentSlots    = [...new Set(successEntries.slice(-20).map(e => e.slot))].join(', ') || 'none'

  // ─── System prompt ────────────────────────────────────────────────────────

  const systemPrompt = [
    directive,
    memory,
    `You are the BSV Strategist. You think in terms of the model:

- Aspiration tier ($200–500): makes the man want to be in the room
- Standard tier ($40–100): where the commission flows
- Entry tier ($15–40): removes every excuse not to start

Your job is not to report what happened.
Your job is to decide what should happen next and why.

Every output must answer three questions:
1. Where is the shelf weak right now and what does product-research need to find this week?
2. What is the one story the content pipeline should tell this week and why does it serve the model?
3. What does the audience need to feel this week to move closer to buying?

You are not a monitor. You are not a reporter.
You are the only agent thinking about growth.

One rule: never report on failures, never triage errors, never monitor the pipeline. That is eng-bot and chief's job. You only look forward.

The Proprietor's Foot Balm does not exist yet on the shelf. Do not reference it as a buyable product. It can appear as "coming" in The Week's Story if contextually natural — never as a linked product.`,
  ].filter(Boolean).join('\n\n---\n\n')

  // ─── User prompt ──────────────────────────────────────────────────────────

  const userPrompt = `Write the BSV Strategy Brief for the week of ${today}.

## Current shelf
${shelfSummary}

## Newsletter rotation
${newsletterCtx}

## Recent content run (last 20 successful slots)
${recentSlots}

## Brand health (${brandHealth?.filename || 'unavailable'})
${brandHealth ? brandHealth.content.slice(0, 1500) : '(not available)'}

## Social intelligence (${socialReport?.filename || 'unavailable'})
${socialReport ? socialReport.content.slice(0, 1200) : '(not available)'}

## Last standup (${standup?.filename || 'unavailable'})
${standup ? standup.content.slice(0, 1000) : '(not available)'}

---

Write the strategy brief using EXACTLY this structure. No additional sections. No commentary outside the sections.

# BSV Strategy Brief — ${today}

## The Model This Week
[2–3 sentences. Where BSV stands against the aspiration/standard/entry framework right now. Not a status report — a diagnosis. What is out of balance and why it matters for growth.]

## Shelf Gap
[What the shelf is missing by category and price tier. Specific direction for product-research this week — not "find foot care products" but the exact category, tier, source channel, and narrative hook that serves the week's story. One focused paragraph.]

## The Week's Story
[One narrative thread the entire content pipeline runs this week. Not a theme — a story. Who is the man this week, what is he doing, what does he reach for, where do his feet end up at the end of it. Two to three sentences, present tense.]

## Content Direction
[Exactly 3 content angles for media-director to assign across the week's slots. Each angle: one sentence of direction, which slot energy it fits (AM or PM), and at least one shelf product at each price tier tied to it. Numbered list — no sub-bullets.]

## Audience Move
[What newsletter and social content should make the audience feel this week. Not an engagement tactic — an emotional direction. One or two sentences. Present tense. Example: "This week the man recognizes the gap." Or: "This week the man already knows — he's waiting for someone to name it."]

## Chief Directive
[One paragraph. What chief-of-staff reads at the top of Monday's standup above all pipeline status. Direct. Actionable. Starts with what to do this week, not what happened last week.]`

  // ─── Call Claude API ──────────────────────────────────────────────────────

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  let strategyText = ''
  try {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })
    strategyText = (msg.content[0]?.text || '').trim()
    log(`Generated: ${strategyText.length} chars, ${msg.usage?.output_tokens ?? '?'} tokens`)
  } catch (err) {
    log(`ERROR: Claude API failed — ${err.message}`)
    process.exit(1)
  }

  if (!strategyText) {
    log('ERROR: empty response from Claude')
    process.exit(1)
  }

  // ─── Write local cache — downstream agents read this directly ─────────────

  fs.writeFileSync(ACTIVE_FILE, strategyText)
  log(`Written → ${ACTIVE_FILE}`)

  // ─── Upload to Drive → Plans/ — blog-agent and product-research pick up here

  const localPath = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localPath, strategyText)
  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Plans/${outFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log(`Uploaded → ${REMOTE}/Plans/${outFile}`)
  } catch (err) {
    log(`WARNING: Drive upload failed — ${err.stderr?.toString().trim() || err.message}`)
    log('Local cache still available for downstream agents this week')
  }

  // ─── Extract key sections for Telegram ───────────────────────────────────

  const shelfGap  = extractSection(strategyText, 'Shelf Gap')
  const weekStory = extractSection(strategyText, "The Week's Story")
  const chiefDir  = extractSection(strategyText, 'Chief Directive')

  const oneliner = (s) => (s || '(see brief)').replace(/\n/g, ' ').slice(0, 130)

  await sendTelegram([
    `🧠 *BSV — Strategy Brief Ready — week of ${today}*`,
    ``,
    `*Shelf gap:* ${oneliner(shelfGap)}`,
    `*This week's story:* ${oneliner(weekStory)}`,
    `*Chief directive:* ${oneliner(chiefDir)}`,
    ``,
    `Full brief in Drive → Plans/${outFile}`,
  ].join('\n'))

  log('━━━ strategist complete ━━━\n')
})()
