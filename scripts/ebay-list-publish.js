require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getValidAccessToken } = require('./ebay-auth')
const { connect, readAllRows, updateRowFields } = require('./resale-sheets-client')

// ─────────────────────────────────────────────────────────────────────────────
// ebay-list-publish.js — phase 2 of the resale/eBay project: takes a row
// Big D has reviewed and approved in the BSV Resale Listings sheet (Status
// changed to "Reviewed") and actually publishes it as a live eBay listing.
//
// Deliberately gated on Status == "Reviewed", not "Draft" — ebay-lister.js
// (phase 1) writes drafts as "Draft"; this script only touches rows Big D
// has explicitly moved to "Reviewed" himself, same approve-before-act
// pattern as the dashboard's approve/deny buttons. Never runs on a Draft row.
//
// Prerequisite: node scripts/ebay-account-setup.js must have been run once
// for this environment (creates the merchant location + fulfillment/payment/
// return policies every offer needs). Run this script after that, or it will
// fail with a clear error naming which policy/location is missing.
//
// Flow per row: download the item's photos from the Drive Processed folder
// -> normalize + upload to Cloudflare R2 for public URLs (eBay's Inventory
// API requires real URLs, not base64 — same R2 bucket/pattern distribute.js
// already uses for Instagram/Meta) -> resolve an eBay category ID via the
// Taxonomy API -> createOrReplaceInventoryItem -> createOffer -> publishOffer
// -> write the live listing URL + Status=Posted back to the sheet.
//
// Usage: node scripts/ebay-list-publish.js [--env sandbox|prod] [--dry-run]
// --dry-run does everything except the actual publishOffer call, so you can
// see exactly what would be created (inventory item + offer payloads) first.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT       = path.join(__dirname, '..')
const LOG_FILE    = path.join(ROOT, 'logs', 'ebay-list-publish.log')
const TEMP_DIR    = path.join(os.homedir(), 'tmp', 'bsv-resale-publish')

const MAX_IMAGE_DIMENSION = 1600 // px, long edge — eBay recommends 500-1600px; slightly above ebay-lister.js's 1568 (that number is Claude's vision target, not an eBay requirement)
const JPEG_QUALITY        = 85

const args = process.argv.slice(2)
function getArg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null }
const env    = getArg('--env') || 'sandbox'
const dryRun = args.includes('--dry-run')

const API_BASE = env === 'prod' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
const MARKETPLACE_ID = 'EBAY_US'

// From ebay-account-setup.js's printed output — see that script's README
// comment. Re-run ebay-account-setup.js and update these if it's ever torn
// down and recreated (the IDs are not stable across a delete/recreate).
const LOCATION_KEY        = 'bsv-resale-main'
const FULFILLMENT_POLICY_ID = process.env.EBAY_FULFILLMENT_POLICY_ID
const PAYMENT_POLICY_ID     = process.env.EBAY_PAYMENT_POLICY_ID
const RETURN_POLICY_ID      = process.env.EBAY_RETURN_POLICY_ID

// eBay's ConditionEnum for used items. ebay-lister.js writes free-text like
// "Pre-owned - Good" to the sheet; map the common phrases it actually
// produces (see its Claude prompt) to eBay's enum. Falls back to USED_GOOD
// if nothing matches, rather than failing the whole publish over a wording
// mismatch — logged loudly either way so it's easy to catch in review.
const CONDITION_MAP = [
  [/new with (tags|box)/i, 'NEW_WITH_TAGS'],
  [/like new|excellent/i, 'USED_EXCELLENT'],
  [/very good/i, 'USED_VERY_GOOD'],
  [/good/i, 'USED_GOOD'],
  [/acceptable|fair|heavily worn/i, 'USED_ACCEPTABLE'],
]

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function mapCondition(text) {
  for (const [re, code] of CONDITION_MAP) {
    if (re.test(text)) return code
  }
  log(`  WARNING: couldn't map condition "${text}" to an eBay condition enum — defaulting to USED_GOOD`)
  return 'USED_GOOD'
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// ─── eBay REST helper ────────────────────────────────────────────────────────

async function ebayFetch(token, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
      'Accept-Language': 'en-US',
      'Content-Language': 'en-US',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

// ─── R2 upload (same pattern as distribute.js's uploadToR2) ─────────────────

async function uploadToR2(localFilePath, fileName) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) {
    throw new Error('Missing R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL)')
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  })
  await client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: fileName,
    Body: fs.readFileSync(localFilePath),
    ContentType: 'image/jpeg',
  }))
  return `${process.env.R2_PUBLIC_URL}/${fileName}`
}

