// edition-agent.js — Monthly BSV Edition writer
// Reads shelf-products.json, selects 5-6 products for this edition,
// writes a J. Peterman-style long-form story with products woven in as scene props,
// generates per-product vignettes + image briefs for media-director to use all month,
// uploads draft to Drive for Big D approval, saves state to logs/edition-state.json.
//
// Run: node scripts/edition-agent.js
// Flags:
//   --force        Re-run even if an active edition already exists
//   --dry-run      Generate and log but do not upload to Drive or save state
//   --products     Comma-separated product names to include (overrides rotation)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const Anthropic        = require('@anthropic-ai/sdk').default
const { execSync }     = require('child_process')
const fs               = require('fs')
const path             = require('path')
const os               = require('os')
const { TAGLINE, VOICE } = require('./lib/brand-copy')

const ROOT                = path.join(__dirname, '..')
const LOG_FILE            = path.join(ROOT, 'logs', 'edition-agent.log')
const SHELF_PRODUCTS_FILE = path.join(ROOT, 'scripts', 'data', 'shelf-products.json')
const EDITION_STATE_FILE  = path.join(ROOT, 'logs', 'edition-state.json')
const EDITION_INDEX_FILE  = path.join(ROOT, 'logs', 'edition-index.json')
const TEMP_DIR            = path.join(os.tmpdir(), 'bsv-edition-agent')
const REMOTE              = 'big sole vibes:Big Sole Vibes'
const GDRIVE_REPORTS_FOLDER = '1vKaxZuhQy2tZ8cQQF1Vc8TSVJrq26PaP'
const BLOG_DIR            = path.join(ROOT, 'public', 'the-lounge')
const SITE_URL            = 'https://bigsolevibes.com'

const PRODUCTS_PER_EDITION = 6
const EDITION_CADENCE_DAYS = 30

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── State helpers ─────────────────────────────────────────────────────────────

function loadEditionState() {
  try {
    if (fs.existsSync(EDITION_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(EDITION_STATE_FILE, 'utf8'))
    }
  } catch {}
  return null
}

function saveEditionState(state) {
  fs.writeFileSync(EDITION_STATE_FILE, JSON.stringify(state, null, 2))
}

function loadEditionIndex() {
  try {
    if (fs.existsSync(EDITION_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(EDITION_INDEX_FILE, 'utf8'))
    }
  } catch {}
  return { nextProductIndex: 0, editionNumber: 0 }
}

function saveEditionIndex(idx) {
  fs.writeFileSync(EDITION_INDEX_FILE, JSON.stringify(idx, null, 2))
}

// ─── Product selection ─────────────────────────────────────────────────────────

function loadShelfProducts() {
  if (!fs.existsSync(SHELF_PRODUCTS_FILE)) return []
  return JSON.parse(fs.readFileSync(SHELF_PRODUCTS_FILE, 'utf8'))
}

function selectProducts(shelf, idx, overrideNames) {
  if (overrideNames?.length) {
    return shelf.filter(p => overrideNames.includes(p['Product Name']))
  }
  const start   = idx.nextProductIndex % shelf.length
  const picked  = []
  for (let i = 0; i < PRODUCTS_PER_EDITION; i++) {
    picked.push(shelf[(start + i) % shelf.length])
  }
  return picked
}

// ─── Drive helpers ─────────────────────────────────────────────────────────────

function uploadToDrive(localPath, remoteName, folderId) {
  execSync(
    `rclone copyto "${localPath}" "big sole vibes:${remoteName}" --drive-root-folder-id ${folderId}`,
    { stdio: 'pipe' }
  )
}

// ─── Claude prompts ───────────────────────────────────────────────────────────

