require('dotenv').config()
const { execSync }  = require('child_process')
const fs            = require('fs')
const path          = require('path')
const { connect, ensureHeaders, readAllRows } = require('./sheets-client')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'sync-shop.log')
const SHOP_OUT = path.join(ROOT, 'shop', 'index.html')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Category → locker number map ────────────────────────────────────────────
// Deterministic order so locker numbers don't shuffle on every deploy.
const CATEGORY_ORDER = [
  'Foot Files',
  'Foot Serums',
  'Foot Creams',
  'Foot Soaks',
  'Foot Soaks & Recovery',
  'Foot Powders',
  'Foot Grooming Tools',
  'Nail Care',
  'Men\'s Grooming Kits',
  'Full Kits',
]

function categoryIcon(cat) {
  const map = {
    'Foot Files':            'ti-sparkles',
    'Foot Serums':           'ti-droplet-filled',
    'Foot Creams':           'ti-droplet',
    'Foot Soaks':            'ti-ripple',
    'Foot Soaks & Recovery': 'ti-ripple',
    'Foot Powders':          'ti-wind',
    'Foot Grooming Tools':   'ti-tool',
    'Nail Care':             'ti-scissors',
    'Men\'s Grooming Kits':  'ti-briefcase',
    'Full Kits':             'ti-package',
  }
  return map[cat] || 'ti-star'
}

// ─── HTML generation ──────────────────────────────────────────────────────────

function buildProductCard(product) {
  const amazonUrl = `https://www.amazon.com/dp/${product['ASIN']}?tag=${process.env.AMAZON_AFFILIATE_TAG || 'bigsolevibes-20'}`
  const score     = product['Score'] || ''
  return `
              <div class="product-card">
                <div class="product-score">${score}</div>
                <h3 class="product-name">${escapeHtml(product['Product Name'])}</h3>
                <p class="product-desc">${escapeHtml(product['Description'])}</p>
                <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer" class="product-cta">
                  SHOP ON AMAZON <span class="cta-arrow">↗</span>
                </a>
              </div>`
}

function buildLockerSection(category, products, lockerNum) {
  const icon    = categoryIcon(category)
  const numStr  = String(lockerNum).padStart(2, '0')
  const cards   = products.map(buildProductCard).join('')
  const catSlug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return `
        <!-- Locker ${numStr}: ${category} -->
        <section class="locker-section" id="${catSlug}">
          <div class="locker-header">
            <div class="locker-meta">
              <span class="locker-number">${numStr}</span>
              <div class="locker-vents">
                <span></span><span></span><span></span>
              </div>
            </div>
            <div class="locker-label">
              <i class="ti ${icon}" aria-hidden="true"></i>
              <span class="category-name">${escapeHtml(category)}</span>
            </div>
            <div class="locker-atmosphere" aria-hidden="true">
              <i class="ti ti-shoe"></i>
              <i class="ti ti-sock"></i>
            </div>
          </div>
          <div class="locker-shelf-bar" aria-hidden="true"></div>
          <div class="product-grid">
            ${cards}
          </div>
        </section>`
}

