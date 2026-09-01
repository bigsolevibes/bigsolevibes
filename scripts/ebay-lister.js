require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const Anthropic = require('@anthropic-ai/sdk').default
const { connect, ensureHeaders, appendListing } = require('./resale-sheets-client')

// ─── ebay-lister.js ─────────────────────────────────────────────────────────
// Built 2026-09-01. Phase 1 of the resale/eBay side project (see Big D's
// reselling notes): drops photos of a thrifted item + a quick note into a
// Drive folder, this script drafts an eBay-ready listing (title, specifics,
// description, suggested price) via Claude vision and writes it as a row in
// the "BSV Resale Listings" sheet for manual review. Does NOT post to eBay —
// no eBay API keys exist yet, and even once they do, auto-post is a
// deliberate phase 2 behind its own approval step (see dashboard's
// approve/deny pattern for precedent). This is a single-pass, run-once-per-
// invocation script (like product-research.js), not a polling loop — run it
// manually with `node scripts/ebay-lister.js` after dropping new items in.
//
// Drive layout (mirrors watch-drive.js's Ready to Post / Posted convention):
//   Big Sole Vibes/Resale Inbox/<item-folder>/photo1.jpg, photo2.jpg, notes.txt
//   Big Sole Vibes/Resale Inbox/Processed/<item-folder>/   ← moved here after drafting
//
// notes.txt is optional freeform text — source store, cost, size, condition
// flags, whatever Big D jots down. It's passed to Claude as-is, not parsed.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT           = path.join(__dirname, '..')
const LOG_FILE        = path.join(ROOT, 'logs', 'ebay-lister.log')
const TEMP_DIR         = path.join(os.homedir(), 'tmp', 'bsv-resale-inbox')
const REMOTE_INBOX     = 'big sole vibes:Big Sole Vibes/Resale Inbox'
const REMOTE_PROCESSED = 'big sole vibes:Big Sole Vibes/Resale Inbox/Processed'

const DRAFT_MODEL  = 'claude-sonnet-4-6' // judgment task (condition assessment,
                                          // pricing, listing copy) — same tier
                                          // as creative-agent/product-research,
                                          // not eng-bot/QA-check Haiku tier.
const MAX_IMAGES_PER_ITEM = 6
const MAX_IMAGE_DIMENSION = 1568 // px, long edge — matches Claude's own internal vision resize target
const JPEG_QUALITY        = 80   // sips formatOptions percentage — plenty for condition assessment, keeps request size well under the API cap

