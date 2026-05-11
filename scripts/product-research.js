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

    const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}You are the Affiliate Research Director for Big Sole Vibes (BSV). Every product you recommend must earn its place according to the Proprietor's Directive above — curated like a man who has done the work, not like an algorithm surfacing bestsellers.

Your job is to find products BSV can authentically recommend and earn affiliate revenue from. You are building a continuous product queue. Never recommend products with ASINs already in the sheet. Align picks with this week's content themes and brand signals.

BSV Audience: Men 28–45 who take grooming seriously but don't broadcast it. They buy quality without needing validation. They respond to specificity over hype. Go deeper than search results — find what men who actually take this seriously use.

Scoring criteria — a product earns a place on the shortlist only if it passes all of these:
1. Amazon 4.5+ stars with 500+ genuine reviews
2. Price point $10–$50 (impulse-to-considered purchase range)
3. Amazon Associates eligible (not restricted/sold by third-party only)
4. Premium positioning — could appear next to BSV content without embarrassing the brand
5. Ingredient quality — real actives, not fragrance-forward filler
6. Men's use case — either explicitly marketed to men or clearly unisex without being feminine

For each qualifying product you find, score it 1–10 against each criterion and give a total score. Include the ASIN, current price, review count, and a one-sentence BSV content angle (how would we feature this in a post?).

## Existing product queue — DO NOT recommend any of these ASINs
${sheetSummary}
${weeklyPlan  ? `\n## This week's content plan\n${weeklyPlan.content}`   : ''}
${brandReport ? `\n## Brand signals and trending topics\n${brandReport.content}` : ''}`

    const userPrompt = `Search Amazon and the web for the best men's foot care products to add to BSV's affiliate shortlist this week.

Focus areas:
- Foot creams, balms, and moisturizers (primary category)
- Exfoliating scrubs and pumice tools
- Antifungal and odor-control treatments (premium positioned, not medical-clinical)
- Foot soaks and recovery products
- Compression socks and recovery footwear (if premium brands)

Search for recently launched products as well as established bestsellers with strong review velocity.

${previous ? `## Previous research (for context — do not re-recommend anything already in the queue)\n${previous.content}` : '## No previous research — build the initial shortlist from scratch'}

---

Output format:

# BSV Affiliate Product Research — ${today}

## Shortlist (scored and ranked)
For each product: Name, ASIN, Price, Reviews, BSV Score (/50), breakdown by criterion, content angle.

## Watchlist
Products that almost made it — flag why they didn't qualify and what would change that.

## Category Gaps
What types of products are underrepresented in the shortlist that BSV should actively seek?

## Revenue Estimate
Rough estimate: if BSV featured the top 3 products once each per week for a month at 2% conversion on 1,000 engaged followers, what's the affiliate revenue potential?`

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
      content: `From the research below, extract the top 12 affiliate products for BSV review.

Return a JSON array with this exact shape:
[
  {
    "name": "Product Name",
    "category": "Foot Serums | Foot Creams | Foot Powders | Foot Grooming Tools | Foot Soaks & Recovery | Nail Care | Full Kits",
    "asin": "B00XXXXXXX",
    "price": "$XX",
    "score": "42/50",
    "description": "One sentence — BSV voice: direct, specific, no hype. This is what appears on the shop card.",
    "reasoning": "One sentence on why this made the cut — the key differentiator that earned its place."
  }
]

Rules:
- Pick the 12 highest-scoring products from the Shortlist
- description must be 1 sentence, BSV voice: factual, confident, no exclamation marks
- reasoning must be 1 sentence focused on what makes it stand out
- category must exactly match one of the seven values above
- score must be "XX/50" format

Research:
${fullText}`,
    }],
  })

  const jsonText = extractResponse.content.filter(b => b.type === 'text').map(b => b.text).join('')
  let picks
  try {
    const cleaned = jsonText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    picks = JSON.parse(cleaned)
    if (!Array.isArray(picks)) throw new Error('expected array')
  } catch (err) {
    log(`WARNING: JSON parse failed — ${err.message} — skipping sheet update`)
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
