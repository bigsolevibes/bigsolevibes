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
// Env-prefixed, same convention as ebay-auth.js's APP_ID/CERT_ID/DEV_ID —
// sandbox and prod are different eBay accounts with different policy IDs;
// a single shared var name would silently collide the moment prod policies
// get created (caught before it happened, while wiring up prod planning).
const ENV_PREFIX = env.toUpperCase()
const FULFILLMENT_POLICY_ID = process.env[`EBAY_${ENV_PREFIX}_FULFILLMENT_POLICY_ID`]
const PAYMENT_POLICY_ID     = process.env[`EBAY_${ENV_PREFIX}_PAYMENT_POLICY_ID`]
const RETURN_POLICY_ID      = process.env[`EBAY_${ENV_PREFIX}_RETURN_POLICY_ID`]

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

// Regex rules for matching our free-text condition notes against the
// conditionDescription strings eBay returns from get_item_condition_policies
// (used for "structured" categories like clothing & shoes below).
const CONDITION_DESCRIPTION_MAP = [
  [/new with (tags|box)/i, /new with (box|tags)/i],
  [/new without box/i, /new without box/i],
  [/new with defects/i, /new with defects/i],
  [/like new|excellent/i, /excellent/i],
  [/very good/i, /very good/i],
  [/good/i, /good/i],
  [/acceptable|fair|heavily worn/i, /fair|acceptable/i],
]

// Some eBay categories — clothing & shoes chief among them — define their
// own numeric conditionId scale via get_item_condition_policies, and
// publishOffer validates against THAT scale, not the generic one implied
// by ConditionEnum names — discovered live: "USED_GOOD" (which eBay
// internally resolves to id 5000) got rejected by category 15709 (Athletic
// Shoes), which only accepts {1000,1500,1750,2990,3000,3010}. The
// category's own label for id 3000 is "Pre-owned - Good", but the
// ConditionEnum token that actually maps to id 3000 is (confusingly)
// "USED_EXCELLENT" — verified live, one enum value at a time, against the
// Sandbox API. This table is that empirically-confirmed id->enum mapping;
// IDs not in it (e.g. 1000/1500, the "brand new" tier) haven't been
// verified — a category needing one of those falls back to mapCondition()
// with a loud warning rather than guessing.
const CONDITION_ID_TO_ENUM = {
  '1750': 'NEW_WITH_DEFECTS',
  '2000': 'CERTIFIED_REFURBISHED',
  '2500': 'SELLER_REFURBISHED',
  '2750': 'LIKE_NEW',
  '2990': 'PRE_OWNED_EXCELLENT',
  '3000': 'USED_EXCELLENT', // category desc "Pre-owned - Good" for Athletic Shoes — id match confirmed, enum name is just misleading
  '3010': 'PRE_OWNED_FAIR',
  '4000': 'USED_VERY_GOOD',
  '5000': 'USED_GOOD',
  '6000': 'USED_ACCEPTABLE',
}

async function resolveCondition(token, categoryId, text) {
  const res = await ebayFetch(token, 'GET', `/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?filter=categoryIds:{${categoryId}}`)
  const conditions = res.ok ? res.data?.itemConditionPolicies?.[0]?.itemConditions : null

  if (conditions && conditions.length) {
    for (const [textRe, descRe] of CONDITION_DESCRIPTION_MAP) {
      if (!textRe.test(text)) continue
      const match = conditions.find(c => descRe.test(c.conditionDescription))
      if (match) {
        const enumValue = CONDITION_ID_TO_ENUM[match.conditionId]
        if (enumValue) {
          log(`  Condition: "${text}" -> ${enumValue} (id ${match.conditionId}: "${match.conditionDescription}") [category-specific]`)
          return enumValue
        }
        log(`  WARNING: category ${categoryId} wants condition id ${match.conditionId} ("${match.conditionDescription}") but no verified ConditionEnum maps to it — falling back`)
        break
      }
    }
  }

  return mapCondition(text)
}

// Department is a SELECTION_ONLY aspect for shoe categories — eBay's
// Sandbox category 15709 only offers "Men", "Teens", "Unisex Adults" (no
// plain "Women" in that category's list, at least in Sandbox). Check
// "women" before "men" since "women" contains "men" as a substring.
function deriveDepartment(sizeText) {
  if (!sizeText) return null
  if (/women/i.test(sizeText)) return 'Unisex Adults' // no distinct Women option in this category's list — safest is Unisex Adults over guessing wrong
  if (/\bmen\b/i.test(sizeText)) return 'Men'
  if (/\b(boy|girl|kid|youth|teen)s?\b/i.test(sizeText)) return 'Teens'
  if (/unisex/i.test(sizeText)) return 'Unisex Adults'
  return null
}

// Pulls the numeric shoe size out of free text like "US Men's 11" or
// "Women's 8.5" -> "11" / "8.5", matching the plain-number aspect values
// eBay's Taxonomy API returns for "US Shoe Size" (e.g. "9.5", "11").
function deriveShoeSize(sizeText) {
  if (!sizeText) return null
  const m = sizeText.match(/(\d+(?:\.\d+)?)/)
  return m ? m[1] : null
}