function buildEditionPrompt(products, editionNumber, monthYear) {
  const productList = products.map((p, i) =>
    `${i + 1}. **${p['Product Name']}** (${p['Category']}, ${p['Price'] || 'price varies'})\n   Affiliate: ${p['Affiliate Link']}\n   Narrative seed: ${p['Narrative']}`
  ).join('\n\n')

  return `You are writing the BSV Monthly Edition — a J. Peterman-style catalog story for Big Sole Vibes.

BSV is a premium men's grooming and lifestyle brand. Voice: ${VOICE} No fluff. No cheerleading. Every word earns its place.

EDITION: #${editionNumber} — ${monthYear}
PRODUCTS THIS EDITION (${products.length} products):

${productList}

---

YOUR OUTPUT — produce exactly these sections, no more:

## EDITION STORY
A single long-form piece, 800–1000 words. J. Peterman style — the story moves through a man's day or a specific situation, and each product appears naturally as a prop in the scene. The story has a beginning, a middle, and an end. Products are not the hero — the man and the moment are. Products are what he reaches for, what's on the shelf when he gets there, what earns its place without explaining itself.

Rules:
- Name each product exactly once in the story, naturally
- Never write "affiliate link" or "buy now" in the story itself
- End the story with a closing line that invites the reader to the shelf: something like "Everything in this edition is on the shelf at bigsolevibes.com/shop/ — it earned its place."
- Tone: The man who has things figured out in this one area, at least.

## PRODUCT VIGNETTES
For each product, a standalone 3-sentence vignette pulled from the story's world. This is what media-director uses as the opening snippet for social posts. Format:

### [Product Name]
VIGNETTE: [3 sentences — the scene, the moment, the hook. Past tense or present tense. No CTA here — that's media-director's job.]
IMAGE_BRIEF: [One paragraph. Describe the scene for Gemini Imagen 4 to generate. The product is a natural prop — on the counter, in his hand, on the bench. The man's face is not visible or is partially visible. Film-still quality. Include lighting, mood, composition. The feeling, not the product spec.]
SOCIAL_HOOK: [One sentence — the opening line for Instagram. Reads like the first line of a short story.]

## EDITION METADATA
EDITION_NUMBER: ${editionNumber}
MONTH: ${monthYear}
THEME: [2-4 word theme for this edition — e.g., "The Morning Protocol" or "The Standard, Assembled"]
PRODUCTS: ${products.map(p => p['Product Name']).join(' | ')}
SHELF_URL: https://bigsolevibes.com/shop/`
}

// ─── Parse Claude output ───────────────────────────────────────────────────────

