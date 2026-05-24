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

const AFFILIATE_TAG = process.env.AMAZON_AFFILIATE_TAG || 'bigsolevibes-20'

// Pillar → sheet Category column value
const PILLAR_CATEGORY = {
  1: 'Skincare',
  2: 'Body Care',
  3: 'Recovery',
  4: 'Grooming Tools',
  5: 'Grooming Tools',
}

// ─── JSON extraction helper — bracket-balanced, handles surrounding commentary ─

function extractJsonArray(text) {
  const stripped = text.replace(/```json\s*/gi, '').replace(/```/g, '')
  const start = stripped.indexOf('[')
  if (start === -1) throw new Error('no JSON array found')
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) return JSON.parse(stripped.slice(start, i + 1)) }
  }
  throw new Error('unbalanced JSON array')
}

// ─── Targets mode: Amazon validation via web_search (batches of 5) ───────────

async function validateBatch(client, batch) {
  const productList = batch.map((t, i) => `${i + 1}. ${t.name} (brand: ${t.brand})`).join('\n')

  let messages = [{
    role: 'user',
    content: `Search Amazon for each product below. For each one: find the exact listing, confirm it is In Stock, record the ASIN and current price.

${productList}

After searching, output ONLY this JSON array — no introduction, no explanation, nothing else before or after the brackets:
[{"name":"...","asin":"B0XXXXXXX or null","price":"$XX.XX or null","available":true,"note":""}]

Rules: asin must be real (B0... format). If not found or unavailable set asin to null and available to false.`,
  }]

  let result = null
  let turns = 0

  while (turns < 8) {
    turns++
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
      try {
        result = extractJsonArray(text)
      } catch (err) {
        log(`WARNING: batch JSON parse failed — ${err.message} — raw: ${text.slice(0, 200)}`)
      }
      break
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }))
      messages.push({ role: 'user', content: toolResults })
    } else {
      break
    }
  }

  return result || batch.map(t => ({ name: t.name, asin: null, price: null, available: false, note: 'search failed' }))
}

async function validateOnAmazon(client, targets) {
  log('Amazon validation: searching for ASINs via web_search (batches of 5)...')
  const BATCH_SIZE = 5
  const allResults = []

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE)
    log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map(t => t.name).join(', ').slice(0, 80)}...`)
    const batchResults = await validateBatch(client, batch)
    allResults.push(...batchResults)
    log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} done: ${batchResults.filter(r => r.asin).length}/${batch.length} found`)
  }

  // Merge back with target metadata — match by position (batches preserve order)
  return targets.map((t, i) => {
    const r = allResults[i] || {}
    return { ...t, asin: r.asin || null, price: r.price || null, available: r.available || false, note: r.note || '' }
  })
}

// ─── Targets mode: brand story generation (chapter voice from BSV-Memory.md) ──

async function generateBrandStories(client, targets, memory, directive) {
  const chapterDescriptions = {
    1: 'The man who takes care of his face with the same seriousness he brings to everything else. Skincare is not vanity — it is the same standard applied to a different surface.',
    2: 'The man who knows what he smells like matters. Fragrance is not performance — it is the quiet signal that arrives before he does.',
    3: 'The man who treats recovery like training. The body is a system — what he puts in and on it between sessions is part of the work.',
    4: 'The man who carries only what earns its place. Every object in his pocket has been chosen, not accumulated.',
    5: 'The man who shaves like his grandfather taught him — not because it is faster, but because the ritual is the point.',
  }

  const productLines = targets.map((t, i) =>
    `${i + 1}. "${t.name}" by ${t.brand} — Chapter ${t.chapter}: ${chapterDescriptions[t.chapter] || ''}`
  ).join('\n')

  log('Brand story generation: calling Claude API...')
  const resp = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 3000,
    system:     `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You write BSV brand stories — one sentence per product, chapter voice. The sentence captures the moment the man found this product, not what the product does. It belongs in the room. It doesn't announce itself. Present tense. The Proprietor's voice — deadpan, certain, slightly amused.`,
    messages: [{
      role: 'user',
      content: `Write a brand_story sentence for each product below. One sentence per product. Chapter voice as described. The sentence is the moment — not a description, not a headline. The man found it. That's all we need to know.

${productLines}

Return ONLY a valid JSON array (no markdown, no commentary):
[
  { "name": "exact product name", "brand_story": "one sentence in chapter voice" }
]`,
    }],
  })

  const text = (resp.content.find(b => b.type === 'text')?.text || '').trim()
  try {
    const stories = extractJsonArray(text)
    const storyMap = {}
    stories.forEach(s => { storyMap[s.name] = s.brand_story })
    return targets.map(t => ({ ...t, brand_story: storyMap[t.name] || '' }))
  } catch (err) {
    log(`WARNING: brand story JSON parse failed — ${err.message}`)
    return targets.map(t => ({ ...t, brand_story: '' }))
  }
}