// "Upper Material" is a required SELECTION_ONLY aspect for several shoe
// categories (e.g. 24087 Casual Shoes) -- discovered live via publishOffer's
// "item specific Upper Material is missing" error, same pattern as
// Department/US Shoe Size above. Unlike those two (hand-verified fixed
// value sets), Upper Material's valid values vary more by category, so
// this looks them up live via the Taxonomy API's get_item_aspects_for_category
// and matches against our title+description text instead of hardcoding a guess.
async function resolveAspectValue(token, categoryId, aspectName, text) {
  const res = await ebayFetch(token, 'GET', `/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`)
  const aspect = res.ok && res.data?.aspects?.find(a => a.localizedAspectName === aspectName)
  const values = aspect?.aspectValues?.map(v => v.localizedValue) || []
  const lowerText = text.toLowerCase()

  if (values.length) {
    // Longest-first, plain substring match (not \b-bounded -- plurals like
    // "Sneakers" vs the enum's "Sneaker" wouldn't match with word boundaries).
    const sorted = [...values].sort((a, b) => b.length - a.length)
    const match = sorted.find(v => lowerText.includes(v.toLowerCase()))
    if (match) {
      log(`  ${aspectName}: matched "${match}" from listing text [category-specific]`)
      return match
    }
    log(`  WARNING: category ${categoryId} requires ${aspectName} but none of its values (${values.join(', ')}) matched the listing text -- using first available value "${values[0]}" as a fallback`)
    return values[0]
  }

  log(`  WARNING: couldn't fetch ${aspectName} values for category ${categoryId} -- leaving aspect unset, listing may fail item-specifics validation`)
  return null
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
  // Always start from a clean dir — otherwise a re-run finds last run's
  // normalized-*.jpg outputs still sitting next to the source photos and
  // re-uploads each photo twice (bug found during the first live test).
  fs.rmSync(localDir, { recursive: true, force: true })
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
    throw new Error(`Missing EBAY_${ENV_PREFIX}_FULFILLMENT_POLICY_ID / EBAY_${ENV_PREFIX}_PAYMENT_POLICY_ID / EBAY_${ENV_PREFIX}_RETURN_POLICY_ID — run scripts/ebay-account-setup.js --env ${env} and add its output to .env first`)
  }

  const imageUrls = await preparePhotoUrls(row, sku)
  const categoryId = await resolveCategoryId(token, row['eBay Title'] || row['Category'])
  const condition = await resolveCondition(token, categoryId, row['Item Condition'])
  const price = parseFloat(row['Suggested Price'])
  if (!price || Number.isNaN(price)) throw new Error(`Invalid Suggested Price: "${row['Suggested Price']}"`)

  const aspects = {}
  if (row['Brand']) aspects.Brand = [row['Brand']]
  if (row['Color']) aspects.Color = [row['Color']]
  // Clothing/shoe categories (e.g. 15709 Athletic Shoes) require the
  // "Department" and "US Shoe Size" item specifics — discovered live via
  // publishOffer's "item specific Department is missing" error. Our sheet's
  // free-text "Size" column (e.g. "US Men's 11") isn't itself a valid
  // aspect for these categories, so parse it into the two eBay actually
  // wants instead of sending it as-is.
  // Size alone doesn't reliably carry a gender qualifier (e.g. just '9'
  // for the New Balance row, vs. 'US Men's 11' for the Nike one -- caught
  // live when this exact gap made publishOffer fail with 'item specific
  // Department is missing'). eBay Title reliably does ('...Men's Size 9...')
  // since ebay-lister.js's prompt asks for it there. Shoe SIZE stays
  // Size-field-only though -- a title can contain other numbers first
  // (e.g. 'Metcon 9' is the model number, not the shoe size) and would misparse.
  const department = deriveDepartment(`${row['Size']} ${row['eBay Title']}`)
  if (department) aspects.Department = [department]
  const shoeSize = deriveShoeSize(row['Size'])
  if (shoeSize) aspects['US Shoe Size'] = [shoeSize]
  if (!department || !shoeSize) {
    log(`  WARNING: couldn't fully parse Department/US Shoe Size from Size="${row['Size']}" (got department=${department}, shoeSize=${shoeSize}) — listing may fail item-specifics validation`)
  }

  const aspectText = `${row['eBay Title']} ${row['Description']}`
  const upperMaterial = await resolveAspectValue(token, categoryId, 'Upper Material', aspectText)
  if (upperMaterial) aspects['Upper Material'] = [upperMaterial]
  const style = await resolveAspectValue(token, categoryId, 'Style', aspectText)
  if (style) aspects.Style = [style]

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
    if (offerRes.ok) {
      offerId = offerRes.data.offerId
      log(`  Offer created: ${offerId}`)
    } else if (offerRes.data?.errors?.[0]?.errorId === 25002) {
      // "Offer entity already exists" — a prior run for this SKU got this
      // far and failed later (e.g. our own publishOffer condition/aspect
      // bugs, fixed live this session). Reuse that existing offer instead
      // of treating a retry as a hard failure.
      offerId = offerRes.data.errors[0].parameters?.find(p => p.name === 'offerId')?.value
      if (!offerId) throw new Error(`createOffer failed: HTTP ${offerRes.status} ${JSON.stringify(offerRes.data)}`)
      log(`  Offer already existed, reusing: ${offerId}`)
    } else {
      throw new Error(`createOffer failed: HTTP ${offerRes.status} ${JSON.stringify(offerRes.data)}`)
    }
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
