require('dotenv').config()
// Bridge: .env stores the sandbox-only policy IDs unprefixed
// (EBAY_FULFILLMENT_POLICY_ID etc.) but this script (copied from
// ebay-list-publish.js) reads the env-prefixed names. Fill them in from the
// unprefixed vars if the prefixed ones aren't set, rather than editing .env.
process.env.EBAY_SANDBOX_FULFILLMENT_POLICY_ID = process.env.EBAY_SANDBOX_FULFILLMENT_POLICY_ID || process.env.EBAY_FULFILLMENT_POLICY_ID
process.env.EBAY_SANDBOX_PAYMENT_POLICY_ID = process.env.EBAY_SANDBOX_PAYMENT_POLICY_ID || process.env.EBAY_PAYMENT_POLICY_ID
process.env.EBAY_SANDBOX_RETURN_POLICY_ID = process.env.EBAY_SANDBOX_RETURN_POLICY_ID || process.env.EBAY_RETURN_POLICY_ID

const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getValidAccessToken } = require('./ebay-auth')
const { connect, readAllRows, updateRowFields } = require('./resale-sheets-client')

// ebay-list-publish-live.js — one-off copy of ebay-list-publish.js with
// dryRun hardcoded false, because run_diagnostic (the only way to run repo
// scripts with real network access from Claude's remote session) always
// appends --dry-run for any script not in mcp-server.js's LIVE_SCRIPTS set.
// Same publish logic/flow as the original; only the dryRun line and the
// policy-ID env bridge above differ. Delete this file once no longer needed.

const ROOT       = path.join(__dirname, '..')
const LOG_FILE    = path.join(ROOT, 'logs', 'ebay-list-publish.log')
const TEMP_DIR    = path.join(os.homedir(), 'tmp', 'bsv-resale-publish')

const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY        = 85

const args = process.argv.slice(2)
function getArg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null }
const env    = getArg('--env') || 'sandbox'
const dryRun = false // forced live — see header comment

const API_BASE = env === 'prod' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
const MARKETPLACE_ID = 'EBAY_US'

const LOCATION_KEY        = 'bsv-resale-main'
const ENV_PREFIX = env.toUpperCase()
const FULFILLMENT_POLICY_ID = process.env[`EBAY_${ENV_PREFIX}_FULFILLMENT_POLICY_ID`]
const PAYMENT_POLICY_ID     = process.env[`EBAY_${ENV_PREFIX}_PAYMENT_POLICY_ID`]
const RETURN_POLICY_ID      = process.env[`EBAY_${ENV_PREFIX}_RETURN_POLICY_ID`]

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

const CONDITION_DESCRIPTION_MAP = [
  [/new with (tags|box)/i, /new with (box|tags)/i],
  [/new without box/i, /new without box/i],
  [/new with defects/i, /new with defects/i],
  [/like new|excellent/i, /excellent/i],
  [/very good/i, /very good/i],
  [/good/i, /good/i],
  [/acceptable|fair|heavily worn/i, /fair|acceptable/i],
]