function buildShopPage(approvedProducts) {
  // Group by category preserving order
  const grouped = {}
  for (const cat of CATEGORY_ORDER) grouped[cat] = []

  for (const p of approvedProducts) {
    const cat = p['Category']
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }

  // Only render categories that have products
  let lockerNum   = 0
  let sectionsHtml = ''
  for (const cat of CATEGORY_ORDER) {
    if (!grouped[cat] || !grouped[cat].length) continue
    lockerNum++
    sectionsHtml += buildLockerSection(cat, grouped[cat], lockerNum)
  }

  // Handle any categories not in the predefined order
  for (const [cat, products] of Object.entries(grouped)) {
    if (!CATEGORY_ORDER.includes(cat) && products.length) {
      lockerNum++
      sectionsHtml += buildLockerSection(cat, products, lockerNum)
    }
  }

  const totalProducts = approvedProducts.length
  const generated     = new Date().toISOString().slice(0, 10)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Locker Room — Big Sole Vibes</title>
  <meta name="description" content="Proprietor-approved foot care picks. Nothing goes on this shelf that hasn't earned its place.">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css">
  <style>
    /* ── Locker Room page styles ── */

    .shop-hero {
      text-align: center;
      padding: 5rem 1.5rem 3rem;
      border-bottom: 1px solid rgba(184, 146, 74, 0.15);
    }

    .shop-eyebrow {
      font-family: 'Courier New', monospace;
      font-size: 0.625rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--gold);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 0.75rem;
    }

    .shop-eyebrow::before,
    .shop-eyebrow::after {
      content: '';
      display: block;
      width: 28px;
      height: 1px;
      background: var(--gold);
      opacity: 0.4;
    }

    .shop-title {
      font-size: clamp(2.5rem, 6vw, 4rem);
      font-weight: 700;
      color: var(--cream);
      letter-spacing: 0.04em;
      margin: 0 0 0.5rem;
      line-height: 1.1;
    }

    .shop-tagline {
      font-style: italic;
      color: var(--cream-muted);
      font-size: 1rem;
      margin: 0 0 1.5rem;
    }

    .shop-count {
      font-family: 'Courier New', monospace;
      font-size: 0.625rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: rgba(184, 146, 74, 0.4);
    }

    /* ── Affiliate disclaimer ── */
    .affiliate-bar {
      background: rgba(255,255,255,0.03);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      text-align: center;
      padding: 0.6rem 1.5rem;
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.08em;
      color: rgba(255,255,255,0.25);
    }

    /* ── Locker sections ── */
    .locker-room {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 1.5rem 5rem;
    }

    .locker-section {
      margin-top: 4rem;
    }

    .locker-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 0;
      padding-bottom: 0.75rem;
    }

    .locker-meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 36px;
    }

    .locker-number {
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.12em;
      color: var(--gold);
      opacity: 0.5;
    }

    .locker-vents {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .locker-vents span {
      display: block;
      width: 18px;
      height: 2px;
      background: rgba(255,255,255,0.08);
      border-radius: 1px;
    }

    .locker-label {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .locker-label .ti {
      font-size: 1rem;
      color: var(--gold);
      opacity: 0.7;
    }

    .category-name {
      font-family: 'Courier New', monospace;
      font-size: 0.625rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--gold);
    }

    .locker-atmosphere {
      display: flex;
      gap: 6px;
      opacity: 0.15;
    }

    .locker-atmosphere .ti {
      font-size: 1rem;
      color: var(--cream);
    }

    .locker-shelf-bar {
      height: 3px;
      background: linear-gradient(90deg,
        rgba(184,146,74,0.0) 0%,
        rgba(184,146,74,0.3) 20%,
        rgba(184,146,74,0.3) 80%,
        rgba(184,146,74,0.0) 100%
      );
      margin-bottom: 1.5rem;
      border-radius: 2px;
    }

    /* ── Product grid ── */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.25rem;
    }

    .product-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 4px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      transition: border-color 0.2s;
    }

    .product-card:hover {
      border-color: rgba(184,146,74,0.3);
    }

    .product-score {
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.1em;
      color: var(--gold);
      opacity: 0.6;
      margin-bottom: 0.5rem;
    }

    .product-name {
      font-size: 1rem;
      font-weight: 600;
      color: var(--cream);
      margin: 0 0 0.75rem;
      line-height: 1.35;
    }

    .product-desc {
      font-style: italic;
      font-size: 0.875rem;
      color: var(--cream-muted);
      line-height: 1.6;
      flex: 1;
      margin: 0 0 1.25rem;
    }

    .product-cta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--gold);
      color: var(--navy);
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-decoration: none;
      padding: 0.6rem 1rem;
      border-radius: 2px;
      transition: opacity 0.15s;
      align-self: flex-start;
    }

    .product-cta:hover { opacity: 0.85; }
    .cta-arrow { font-style: normal; }

    /* ── Floor ── */
    .locker-floor {
      text-align: center;
      border-top: 1px solid rgba(184,146,74,0.12);
      margin-top: 5rem;
      padding-top: 3rem;
      padding-bottom: 3rem;
    }

    .floor-rule {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 1rem;
    }

    .floor-rule span {
      display: block;
      width: 32px;
      height: 1px;
      background: var(--gold);
      opacity: 0.3;
    }

    .floor-question {
      font-style: italic;
      font-size: 1.1rem;
      color: var(--cream-muted);
      margin: 0 0 0.4rem;
    }

    .floor-sub {
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(184,146,74,0.35);
      margin: 0 0 2rem;
    }

    .floor-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(184,146,74,0.25);
      color: var(--cream-muted);
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-decoration: none;
      padding: 0.7rem 1.5rem;
      border-radius: 2px;
      transition: border-color 0.2s, color 0.2s;
    }

    .floor-cta:hover {
      border-color: var(--gold);
      color: var(--gold);
    }

    .coming-soon {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      color: rgba(255,255,255,0.2);
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      padding: 0.7rem 1.5rem;
      border-radius: 2px;
      margin-top: 1rem;
      display: block;
      width: fit-content;
      margin: 1rem auto 0;
    }

    .coming-soon .ti { font-size: 0.75rem; opacity: 0.5; }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .product-grid { grid-template-columns: 1fr; }
      .locker-atmosphere { display: none; }
    }
  </style>