// ─── Targets mode: main orchestrator ─────────────────────────────────────────

async function runTargetsMode(targetsPath, client, memory, directive, dryRun, conn, existingAsins) {
  log(`Loading targets from ${targetsPath}...`)
  let targets
  try {
    targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'))
    if (!Array.isArray(targets) || !targets.length) throw new Error('empty or invalid targets array')
    log(`Targets: ${targets.length} products`)
  } catch (err) {
    log(`ERROR: could not read targets file — ${err.message}`)
    process.exit(1)
  }

  // Step 1: Amazon validation
  const withAsin = await validateOnAmazon(client, targets)
  const available  = withAsin.filter(t => t.asin && t.available)
  const unavailable = withAsin.filter(t => !t.asin || !t.available)

  log(`Amazon validation complete: ${available.length} available, ${unavailable.length} unavailable/not found`)
  unavailable.forEach(t => log(`  SKIP: "${t.name}" — ${t.note || 'unavailable'}`))

  if (!available.length) {
    log('ERROR: no products available on Amazon — nothing to write')
    return
  }

  // Step 2: Brand story generation (chapter voice)
  const withStories = await generateBrandStories(client, available, memory, directive)

  // Step 3: Generate narrative drafts + build final picks
  log(`Building picks and generating narrative drafts for ${withStories.length} products...`)
  const picks = []
  for (const t of withStories) {
    const affiliateUrl = `https://www.amazon.com/dp/${t.asin}?tag=${AFFILIATE_TAG}`
    const pick = {
      name:        t.name,
      asin:        t.asin,
      price:       t.price || '',
      category:    PILLAR_CATEGORY[t.pillar] || 'Body Care',
      score:       '90/100',
      description: '',
      reasoning:   `Pre-curated target — Pillar ${t.pillar}, Lane ${t.lane}, Chapter ${t.chapter}. Curation complete.`,
      brand_story: t.brand_story || '',
      imageUrl:    'NEEDS_RENDER',
      affiliateUrl,
    }

    if (!dryRun) {
      pick.narrative = await generateNarrative(client, t.name)
      if (pick.narrative) log(`  Narrative: "${pick.narrative.slice(0, 60)}..."`)
    }

    picks.push(pick)
  }

  // Step 4: Write to sheet or dry-run log
  log(`\n${'─'.repeat(60)}`)
  log(dryRun ? 'DRY-RUN OUTPUT — nothing will be written to sheet' : 'Writing to sheet...')
  log('─'.repeat(60))

  let written = 0
  let skipped = 0
  for (const pick of picks) {
    if (existingAsins.has(pick.asin)) {
      log(`  SKIP (already in sheet): ${pick.asin} — "${pick.name}"`)
      skipped++
      continue
    }
    if (dryRun) {
      log(`  ✓ "${pick.name}"`)
      log(`    ASIN:        ${pick.asin}`)
      log(`    Price:       ${pick.price}`)
      log(`    Affiliate:   ${pick.affiliateUrl}`)
      log(`    Category:    ${pick.category}`)
      log(`    Brand story: ${pick.brand_story}`)
      log(`    Status:      Approved`)
    } else {
      await appendPick(conn, pick, { status: 'Approved' })
      log(`  Sheet: "${pick.name}" (${pick.asin}) → Approved`)
    }
    written++
  }

  log('─'.repeat(60))
  log(`Targets mode complete: ${written} ${dryRun ? 'would be written' : 'written'}, ${skipped} skipped (already in sheet), ${unavailable.length} unavailable`)
}

