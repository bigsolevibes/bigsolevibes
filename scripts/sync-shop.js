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
  const asin       = product['ASIN'] || ''
  const tag        = process.env.AMAZON_AFFILIATE_TAG || 'bigsolevibes-20'
  const amazonUrl  = asin
    ? `https://www.amazon.com/dp/${asin}?tag=${tag}`
    : `https://www.amazon.com/s?k=${encodeURIComponent(product['Product Name'] || '')}&tag=${tag}`
  const imageUrl   = (product['Locker Image'] || '').trim()
  const score      = product['Score']       ? `<div class="card-score">${escapeHtml(product['Score'])}</div>` : ''
  const audit      = product['Reasoning']   ? `<p class="card-audit">${escapeHtml(product['Reasoning'])}</p>` : ''
  const price      = product['Price']       ? `<span class="card-price">${escapeHtml(product['Price'])}</span>` : ''
  const category   = product['Category']    ? `<p class="card-cat">${escapeHtml(product['Category'].toUpperCase())}</p>` : ''
  const heroHtml   = imageUrl
    ? `<div class="card-hero"><img src="${imageUrl}" alt="${escapeHtml(product['Product Name'] || '')}" loading="lazy"></div>`
    : ''

  return `
        <article class="locker-card">
          ${heroHtml}
          <div class="card-body">
            ${category}
            <h3 class="card-name">${escapeHtml(product['Product Name'] || '')}</h3>
            ${audit}
            <div class="card-footer">
              ${score}
              <div class="card-actions">
                ${price}
                <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer sponsored" class="card-cta">
                  SHOP ON AMAZON ↗
                </a>
              </div>
            </div>
          </div>
        </article>`
}

function buildLockerBayHeaderSVG() {
  const lockerW = 144
  const totalW  = 1440
  const h       = 200
  const lockers = Array.from({ length: 10 }, (_, i) => {
    const x   = i * lockerW
    const cx  = x + lockerW / 2
    const num = String(i + 1).padStart(2, '0')
    return `
      <rect x="${x}" y="0" width="${lockerW}" height="${h}" fill="#1e2535" stroke="#253044" stroke-width="2"/>
      <rect x="${x+4}" y="18" width="5" height="14" fill="#253044" rx="1"/>
      <rect x="${x+4}" y="158" width="5" height="14" fill="#253044" rx="1"/>
      <rect x="${x+32}" y="40" width="80" height="3" fill="#253044" rx="1"/>
      <rect x="${x+32}" y="52" width="80" height="3" fill="#253044" rx="1"/>
      <rect x="${x+32}" y="64" width="80" height="3" fill="#253044" rx="1"/>
      <rect x="${x+32}" y="76" width="80" height="3" fill="#253044" rx="1"/>
      <rect x="${x+32}" y="88" width="80" height="3" fill="#253044" rx="1"/>
      <rect x="${cx-3}" y="112" width="6" height="22" fill="#253044" rx="2"/>
      <rect x="${cx-9}" y="110" width="18" height="4" fill="#253044" rx="1"/>
      <rect x="${cx-18}" y="160" width="36" height="22" fill="none" stroke="#C17D2E" stroke-width="1" opacity="0.6"/>
      <text x="${cx}" y="175" font-family="Courier New, monospace" font-size="12" font-weight="bold" fill="#C17D2E" text-anchor="middle" opacity="0.8">${num}</text>`
  }).join('')

  return `<svg viewBox="0 0 ${totalW} ${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="display:block;width:100%;height:auto;">${lockers}
    <rect x="0" y="${h-8}" width="${totalW}" height="8" fill="#162233"/>
  </svg>`
}