</head>
<body>

  <!-- Navigation (matches site nav) -->
  <nav class="site-nav">
    <a href="/" class="nav-brand">BIG SOLE VIBES</a>
    <ul class="nav-links">
      <li><a href="/">Home</a></li>
      <li><a href="/lounge">Lounge</a></li>
      <li><a href="/audits">Audits</a></li>
      <li><a href="/brief">Brief</a></li>
      <li><a href="/shop" class="nav-active">Shop</a></li>
    </ul>
  </nav>

  <!-- Hero -->
  <header class="shop-hero">
    <p class="shop-eyebrow">Big Sole Vibes</p>
    <h1 class="shop-title">The Locker Room</h1>
    <p class="shop-tagline">"When the shoes come off — what's left?"</p>
    <p class="shop-count">${totalProducts} proprietor-approved picks</p>
  </header>

  <!-- Affiliate disclaimer -->
  <div class="affiliate-bar">
    BSV participates in the Amazon Associates Program. Links on this page are affiliate links — we may earn a commission at no cost to you.
  </div>

  <!-- Locker sections -->
  <main class="locker-room">
    ${sectionsHtml}

    <!-- Floor -->
    <div class="locker-floor">
      <div class="floor-rule"><span></span><span></span></div>
      <p class="floor-question">"Are your feet worthy to bare?"</p>
      <p class="floor-sub">Est. 2025 — Chicago</p>
      <a href="/audits" class="floor-cta">
        <i class="ti ti-file-text" aria-hidden="true"></i>
        Read the Sole Audits
      </a>
      <div class="coming-soon">
        <i class="ti ti-lock" aria-hidden="true"></i>
        More lockers opening soon
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer class="site-footer">
    <p>© ${new Date().getFullYear()} Big Sole Vibes. All rights reserved.</p>
    <p class="footer-note">Generated ${generated} — ${totalProducts} approved picks</p>
  </footer>

</body>
</html>`
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function gitPush() {
  const cwd = ROOT
  try {
    execSync('git add shop/index.html', { cwd, stdio: 'pipe' })

    // Check if there's anything to commit
    const status = execSync('git status --porcelain shop/index.html', { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
    if (!status) {
      log('Git: no changes to shop/index.html — skipping push')
      return false
    }

    const msg = `chore: sync shop — ${new Date().toISOString().slice(0,10)}`
    execSync(`git commit -m "${msg}"`, { cwd, stdio: 'pipe' })
    execSync('git push', { cwd, stdio: 'pipe' })
    log('Git: pushed → Cloudflare Pages deploy triggered')
    return true
  } catch (err) {
    log(`ERROR: git push failed — ${err.stderr?.toString().trim() || err.message}`)
    return false
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(path.dirname(SHOP_OUT),  { recursive: true })

  const dryRun = process.argv.includes('--dry-run')

  log(`━━━ sync-shop start ━━━${dryRun ? ' [dry-run]' : ''}`)

  // Read sheet
  let conn
  let allRows = []
  try {
    conn    = await connect()
    await ensureHeaders(conn)
    allRows = await readAllRows(conn)
    log(`Sheet: ${allRows.length} total row(s)`)
  } catch (err) {
    log(`ERROR: could not read sheet — ${err.message}`)
    process.exit(1)
  }

  // Filter approved only
  const approved = allRows.filter(r => (r['Status'] || '').trim().toLowerCase() === 'approved')
  log(`Approved: ${approved.length} product(s) — Pending: ${allRows.length - approved.length}`)

  if (!approved.length) {
    log('No approved products yet — shop page not updated')
    log('━━━ sync-shop complete ━━━\n')
    return
  }

  // Build HTML
  const html = buildShopPage(approved)
  log(`Generated shop page — ${html.length} chars`)

  if (dryRun) {
    const preview = path.join(ROOT, 'logs', 'shop-preview.html')
    fs.writeFileSync(preview, html)
    log(`[dry-run] HTML written to ${preview} — no git push`)
    log('━━━ sync-shop complete ━━━\n')
    return
  }

  // Write and deploy
  fs.writeFileSync(SHOP_OUT, html)
  log(`Written → ${SHOP_OUT}`)

  const pushed = gitPush()
  log(`Deploy: ${pushed ? 'triggered' : 'skipped (no changes)'}`)

  log('━━━ sync-shop complete ━━━\n')
})()