const IMAGE_EXTENSIONS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
// iPhone camera photos are HEIC/HEIF by default — Big D's actual workflow
// (photographing thrift finds on his phone) — and Claude's vision API only
// accepts jpeg/png/gif/webp. Recognized as image files here, then converted
// to jpeg via macOS's built-in `sips` (no extra install) before sending.
const HEIC_EXTENSIONS = ['.heic', '.heif']

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function listRemoteDirs(remotePath) {
  try {
    const out = execSync(`rclone lsf --dirs-only "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.split('\n').map(l => l.replace(/\/$/, '')).filter(Boolean)
  } catch (err) {
    log(`ERROR: rclone lsf failed for ${remotePath}: ${err.stderr?.toString().trim() || err.message}`)
    return []
  }
}

function listRemoteFiles(remotePath) {
  try {
    const out = execSync(`rclone lsf --files-only "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.split('\n').filter(Boolean)
  } catch (err) {
    log(`ERROR: rclone lsf --files-only failed for ${remotePath}: ${err.stderr?.toString().trim() || err.message}`)
    return []
  }
}

function downloadItemFolder(remotePath, localDir) {
  fs.mkdirSync(localDir, { recursive: true })
  execSync(`rclone copy "${remotePath}" "${localDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function moveToProcessed(itemName) {
  execSync(`rclone move "${REMOTE_INBOX}/${itemName}" "${REMOTE_PROCESSED}/${itemName}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

// Strips markdown code fences if Claude wraps the JSON in ```json ... ```
// despite being asked not to — cheap insurance, same defensive parse used
// elsewhere in the pipeline for Claude JSON responses.
function parseJsonResponse(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(cleaned)
}

async function draftListing(anthropicKey, itemName, images, notesText) {
  const client = new Anthropic({ apiKey: anthropicKey })

  const content = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType, data: img.base64 },
  }))

  content.push({
    type: 'text',
    text: `You are drafting an eBay listing for a thrifted/used item BSV (Big Sole Vibes) is reselling. You're looking at ${images.length} photo(s) of the item named "${itemName}".

${notesText ? `Seller's own notes (source store, cost, anything they flagged about condition):\n${notesText}\n` : 'No seller notes were provided — assess entirely from the photos.'}

Look closely at the photos for: brand and model (read any visible labels/tags), size (if a tag is visible), color/colorway, and condition — genuinely inspect for wear: sole wear, creasing, scuffs, discoloration, missing laces/insoles, box/original packaging presence. Be honest about condition; overstating it causes returns and bad feedback. Use eBay's standard condition vocabulary (e.g. "Pre-owned - Good", "Pre-owned - Fair", "New with box", "New without box").

Suggest a starting price in USD based on what you can see of the item's condition and apparent market tier — note in price_reasoning that this is a rough estimate and Big D should sanity-check it against actual recent eBay sold listings before posting, since you don't have live market data.

Respond with ONLY a single JSON object — no markdown fences, no commentary before or after — with exactly these keys:
{
  "title": "eBay listing title, 80 characters or fewer, keyword-forward the way eBay search rewards",
  "brand": "",
  "size": "",
  "color": "",
  "item_condition": "",
  "category": "suggested eBay category, e.g. 'Clothing, Shoes & Accessories > Men > Men's Shoes > Athletic Shoes'",
  "description": "a few short paragraphs: what it is, condition detail, any flaws called out plainly, standard shipping/returns note",
  "suggested_price": "a number only, e.g. 45",
  "price_reasoning": "one or two sentences"
}`,
  })

  const response = await client.messages.create({
    model:      DRAFT_MODEL,
    max_tokens: 1200,
    messages:   [{ role: 'user', content }],
  })

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return parseJsonResponse(text)
}

async function processItem(anthropicKey, sheetCtx, itemName) {
  const remoteItemPath = `${REMOTE_INBOX}/${itemName}`
  const localDir        = path.join(TEMP_DIR, itemName)

  const files = listRemoteFiles(remoteItemPath)
  const imageFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase()
    return IMAGE_EXTENSIONS[ext] || HEIC_EXTENSIONS.includes(ext)
  })
  const hasNotes    = files.includes('notes.txt')

  if (!imageFiles.length) {
    log(`SKIP ${itemName}: no supported image files found (jpg/jpeg/png/webp/gif) — left in Inbox`)
    return { skipped: true }
  }

  log(`Processing ${itemName}: ${imageFiles.length} image(s), notes.txt=${hasNotes}`)
  downloadItemFolder(remoteItemPath, localDir)

  const imagesToSend = imageFiles.slice(0, MAX_IMAGES_PER_ITEM)
  if (imageFiles.length > MAX_IMAGES_PER_ITEM) {
    log(`  NOTE: ${imageFiles.length} images found, only sending first ${MAX_IMAGES_PER_ITEM} to control cost`)
  }

  // Every image gets normalized through sips: resized to MAX_IMAGE_DIMENSION
  // and re-encoded as jpeg. Two reasons this runs on ALL images, not just
  // HEIC: (1) Claude's vision API downsamples internally past ~1568px on the
  // long edge anyway, so sending full-res iPhone originals (often 3000px+)
  // wastes request size for zero quality gain, and full-res HEIC->JPEG
  // conversion alone (no resize) is what hit a 413 request_too_large on the
  // first real test — 6 photos, converted 1:1, was too large; (2) it gives
  // one code path instead of format-specific branches.
  const images = []
  for (const f of imagesToSend) {
    const ext        = path.extname(f).toLowerCase()
    const sourcePath = path.join(localDir, f)
    const jpegPath    = sourcePath.replace(new RegExp(`${ext}$`, 'i'), '.normalized.jpg')

    try {
      execSync(`sips -Z ${MAX_IMAGE_DIMENSION} -s format jpeg -s formatOptions ${JPEG_QUALITY} "${sourcePath}" --out "${jpegPath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      log(`  WARNING: sips normalization failed for ${f}, skipping this image: ${err.stderr?.toString().trim() || err.message}`)
      continue
    }

    const buffer = fs.readFileSync(jpegPath)
    images.push({ mimeType: 'image/jpeg', base64: buffer.toString('base64') })
  }

  if (!images.length) {
    log(`SKIP ${itemName}: all images failed to load/convert — left in Inbox for review`)
    return { error: true }
  }

  const notesText = hasNotes ? fs.readFileSync(path.join(localDir, 'notes.txt'), 'utf8').trim() : ''

  let draft
  try {
    draft = await draftListing(anthropicKey, itemName, images, notesText)
  } catch (err) {
    log(`ERROR: Claude drafting failed for ${itemName}: ${err.message}`)
    return { error: true }
  }

  await appendListing(sheetCtx, {
    item:            itemName,
    conditionNotes:  notesText,
    title:           draft.title,
    brand:           draft.brand,
    size:            draft.size,
    color:           draft.color,
    itemCondition:   draft.item_condition,
    category:        draft.category,
    description:     draft.description,
    suggestedPrice:  draft.suggested_price,
    priceReasoning:  draft.price_reasoning,
    status:          'Draft',
    photos:          imagesToSend.join(', '),
    driveFolder:     `${REMOTE_PROCESSED}/${itemName}`,
  })
  log(`  Draft written to sheet: "${draft.title}" — suggested $${draft.suggested_price}`)

  moveToProcessed(itemName)
  log(`  Moved Drive folder to Processed/${itemName}`)

  // Local temp copy is scratch — clean up now that Drive has the durable copy.
  fs.rmSync(localDir, { recursive: true, force: true })

  return { drafted: true }
}

async function main() {
  log('━━━ ebay-lister start ━━━')

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    log('ERROR: ANTHROPIC_API_KEY not set — cannot draft listings')
    process.exit(1)
  }

  let sheetCtx
  try {
    sheetCtx = await connect()
    await ensureHeaders(sheetCtx)
  } catch (err) {
    log(`ERROR: could not connect to resale sheet: ${err.message}`)
    process.exit(1)
  }

  const itemFolders = listRemoteDirs(REMOTE_INBOX).filter(name => name !== 'Processed')

  if (!itemFolders.length) {
    log('No new item folders in Resale Inbox — nothing to do')
    log('━━━ ebay-lister complete ━━━')
    return
  }

  log(`Found ${itemFolders.length} item folder(s): ${itemFolders.join(', ')}`)

  let drafted = 0, skipped = 0, errored = 0
  for (const itemName of itemFolders) {
    try {
      const result = await processItem(anthropicKey, sheetCtx, itemName)
      if (result.drafted) drafted++
      else if (result.skipped) skipped++
      else if (result.error) errored++
    } catch (err) {
      log(`ERROR: unhandled failure processing ${itemName}: ${err.message}`)
      errored++
    }
  }

  log(`Summary: ${drafted} drafted, ${skipped} skipped (no images), ${errored} errored`)
  log('━━━ ebay-lister complete ━━━')
}

main().catch(err => {
  log(`FATAL: ${err.stack || err.message}`)
  process.exit(1)
})
