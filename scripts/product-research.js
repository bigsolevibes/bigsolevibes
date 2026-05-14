require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { connect, ensureHeaders, readAllRows, appendPick } = require('./sheets-client')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'product-research.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-product-research')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function loadMemory() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Memory.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Memory.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function getPreviousResearch() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Product Research"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^research-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()

    if (!files.length) return null
    const latest = files[files.length - 1]
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Product Research/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

function loadProductBrief() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Product Development"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^product-brief-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Product Development/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// Returns { filename, content } for the alphabetically-latest .md in a Drive folder.
function getLatestDriveFile(folder) {
  try {
    const files = execSync(`rclone ls --max-depth 1 "${REMOTE}/${folder}"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.endsWith('.md'))
      .sort()

    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/${folder}/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, path.basename(latest))
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  const skipResearch = process.argv.includes('--skip-research')
  const dryRun       = process.argv.includes('--dry-run')

  log(`━━━ product-research start ━━━${skipResearch ? ' [skip-research]' : ''}${dryRun ? ' [dry-run]' : ''}`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `research-${today}.md`

  // ─── Read sheet up front — needed for research prompt exclusions + write dedup
  log('Reading Google Sheet for existing product queue...')
  let conn
  let sheetRows = []
  try {
    conn = await connect()
    await ensureHeaders(conn)
    sheetRows = await readAllRows(conn)
    log(`Sheet: ${sheetRows.length} existing row(s)`)
  } catch (err) {
    log(`WARNING: could not read sheet — ${err.message}`)
  }

  const existingAsins = new Set(sheetRows.map(r => r['ASIN']).filter(Boolean))
  const sheetSummary  = sheetRows.length
    ? sheetRows.map(r => `- ${r['ASIN']} (${r['Status'] || 'Unknown'}): ${r['Name'] || ''}`.trim()).join('\n')
    : 'None yet.'

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory = loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  log('Loading product development brief...')
  const productBrief = loadProductBrief()
  log(`Product brief: ${productBrief ? productBrief.filename : 'none'}`)

  const previous = getPreviousResearch()
  log(`Previous research: ${previous ? previous.filename : 'none'}`)

  let fullText = ''

  if (skipResearch) {
    if (!previous) {
      log('ERROR: --skip-research requires an existing research file in Drive — none found')
      process.exit(1)
    }
    fullText = previous.content
    log(`--skip-research: using ${previous.filename} as research input`)
  } else {
    // ─── Read weekly plan and brand report ───────────────────────────────────
    const weeklyPlan  = getLatestDriveFile('Plans')
    const brandReport = getLatestDriveFile('Brand')
    log(`Weekly plan:  ${weeklyPlan  ? weeklyPlan.filename  : 'none'}`)
    log(`Brand report: ${brandReport ? brandReport.filename : 'none'}`)

    const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the BSV Product Curator. Everything you recommend must earn its place according to the Proprietor's Directive above.

Your job is not to find solutions to foot problems. Your job is to find products that belong in the ritual of a man who already takes his core seriously.

The BSV man is not broken. He is not searching for a fix. He is building a practice — the same way he thinks about his skincare, his grooming kit, his workout recovery, his bourbon. He wants to know what belongs in his rotation, not what fixes a problem.

The test question for every product: "Would a man who has his life together reach for this as part of how he takes care of himself — or does it belong in the medicine cabinet next to the bandaids?"

If it's medicine cabinet — it's off the shelf. Full stop.

## What stays off the shelf permanently

- Antifungal treatments
- Medicated anything
- Products whose primary positioning is fixing a visible problem
- Anything that would embarrass a man to have on his bathroom counter
- Anything findable on the first page of a Google search for "best foot cream"

## Source hierarchy — go in this order

1. **Professional channels** — what are podiatrists, athletic trainers, and physical therapists actually recommending to patients who take care of themselves
2. **Specialty retailers** — what's on the shelf at high-end grooming shops, men's specialty stores, apothecaries
3. **Athletic and performance community** — what are serious athletes, coaches, and trainers using for recovery and maintenance
4. **Barber and grooming insider community** — what do the best barbers recommend their clients add to their home routine
5. **Understated brands** — products that have earned a quiet reputation without mass marketing
6. **Amazon as a last check only** — confirm availability and pricing, never as a discovery source

## Scoring — 100 points total

| Criterion | Weight | Question |
|-----------|--------|----------|
| Ritual fit | 25% | Does this belong in a man's grooming rotation, not his medicine cabinet? |
| Discovery depth | 20% | Would the BSV man find this himself on a Google search? If yes, score lower. |
| Ingredient/quality standard | 20% | Is this genuinely premium or just premium-priced? |
| Story | 20% | Is there a real reason this earned its place — not just ratings and reviews? |
| Availability | 15% | Can he actually buy it — Amazon, brand direct, or specialty retail? |

Score each criterion 0–10, weight it, sum to 100. A product needs 70+ to make the shortlist.

## The Proprietor's Audit

Every shortlisted product must include a reasoning field that answers: "Why does this belong on the BSV shelf — not what problem it solves, but what standard it upholds and why a man who takes his core seriously would reach for it."

If the reasoning sounds like a product description or an Amazon review, send it back. It should sound like the Proprietor looked at it, picked it up, and decided it belonged.

## Existing product queue — DO NOT recommend any of these ASINs
${sheetSummary}
${weeklyPlan  ? `\n## This week's content context\n${weeklyPlan.content.slice(0, 2000)}` : ''}
${brandReport ? `\n## Brand signals\n${brandReport.content.slice(0, 1000)}` : ''}

## BSV Private Label Roadmap — Mandatory Context

BSV is developing its own private label product — Proprietor's Foot Balm. Your affiliate recommendations must not conflict with or undermine this roadmap.

Specifically:
- Do not recommend foot balms that occupy the same positioning as Proprietor's Foot Balm
- Do not recommend products that would cannibalize the $35–50 premium balm category BSV will own
- Do recommend products that complement the ritual — tools, soaks, recovery items that sit alongside the balm, not against it

Product-research and product-development are teammates — one curates the shelf today, the other builds what owns the shelf tomorrow. They do not work against each other.
${productBrief ? `\nCurrent development brief (${productBrief.filename}):\n${productBrief.content.slice(0, 1000)}${productBrief.content.length > 1000 ? '\n[truncated]' : ''}` : ''}`

    const userPrompt = `You are a product curator searching for items that belong on the BSV shelf. You are not searching for what most men would find — you are searching for what a man who takes himself seriously would find if he actually went looking.

## Exact search queries to run — use these verbatim

Run each of the following searches and dig into the results. Do not summarize. Find actual products with names, prices, and purchase URLs.

**Discovery searches:**
- "luxury men's foot ritual UK"
- "professional grade men's foot treatment"
- "high end men's pedicure products"
- "men's foot care sold at Gilt Barneys Nordstrom"
- "spa quality men's foot soak men"
- "men's grooming independent brands not Amazon"
- "men's lower leg recovery tool premium"
- "magnesium foot soak athletic recovery ritual"
- "apothecary men's foot care understated"
- "men's grooming Huckberry exclusive"

**Search these specific retailer sites directly** — look at their men's grooming and recovery sections:
- site:huckberry.com men's grooming OR foot OR recovery
- site:groominglounge.com foot OR leg OR recovery
- site:artofshaving.com foot OR body
- site:gilt.com men's grooming
- site:nordstrom.com men's foot care OR body care OR grooming tools

**Niche and independent brand searches:**
- "men's grooming cult brand UK apothecary"
- "men's foot soak DTC brand intentional packaging"
- "premium calf compression men's recovery"
- "men's skin care dermatologist formulated understated"

## What you are looking for

Products anchored at the foot and working up. The man who buys Proprietor's Foot Balm also owns these. Every pick must pass the checkout test: would the BSV man reach for it without needing to explain it to anyone?

Categories: premium foot soaks, lower-leg and calf recovery tools, compression and circulation products, clean-positioning grooming brands (Caldera + Lab register), understated body treatments with serious ingredient decks.

Hard exclusions: medicated, antifungal, problem-positioned, first-page generic Google results, loud or juvenile packaging, anything clinical-looking, anything you'd find in a drugstore.

${previous ? `## Previous research (do not re-recommend anything already in the queue)\n${previous.content.slice(0, 2000)}${previous.content.length > 2000 ? '\n[truncated]' : ''}` : '## No previous research — build the initial shortlist from scratch.'}

---

# BSV Product Curation Report — ${today}

## The Shelf (shortlist, scored and ranked)
For each product: Name, source where discovered, ASIN or purchase URL, price, score breakdown (ritual fit / discovery depth / quality / story / availability = total/100), and the Proprietor's Audit field — one paragraph, written as if the Proprietor picked it up and decided it belonged.

## Held Back
Products that showed promise but didn't clear 70 — what kept them off the shelf and what would change that.

## Discovery Notes
Where the best finds came from this cycle. Which source channels are producing and which are dry.

## Shelf Gaps
What categories or product types are underrepresented that BSV should actively seek next cycle.

## Revenue Estimate
If BSV featured the top 3 products once each per week for a month at 2% conversion on 1,000 engaged followers — rough affiliate revenue potential.`

    log('Calling Claude API with web search...')
    const researchClient = new Anthropic({ apiKey })
    let messages = [{ role: 'user', content: userPrompt }]
    let turns     = 0
    const MAX_TURNS = 10

    while (turns < MAX_TURNS) {
      turns++
      log(`Turn ${turns}...`)

      const response = await researchClient.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 8192,
        system:     systemPrompt,
        tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
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
      execSync(`rclone copyto "${localPath}" "${REMOTE}/Product Research/${outFile}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      log(`Uploaded → ${REMOTE}/Product Research/${outFile}`)
    } catch (err) {
      log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
      process.exit(1)
    }
  }

  // ─── Extract structured picks → BSV Product Queue sheet ──────────────────
  log('Extracting structured picks for product queue...')

  const client = new Anthropic({ apiKey })
  const extractResponse = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system:     'You extract structured product data from research documents. Return only valid JSON — no markdown fences, no commentary.',
    messages:   [{
      role: 'user',
      content: `From the research below, extract the top 12 products from the shelf shortlist for BSV review.

Return a JSON array with this exact shape:
[
  {
    "name": "Product Name",
    "category": "Skincare | Grooming Tools | Body Care | Hair Care | Recovery | Foot Care | Nail Care | Full Kits",
    "asin": "B00XXXXXXX",
    "price": "$XX",
    "score": "82/100",
    "description": "One sentence — BSV voice: direct, specific, no hype. This is what appears on the shop card.",
    "reasoning": "The Proprietor's Audit — one paragraph explaining why this belongs on the BSV shelf: what standard it upholds, why a man who takes his core seriously would reach for it. Not a product description. Not an Amazon review."
  }
]

Rules:
- Pick the 12 highest-scoring products from The Shelf section
- description: 1 sentence, BSV voice — factual, confident, no exclamation marks
- reasoning: the Proprietor's Audit paragraph from the research — preserve it exactly, do not summarize
- category must exactly match one of the eight values above
- score must be "XX/100" format
- If a product has no ASIN, use its brand direct or specialty retailer URL in the asin field

Research:
${fullText}`,
    }],
  })

  const jsonText = extractResponse.content.filter(b => b.type === 'text').map(b => b.text).join('')
  let picks
  try {
    // Strip markdown fences, then extract from first '[' to last ']' to
    // handle any trailing text or commentary the model appended after the array
    const stripped = jsonText.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
    const start = stripped.indexOf('[')
    const end   = stripped.lastIndexOf(']')
    if (start === -1 || end === -1 || end <= start) throw new Error('no JSON array found in response')
    picks = JSON.parse(stripped.slice(start, end + 1))
    if (!Array.isArray(picks)) throw new Error('expected array')
    log(`Extracted ${picks.length} picks from JSON`)
  } catch (err) {
    log(`WARNING: JSON parse failed — ${err.message}`)
    log(`Raw response (first 500 chars): ${jsonText.slice(0, 500)}`)
    log('━━━ product-research complete ━━━\n')
    return
  }

  // Write picks to Google Sheet as Pending — sync-shop.js deploys approved rows
  try {
    if (!conn) {
      conn = await connect()
      await ensureHeaders(conn)
    }

    let added = 0
    for (const pick of picks) {
      if (existingAsins.has(pick.asin)) {
        log(`  Sheet: ${pick.asin} already present — skipping`)
        continue
      }
      if (dryRun) {
        log(`  [dry-run] would append "${pick.name}" (${pick.asin}) → Pending`)
      } else {
        await appendPick(conn, pick)
        log(`  Sheet: appended "${pick.name}" (${pick.asin}) → Pending`)
      }
      added++
    }
    log(`Sheet update complete — ${added} new row(s) ${dryRun ? 'would be added (dry-run)' : 'added'}, ${picks.length - added} skipped`)
  } catch (err) {
    log(`WARNING: sheet update failed — ${err.message}`)
  }

  log('━━━ product-research complete ━━━\n')
})()
