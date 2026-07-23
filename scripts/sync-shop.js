require('dotenv').config({ quiet: true })
const { execSync }  = require('child_process')
const fs            = require('fs')
const path          = require('path')
const { connect, ensureHeaders, readAllRows } = require('./sheets-client')
const { TAGLINE } = require('./lib/brand-copy')

const ROOT         = path.join(__dirname, '..')
const LOG_FILE     = path.join(ROOT, 'logs', 'sync-shop.log')
const SHOP_OUT     = path.join(ROOT, 'public', 'shop', 'index.html')
const FEATURED_OUT = path.join(ROOT, 'public', 'shop', 'featured.json')

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

// ─── Affiliate overrides (local file takes precedence over sheet) ─────────────
const AFFILIATE_OVERRIDES_PATH = path.join(__dirname, 'data', 'affiliate-overrides.json')
const AFFILIATE_OVERRIDES = fs.existsSync(AFFILIATE_OVERRIDES_PATH)
  ? JSON.parse(fs.readFileSync(AFFILIATE_OVERRIDES_PATH, 'utf8'))
  : {}

function getAffiliateOverride(product) {
  const name = (product['Product Name'] || '').trim()
  const key = Object.keys(AFFILIATE_OVERRIDES).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? AFFILIATE_OVERRIDES[key].affiliate_url : null
}

// ─── Shared URL builder ───────────────────────────────────────────────────────

