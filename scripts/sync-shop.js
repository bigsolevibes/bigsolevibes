require('dotenv').config()
const { execSync }  = require('child_process')
const fs            = require('fs')
const path          = require('path')
const { connect, ensureHeaders, readAllRows } = require('./sheets-client')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'sync-shop.log')
const SHOP_OUT = path.join(ROOT, 'public', 'shop', 'index.html')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Category → locker number map ────────────────────────────────────────────
// Deterministic order so locker numbers don't shuffle on every deploy.
const CATEGORY_ORDER = [
  // Ground — the founding argument
  'Foot Files',
  'Foot Serums',
  'Foot Creams',
  'Foot Soaks',
  'Foot Soaks & Recovery',
  'Foot Powders',
  'Foot Grooming Tools',
  'Nail Care',
  // Up the body
  'Body & Recovery',
  'Shaving',
  'Face & Skincare',
  'Fragrance',
  'Hair & Grooming',
  // The kit
  'Leather Goods & Accessories',
  'Precision Tools',
  // Bundles
  'Men\'s Grooming Kits',
  'Full Kits',
]

// ─── SEO-aligned display names ────────────────────────────────────────────────
// Internal category names (from sheet) stay unchanged for grouping/slugs.
// Display names match how the BSV man actually searches.
const CATEGORY_DISPLAY = {
  // Legacy internal → BSV display name
  'Nail Care':             'Precision German Podiatry Hardware',
  'Foot Grooming Tools':   'Precision German Podiatry Hardware',
  'Foot Care':             'Fast-Absorbing Treatments',
  'Foot Creams':           'Fast-Absorbing Treatments',
  'Foot Serums':           'Fast-Absorbing Treatments',
  'Body Care':             'Head to Toe Ritual',
  'Foot Soaks':            'Athletic Recovery',
  'Foot Soaks & Recovery': 'Athletic Recovery',
  // New BSV names — identity (already correct, no remapping needed)
  'Fast-Absorbing Treatments':          'Fast-Absorbing Treatments',
  'Athletic Recovery':                  'Athletic Recovery',
  'Precision German Podiatry Hardware': 'Precision German Podiatry Hardware',
  'Head to Toe Ritual':                 'Head to Toe Ritual',
}

function displayCategory(cat) {
  return CATEGORY_DISPLAY[cat] || cat
}

function categoryIcon(cat) {
  const map = {
    'Foot Files':                 'ti-sparkles',
    'Foot Serums':                'ti-droplet-filled',
    'Foot Creams':                'ti-droplet',
    'Foot Soaks':                 'ti-ripple',
    'Foot Soaks & Recovery':      'ti-ripple',
    'Foot Powders':               'ti-wind',
    'Foot Grooming Tools':        'ti-tool',
    'Nail Care':                  'ti-scissors',
    'Body & Recovery':            'ti-droplet-filled',
    'Shaving':                    'ti-razor',
    'Face & Skincare':            'ti-sparkles',
    'Fragrance':                  'ti-feather',
    'Hair & Grooming':            'ti-scissors',
    'Leather Goods & Accessories':'ti-briefcase',
    'Precision Tools':            'ti-tool',
    'Men\'s Grooming Kits':       'ti-briefcase',
    'Full Kits':                  'ti-package',
  }
  return map[cat] || 'ti-star'
}

// ─── HTML generation ──────────────────────────────────────────────────────────

// Colors match tailwind.config.ts exactly
const C = {
  bg:      '#0D1B2A',
  card:    '#162233',
  surface: '#1C2E42',
  amber:   '#C17D2E',
  cream:   '#F5ECD7',
  muted:   '#4A6380',
}