function buildLockerSection(category, products, lockerNum) {
  const numStr  = String(lockerNum).padStart(2, '0')
  const catSlug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const cards   = products.map(buildProductCard).join('\n')

  return `
      <!-- Locker ${numStr}: ${escapeHtml(category)} -->
      <section class="locker-bay" id="${catSlug}">

        <!-- Left: steel door frame -->
        <div class="locker-door">
          <svg class="door-vents-svg" viewBox="0 0 52 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="0" y="0" width="52" height="80" fill="#1e2535"/>
            <rect x="8" y="8"  width="36" height="3" fill="#253044" rx="1"/>
            <rect x="8" y="19" width="36" height="3" fill="#253044" rx="1"/>
            <rect x="8" y="30" width="36" height="3" fill="#253044" rx="1"/>
            <rect x="8" y="41" width="36" height="3" fill="#253044" rx="1"/>
            <rect x="8" y="52" width="36" height="3" fill="#253044" rx="1"/>
            <rect x="8" y="63" width="36" height="3" fill="#253044" rx="1"/>
            <rect x="8" y="74" width="36" height="3" fill="#253044" rx="1"/>
          </svg>
          <div class="door-number">${numStr}</div>
        </div>

        <!-- Right: locker interior -->
        <div class="locker-interior">
          <div class="interior-vent-band" aria-hidden="true">
            <svg width="100%" height="20" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="4"  width="100%" height="3" fill="#253044" rx="1"/>
              <rect x="0" y="12" width="100%" height="3" fill="#253044" rx="1"/>
            </svg>
          </div>
          <div class="locker-label-area">
            <span class="locker-cat-name">${escapeHtml(category.toUpperCase())}</span>
          </div>
          <div class="locker-shelf-bar"></div>
          <div class="locker-stack">
            ${cards}
          </div>
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

  let lockerNum    = 0
  let sectionsHtml = ''
  for (const cat of CATEGORY_ORDER) {
    if (!grouped[cat]?.length) continue
    lockerNum++
    sectionsHtml += buildLockerSection(cat, grouped[cat], lockerNum)
  }
  for (const [cat, products] of Object.entries(grouped)) {
    if (!CATEGORY_ORDER.includes(cat) && products.length) {
      lockerNum++
      sectionsHtml += buildLockerSection(cat, products, lockerNum)
    }
  }

  // Jump nav links for populated categories
  const jumpLinks = CATEGORY_ORDER
    .filter(cat => grouped[cat]?.length)
    .map(cat => `<a href="#${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}" class="jump-link">${escapeHtml(cat.toUpperCase())}</a>`)
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

    /* ── Locker bay header illustration ── */
    .locker-bay-header { width:100%; background:var(--bg); border-bottom:3px solid #1e2535; overflow:hidden; line-height:0; }

    /* ── Locker room container ── */
    .locker-room {
      max-width: 1100px;
      margin: 0 auto;
      padding: 3rem 1.5rem 6rem;
      display: flex;
      flex-direction: column;
      gap: 3rem;
    }

    /* ── Open locker = category section ── */
    .locker-bay {
      display: flex;
      border: 1px solid #1e2535;
      border-radius: 2px;
      overflow: hidden;
    }

    .locker-door {
      width: 72px;
      flex-shrink: 0;
      background: #1e2535;
      border-right: 2px solid #253044;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.75rem 0 1rem;
    }

    .door-vents-svg { width: 52px; }

    .door-number {
      font-family: 'Courier New', Courier, monospace;
      font-size: 1.25rem;
      font-weight: bold;
      color: var(--amber);
      letter-spacing: 0.05em;
      border: 1px solid rgba(193,125,46,0.35);
      padding: 3px 7px;
      line-height: 1;
      margin-top: auto;
      opacity: 0.9;
    }

    .locker-interior {
      flex: 1;
      background: var(--card);
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .interior-vent-band {
      background: #1e2535;
      padding: 0.5rem 1.25rem;
      border-bottom: 1px solid #253044;
      line-height: 0;
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

    /* Hero image — full bleed, portrait ~3:2 */
    .card-hero {
      width: 100%;
      aspect-ratio: 3 / 2;
      overflow: hidden;
      background: #0a1220;
    }
    .card-hero img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center top;
      display: block;
      filter: brightness(0.92);
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
      color: var(--amber);
      opacity: 0.55;
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
        <li><a href="/lounge">Lounge</a></li>
        <li><a href="/kickoff">The Kick Off</a></li>
        <li><a href="/audits">Audits</a></li>
        <li><a href="/brief">Brief</a></li>
        <li><a href="/shop" class="active">The Locker Room</a></li>
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

  <!-- Locker bay header illustration -->
  <div class="locker-bay-header">${buildLockerBayHeaderSVG()}</div>

  ${isEmpty ? `
  <!-- Coming soon floor -->
  <main class="locker-coming-soon">
    <div class="coming-soon-inner">
      <div class="coming-soon-rule"></div>
      <p class="coming-soon-heading">More lockers opening soon.</p>
      <p class="coming-soon-sub">The proprietor is still pulling product. Only the best earns a spot on these shelves.</p>
      <a href="/audits" class="shop-cta-btn">READ THE AUDITS →</a>
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
    <a href="/audits" class="shop-cta-btn">READ THE AUDITS →</a>
  </section>
  `}

  <!-- Footer — matches Footer.tsx -->
  <footer class="site-footer">
    <div class="footer-inner">
      <div>
        <a href="/" class="footer-brand-name">BIG SOLE VIBES</a>
        <p class="footer-tagline">Step Up. Feel Good. Own It.</p>
      </div>
      <ul class="footer-nav">
        <li><a href="/">Home</a></li>
        <li><a href="/lounge">Lounge</a></li>
        <li><a href="/kickoff">The Kick Off</a></li>
        <li><a href="/audits">Audits</a></li>
        <li><a href="/brief">Brief</a></li>
        <li><a href="/shop">The Locker Room</a></li>
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
