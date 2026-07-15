// affiliate-scout.js — audits shelf products for direct affiliate programs
// Replaces Amazon links with direct brand links where available.
// Run: node scripts/affiliate-scout.js [--dry-run]
//
// Output:
//   logs/affiliate-scout.log        — full run log
//   logs/affiliate-scout-report.md  — human-readable findings for Big D
//   scripts/data/affiliate-overrides.json — updated with confirmed direct links

require('dotenv').config({ quiet: true })
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')
const fs   = require('fs')
const path = require('path')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'affiliate-scout.log')
const REPORT   = path.join(ROOT, 'logs', 'affiliate-scout-report.md')
const OVERRIDES_PATH = path.join(__dirname, 'data', 'affiliate-overrides.json')
const PRODUCTS_PATH  = path.join(__dirname, 'data', 'shelf-products.json')

const DRY_RUN = process.argv.includes('--dry-run')
const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function loadOverrides() {
  if (fs.existsSync(OVERRIDES_PATH)) return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
  return { _note: 'Direct affiliate links — override Amazon fallback in sync-shop.js' }
}

// Extract unique brands from shelf products
function getBrands(products) {
  const brands = {}
  for (const p of products) {
    const name = p['Product Name'] || ''
    // Extract brand (first word or two)
    const brand = name.split(' ').slice(0, 2).join(' ')
      .replace(/\b(Men|Super|Daily|Safety|Slim|Heavy|Fireside|Royal|Wave)\b.*/i, '').trim()
      || name.split(' ')[0]
    if (!brands[brand]) brands[brand] = []
    brands[brand].push(p)
  }
  return brands
}

async function scoutBrand(brandName, products) {
  log(`Scouting: ${brandName} (${products.length} product${products.length > 1 ? 's' : ''})`)

  const productList = products.map(p => `- ${p['Product Name']}`).join('\n')

  const prompt = `You are an affiliate marketing researcher for Big Sole Vibes, a premium men's grooming and lifestyle brand.

Research whether "${brandName}" has a direct affiliate program — NOT through Amazon Associates.

Products on our shelf:
${productList}

Search for:
1. "${brandName} affiliate program"
2. "${brandName} ambassador program"  
3. "${brandName} partner program"

For each result determine:
- Does the brand have a DIRECT affiliate program (on their own site, or via Impact.com, ShareASale, CJ Affiliate, Rakuten, FlexOffers, etc.)?
- What is the commission rate?
- What is the signup/application URL?
- For each product on our shelf, what is the DIRECT product URL on their website?

Return ONLY valid JSON:
{
  "brand": "${brandName}",
  "has_direct_program": true|false,
  "network": "Impact.com|ShareASale|CJ|Direct|None",
  "commission_rate": "X%" or null,
  "signup_url": "https://..." or null,
  "notes": "brief summary",
  "products": [
    {
      "name": "exact product name from list",
      "direct_url": "https://brand.com/product-page or null",
      "confirmed": true|false
    }
  ]
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', // downgraded from opus-4-8 2026-07-15 — factual lookup task, doesn't need opus-tier reasoning; was the one script in the pipeline off the Sonnet/Haiku pattern
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt }]
    })

    // Extract the final text response
    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock) return null

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) { log(`  No JSON found for ${brandName}`); return null }

    return JSON.parse(jsonMatch[0])
  } catch (err) {
    log(`  ERROR scouting ${brandName}: ${err.message}`)
    return null
  }
}

async function run() {
  log('=== Affiliate Scout starting ===')
  if (DRY_RUN) log('DRY RUN — no files will be written')

  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'))
  const overrides = loadOverrides()
  const brands = getBrands(products)

  log(`Brands to scout: ${Object.keys(brands).join(', ')}`)

  const results = []
  const reportLines = [
    `# BSV Affiliate Scout Report`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``
  ]

  for (const [brand, brandProducts] of Object.entries(brands)) {
    const result = await scoutBrand(brand, brandProducts)
    if (!result) continue

    results.push(result)

    const status = result.has_direct_program ? '✅ DIRECT PROGRAM' : '❌ Amazon only'
    log(`  ${brand}: ${status} — ${result.commission_rate || 'unknown rate'} via ${result.network || 'N/A'}`)

    reportLines.push(`### ${brand}`)
    reportLines.push(`**Status:** ${status}`)
    if (result.commission_rate) reportLines.push(`**Commission:** ${result.commission_rate}`)
    if (result.network) reportLines.push(`**Network:** ${result.network}`)
    if (result.signup_url) reportLines.push(`**Signup:** ${result.signup_url}`)
    reportLines.push(`**Notes:** ${result.notes}`)
    reportLines.push(``)

    if (result.products) {
      for (const prod of result.products) {
        if (prod.direct_url && prod.confirmed) {
          reportLines.push(`- ✅ [${prod.name}](${prod.direct_url})`)
        } else {
          reportLines.push(`- ⚠️ ${prod.name} — no direct URL confirmed`)
        }
      }
    }
    reportLines.push(``)

    // Update overrides for confirmed direct links
    if (!DRY_RUN && result.products) {
      for (const prod of result.products) {
        if (prod.direct_url && prod.confirmed && result.has_direct_program) {
          overrides[prod.name] = {
            affiliate_url: prod.direct_url,
            affiliate_network: result.network,
            commission: result.commission_rate,
            signup_url: result.signup_url,
            scouted: new Date().toISOString().split('T')[0]
          }
          log(`  → Override saved: ${prod.name} → ${prod.direct_url}`)
        }
      }
    }

    // Pace requests — don't hammer the API
    await new Promise(r => setTimeout(r, 2000))
  }

  // Write report
  if (!DRY_RUN) {
    fs.writeFileSync(REPORT, reportLines.join('\n'))
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2))
    log(`Report written: ${REPORT}`)
    log(`Overrides updated: ${OVERRIDES_PATH}`)
  } else {
    console.log('\n--- REPORT PREVIEW ---')
    console.log(reportLines.join('\n'))
  }

  const found = results.filter(r => r.has_direct_program).length
  log(`=== Done. ${found}/${results.length} brands have direct programs ===`)
  log(`Next step: review ${REPORT}, then run sync-shop to update the live page`)
}

run().catch(err => {
  log(`FATAL: ${err.message}`)
  process.exit(1)
})