// ─── Image sourcing rules — never violate ─────────────────────────────────────
// 1. Never download and re-host brand images without explicit permission
// 2. Never use Amazon product images under any circumstances (ToS violation)
// 3. Official brand site images linked directly = standard editorial practice
// 4. BSV-generated renders = original content, no IP issues
// 5. If in doubt about a source — use NEEDS_RENDER and generate

// ─── Narrative generation ─────────────────────────────────────────────────────

async function generateNarrative(client, productName) {
  try {
    const resp = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 300,
      messages:   [{
        role: 'user',
        content: `Write an 80–120 word narrative for the BSV Locker Room shelf about ${productName}.

Voice: The Proprietor — deadpan, confident, slightly amused. Never preachy. Present tense.
The reader is already in the room. This is a scene, not a description.

PRODUCT INTEGRATION RULE: The product is never the subject. It is the detail that completes the man.

Wrong: "The FootLogix Mousse is a fast-absorbing formula with urea and tea tree oil..."
Right: "He reached for the mousse — not because he'd researched it, but because it was the only thing on the shelf that didn't announce itself."

Write the man first. The product appears where it belongs in the scene.
End with one quiet line that makes the reader want it without asking them to buy it.`,
      }],
    })
    const text = (resp.content.find(b => b.type === 'text')?.text || '').trim()
    return text ? `[DRAFT] ${text}` : ''
  } catch (err) {
    log(`WARNING: narrative generation failed for "${productName}" — ${err.message}`)
    return ''
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  const skipResearch = process.argv.includes('--skip-research')
  const dryRun       = process.argv.includes('--dry-run')
  const targetsArg   = process.argv.indexOf('--targets')
  const targetsFile  = targetsArg !== -1 ? process.argv[targetsArg + 1] : null

  log(`━━━ product-research start ━━━${targetsFile ? ' [targets]' : ''}${skipResearch ? ' [skip-research]' : ''}${dryRun ? ' [dry-run]' : ''}`)

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

  // ─── --targets mode: curated list, skip discovery, go straight to validation ─
  if (targetsFile) {
    const client = new Anthropic({ apiKey })
    await runTargetsMode(targetsFile, client, memory, directive, dryRun, conn, existingAsins)
    log('━━━ product-research complete ━━━\n')
    return
  }

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
- Any product that shows a "Sponsored" label on Amazon — if it's buying its way to page one, it is not a discovery find
- Any product that is out of stock on Amazon — check before scoring; if unavailable, skip it entirely

## Approved sources — mandatory list

Discovery starts and ends with these ten sources. Do not search general grooming aggregators, Amazon bestseller lists, or affiliate roundups for leads.

1. **Grooming Lounge** — groominglounge.com
2. **Lab Series** — labseries.com
3. **ELEMIS** — us.elemis.com
4. **Art of Shaving** — theartofshaving.com
5. **Kiehl's** — kiehls.com
6. **Huckberry grooming** — huckberry.com/store/t/category/home/bath-and-grooming
7. **Gilt men's grooming** — gilt.com
8. **MR PORTER grooming** — mrporter.com
9. **GQ grooming** — gq.com
10. **Esquire grooming** — esquire.com

Amazon is not a sourcing channel. It is a confirmation step only: after a product is discovered through the approved sources and passes all brand alignment gates, look it up on Amazon to confirm availability and get the affiliate ASIN. If the product is not on Amazon, note the direct purchase URL instead.

## Brand alignment gates — run before scoring

Every product must pass four gates before scoring begins. Fail any gate: reject. Do not spend scoring tokens on a product that doesn't belong in the room.

**Gate 1 — Retailer gate:** Is the product sold at Grooming Lounge, Art of Shaving, MR PORTER, Gilt, or Huckberry? If it exists only on Amazon page one and no curated retailer stocks it, reject it.

**Gate 2 — Story gate:** Does the brand have a founding story, heritage claim, or craft narrative? Clinical or pharmacy brands with no origin story — reject. The BSV man buys things with provenance.

**Gate 3 — Scent/texture gate:** Does the product language include any of: sandalwood, cedarwood, oud, eucalyptus, fast-absorbing, non-greasy, lightweight, dry finish? If the scent profile is mint, medicinal, "fresh," or pharmacy-adjacent — reject.

**Gate 4 — Competitor gate:** Does this product directly compete with the Proprietor's Foot Balm positioning (premium foot balm, $35–50)? If yes: do NOT reject — flag it as competitive intel. It goes in a separate Competitive Intelligence section, not The Shelf.

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

    const userPrompt = `You are the BSV Product Curator. Your job is to find products that belong on the BSV shelf — not products that are easy to find, but products that a man who takes himself seriously would find if he actually went looking.

This is a three-phase process. Run all three in order. Do not skip phases. Do not score a product before it passes the brand alignment gates.

---

## PHASE 1 — Approved source discovery

Search exclusively against these ten sources. Do not search Amazon, grooming roundups, or affiliate blogs for leads.

Run these searches in order:

1. site:groominglounge.com foot OR body OR soak OR recovery OR balm
2. site:labseries.com body OR foot OR soak OR recovery
3. site:us.elemis.com body OR foot OR soak OR recovery OR massage
4. site:theartofshaving.com foot OR body OR balm OR soak
5. site:kiehls.com foot OR body OR balm OR soak OR recovery
6. site:huckberry.com/store/t/category/home/bath-and-grooming foot OR body OR recovery OR soak
7. site:gilt.com men grooming foot OR body OR soak OR balm
8. site:mrporter.com grooming foot OR body OR soak OR recovery OR balm
9. site:gq.com men grooming foot OR body care recommendation
10. site:esquire.com men grooming foot OR body care recommendation

From these searches, build a list of specific product names and brands. Note which source surfaced each product. Do not score yet. Do not go to Amazon yet.

---

## PHASE 2 — Brand alignment gates

Run every product from Phase 1 through these four gates before scoring. A product that fails any gate is rejected — do not score it.

**Gate 1 — Retailer gate**
Is this product available at Grooming Lounge, Art of Shaving, MR PORTER, Gilt, or Huckberry? If it exists only on Amazon page one and no curated retailer stocks it — reject.

**Gate 2 — Story gate**
Does this brand have a founding story, heritage claim, or craft narrative? Search the brand's About page or press coverage. Clinical or pharmacy brands with no story — reject.

**Gate 3 — Scent/texture gate**
Does the product language include any of: sandalwood, cedarwood, oud, eucalyptus, fast-absorbing, non-greasy, lightweight, dry finish? If the scent profile is mint, medicinal, "fresh," or pharmacy-adjacent — reject.

**Gate 4 — Competitor gate**
Does this product directly compete with the Proprietor's Foot Balm positioning (premium foot balm, $35–50)? If yes — do NOT reject. Flag it in the Competitive Intelligence section instead.

Record gate results for every product. Only products that pass Gates 1–3 move to scoring.

---

## PHASE 3 — Amazon confirmation and scoring

For each product that passed the brand alignment gates:

1. Search Amazon for the exact product name and brand
2. Confirm it is In Stock (skip if "Currently unavailable")
3. Confirm it does not appear as a Sponsored result in search (skip if sponsored)
4. If it passes: record the ASIN, current price, and confirm availability
5. Score against the 100-point rubric from the system prompt

Only products that pass both Amazon checks AND score 70+ make The Shelf.

---

## What you are looking for

Products anchored at the foot and working up. The man who buys Proprietor's Foot Balm also owns these. Every pick must pass the checkout test: would the BSV man reach for it without needing to explain it to anyone?

Categories: premium foot soaks, lower-leg and calf recovery tools, compression and circulation products, understated body treatments with serious ingredient decks, precision grooming tools from professional channels.

Hard exclusions: medicated, antifungal, problem-positioned, anything on the first page of a Google search for "best foot cream," loud or juvenile packaging, anything clinical-looking, anything you'd find in a drugstore, anything sponsored on Amazon.

${previous ? `## Previous research (do not re-recommend anything already in the queue)\n${previous.content.slice(0, 2000)}${previous.content.length > 2000 ? '\n[truncated]' : ''}` : '## No previous research — build the initial shortlist from scratch.'}

---

# BSV Product Curation Report — ${today}

## The Shelf (shortlist, scored and ranked)
For each product: Name, source where discovered (Phase 1), gate results (G1/G2/G3 pass, G4 flag if applicable), Amazon ASIN (confirmed in stock, not sponsored), price, score breakdown (ritual fit / discovery depth / quality / story / availability = total/100), Proprietor's Audit (one paragraph — not a product description, not an Amazon review; written as if the Proprietor picked it up and decided it belonged), and Brand Story (2–3 sentences: who makes this, what their heritage is, why it has provenance — this is what the Sole Report uses to write editorial around the link).

## Gate Rejections
Products from Phase 1 that failed a brand alignment gate — which gate, and why.

## Skipped — Stock or Sponsored
Products that passed gates but were eliminated in Phase 3 (out of stock / sponsored).

## Held Back
Products that passed all gates and Phase 3 but didn't clear 70 in scoring — what kept them off and what would change that.

## Competitive Intelligence
Products flagged on Gate 4 (direct foot balm competitors). Name, price, positioning, what they do well, what they leave open for BSV to own.

## Discovery Notes
Which Phase 1 sources were productive this cycle. Which were dry. What that signals about where to look next.

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
        tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 20 }],
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
      content: `From the research below, extract the top 12 products from The Shelf shortlist for BSV review.

Return a JSON array with this exact shape:
[
  {
    "name": "Product Name",
    "category": "Skincare | Grooming Tools | Body Care | Hair Care | Recovery | Foot Care | Nail Care | Full Kits",
    "asin": "B00XXXXXXX",
    "price": "$XX",
    "score": "82/100",
    "description": "One sentence — BSV voice: direct, specific, no hype. This is what appears on the shop card.",
    "reasoning": "The Proprietor's Audit — one paragraph explaining why this belongs on the BSV shelf: what standard it upholds, why a man who takes his core seriously would reach for it. Not a product description. Not an Amazon review.",
    "brand_story": "2–3 sentences: who makes this brand, what their founding story or heritage is, why it has provenance. Pulled from research — not invented. This is what the Sole Report uses to editorialize around the affiliate link. If no heritage narrative was found in research, write exactly: No heritage narrative identified.",
    "image_url": "URL of the product's primary image from the brand's official website (og:image or main hero image). Must be from the brand's own domain — not Amazon, not a retailer. If you visited the brand's product page during research and found a clean image URL, write it here. If not found or unverifiable, write exactly: NEEDS_RENDER"
  }
]

Rules:
- Pick the 12 highest-scoring products from The Shelf section only — do not include anything from Gate Rejections, Skipped, Held Back, or Competitive Intelligence
- Every product in the output must have been confirmed in stock on Amazon and confirmed not sponsored
- description: 1 sentence, BSV voice — factual, confident, no exclamation marks
- reasoning: the Proprietor's Audit paragraph from the research — preserve it exactly, do not summarize
- brand_story: 2–3 sentences pulled directly from the Brand Story field in the research — do not write marketing copy; if none found, use "No heritage narrative identified."
- image_url: official brand domain image URL only — not Amazon, not a retailer CDN. If the brand product page was not visited during research, write NEEDS_RENDER
- category must exactly match one of the eight values above
- score must be "XX/100" format
- asin must be a real Amazon ASIN (B0XXXXXXX format) — if no confirmed ASIN exists, omit the product entirely

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
        // Generate narrative draft before writing — marked [DRAFT] until Big D reviews
        pick.narrative = await generateNarrative(client, pick.name)
        if (pick.narrative) log(`  Narrative draft: "${pick.narrative.slice(0, 60)}..."`)
        // imageUrl: use official brand URL from extraction, fall back to NEEDS_RENDER
        pick.imageUrl = (pick.image_url && pick.image_url !== 'NEEDS_RENDER') ? pick.image_url : 'NEEDS_RENDER'
        log(`  Image URL: ${pick.imageUrl === 'NEEDS_RENDER' ? 'NEEDS_RENDER (will generate render)' : pick.imageUrl.slice(0, 60)}`)
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