// ─── Photos: download from Drive, normalize, upload to R2 ───────────────────

async function preparePhotoUrls(row, sku) {
  const localDir = path.join(TEMP_DIR, sku)
  fs.mkdirSync(localDir, { recursive: true })

  log(`  Downloading photos from ${row['Drive Folder']}...`)
  execSync(`rclone copy "${row['Drive Folder']}" "${localDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })

  const files = fs.readdirSync(localDir).filter(f => /\.(jpe?g|png|heic|heif|webp)$/i.test(f))
  if (!files.length) throw new Error(`No photos found in ${row['Drive Folder']}`)

  const urls = []
  for (let i = 0; i < files.length; i++) {
    const sourcePath = path.join(localDir, files[i])
    const jpegPath = path.join(localDir, `normalized-${i}.jpg`)
    try {
      execSync(`sips -Z ${MAX_IMAGE_DIMENSION} -s format jpeg -s formatOptions ${JPEG_QUALITY} "${sourcePath}" --out "${jpegPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      log(`  WARNING: sips normalization failed for ${files[i]}, skipping: ${err.stderr?.toString().trim() || err.message}`)
      continue
    }
    const r2Key = `ebay-resale/${sku}/${i}.jpg`
    const url = await uploadToR2(jpegPath, r2Key)
    urls.push(url)
    log(`  Uploaded photo ${i + 1}/${files.length} -> ${url}`)
  }

  if (!urls.length) throw new Error('All photos failed to normalize/upload')
  return urls
}

// ─── Category resolution via Taxonomy API ────────────────────────────────────

async function resolveCategoryId(token, query) {
  // "0" is eBay's well-known default category tree ID for the US marketplace.
  const res = await ebayFetch(token, 'GET', `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`)
  if (!res.ok || !res.data?.categorySuggestions?.length) {
    throw new Error(`Category suggestion lookup failed for "${query}": HTTP ${res.status} ${JSON.stringify(res.data)}`)
  }
  const top = res.data.categorySuggestions[0]
  log(`  Category: "${query}" -> ${top.category.categoryId} (${top.category.categoryName})`)
  return top.category.categoryId
}

// ─── Publish one row ─────────────────────────────────────────────────────────