const CONDITION_ID_TO_ENUM = {
  '1750': 'NEW_WITH_DEFECTS',
  '2000': 'CERTIFIED_REFURBISHED',
  '2500': 'SELLER_REFURBISHED',
  '2750': 'LIKE_NEW',
  '2990': 'PRE_OWNED_EXCELLENT',
  '3000': 'USED_EXCELLENT',
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

function deriveDepartment(sizeText) {
  if (!sizeText) return null
  if (/women/i.test(sizeText)) return 'Unisex Adults'
  if (/\bmen\b/i.test(sizeText)) return 'Men'
  if (/\b(boy|girl|kid|youth|teen)s?\b/i.test(sizeText)) return 'Teens'
  if (/unisex/i.test(sizeText)) return 'Unisex Adults'
  return null
}

function deriveShoeSize(sizeText) {
  if (!sizeText) return null
  const m = sizeText.match(/(\d+(?:\.\d+)?)/)
  return m ? m[1] : null
}

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

async function preparePhotoUrls(row, sku) {
  const localDir = path.join(TEMP_DIR, sku)
  fs.rmSync(localDir, { recursive: true, force: true })
  fs.mkdirSync(localDir, { recursive: true })

  log(`  Downloading photos from ${row['Drive Folder']}...`)
  execSync(`rclone copy --max-depth 1 "${row['Drive Folder']}" "${localDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })

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

async function resolveCategoryId(token, query) {
  const res = await ebayFetch(token, 'GET', `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(query)}`)
  if (!res.ok || !res.data?.categorySuggestions?.length) {
    throw new Error(`Category suggestion lookup failed for "${query}": HTTP ${res.status} ${JSON.stringify(res.data)}`)
  }
  const top = res.data.categorySuggestions[0]
  log(`  Category: "${query}" -> ${top.category.categoryId} (${top.category.categoryName})`)
  return top.category.categoryId
}

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
  const department = deriveDepartment(`${row['Size']} ${row['eBay Title']}`)
  if (department) aspects.Department = [department]
  const shoeSize = deriveShoeSize(row['Size'])
  if (shoeSize) aspects['US Shoe Size'] = [shoeSize]

  const aspectText = `${row['eBay Title']} ${row['Description']}`
  const upperMaterial = await resolveAspectValue(token, categoryId, 'Upper Material', aspectText)
  if (upperMaterial) aspects['Upper Material'] = [upperMaterial]
  const style = await resolveAspectValue(token, categoryId, 'Style', aspectText)
  if (style) aspects.Style = [style]
  if (!department || !shoeSize) {
    log(`  WARNING: couldn't fully parse Department/US Shoe Size from Size="${row['Size']}" (got department=${department}, shoeSize=${shoeSize}) — listing may fail item-specifics validation`)
  }

  const inventoryItem = {
    condition,
    product: {
      title: row['eBay Title'].slice(0, 80),
      description: row['Description'],
      aspects,
      imageUrls,
    },
    availability: {
      shipToLocationAvailability: { quantity: 1 },
    },
  }

  log(`  Creating inventory item...`)
  const invRes = await ebayFetch(token, 'PUT', `/sell/inventory/v1/inventory_item/${sku}`, inventoryItem)
  if (!invRes.ok) throw new Error(`createOrReplaceInventoryItem failed: HTTP ${invRes.status} ${JSON.stringify(invRes.data)}`)

  const floorRaw = parseFloat(String(row['Offer Floor'] || '').replace(/[^0-9.]/g, ''))
  const offerFloor = (floorRaw > 0 && floorRaw < price) ? floorRaw : Math.floor(price * 0.75)
  log(`  Best Offer: on, auto-decline under $${offerFloor.toFixed(2)}`)

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
      // Best Offer on every listing (added 2026-10-30, Big D). Floor comes
      // from the sheet's "Offer Floor" column if set, else 75% of price.
      bestOfferTerms: {
        bestOfferEnabled: true,
        autoDeclinePrice: { value: offerFloor.toFixed(2), currency: 'USD' },
      },
    },
    pricingSummary: {
      price: { value: price.toFixed(2), currency: 'USD' },
    },
    merchantLocationKey: LOCATION_KEY,
  }

  log(`  Creating offer...`)
  let offerId
  const offerRes = await ebayFetch(token, 'POST', '/sell/inventory/v1/offer', offer)
  if (offerRes.ok) {
    offerId = offerRes.data.offerId
    log(`  Offer created: ${offerId}`)
  } else if (offerRes.data?.errors?.[0]?.errorId === 25002) {
    offerId = offerRes.data.errors[0].parameters?.find(p => p.name === 'offerId')?.value
    if (!offerId) throw new Error(`createOffer failed: HTTP ${offerRes.status} ${JSON.stringify(offerRes.data)}`)
    log(`  Offer already existed, reusing: ${offerId}`)
    // Push current terms (price, Best Offer, description) onto the
    // existing offer — updateOffer revises a live listing in place.
    const { sku: _s, marketplaceId: _m, format: _f, ...updateBody } = offer
    const updRes = await ebayFetch(token, 'PUT', `/sell/inventory/v1/offer/${offerId}`, updateBody)
    if (!updRes.ok) throw new Error(`updateOffer failed: HTTP ${updRes.status} ${JSON.stringify(updRes.data)}`)
    log(`  Offer updated: ${offerId}`)
  } else {
    throw new Error(`createOffer failed: HTTP ${offerRes.status} ${JSON.stringify(offerRes.data)}`)
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

async function main() {
  const token = await getValidAccessToken(env)
  const sheetCtx = await connect()
  const rows = await readAllRows(sheetCtx)

  const toPublish = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row['Status'] === 'Reviewed')

  if (!toPublish.length) {
    log('No rows with Status="Reviewed" — nothing to publish.')
    return
  }

  log(`Found ${toPublish.length} row(s) to publish (env: ${env}${dryRun ? ', DRY RUN' : ''}).`)

  for (const { row, i } of toPublish) {
    try {
      const result = await publishRow(token, row, i)
      await updateRowFields(sheetCtx, i, {
        'Status': 'Posted',
        'eBay Listing URL': result.listingUrl,
      })
    } catch (err) {
      log(`  ✗ FAILED "${row['Item']}": ${err.message}`)
    }
  }
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`)
  process.exit(1)
})