function buildAmazonUrl(product) {
  const asin         = (product['ASIN']          || '').trim()
  const override     = getAffiliateOverride(product)
  const affiliateUrl = override || (product['Affiliate_URL'] || '').trim()
  const tag          = process.env.AMAZON_AFFILIATE_TAG || 'bigsolevibes-20'
  if (affiliateUrl && /^https?:\/\//i.test(affiliateUrl)) return affiliateUrl
  if (/^https?:\/\//i.test(asin)) {
    const sep = asin.includes('?') ? '&' : '?'
    return asin.includes('amazon.com') ? `${asin}${sep}tag=${tag}` : asin
  }
  if (asin) return `https://www.amazon.com/dp/${asin}?tag=${tag}`
  return `https://www.amazon.com/s?k=${encodeURIComponent(product['Product Name'] || '')}&tag=${tag}`
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
  const amazonUrl = buildAmazonUrl(product)
  // REVERTED 2026-07-23 (Big D's call): the 2026-07-10 click-tracking redirect
  // (/api/go/[key]?to=..., app/api/go/[key]/route.ts) turned out to be
  // completely dead on the live site. next.config.js sets `output: 'export'`
  // whenever CF_PAGES=1, which is a fully static build — Next.js API routes
  // don't exist in that output at all. Confirmed live: hitting /api/go/test
  // returned the exact same not-found response as a nonexistent path. Every
  // "Get it on Amazon" link on the deployed shop has almost certainly been a
  // dead 404 instead of a redirect to Amazon since 2026-07-10 — a direct
  // candidate for the standing "zero revenue" problem. Going straight back to
  // the plain affiliate URL restores working links immediately. Per-product
  // click counts are gone until someone rebuilds tracking in a way that
  // survives static export (e.g. a client-side beacon that still navigates
  // directly) — app/api/go/[key]/route.ts is left in place, just unused, in
  // case that's built later.

  // Scene image: prefer Sheet Image_URL → fall back to local public/posts/output/{slug}-scene.jpg
  const rawImageUrl = (product['Image_URL'] || product['Locker Image'] || '').trim()
  const cardId0 = (product['Product Name'] || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const localScenePath = path.join(ROOT, 'public', 'posts', 'output', `${cardId0}-scene.jpg`)
  const localSceneUrl  = fs.existsSync(localScenePath) ? `/posts/output/${cardId0}-scene.jpg` : null
  const imageUrl  = (rawImageUrl && rawImageUrl !== 'NEEDS_RENDER') ? rawImageUrl : localSceneUrl
  const heroHtml  = imageUrl
    ? `<div class="card-hero"><img src="${imageUrl}?v=2" alt="${escapeHtml(product['Product Name'] || '')}" loading="lazy"></div>`
    : `<div class="card-hero card-hero--placeholder"><span class="card-hero-mono">BSV</span></div>`

  // Narrative — [DRAFT] prefix stripped; first sentence shown, rest expandable
  const narrative = (product['Narrative'] || '').trim().replace(/^\[DRAFT\]\s*/i, '')
  let narrativeHtml = ''
  if (narrative) {
    const m = narrative.match(/^(.*?[.!?])\s*(.+)?$/s)
    const lead = m ? m[1].trim() : narrative
    const rest = m && m[2] ? m[2].trim() : ''
    const uid  = Math.random().toString(36).slice(2, 8)
    narrativeHtml = rest
      ? `<p class="card-narrative">${escapeHtml(lead)} <span class="card-narrative-rest" id="rest-${uid}" hidden>${escapeHtml(rest)}</span><button class="card-expand" onclick="var r=document.getElementById('rest-${uid}');r.hidden=!r.hidden;this.textContent=r.hidden?'Read more':'Read less';">Read more</button></p>`
      : `<p class="card-narrative">${escapeHtml(narrative)}</p>`
  }

  // Highlights — from sheet column if present, else skip
  const highlights = (product['Highlights'] || '').trim()
  const highlightsHtml = highlights
    ? `<ul class="card-highlights">${highlights.split('|').map(h => `<li>${escapeHtml(h.trim())}</li>`).join('')}</ul>`
    : ''

  // Price — always show something
  const price = (product['Price'] || '').trim()
  const priceHtml = price
    ? `<span class="card-price">${escapeHtml(price)}</span>`
    : `<span class="card-price card-price--check">See price →</span>`

  // Badge — "Proprietor's Pick" for Featured products, or custom Badge column
  const customBadge = (product['Badge'] || '').trim()
  const isFeatured  = (product['Featured'] || '').trim().toLowerCase() === 'true'
  const badgeText   = customBadge || (isFeatured ? "Proprietor's Pick" : '')
  const badgeHtml   = badgeText ? `<span class="card-badge">★ ${escapeHtml(badgeText)}</span>` : ''

  const cardId = (product['Product Name'] || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return `
        <article class="locker-card" id="${cardId}">
          ${heroHtml}
          <div class="card-body">
            <div class="card-meta-row">
              <span class="card-cat-chip">${escapeHtml(displayCategory(product['Category'] || ''))}</span>
              ${badgeHtml}
            </div>
            <h3 class="card-name">${escapeHtml(product['Product Name'] || '')}</h3>
            ${narrativeHtml}
            ${highlightsHtml}
            <div class="card-footer">
              ${priceHtml}
              <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer sponsored" class="card-cta">
                Get it on Amazon →
              </a>
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
  <meta name="description" content="Proprietor-approved picks. ${TAGLINE}">
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

    /* Hero image — 16:9, cinematic scene, full-bleed */
    .card-hero {
      width: 100%;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: #0a1220;
    }
    .card-hero img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      display: block;
    }
    .card-hero--placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
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
      gap: 0.875rem;
    }

    .card-name {
      font-family: var(--font-playfair);
      font-size: 1.375rem;
      font-weight: 700;
      color: var(--amber);
      line-height: 1.25;
    }
    .card-narrative {
      font-family: var(--font-playfair);
      font-style: italic;
      font-size: 1rem;
      color: var(--cream);
      line-height: 1.8;
      opacity: 0.9;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255,255,255,0.05);
      margin-top: 0.25rem;
    }
    /* ── Card meta row (chip + badge) ── */
    .card-meta-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .card-cat-chip {
      font-family: var(--font-bebas);
      font-size: 0.625rem;
      letter-spacing: 0.12em;
      color: var(--muted);
      background: rgba(74,99,128,0.15);
      border: 1px solid rgba(74,99,128,0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 1px;
      white-space: nowrap;
      text-transform: uppercase;
    }
    .card-badge {
      font-family: var(--font-bebas);
      font-size: 0.625rem;
      letter-spacing: 0.1em;
      color: var(--amber);
      border: 1px solid rgba(193,125,46,0.4);
      padding: 0.2rem 0.5rem;
      border-radius: 1px;
      white-space: nowrap;
    }

    /* ── Narrative expand ── */
    .card-expand {
      background: none;
      border: none;
      cursor: pointer;
      font-family: var(--font-playfair);
      font-style: italic;
      font-size: 0.8125rem;
      color: var(--amber);
      padding: 0;
      margin-left: 0.25rem;
      opacity: 0.75;
      transition: opacity 0.15s;
    }
    .card-expand:hover { opacity: 1; }

    /* ── Highlights ── */
    .card-highlights {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem 0.75rem;
      padding: 0;
      margin: 0;
    }
    .card-highlights li {
      font-family: var(--font-playfair);
      font-size: 0.8125rem;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .card-highlights li::before {
      content: '·';
      color: var(--amber);
      font-size: 1rem;
      line-height: 1;
    }

    .card-price {
      font-family: var(--font-playfair);
      font-size: 1rem;
      font-weight: 600;
      color: var(--cream);
    }
    .card-price--check {
      font-size: 0.8125rem;
      font-weight: normal;
      font-style: italic;
      color: var(--muted);
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
      .card-footer { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
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
        <li><a href="/the-lounge">The Lounge</a></li>
        <li><a href="/sole-report">The Sole Report</a></li>
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
    <p class="hero-tagline">Proprietor-approved picks across every category of men's care.</p>
    <p class="hero-count">${isEmpty ? 'More lockers opening soon.' : `${totalProducts} approved picks`}</p>
  </header>

  ${isEmpty ? `
  <!-- Coming soon floor -->
  <main class="locker-coming-soon">
    <div class="coming-soon-inner">
      <div class="coming-soon-rule"></div>
      <p class="coming-soon-heading">More lockers opening soon.</p>
      <p class="coming-soon-sub">The proprietor is still pulling product. Only the best earns a spot on these shelves.</p>
      <a href="/the-lounge" class="shop-cta-btn">ENTER THE LOUNGE →</a>
    </div>
  </main>
  ` : `
  <!-- Affiliate bar -->
  <div class="affiliate-bar">
    Some links on this page are affiliate links — we may earn a commission at no cost to you. We only recommend products that have earned a place on the shelf.
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
    <p class="shop-cta-heading">Every product on this shelf has a chapter.</p>
    <p class="shop-cta-sub">The story starts in The Lounge.</p>
    <a href="/the-lounge" class="shop-cta-btn">ENTER THE LOUNGE →</a>
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
        <li><a href="/the-lounge">The Lounge</a></li>
        <li><a href="/sole-report">The Sole Report</a></li>
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

// ─── Featured JSON ────────────────────────────────────────────────────────────

function buildFeaturedJson(approvedProducts) {
  const picks = approvedProducts
    .filter(r => (r['Featured'] || '').trim().toLowerCase() === 'true')
    .slice(0, 3)
    .map(r => {
      const narrative = (r['Narrative'] || '').trim().replace(/^\[DRAFT\]\s*/i, '')
      const firstSentenceMatch = narrative.match(/^[^.!?]*[.!?]/)
      return {
        name:          (r['Product Name'] || '').trim(),
        category:      (r['Category']     || '').trim(),
        affiliate_url: buildAmazonUrl(r),
        narrative:     firstSentenceMatch ? firstSentenceMatch[0].trim() : narrative,
      }
    })
  return JSON.stringify({ picks }, null, 2)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function gitPush() {
  const cwd = ROOT
  try {
    execSync('git add public/shop/index.html public/shop/featured.json', { cwd, stdio: 'pipe' })

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

  // A flag file at logs/.sync-shop-live overrides --dry-run (used by MCP run_diagnostic)
  const LIVE_FLAG = path.join(ROOT, 'logs', '.sync-shop-live')
  const forceLive = fs.existsSync(LIVE_FLAG)
  if (forceLive) { try { fs.unlinkSync(LIVE_FLAG) } catch {} }
  const dryRun = !forceLive && process.argv.includes('--dry-run')

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

  // Filter approved only — skip blank rows, deduplicate by product name
  const seen = new Set()
  const approved = allRows.filter(r => {
    if ((r['Status'] || '').trim().toLowerCase() !== 'approved') return false
    const name = (r['Product Name'] || '').trim()
    if (!name) return false
    if (seen.has(name)) { log(`WARNING: duplicate skipped — "${name}"`); return false }
    seen.add(name)
    return true
  })
  log(`Approved: ${approved.length} product(s) — Pending: ${allRows.length - approved.length}`)

  // Build HTML
  const html = buildShopPage(approved)
  log(`Generated shop page — ${html.length} chars`)

  if (dryRun) {
    const preview = path.join(ROOT, 'logs', 'shop-preview.html')
    fs.writeFileSync(preview, html)
    fs.writeFileSync(path.join(ROOT, 'logs', 'featured-preview.json'), buildFeaturedJson(approved))
    log(`[dry-run] HTML written to ${preview} — no git push`)
    log('━━━ sync-shop complete ━━━\n')
    return
  }

  // Write and deploy
  fs.writeFileSync(SHOP_OUT, html)
  log(`Written → ${SHOP_OUT}`)

  const featuredJson = buildFeaturedJson(approved)
  fs.writeFileSync(FEATURED_OUT, featuredJson)
  log(`Written → ${FEATURED_OUT} (${JSON.parse(featuredJson).picks.length} featured pick(s))`)

  const pushed = gitPush()
  log(`Deploy: ${pushed ? 'triggered' : 'skipped (no changes)'}`)

  log('━━━ sync-shop complete ━━━\n')
})()