async function publishRow(token, row, rowIndex) {
  const sku = `bsv-resale-${slugify(row['Item'])}-${rowIndex}`
  log(`\n--- Publishing row ${rowIndex}: "${row['Item']}" (sku: ${sku}) ---`)

  if (!FULFILLMENT_POLICY_ID || !PAYMENT_POLICY_ID || !RETURN_POLICY_ID) {
    throw new Error('Missing EBAY_FULFILLMENT_POLICY_ID / EBAY_PAYMENT_POLICY_ID / EBAY_RETURN_POLICY_ID — run scripts/ebay-account-setup.js and add its output to .env first')
  }

  const imageUrls = await preparePhotoUrls(row, sku)
  const categoryId = await resolveCategoryId(token, row['Category'] || row['eBay Title'])
  const condition = mapCondition(row['Item Condition'])
  const price = parseFloat(row['Suggested Price'])
  if (!price || Number.isNaN(price)) throw new Error(`Invalid Suggested Price: "${row['Suggested Price']}"`)

  const aspects = {}
  if (row['Brand']) aspects.Brand = [row['Brand']]
  if (row['Size'])  aspects.Size  = [row['Size']]
  if (row['Color']) aspects.Color = [row['Color']]

  const inventoryItem = {
    condition,
    product: {
      title: row['eBay Title'].slice(0, 80), // eBay's hard title limit
      description: row['Description'],
      aspects,
      imageUrls,
    },
    availability: {
      shipToLocationAvailability: { quantity: 1 },
    },
  }

  log(`  Creating inventory item...`)
  if (!dryRun) {
    const invRes = await ebayFetch(token, 'PUT', `/sell/inventory/v1/inventory_item/${sku}`, inventoryItem)
    if (!invRes.ok) throw new Error(`createOrReplaceInventoryItem failed: HTTP ${invRes.status} ${JSON.stringify(invRes.data)}`)
  } else {
    log(`  [dry-run] would PUT /sell/inventory/v1/inventory_item/${sku}: ${JSON.stringify(inventoryItem).slice(0, 300)}...`)
  }

  const offer = {
    sku,
    marketplaceId: MARKETPLACE_ID,
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId,
    listingDescription: row['Description'],
    listingPolicies: {
      fulfillmentPolicyId: FULFILLMENT_POLICY_ID,
      paymentPolicyId: PAYMENT_POLICY_ID,
      returnPolicyId: RETURN_POLICY_ID,
    },
    pricingSummary: {
      price: { value: price.toFixed(2), currency: 'USD' },
    },
    merchantLocationKey: LOCATION_KEY,
  }

  log(`  Creating offer...`)
  let offerId
  if (!dryRun) {
    const offerRes = await ebayFetch(token, 'POST', '/sell/inventory/v1/offer', offer)
    if (!offerRes.ok) throw new Error(`createOffer failed: HTTP ${offerRes.status} ${JSON.stringify(offerRes.data)}`)
    offerId = offerRes.data.offerId
    log(`  Offer created: ${offerId}`)
  } else {
    log(`  [dry-run] would POST /sell/inventory/v1/offer: ${JSON.stringify(offer).slice(0, 300)}...`)
    return { dryRun: true }
  }

  log(`  Publishing offer ${offerId}...`)
  const pubRes = await ebayFetch(token, 'POST', `/sell/inventory/v1/offer/${offerId}/publish`)
  if (!pubRes.ok) throw new Error(`publishOffer failed: HTTP ${pubRes.status} ${JSON.stringify(pubRes.data)}`)

  const listingId = pubRes.data.listingId
  const listingUrl = env === 'prod'
    ? `https://www.ebay.com/itm/${listingId}`
    : `https://www.sandbox.ebay.com/itm/${listingId}`

  log(`  ✓ Published: ${listingUrl}`)
  return { listingId, listingUrl }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const token = await getValidAccessToken(env)
  const sheetCtx = await connect()
  const rows = await readAllRows(sheetCtx)

  const toPublish = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row['Status'] === 'Reviewed')

  if (!toPublish.length) {
    log('No rows with Status="Reviewed" — nothing to publish. (ebay-lister.js writes "Draft"; move a row to "Reviewed" in the sheet once you\'ve checked it over.)')
    return
  }

  log(`Found ${toPublish.length} row(s) to publish (env: ${env}${dryRun ? ', DRY RUN' : ''}).`)

  for (const { row, i } of toPublish) {
    try {
      const result = await publishRow(token, row, i)
      if (!result.dryRun) {
        await updateRowFields(sheetCtx, i, {
          'Status': 'Posted',
          'eBay Listing URL': result.listingUrl,
        })
      }
    } catch (err) {
      log(`  ✗ FAILED "${row['Item']}": ${err.message}`)
      // Leave Status as "Reviewed" (not Posted) so a failed row is obviously
      // not live yet and will be retried next run — never silently skip it.
    }
  }
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`)
  process.exit(1)
})
