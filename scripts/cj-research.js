// cj-research.js — CJ (Commission Junction) prospecting for the Locker Room shelf.
//
// Added 2026-07-16. Previously: a launchd job (com.bsv.cj-research) existed and
// fired weekly, but this file never did — every run failed at
// "Cannot find module '.../scripts/cj-research.js'" before it could even try to
// connect to anything. Not a connection/credential problem, just a script that
// was never written. See BSV-BigC-Audit-Log.md 2026-07-16.
//
// Does two things, both scoped to CJ's ~3,000-advertiser network:
//   1. Advertiser discovery — finds CJ advertiser programs in BSV-relevant
//      categories (grooming/men's care, footwear, fragrance) that BSV is not
//      yet joined to, so Big D can decide whether to apply.
//   2. Product prospecting — for advertiser programs BSV IS already joined to
//      on CJ, pulls live product listings and keeps the ones that plausibly
//      fit the shelf.
//
// Does NOT auto-add anything to the live product queue (Sheets) — output is a
// report for Big D to review, same pattern as affiliate-scout.js. The shelf
// queue's "Amazon First" rule (BSV-Directive.md) is specifically about the
// Amazon-fallback path; CJ prospects are themselves the "alternative affiliate
// channel confirmed" case, so they're presented separately rather than forced
// through the ASIN-shaped product-queue schema.
//
// CJ credentials (CJ_API_TOKEN, CJ_CID) already exist in .env — same ones
// accounting-agent.js / check-cj-api.js use for the Commission Detail API.
// Advertiser Lookup is a REST API; Product Search is GraphQL (ads.api.cj.com).
// Neither endpoint has been exercised from this repo before (only Commission
// Detail has), so — same as the 2026-07-02/07-13 Commission Detail 404→GraphQL
// fixes — the first real run's log is the source of truth if CJ's actual
// response shape differs from what's coded here. Every parse is defensive and
// logs the raw response on anything unexpected, on purpose, so a schema
// mismatch is a one-line log fix, not a silent failure.
//
// Usage: node scripts/cj-research.js [--dry-run]

require('dotenv').config()
const path = require('path')
const fs   = require('fs')
const { execSync } = require('child_process')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'cj-research.log')
const REMOTE   = 'big sole vibes:Big Sole Vibes'
const DRY_RUN  = process.argv.includes('--dry-run')

const CJ_TOKEN = process.env.CJ_API_TOKEN
const CJ_CID   = process.env.CJ_CID

// BSV-relevant CJ advertiser categories / keyword terms — mirrors the
// categories already on the shelf (see scripts/data/shelf-products.json:
// Face Care, Fragrance, etc.) plus foot care and footwear since that's the
// brand's home turf.
const CATEGORY_KEYWORDS = [
  "men's grooming", 'skincare', 'fragrance', 'footwear', 'socks', 'foot care', "men's apparel",
]

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Tiny XML helpers ─────────────────────────────────────────────────────────
// Advertiser Lookup returns XML, not JSON, and CJ's shape is a flat, predictable
// repeating <advertiser>...</advertiser> list — not worth pulling in a full XML
// parser dependency for. Confirmed live 2026-07-16 against the real endpoint
// (see BSV-BigC-Audit-Log.md same date) — fields used below (advertiser-id,
// advertiser-name, program-url, primary-category > parent/child) are exactly
// what CJ sends.
function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? m[1] : null
}
function xmlCategory(block) {
  const m = block.match(/<primary-category><parent>([^<]*)<\/parent><child>([^<]*)<\/child><\/primary-category>/)
  return m ? `${m[1]} > ${m[2]}` : null
}
function splitBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  const blocks = []
  let m
  while ((m = re.exec(xml))) blocks.push(m[1])
  return blocks
}