function buildProductCard(product) {
  const asinOrUrl  = (product['ASIN'] || '').trim()
  const tag        = process.env.AMAZON_AFFILIATE_TAG || 'bigsolevibes-20'

  let amazonUrl
  if (/^https?:\/\//i.test(asinOrUrl)) {
    // Full URL in the ASIN column — use as-is, append affiliate tag only for Amazon links
    if (asinOrUrl.includes('amazon.com')) {
      const sep = asinOrUrl.includes('?') ? '&' : '?'
      amazonUrl = `${asinOrUrl}${sep}tag=${tag}`
    } else {
      amazonUrl = asinOrUrl
    }
  } else if (asinOrUrl) {
    // Bare ASIN
    amazonUrl = `https://www.amazon.com/dp/${asinOrUrl}?tag=${tag}`
  } else {
    // No ASIN — search fallback
    amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(product['Product Name'] || '')}&tag=${tag}`
  }

  const isAmazon  = amazonUrl.includes('amazon.com')
  const score     = product['Score']    ? `<div class="card-score">${escapeHtml(product['Score'])}</div>` : ''
  const price     = product['Price']    ? `<span class="card-price">${escapeHtml(product['Price'])}</span>` : ''
  const category  = product['Category'] ? `<p class="card-cat">${escapeHtml(displayCategory(product['Category']).toUpperCase())}</p>` : ''

  // Image_URL is the canonical field; Locker Image is the legacy fallback.
  // NEEDS_RENDER and empty both render the BSV placeholder — dark background, Bourbon monogram.
  const rawImageUrl = (product['Image_URL'] || product['Locker Image'] || '').trim()
  const useImage    = rawImageUrl && rawImageUrl !== 'NEEDS_RENDER'
  const heroHtml    = useImage
    ? `<div class="card-hero"><img src="${rawImageUrl}" alt="A detail from The Locker Room" loading="lazy"></div>`
    : `<div class="card-hero card-hero--placeholder"><span class="card-hero-mono">BSV</span></div>`

  // Narrative-first layout: render if Narrative is populated.
  // Status=Approved is the single gate — [DRAFT] prefix is stripped at render time.
  const rawNarrative = (product['Narrative'] || '').trim().replace(/^\[DRAFT\]\s*/i, '')
  const hasNarrative = !!rawNarrative

  let contentHtml, ctaText
  if (hasNarrative) {
    const descLine = (product['Description'] || '').trim()
      ? `<p class="card-desc">${escapeHtml(product['Description'])}</p>`
      : ''
    contentHtml = `<p class="card-narrative">${escapeHtml(rawNarrative)}</p>${descLine}`
    ctaText = "It's on the shelf →"
  } else {
    // Fallback: description or reasoning, standard CTA
    const fallbackText = (product['Description'] || product['Reasoning'] || '').trim()
    contentHtml = fallbackText ? `<p class="card-audit">${escapeHtml(fallbackText)}</p>` : ''
    ctaText = isAmazon ? 'SHOP ON AMAZON ↗' : 'SHOP NOW ↗'
  }

  const cardId = (product['Product Name'] || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return `
        <article class="locker-card" id="${cardId}">
          ${heroHtml}
          <div class="card-body">
            ${category}
            <h3 class="card-name">${escapeHtml(product['Product Name'] || '')}</h3>
            ${contentHtml}
            <div class="card-footer">
              ${score}
              <div class="card-actions">
                ${price}
                <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer sponsored" class="card-cta">
                  ${ctaText}
                </a>
              </div>
            </div>
          </div>
        </article>`
}

function buildLockerSection(category, products) {
  const catSlug     = category.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const cards       = products.map(buildProductCard).join('\n')
  const displayName = displayCategory(category)
  return `
      <section class="locker-bay" id="${catSlug}">
        <div class="locker-label-area">
          <span class="locker-cat-name">${escapeHtml(displayName.toUpperCase())}</span>
        </div>
        <div class="locker-shelf-bar"></div>
        <div class="locker-stack">
          ${cards}
        </div>
      </section>`
}

function buildShopPage(approvedProducts) {
  const grouped = {}
  for (const cat of CATEGORY_ORDER) grouped[cat] = []
  for (const p of approvedProducts) {
    const cat = p['Category']
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(p)
  }

  let sectionsHtml = ''
  for (const cat of CATEGORY_ORDER) {
    if (!grouped[cat]?.length) continue
    sectionsHtml += buildLockerSection(cat, grouped[cat])
  }
  for (const [cat, products] of Object.entries(grouped)) {
    if (!CATEGORY_ORDER.includes(cat) && products.length) {
      sectionsHtml += buildLockerSection(cat, products)
    }
  }

  // Jump nav links for populated categories
  const jumpLinks = CATEGORY_ORDER
    .filter(cat => grouped[cat]?.length)
    .map(cat => `<a href="#${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}" class="jump-link">${escapeHtml(displayCategory(cat).toUpperCase())}</a>`)
    .join('\n            ')

  const totalProducts = approvedProducts.length
  const isEmpty       = totalProducts === 0
  const year          = new Date().getFullYear()
  const generated     = new Date().toISOString().slice(0, 10)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Locker Room — Big Sole Vibes</title>
  <meta name="description" content="Proprietor-approved foot care. Nothing goes on this shelf that hasn't earned its place.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:      ${C.bg};
      --card:    ${C.card};
      --surface: ${C.surface};
      --amber:   ${C.amber};
      --cream:   ${C.cream};
      --muted:   ${C.muted};
      --font-bebas:    'Bebas Neue', sans-serif;
      --font-playfair: 'Playfair Display', Georgia, serif;
    }

    html { scroll-behavior: smooth; }

    body {
      background: var(--bg);
      color: var(--cream);
      font-family: var(--font-playfair);
      -webkit-font-smoothing: antialiased;
    }

    a { color: inherit; text-decoration: none; }

    /* ── Nav — matches SiteNav.tsx ── */
    .site-nav {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 50;
      background: rgba(13,27,42,0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255,255,255,0.10);
      height: 64px;
    }
    .nav-inner {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 1.5rem;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nav-brand {
      font-family: var(--font-bebas);
      font-size: 1.5rem;
      letter-spacing: 0.08em;
      color: var(--amber);
    }
    .nav-links {
      display: flex;
      gap: 1.5rem;
      list-style: none;
    }
    .nav-links a {
      font-size: 0.875rem;
      font-family: var(--font-playfair);
      color: var(--muted);
      transition: color 0.15s;
    }
    .nav-links a:hover, .nav-links a.active { color: var(--cream); }
    .nav-links a.active { color: var(--amber); }
    @media (max-width: 640px) { .nav-links { display: none; } }

    /* ── Page hero ── */
    .shop-hero {
      padding: 8rem 1.5rem 4rem;
      text-align: center;
      background: var(--card);
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .hero-eyebrow {
      font-family: var(--font-bebas);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      color: var(--amber);
      margin-bottom: 1rem;
    }
    .hero-title {
      font-family: var(--font-playfair);
      font-size: clamp(2.5rem, 6vw, 4rem);
      font-weight: 700;
      color: var(--cream);
      line-height: 1.1;
      margin-bottom: 0.5rem;
    }
    .hero-title em { color: var(--amber); font-style: normal; }
    .hero-tagline {
      font-style: italic;
      font-size: 1.0625rem;
      color: var(--muted);
      margin-bottom: 1.5rem;
    }
    .hero-count {
      font-family: var(--font-bebas);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      color: rgba(193,125,46,0.5);
    }

    /* ── Affiliate bar ── */
    .affiliate-bar {
      background: var(--surface);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding: 0.6rem 1.5rem;
      text-align: center;
      font-family: var(--font-playfair);
      font-size: 0.6875rem;
      color: rgba(255,255,255,0.3);
    }

    /* ── Jump nav ── */
    .jump-nav {
      background: var(--bg);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding: 1rem 1.5rem;
      position: sticky;
      top: 64px;
      z-index: 40;
    }
    .jump-nav-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
      justify-content: center;
    }
    .jump-link {
      font-family: var(--font-bebas);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      color: var(--muted);
      transition: color 0.15s;
      white-space: nowrap;
    }
    .jump-link:hover { color: var(--amber); }

    /* ── Locker room container ── */
    .locker-room {
      max-width: 1100px;
      margin: 0 auto;
      padding: 3rem 1.5rem 6rem;
      display: flex;
      flex-direction: column;
      gap: 3rem;
    }

    /* ── Category section ── */
    .locker-bay {
      background: var(--card);
      border: 1px solid #1e2535;
      border-radius: 2px;
      overflow: hidden;
    }

    .locker-label-area { padding: 0.875rem 1.25rem 0.625rem; }

    .locker-cat-name {
      font-family: var(--font-bebas);
      font-size: 1.25rem;
      letter-spacing: 0.1em;
      color: var(--cream);
    }

    .locker-shelf-bar {
      height: 5px;
      background: linear-gradient(90deg,
        rgba(193,125,46,0) 0%,
        rgba(193,125,46,0.55) 4%,
        #C17D2E 12%,
        #C17D2E 88%,
        rgba(193,125,46,0.55) 96%,
        rgba(193,125,46,0) 100%
      );
      box-shadow: 0 2px 10px rgba(193,125,46,0.18);
    }

    /* ── Locker card stack ── */
    .locker-stack {
      padding: 1.5rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
    }

    .locker-card {
      background: var(--bg);
      border: 1px solid rgba(255,255,255,0.05);
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .locker-card:hover { border-color: rgba(193,125,46,0.2); }

    /* Hero image — 4:3, contained */
    .card-hero {
      width: 100%;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      background: #0a1220;
    }
    .card-hero img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center;
      display: block;
      filter: brightness(0.92);
    }
    .card-hero--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a1220;
    }
    .card-hero-mono {
      font-family: var(--font-bebas);
      font-size: 3rem;
      letter-spacing: 0.25em;
      color: ${C.amber};
      opacity: 0.18;
      user-select: none;
    }

    /* Text panel */
    .card-body {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .card-cat {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.6875rem;
      letter-spacing: 0.14em;
      color: var(--amber);
      opacity: 0.8;
    }
    .card-name {
      font-family: var(--font-playfair);
      font-size: 1.375rem;
      font-weight: 700;
      color: var(--cream);
      line-height: 1.25;
    }
    .card-audit {
      font-style: italic;
      font-size: 0.9375rem;
      color: rgba(245,236,215,0.65);
      line-height: 1.7;
    }
    .card-narrative {
      font-family: var(--font-playfair);
      font-style: italic;
      font-size: 1rem;
      color: var(--cream);
      line-height: 1.75;
    }
    .card-desc {
      font-size: 0.8125rem;
      color: rgba(245,236,215,0.45);
      line-height: 1.5;
      margin-top: 0.25rem;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding-top: 0.5rem;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .card-score {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.6875rem;
      letter-spacing: 0.1em;
      color: #C17D2E;
    }
    .card-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .card-price {
      font-family: var(--font-bebas);
      font-size: 1rem;
      letter-spacing: 0.06em;
      color: var(--cream);
      opacity: 0.65;
    }
    .card-cta {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--amber);
      color: var(--bg);
      font-family: var(--font-bebas);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      padding: 0.55rem 1.125rem;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .card-cta:hover { opacity: 0.85; }

    /* ── Coming soon floor (empty state) ── */
    .locker-coming-soon {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 40vh;
      padding: 6rem 1.5rem;
    }
    .coming-soon-inner {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }
    .coming-soon-rule {
      width: 32px;
      height: 1px;
      background: var(--amber);
    }
    .coming-soon-heading {
      font-family: var(--font-playfair);
      font-size: clamp(1.5rem, 3vw, 2.25rem);
      font-style: italic;
      color: var(--cream);
    }
    .coming-soon-sub {
      font-style: italic;
      font-size: 0.9375rem;
      color: var(--muted);
      max-width: 480px;
    }

    /* ── Bottom CTA ── */
    .shop-cta {
      text-align: center;
      padding: 5rem 1.5rem;
      border-top: 1px solid rgba(255,255,255,0.05);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }
    .shop-cta-rule {
      width: 32px;
      height: 1px;
      background: var(--amber);
    }
    .shop-cta-heading {
      font-family: var(--font-playfair);
      font-size: clamp(1.5rem, 3vw, 2rem);
      color: var(--cream);
    }
    .shop-cta-sub {
      font-style: italic;
      font-size: 0.9375rem;
      color: var(--muted);
    }
    .shop-cta-btn {
      font-family: var(--font-bebas);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      border: 1px solid var(--amber);
      color: var(--amber);
      padding: 1rem 2.5rem;
      transition: background 0.15s, color 0.15s;
    }
    .shop-cta-btn:hover {
      background: var(--amber);
      color: var(--bg);
    }

    /* ── Footer — matches Footer.tsx ── */
    .site-footer {
      background: var(--card);
      border-top: 1px solid rgba(255,255,255,0.1);
      padding: 4rem 1.5rem;
    }
    .footer-inner {
      max-width: 1280px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2rem;
    }
    @media (min-width: 768px) {
      .footer-inner {
        flex-direction: row;
        align-items: flex-start;
        justify-content: space-between;
      }
    }
    .footer-brand-name {
      font-family: var(--font-bebas);
      font-size: 1.875rem;
      letter-spacing: 0.08em;
      color: var(--amber);
      display: block;
      margin-bottom: 0.5rem;
    }
    .footer-tagline {
      font-size: 0.875rem;
      color: var(--muted);
    }
    .footer-nav {
      display: flex;
      gap: 2rem;
      list-style: none;
    }
    .footer-nav a {
      font-size: 0.875rem;
      color: var(--muted);
      transition: color 0.15s;
    }
    .footer-nav a:hover { color: var(--cream); }
    .footer-socials {
      display: flex;
      gap: 1rem;
    }
    .footer-socials a {
      color: var(--muted);
      transition: color 0.15s;
    }
    .footer-socials a:hover { color: var(--amber); }
    .footer-socials svg { width: 20px; height: 20px; }
    .footer-copy {
      max-width: 1280px;
      margin: 3rem auto 0;
      padding-top: 2rem;
      border-top: 1px solid rgba(255,255,255,0.05);
      text-align: center;
      font-size: 0.75rem;
      color: var(--muted);
    }

    @media (max-width: 600px) {
      .card-footer { flex-direction: column; align-items: flex-start; }
      .card-actions { flex-wrap: wrap; }
    }
  </style>
</head>
<body>

  <!-- Nav — matches SiteNav.tsx -->
  <nav class="site-nav">
    <div class="nav-inner">
      <a href="/" class="nav-brand">BIG SOLE VIBES</a>
      <ul class="nav-links">
        <li><a href="/">Home</a></li>
        <li><a href="/sole-report">The Sole Report</a></li>
        <li><a href="/shop" class="active">The Locker Room</a></li>
        <li><a href="/lounge">The Lounge</a></li>
      </ul>
    </div>
  </nav>

  <!-- Hero -->
  <header class="shop-hero">
    <p class="hero-eyebrow">THE LOCKER ROOM</p>
    <h1 class="hero-title">
      Nothing Goes on This Shelf<br>
      <em>That Hasn't Earned Its Place.</em>
    </h1>
    <p class="hero-tagline">Proprietor-approved picks across every category of men's foot care.</p>
    <p class="hero-count">${isEmpty ? 'More lockers opening soon.' : `${totalProducts} approved picks`}</p>
  </header>

  ${isEmpty ? `
  <!-- Coming soon floor -->
  <main class="locker-coming-soon">
    <div class="coming-soon-inner">
      <div class="coming-soon-rule"></div>
      <p class="coming-soon-heading">More lockers opening soon.</p>
      <p class="coming-soon-sub">The proprietor is still pulling product. Only the best earns a spot on these shelves.</p>
      <a href="/sole-report" class="shop-cta-btn">READ THE SOLE REPORT →</a>
    </div>
  </main>
  ` : `
  <!-- Affiliate bar -->
  <div class="affiliate-bar">
    BSV participates in the Amazon Associates Program. Links on this page are affiliate links — we may earn a commission at no cost to you.
  </div>

  <!-- Jump nav -->
  <nav class="jump-nav" aria-label="Category navigation">
    <div class="jump-nav-inner">
      ${jumpLinks}
    </div>
  </nav>

  <!-- Locker room -->
  <main class="locker-room">
    ${sectionsHtml}
  </main>

  <!-- Bottom CTA -->
  <section class="shop-cta">
    <div class="shop-cta-rule"></div>
    <p class="shop-cta-heading">Want the full breakdown before you buy?</p>
    <p class="shop-cta-sub">The Sole Audits go deeper — every pick tested, ranked, and given a verdict.</p>
    <a href="/sole-report" class="shop-cta-btn">READ THE SOLE REPORT →</a>
  </section>
  `}

  <!-- Footer — matches Footer.tsx -->
  <footer class="site-footer">
    <div class="footer-inner">
      <div>
        <a href="/" class="footer-brand-name">BIG SOLE VIBES</a>
        <p class="footer-tagline">We found what you were looking for.</p>
      </div>
      <ul class="footer-nav">
        <li><a href="/">Home</a></li>
        <li><a href="/sole-report">The Sole Report</a></li>
        <li><a href="/shop">The Locker Room</a></li>
        <li><a href="/lounge">The Lounge</a></li>
      </ul>
      <div class="footer-socials">
        <a href="https://instagram.com/bigsolevibes" aria-label="Instagram" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
        </a>
        <a href="https://x.com/bigsolevibes" aria-label="X" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.626 5.905-5.626zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a href="https://www.youtube.com/@bigsolevibes" aria-label="YouTube" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        </a>
        <a href="https://tiktok.com/@bigsolevibes" aria-label="TikTok" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.73a4.85 4.85 0 01-1.01-.04z"/></svg>
        </a>
      </div>
    </div>
    <div class="footer-copy">
      <p>© 2025 Big Sole Vibes. All rights reserved. &nbsp;·&nbsp; <a href="/privacy" style="color:inherit;opacity:0.6">Privacy Policy</a> &nbsp;·&nbsp; <a href="/terms" style="color:inherit;opacity:0.6">Terms of Service</a></p>
    </div>
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
    execSync('git add public/shop/index.html', { cwd, stdio: 'pipe' })

    // Check if there's anything to commit
    const status = execSync('git status --porcelain public/shop/index.html', { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
    if (!status) {
      log('Git: no changes to shop/index.html — skipping push')
      return false
    }

    const msg = `chore: sync shop — ${new Date().toISOString().slice(0,10)}`
    execSync(`git commit -m "${msg}"`, { cwd, stdio: 'pipe' })
    require('./git-push-guard').safePushToPreview(cwd, log)
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