function parseEditionOutput(raw, products) {
  const storyMatch = raw.match(/## EDITION STORY\s*([\s\S]*?)(?=## PRODUCT VIGNETTES)/i)
  const vignetteSection = raw.match(/## PRODUCT VIGNETTES\s*([\s\S]*?)(?=## EDITION METADATA)/i)
  const metaSection = raw.match(/## EDITION METADATA\s*([\s\S]*?)$/i)

  const story = storyMatch ? storyMatch[1].trim() : raw

  // Parse per-product vignettes
  const vignettes = []
  if (vignetteSection) {
    for (const product of products) {
      const name = product['Product Name']
      const re = new RegExp(`### ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([\\s\\S]*?)(?=###|$)`, 'i')
      const match = vignetteSection[1].match(re)
      if (match) {
        const block = match[1]
        const vignette  = (block.match(/VIGNETTE:\s*([^\n]+(?:\n(?!IMAGE_BRIEF:|SOCIAL_HOOK:)[^\n]+)*)/i) || [])[1]?.trim()
        const imageBrief = (block.match(/IMAGE_BRIEF:\s*([^\n]+(?:\n(?!SOCIAL_HOOK:)[^\n]+)*)/i) || [])[1]?.trim()
        const socialHook = (block.match(/SOCIAL_HOOK:\s*(.+)/i) || [])[1]?.trim()
        vignettes.push({
          productName:  name,
          affiliateLink: product['Affiliate Link'],
          category:     product['Category'],
          price:        product['Price'] || '',
          vignette:     vignette || '',
          imageBrief:   imageBrief || '',
          socialHook:   socialHook || '',
        })
      } else {
        vignettes.push({
          productName:  name,
          affiliateLink: product['Affiliate Link'],
          category:     product['Category'],
          price:        product['Price'] || '',
          vignette:     '',
          imageBrief:   '',
          socialHook:   '',
        })
      }
    }
  }

  // Parse metadata
  let meta = { theme: '', editionNumber: 0, month: '', products: [] }
  if (metaSection) {
    const m = metaSection[1]
    meta.theme         = (m.match(/THEME:\s*(.+)/i) || [])[1]?.trim() || ''
    meta.editionNumber = parseInt((m.match(/EDITION_NUMBER:\s*(\d+)/i) || [])[1] || '0')
    meta.month         = (m.match(/MONTH:\s*(.+)/i) || [])[1]?.trim() || ''
  }

  return { story, vignettes, meta }
}

// ─── Build Drive doc ───────────────────────────────────────────────────────────

function buildDriveDoc(parsed, editionNumber, monthYear) {
  const lines = [
    `# BSV Edition #${editionNumber} — ${monthYear}`,
    `**Theme:** ${parsed.meta.theme || 'TBD'}`,
    `**Status:** PENDING APPROVAL`,
    `**Products:** ${parsed.vignettes.map(v => v.productName).join(', ')}`,
    '',
    '---',
    '',
    '## ✅ TO APPROVE',
    'Add a file named `edition-approved.txt` to Drive/Inbox/ containing just the word `APPROVED` to activate this edition.',
    'Or reply APPROVED in Telegram when prompted.',
    '',
    '---',
    '',
    '## THE EDITION STORY',
    '',
    parsed.story,
    '',
    '---',
    '',
    '## PRODUCT VIGNETTES (used in social posts)',
    '',
  ]

  for (const v of parsed.vignettes) {
    lines.push(`### ${v.productName}`)
    lines.push(`**Category:** ${v.category} | **Price:** ${v.price || 'See Amazon'}`)
    lines.push(`**Affiliate Link:** ${v.affiliateLink}`)
    lines.push('')
    lines.push(`**Vignette:**`)
    lines.push(v.vignette || '_Not parsed — check raw output_')
    lines.push('')
    lines.push(`**Social Hook:** ${v.socialHook || '_Not parsed_'}`)
    lines.push('')
    lines.push(`**Image Brief:**`)
    lines.push(v.imageBrief || '_Not parsed_')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Lounge publish ───────────────────────────────────────────────────────────
// Converts the edition story to a Lounge HTML page at the time of approval.
// Posts this month will link to this URL instead of just /shop/.

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function storyToHtmlParagraphs(story) {
  return story
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n        ')
}

function buildEditionPageHtml(state, dateStr) {
  const slug        = `edition-${state.editionNumber}-${state.month.toLowerCase().replace(/\s+/g, '-')}`
  const title       = `Edition #${state.editionNumber}: ${state.theme}`
  const canonicalUrl = `${SITE_URL}/the-lounge/${slug}.html`
  const publishDate = new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const bodyHtml    = storyToHtmlParagraphs(state.story)
  const productListHtml = state.vignettes.map(v =>
    `<li><a href="${escapeHtml(v.affiliateLink)}" target="_blank" rel="noopener">${escapeHtml(v.productName)}</a></li>`
  ).join('\n            ')

  return { slug, html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — The Lounge | Big Sole Vibes</title>
  <meta name="description" content="${escapeHtml(state.theme)} — The monthly BSV Edition. ${state.products?.slice(0,3).join(', ')}.">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title"       content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(state.theme)}">
  <meta property="og:url"         content="${canonicalUrl}">
  <meta property="og:type"        content="article">
  <meta property="article:published_time" content="${dateStr}">
  <link rel="stylesheet" href="/styles/lounge.css">
</head>
<body>
  <nav class="lounge-nav">
    <a href="/" class="nav-logo">BSV</a>
    <ul>
      <li><a href="/the-lounge">The Lounge</a></li>
      <li><a href="/shop">The Locker Room</a></li>
    </ul>
  </nav>
  <main class="post-container">
    <header class="post-header">
      <p class="post-eyebrow">Edition #${state.editionNumber} — ${escapeHtml(state.month)}</p>
      <h1 class="post-title">${escapeHtml(state.theme)}</h1>
      <p class="post-meta">${publishDate}</p>
    </header>
    <article class="post-body">
        ${bodyHtml}
    </article>
    <aside class="edition-shelf">
      <h2>Everything in This Edition</h2>
      <p>${TAGLINE}</p>
      <ul>
            ${productListHtml}
      </ul>
      <a href="/shop" class="shelf-cta">The Full Locker Room →</a>
    </aside>
    <p class="affiliate-note">BSV participates in the Amazon Associates Program. Links on this page are affiliate links — we may earn a commission at no cost to you.</p>
  </main>
  <footer class="lounge-footer">
    <p>© Big Sole Vibes — <a href="/the-lounge">The Lounge</a></p>
  </footer>
</body>
</html>` }
}

function publishEditionToLounge(state) {
  fs.mkdirSync(BLOG_DIR, { recursive: true })
  const dateStr    = (state.approvedAt || new Date().toISOString()).slice(0, 10)
  const { slug, html } = buildEditionPageHtml(state, dateStr)
  const htmlPath   = path.join(BLOG_DIR, `${slug}.html`)
  const manifestPath = path.join(BLOG_DIR, 'manifest.json')
  const loungeUrl  = `${SITE_URL}/the-lounge/${slug}.html`

  // Write page
  fs.writeFileSync(htmlPath, html)
  log(`Lounge page written: ${htmlPath}`)

  // Update manifest
  let manifest = []
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}
  manifest = manifest.filter(m => m.slug !== slug)
  manifest.unshift({
    slug,
    title:   `Edition #${state.editionNumber}: ${state.theme}`,
    date:    dateStr,
    excerpt: state.story.slice(0, 200).replace(/\n/g, ' ') + '…',
    type:    'edition',
  })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  log(`Manifest updated: ${manifest.length} article(s)`)

  // Git commit + push to preview/full-site.
  // FIXED 2026-08-06: safePushToPreview(cwd, log) only runs `git push` — it
  // never stages or commits anything. This call used to pass a commit-message
  // string as the `cwd` argument (signature mismatch) and never called `git
  // add`/`git commit` at all, so when HEAD already matched origin the push
  // was a silent no-op that still logged "pushed" success. Edition #2 sat
  // uncommitted in the working tree for hours before this was caught — see
  // BSV-BigC-Audit-Log.md same date. Now stages + commits BLOG_DIR explicitly
  // before pushing, and checks the actual return value.
  try {
    const { safePushToPreview } = require('./git-push-guard')
    execSync(`git add "${BLOG_DIR}"`, { cwd: ROOT, stdio: 'pipe' })
    execSync(`git commit -m "edition-${state.editionNumber}: publish ${state.theme} to The Lounge"`, { cwd: ROOT, stdio: 'pipe' })
    const pushed = safePushToPreview(ROOT, log)
    if (pushed) log(`Git: committed + pushed to preview/full-site`)
    else log(`WARNING: commit succeeded but push failed — check logs/edition-agent.log for the git error above`)
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message
    log(`WARNING: git commit/push failed — ${msg}`)
    log('Run: git add public/the-lounge/ && git commit -m "edition publish" && git push origin preview/full-site')
  }

  return loungeUrl
}

// ─── Main ──────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  const force    = process.argv.includes('--force')
  const dryRun   = process.argv.includes('--dry-run')
  const approve  = process.argv.includes('--approve')
  const prodArg  = process.argv.indexOf('--products')
  const overrideNames = prodArg !== -1
    ? process.argv[prodArg + 1].split(',').map(s => s.trim())
    : null

  // ── Approval shortcut ────────────────────────────────────────────────────────
  if (approve) {
    const existing = loadEditionState()
    if (!existing) {
      console.log('No edition-state.json found — nothing to approve')
      process.exit(1)
    }
    if (existing.approved) {
      console.log(`Edition #${existing.editionNumber} (${existing.month}) is already approved`)
      process.exit(0)
    }
    existing.approved   = true
    existing.approvedAt = new Date().toISOString()
    saveEditionState(existing)

    // Reset vignette index so approved edition starts at product 0
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true })
    fs.writeFileSync(
      path.join(ROOT, 'logs', 'edition-vignette-index.json'),
      JSON.stringify({ index: 0, lastUpdated: new Date().toISOString() }, null, 2)
    )

    // Publish the edition story to The Lounge
    let loungeUrl = existing.shelfUrl || 'https://bigsolevibes.com/shop/'
    try {
      loungeUrl = publishEditionToLounge(existing)
      existing.loungeUrl = loungeUrl
      saveEditionState(existing)
      console.log(`📖 Lounge page live: ${loungeUrl}`)
    } catch (err) {
      console.log(`⚠️  Lounge publish failed: ${err.message}`)
      console.log('   You can publish manually: node scripts/edition-agent.js --publish-only')
    }

    console.log(`✅ Edition #${existing.editionNumber} — "${existing.theme}" approved.`)
    console.log(`   Posts this month will link to: ${loungeUrl}`)
    try {
      const { sendTelegram } = require('./telegram')
      await sendTelegram(
        `✅ *BSV Edition #${existing.editionNumber} approved*\n\nTheme: ${existing.theme}\n${existing.products?.length || 0} products active this month.\n\nLounge page: ${loungeUrl}`
      )
    } catch {}
    process.exit(0)
  }

  log('━━━ edition-agent start ━━━')

  // ── Check if active edition still running ──────────────────────────────────
  const existing = loadEditionState()
  if (existing && !force) {
    const createdAt  = new Date(existing.createdAt)
    const daysSince  = (Date.now() - createdAt.getTime()) / 86400000
    if (daysSince < EDITION_CADENCE_DAYS) {
      log(`Active edition #${existing.editionNumber} — ${existing.month} (${Math.round(daysSince)}d old, ${EDITION_CADENCE_DAYS}d cadence). Use --force to override.`)
      log('━━━ edition-agent complete (cadence gate) ━━━\n')
      return
    }
    log(`Edition #${existing.editionNumber} is ${Math.round(daysSince)}d old — time for a new one`)
  }

  // ── Load shelf ──────────────────────────────────────────────────────────────
  const shelf = loadShelfProducts()
  if (!shelf.length) {
    log('ERROR: shelf-products.json is empty or missing — cannot generate edition')
    process.exit(1)
  }
  log(`Shelf: ${shelf.length} products`)

  // ── Select products ─────────────────────────────────────────────────────────
  const idx = loadEditionIndex()
  const editionNumber = idx.editionNumber + 1
  const now = new Date()
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const selected = selectProducts(shelf, idx, overrideNames)
  log(`Edition #${editionNumber} — ${monthYear} — ${selected.length} products:`)
  selected.forEach(p => log(`  · ${p['Product Name']} (${p['Category']})`))

  // ── Call Claude ─────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const client = new Anthropic({ apiKey })
  const prompt = buildEditionPrompt(selected, editionNumber, monthYear)

  log(`Calling Claude API — prompt ${prompt.length} chars`)
  let raw = ''
  try {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }],
    })
    raw = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    log(`Claude response: ${raw.length} chars, stop_reason=${response.stop_reason}`)
  } catch (err) {
    log(`ERROR: Claude API failed — ${err.message}`)
    process.exit(1)
  }

  // ── Parse output ────────────────────────────────────────────────────────────
  const parsed = parseEditionOutput(raw, selected)
  log(`Parsed: story ${parsed.story.length} chars, ${parsed.vignettes.length} vignettes`)
  parsed.vignettes.forEach(v => {
    const ok = v.vignette && v.imageBrief && v.socialHook
    log(`  ${ok ? '✓' : '⚠'} ${v.productName}${!ok ? ' — missing fields' : ''}`)
  })

  if (dryRun) {
    log('DRY RUN — not saving state or uploading to Drive')
    log('\n--- EDITION STORY PREVIEW ---')
    log(parsed.story.slice(0, 500) + '...')
    log('━━━ edition-agent complete (dry-run) ━━━\n')
    return
  }

  // ── Build and upload Drive doc ──────────────────────────────────────────────
  const docContent  = buildDriveDoc(parsed, editionNumber, monthYear)
  const docFilename = `edition-${editionNumber}-${now.toISOString().slice(0, 7)}-draft.md`
  const localDoc    = path.join(TEMP_DIR, docFilename)
  fs.writeFileSync(localDoc, docContent)

  try {
    uploadToDrive(localDoc, docFilename, GDRIVE_REPORTS_FOLDER)
    log(`Drive upload: ${docFilename}`)
  } catch (err) {
    log(`WARNING: Drive upload failed — ${err.message}`)
  }

  // ── Save edition state (pending approval) ───────────────────────────────────
  const state = {
    editionNumber,
    month:      monthYear,
    theme:      parsed.meta.theme,
    createdAt:  now.toISOString(),
    approved:   false,
    approvedAt: null,
    driveDoc:   docFilename,
    products:   selected.map(p => p['Product Name']),
    vignettes:  parsed.vignettes,
    story:      parsed.story,
    shelfUrl:   'https://bigsolevibes.com/shop/',
  }

  saveEditionState(state)
  log(`Edition state saved → logs/edition-state.json (approved: false)`)

  // Advance product index for next edition
  const nextIndex = (idx.nextProductIndex + selected.length) % shelf.length
  saveEditionIndex({ nextProductIndex: nextIndex, editionNumber })
  log(`Product index advanced: ${idx.nextProductIndex} → ${nextIndex}`)

  // ── Telegram alert ──────────────────────────────────────────────────────────
  try {
    const { sendTelegram } = require('./telegram')
    const msg = [
      `📖 *BSV Edition #${editionNumber} — ${monthYear}*`,
      ``,
      `Theme: *${parsed.meta.theme || 'TBD'}*`,
      `Products: ${selected.length}`,
      selected.map(p => `• ${p['Product Name']}`).join('\n'),
      ``,
      `Draft in Drive → ${docFilename}`,
      ``,
      `Reply *APPROVED* to activate, or review the draft first.`,
    ].join('\n')
    const r = await sendTelegram(msg)
    if (r?.message_id) log(`Telegram alert sent — message_id: ${r.message_id}`)
    else log('WARNING: Telegram alert returned no confirmation')
  } catch (err) {
    log(`WARNING: Telegram alert failed — ${err.message}`)
  }

  log('━━━ edition-agent complete ━━━\n')
})()