// ─── Advertiser Lookup (REST) ─────────────────────────────────────────────────
// https://developers.cj.com/docs/rest-apis/advertiser-lookup
// Rate-limited to 25 calls/min per CJ docs — callers below space calls out.
// requestor-cid is required (confirmed live 2026-07-16 — CJ 400s without it
// even with a valid bearer token: "You must specify the company making this
// request using the 'requestor-cid' parameter.").
async function advertiserLookup(status, keywords) {
  const params = new URLSearchParams({
    'requestor-cid':  CJ_CID,
    'advertiser-ids': status, // 'joined' or 'notjoined'
    'keywords':       keywords,
    'records-per-page': '50',
  })
  const url = `https://advertiser-lookup.api.cj.com/v2/advertiser-lookup?${params}`
  try {
    const res  = await fetch(url, {
      headers: { Authorization: `Bearer ${CJ_TOKEN}` },
      signal:  AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) {
      log(`  Advertiser Lookup (${status}, "${keywords}") HTTP ${res.status}: ${text.slice(0, 300)}`)
      return []
    }
    if (!text.includes('<advertiser>')) {
      log(`  Advertiser Lookup (${status}, "${keywords}") — no <advertiser> blocks in response: ${text.slice(0, 300)}`)
      return []
    }
    return splitBlocks(text, 'advertiser').map(block => ({
      id:       xmlTag(block, 'advertiser-id'),
      name:     xmlTag(block, 'advertiser-name'),
      url:      xmlTag(block, 'program-url'),
      category: xmlCategory(block),
    })).filter(a => a.id && a.name)
  } catch (err) {
    log(`  Advertiser Lookup (${status}, "${keywords}") exception: ${err.message}`)
    return []
  }
}

// ─── Product Search (GraphQL) ─────────────────────────────────────────────────
// https://developers.cj.com/graphql/reference/Product%20Search
// Six query types exist (products, shoppingProducts, productFeeds,
// shoppingProductFeeds, financeCreditCardProducts, travelExperienceProducts) —
// `products` is the general-purpose one across both feed templates.
async function productSearch(companyId, keywords) {
  const query = `{ products(companyId: "${companyId}", keywords: "${keywords}", limit: 20) { totalCount resultList { advertiserId advertiserName title description price { amount currency } link imageLink } } }`
  try {
    const res  = await fetch('https://ads.api.cj.com/query', {
      method:  'POST',
      headers: { Authorization: `Bearer ${CJ_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
      signal:  AbortSignal.timeout(15000),
    })
    const rawText = await res.text()
    const json    = (() => { try { return JSON.parse(rawText) } catch { return null } })()
    if (!res.ok || !json || json.errors) {
      const detail = json?.errors ? JSON.stringify(json.errors).slice(0, 400) : `HTTP ${res.status}: ${rawText.slice(0, 400)}`
      log(`  Product Search (advertiser ${companyId}, "${keywords}") error: ${detail}`)
      // Confirmed live 2026-07-16: this endpoint 403s even with the same bearer
      // token that works fine for Advertiser Lookup and Commission Detail — CJ's
      // Product Search (GraphQL, ads.api.cj.com) appears to be a separately
      // gated API (their own docs mention an "Innovation Partner" program for
      // some GraphQL APIs). If this keeps 403ing, that's a CJ account/access
      // question for Big D to raise with CJ support, not a bug in this query.
      return []
    }
    const list = json.data?.products?.resultList
    if (!Array.isArray(list)) {
      log(`  Product Search (advertiser ${companyId}) — unrecognized response shape: ${JSON.stringify(json).slice(0, 300)}`)
      return []
    }
    return list
  } catch (err) {
    log(`  Product Search (advertiser ${companyId}) exception: ${err.message}`)
    return []
  }
}

function uploadReport(localPath, filename) {
  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Product Research/${filename}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    log(`✓ uploaded → Product Research/${filename}`)
  } catch (err) {
    log(`WARNING: upload to Drive failed — ${err.stderr?.toString().trim() || err.message}`)
  }
}

async function run() {
  log('━━━ cj-research start ━━━')
  if (DRY_RUN) log('[DRY RUN] — report will print to console only, nothing uploaded')

  if (!CJ_TOKEN || !CJ_CID) {
    log('ERROR: CJ_API_TOKEN / CJ_CID not set — cannot run')
    process.exit(1)
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const lines = [
    `# CJ Research — ${dateStr}`,
    '',
    'Prospects pulled from CJ\'s affiliate network (~3,000 advertisers). Advertiser',
    'discovery covers programs BSV hasn\'t joined yet; product prospecting covers',
    'programs BSV has already joined. Nothing here is auto-added to the shelf —',
    'review and hand anything worth pursuing to product-research/affiliate-scout.',
    '',
  ]

  // ── Part 1: Advertiser discovery ──────────────────────────────────────────
  lines.push('## New Advertiser Programs to Consider (not yet joined)', '')
  const notJoinedById   = new Map() // dedup — the same advertiser often matches several keywords
  const joinedAdvertisers = []

  for (const kw of CATEGORY_KEYWORDS) {
    log(`Advertiser discovery: "${kw}"`)

    const notJoined = await advertiserLookup('notjoined', kw)
    for (const a of notJoined) {
      const existing = notJoinedById.get(a.id)
      if (existing) existing.keywords.add(kw)
      else notJoinedById.set(a.id, { ...a, keywords: new Set([kw]) })
    }
    await sleep(2500) // stay well under the 25 calls/min Advertiser Lookup limit

    const joined = await advertiserLookup('joined', kw)
    for (const a of joined) {
      if (!joinedAdvertisers.some(j => j.id === a.id)) joinedAdvertisers.push({ id: a.id, name: a.name, keyword: kw })
    }
    await sleep(2500)
  }

  for (const a of notJoinedById.values()) {
    lines.push(`- **${a.name}** (id: ${a.id})${a.category ? ` — ${a.category}` : ''}${a.url ? ` — [program info](${a.url})` : ''} — keyword(s): ${[...a.keywords].join(', ')}`)
  }
  if (!notJoinedById.size) lines.push('(none found this run — either fully joined in these categories, or the Advertiser Lookup response shape didn\'t match what this script expects; check logs/cj-research.log for raw responses)')
  lines.push('')

  log(`Advertiser discovery: ${notJoinedById.size} not-joined candidate(s), ${joinedAdvertisers.length} already-joined advertiser(s) in BSV categories`)

  // ── Part 2: Product prospecting (joined advertisers only) ────────────────
  lines.push('## Products Worth a Look (from advertiser programs BSV has already joined)', '')
  let productsFound = 0

  for (const adv of joinedAdvertisers) {
    log(`Product search: ${adv.name} (id: ${adv.id})`)
    const products = await productSearch(adv.id, adv.keyword)
    for (const p of products) {
      const title = p.title
      const price = p.price ? `${p.price.amount} ${p.price.currency}` : null
      if (!title) continue
      productsFound++
      lines.push(`- **${title}** — ${adv.name}${price ? ` — ${price}` : ''}${p.link ? ` — [link](${p.link})` : ''}`)
    }
    await sleep(1000)
  }

  if (!productsFound) lines.push('(no products pulled this run — no joined advertisers matched BSV categories, or Product Search response shape didn\'t match; check logs/cj-research.log for raw responses)')
  lines.push('')

  log(`Product prospecting: ${productsFound} product(s) found across ${joinedAdvertisers.length} joined advertiser(s)`)

  const report = lines.join('\n')
  const reportPath = path.join(ROOT, 'logs', `cj-research-${dateStr}.md`)

  if (DRY_RUN) {
    console.log('\n--- REPORT PREVIEW ---')
    console.log(report)
  } else {
    fs.writeFileSync(reportPath, report)
    log(`Report written: ${reportPath}`)
    uploadReport(reportPath, `cj-research-${dateStr}.md`)
  }

  log('━━━ cj-research complete ━━━')
}

run().catch(err => {
  log(`FATAL: ${err.message}`)
  process.exit(1)
})
