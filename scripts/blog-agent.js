require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// blog-agent.js — weekly blog post generator
//
// Runs Sunday 11:30PM via launchd, after brand-manager completes.
// Reads Plans, Brand, social-listening from Drive + approved shelf products
// from Google Sheets. Calls Claude to generate a Proprietor-voice post
// targeting BSV SEO terms. Outputs static HTML to public/the-lounge/.
// Chief reads blog-agent.log in the Monday morning stand-up.
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { connect, ensureHeaders, readAllRows } = require('./sheets-client')
const { addPendingItem, readDecisionFromDrive } = require('./telegram-queue')
const { sendTelegram } = require('./telegram')

const ROOT      = path.join(__dirname, '..')
const LOG_FILE  = path.join(ROOT, 'logs', 'blog-agent.log')
const BLOG_DIR  = path.join(ROOT, 'public', 'the-lounge')
const TEMP_DIR  = path.join(os.homedir(), 'tmp', 'bsv-blog-agent')
const REMOTE    = 'big sole vibes:Big Sole Vibes'
const AFFILIATE = process.env.AMAZON_AFFILIATE_TAG || 'bigsolevibes-20'
const SITE_URL  = 'https://bigsolevibes.com'

// ─── Content Calendar ─────────────────────────────────────────────────────────
// Ordered list of queued The Lounge pieces. blog-agent checks the manifest for
// published slugs and injects the first unwritten entry into the userPrompt.
// After all entries are published, the agent falls back to hub article direction.
const CONTENT_CALENDAR = [
  {
    // Piece 1 — already published; slug match excludes it from queue
    slug: 'the-standard-doesnt-stop-at-the-ankle',
    title: 'The Standard Doesn\'t Stop at the Ankle',
  },
  {
    // Piece 2 — The Seven Steps Stop at the Ankle (approved 2026-05-21)
    // This is a Lounge article, not a social post brief.
    // Voice: The Lounge — long-form warmth. GQ editorial angle, not lifestyle fluff.
    slug: 'the-seven-steps-stop-at-the-ankle',
    titleDirection: '"The Seven Steps Stop at the Ankle." Fixed title — do not deviate. This is the argument, not the observation: the ankle line is arbitrary. It is not biological, not medical, not inevitable. Men built a seven-step grooming standard over the last decade and drew the line at the ankle because nobody told them to go further. Name that precisely. Make the argument — not the lifestyle take, the actual argument.',
    voice: 'The Lounge — long-form warmth. This is the full essay, not the one-liner. Write the way a man talks when he\'s thought carefully about something and finally decided to say it clearly. Not deadpan. Not a list. Not a tweet with line breaks. Warm, considered, and specific. GQ editorial register: technical mastery without condescension.',
    contentDirection: [
      'Hook: Open on the seven-step routine in motion — the man who actually does all of it. Hair, beard, face, body, fragrance, nails, skin. He\'s disciplined. He\'s serious. And then he puts his shoes on and the standard ends.',
      'The argument: The ankle line is not biological. It is not where the body stops mattering. It is where the culture stopped telling men to care — and men complied. That line is arbitrary, and it\'s starting to move.',
      'The evidence: The grooming industry spent 20 years expanding the standard upward — skincare, then fragrance, then nails. The pattern is there. The ankle is next, not because BSV says so, but because the logic already points there. Name it as an argument. Use the pattern as evidence.',
      'The close: Not a summary. The Proprietor\'s last word on it — quiet and certain. The man who reads this either already knows it or just realized it. Either way, the shelf is there. One soft sentence pointing to bigsolevibes.com/shop: "The shelf is there when you\'re ready."',
    ],
    ctaBox: {
      text: 'The shelf is there when you\'re ready.',
      subtext: '',
      linkHref: '/shop',
      linkText: 'The Locker Room',
    },
    seoTargets: ['mens foot care routine', 'premium foot care men', 'men grooming below the ankle'],
    lengthWords: '800–1,200',
    structureNote: 'Hook → the argument → the evidence → the close. No listicles. No subheads that read like BuzzFeed. If you use subheads, make them one declarative sentence — the kind a man would actually say. This is an essay.',
  },
  {
    // Piece 3 — Hammer & Nails validation
    slugPattern: /hammer.*nails|29-days|barberspa/i,
    titleDirection: 'Concept-first. The concept is the gap between visits. Working titles: "29 Days: What the Man Does Between Appointments" or "The BarberSpa That Finally Gets It: What Happens After You Leave." The concept leads — H&N is the proof it matters, not the subject.',
    voice: 'Validation, not competition. Warm and knowing. The tone of a man who respects H&N\'s in-person standard and is quietly filling the gap they leave open. Never critical of H&N — they built something worth referencing. BSV is what happens after the chair.',
    contentDirection: [
      'Open by acknowledging what H&N actually built — the in-person premium standard that men didn\'t know they were missing until they walked in.',
      'Name the gap: they nail the appointment. What they don\'t do is send him home with anything. The experience ends at the door.',
      'Introduce the 29 days: the chair is one day. The other 29 are his. What carries him between visits is the at-home ritual.',
      'Bring in the shelf naturally: Gehwol as the clinic-grade daily maintenance, Kneipp as the recovery soak, Men and Nails as the tool kit that extends professional results at home. Frame each as evidence of the standard, not as products.',
      'Close with a quiet CTA box: "The ritual doesn\'t end when you leave the chair. The Locker Room has what you need next." Link to /shop.',
    ],
    ctaBox: {
      text: 'The ritual doesn\'t end when you leave the chair.',
      subtext: 'The Locker Room has what you need next.',
      linkHref: '/shop',
      linkText: 'Visit The Locker Room',
    },
    seoTargets: ['luxury apothecary foot balm', 'premium foot care men', 'non greasy absorbent foot lotion men'],
    lengthWords: '1,000–1,300',
  },
]

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadLatestDriveFile(folder, pattern) {
  try {
    const files = execSync(`rclone ls "${REMOTE}/${folder}"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => pattern ? pattern.test(f) : f.endsWith('.md'))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/${folder}/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, path.basename(latest))
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

function loadDriveFile(filename) {
  try {
    execSync(`rclone copy "${REMOTE}/${filename}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, path.basename(filename))
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

// ─── Affiliate URL builder — same logic as sync-shop.js ───────────────────────

function buildProductUrl(product) {
  const raw = (product['ASIN'] || '').trim()
  if (/^https?:\/\//i.test(raw)) {
    if (raw.includes('amazon.com')) {
      const sep = raw.includes('?') ? '&' : '?'
      return `${raw}${sep}tag=${AFFILIATE}`
    }
    return raw
  }
  if (raw) return `https://www.amazon.com/dp/${raw}?tag=${AFFILIATE}`
  return `https://www.amazon.com/s?k=${encodeURIComponent(product['Product Name'] || '')}&tag=${AFFILIATE}`
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildPostHtml(post, dateStr) {
  const canonicalUrl = `${SITE_URL}/the-lounge/${post.slug}.html`
  const wordCount    = (post.openingHtml + post.sections.map(s => s.html).join('') + post.closingHtml)
    .replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length
  const readMinutes  = Math.max(1, Math.ceil(wordCount / 200))
  const publishDate  = new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const sectionsHtml = post.sections.map(s => {
    let html = `\n        <h2>${escapeHtml(s.heading)}</h2>\n        ${s.html}`
    if (s.ctaBox?.complaint) {
      html += `
        <div class="balm-cta">
          <p>Tired of foot balms that ${escapeHtml(s.ctaBox.complaint)}? A fast-absorbing, sandalwood-infused alternative is currently being engineered.</p>
          <a href="/lounge" class="balm-cta-btn">GET ON THE LIST →</a>
          <span class="balm-cta-sub">Founding member pricing.</span>
        </div>`
    }
    return html
  }).join('\n')

  const schemaJson = JSON.stringify({
    '@context':         'https://schema.org',
    '@type':            'Article',
    headline:           post.title,
    description:        post.metaDescription,
    url:                canonicalUrl,
    datePublished:      dateStr,
    publisher: {
      '@type': 'Organization',
      name:    'Big Sole Vibes',
      url:     SITE_URL,
    },
    author: {
      '@type': 'Person',
      name:    'The Proprietor',
    },
    keywords: (post.keywords || []).join(', '),
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(post.title)} — Big Sole Vibes</title>
  <meta name="description" content="${escapeHtml(post.metaDescription)}">
  <link rel="canonical" href="${canonicalUrl}">

  <!-- Open Graph -->
  <meta property="og:type"             content="article">
  <meta property="og:title"            content="${escapeHtml(post.title)}">
  <meta property="og:description"      content="${escapeHtml(post.metaDescription)}">
  <meta property="og:url"              content="${canonicalUrl}">
  <meta property="og:site_name"        content="Big Sole Vibes">
  <meta property="article:published_time" content="${dateStr}">
  <meta name="twitter:card"            content="summary_large_image">
  <meta name="twitter:title"           content="${escapeHtml(post.title)}">
  <meta name="twitter:description"     content="${escapeHtml(post.metaDescription)}">

  <!-- Article schema -->
  <script type="application/ld+json">${schemaJson}</script>

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:      #0D1B2A;
      --card:    #162233;
      --surface: #1C2E42;
      --amber:   #C17D2E;
      --cream:   #F5ECD7;
      --muted:   #4A6380;
      --font-bebas:    'Bebas Neue', sans-serif;
      --font-playfair: 'Playfair Display', Georgia, serif;
    }

    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--cream); font-family: var(--font-playfair); -webkit-font-smoothing: antialiased; }
    a { color: var(--amber); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Nav ── */
    .site-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; background: rgba(13,27,42,0.95); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255,255,255,0.10); height: 64px; }
    .nav-inner { max-width: 1280px; margin: 0 auto; padding: 0 1.5rem; height: 100%; display: flex; align-items: center; justify-content: space-between; }
    .nav-brand { font-family: var(--font-bebas); font-size: 1.5rem; letter-spacing: 0.08em; color: var(--amber); text-decoration: none; }
    .nav-links { display: flex; gap: 1.5rem; list-style: none; }
    .nav-links a { font-size: 0.875rem; color: var(--muted); transition: color 0.15s; text-decoration: none; }
    .nav-links a:hover { color: var(--cream); }
    .nav-links a.active { color: var(--amber); }
    @media (max-width: 640px) { .nav-links { display: none; } }

    /* ── Article hero ── */
    .post-hero { padding: 8rem 1.5rem 4rem; background: var(--card); border-bottom: 1px solid rgba(255,255,255,0.05); }
    .post-hero-inner { max-width: 720px; margin: 0 auto; }
    .back-link { display: inline-flex; align-items: center; gap: 0.4rem; font-family: var(--font-bebas); font-size: 0.75rem; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 2rem; text-decoration: none; }
    .back-link:hover { color: var(--amber); }
    .post-meta { display: flex; align-items: center; gap: 0.75rem; font-size: 0.75rem; color: var(--muted); margin-bottom: 1.25rem; }
    .post-meta-sep { color: rgba(255,255,255,0.2); }
    .post-h1 { font-family: var(--font-playfair); font-size: clamp(2rem, 5vw, 3.25rem); font-weight: 700; color: var(--cream); line-height: 1.15; letter-spacing: -0.01em; }

    /* ── Article body ── */
    .post-body { padding: 4rem 1.5rem 6rem; }
    .post-body-inner { max-width: 720px; margin: 0 auto; }

    .post-body p { font-size: 1.0625rem; line-height: 1.8; color: rgba(245,236,215,0.82); margin-bottom: 1.5rem; }
    .post-body h2 { font-family: var(--font-bebas); font-size: 1.6rem; letter-spacing: 0.08em; color: var(--amber); margin: 3rem 0 1.25rem; }
    .post-body h3 { font-family: var(--font-playfair); font-size: 1.2rem; font-weight: 600; color: var(--cream); margin: 2rem 0 0.75rem; }
    .post-body strong { color: var(--cream); font-weight: 600; }
    .post-body em { font-style: italic; }
    .post-body a { color: var(--amber); border-bottom: 1px solid rgba(193,125,46,0.3); padding-bottom: 1px; transition: border-color 0.15s; }
    .post-body a:hover { border-color: var(--amber); text-decoration: none; }
    .post-body blockquote { border-left: 3px solid var(--amber); padding: 0.25rem 0 0.25rem 1.5rem; margin: 2rem 0; }
    .post-body blockquote p { color: var(--muted); font-style: italic; }
    .post-body hr { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 3rem 0; }

    /* ── Shelf link (product CTA inline) ── */
    .shelf-link { display: inline-block; background: rgba(193,125,46,0.12); border: 1px solid rgba(193,125,46,0.3); color: var(--amber); font-family: var(--font-bebas); font-size: 0.7rem; letter-spacing: 0.1em; padding: 0.25rem 0.6rem; margin-left: 0.4rem; vertical-align: middle; text-decoration: none; transition: background 0.15s; }
    .shelf-link:hover { background: rgba(193,125,46,0.22); border-color: var(--amber); text-decoration: none; }

    /* ── Balm CTA box ── */
    .balm-cta { background: rgba(193,125,46,0.07); border: 1px solid rgba(193,125,46,0.22); border-left: 3px solid var(--amber); padding: 1.5rem 1.75rem; margin: 2.5rem 0; }
    .balm-cta p { font-size: 0.9375rem; line-height: 1.75; color: rgba(245,236,215,0.88); margin-bottom: 1.125rem; font-style: italic; }
    .balm-cta-btn { display: inline-block; font-family: var(--font-bebas); font-size: 0.75rem; letter-spacing: 0.12em; border: 1px solid var(--amber); color: var(--amber); padding: 0.625rem 1.5rem; transition: background 0.15s, color 0.15s; text-decoration: none; }
    .balm-cta-btn:hover { background: var(--amber); color: var(--bg); text-decoration: none; border-color: var(--amber); }
    .balm-cta-sub { display: block; font-size: 0.6875rem; color: var(--muted); margin-top: 0.625rem; letter-spacing: 0.04em; }

    /* ── FTC disclosure ── */
    .ftc-disclosure { font-size: 0.6875rem; color: var(--muted); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); padding: 0.6rem 1rem; margin-top: 1.75rem; line-height: 1.5; }

    /* ── Post footer ── */
    .post-footer { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; padding-top: 3rem; margin-top: 3rem; border-top: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; }
    .shop-cta-btn { font-family: var(--font-bebas); font-size: 0.75rem; letter-spacing: 0.1em; border: 1px solid var(--amber); color: var(--amber); padding: 0.875rem 2rem; transition: background 0.15s, color 0.15s; }
    .shop-cta-btn:hover { background: var(--amber); color: var(--bg); text-decoration: none; }
    .blog-link { font-family: var(--font-bebas); font-size: 0.75rem; letter-spacing: 0.1em; color: var(--muted); }
    .blog-link:hover { color: var(--amber); }

    /* ── Site footer ── */
    .site-footer { background: var(--card); border-top: 1px solid rgba(255,255,255,0.1); padding: 4rem 1.5rem; }
    .footer-inner { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 2rem; }
    @media (min-width: 768px) { .footer-inner { flex-direction: row; align-items: flex-start; justify-content: space-between; } }
    .footer-brand-name { font-family: var(--font-bebas); font-size: 1.875rem; letter-spacing: 0.08em; color: var(--amber); display: block; margin-bottom: 0.5rem; text-decoration: none; }
    .footer-tagline { font-size: 0.875rem; color: var(--muted); }
    .footer-nav { display: flex; gap: 2rem; list-style: none; }
    .footer-nav a { font-size: 0.875rem; color: var(--muted); transition: color 0.15s; text-decoration: none; }
    .footer-nav a:hover { color: var(--cream); }
    .footer-copy { max-width: 1280px; margin: 3rem auto 0; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.05); text-align: center; font-size: 0.75rem; color: var(--muted); }
    .affiliate-note { font-size: 0.6875rem; color: rgba(255,255,255,0.3); text-align: center; padding: 0.5rem 1.5rem 0; font-family: var(--font-playfair); }
  </style>
</head>
<body>

  <nav class="site-nav">
    <div class="nav-inner">
      <a href="/" class="nav-brand">BIG SOLE VIBES</a>
      <ul class="nav-links">
        <li><a href="/">Home</a></li>
        <li><a href="/the-lounge/index.html" class="active">The Lounge</a></li>
        <li><a href="/shop">The Locker Room</a></li>
        <li><a href="/lounge">The Lounge</a></li>
      </ul>
    </div>
  </nav>

  <header class="post-hero">
    <div class="post-hero-inner">
      <a href="/the-lounge/index.html" class="back-link">← THE LOUNGE</a>
      <div class="post-meta">
        <span>${publishDate}</span>
        <span class="post-meta-sep">·</span>
        <span>${readMinutes} min read</span>
      </div>
      <h1 class="post-h1">${escapeHtml(post.title)}</h1>
      <aside class="ftc-disclosure">Disclosure: As an Amazon Associate, Big Sole Vibes earns from qualifying purchases.</aside>
    </div>
  </header>

  <article class="post-body">
    <div class="post-body-inner">

      ${post.openingHtml}

      ${sectionsHtml}

      ${post.closingHtml}

      <div class="post-footer">
        <a href="/shop" class="shop-cta-btn">THE LOCKER ROOM →</a>
        <a href="/the-lounge/index.html" class="blog-link">← The Lounge</a>
      </div>
    </div>
  </article>

  <p class="affiliate-note">BSV participates in the Amazon Associates Program. Links on this page are affiliate links — we may earn a commission at no cost to you.</p>

  <footer class="site-footer">
    <div class="footer-inner">
      <div>
        <a href="/" class="footer-brand-name">BIG SOLE VIBES</a>
        <p class="footer-tagline">We found what you were looking for.</p>
      </div>
      <ul class="footer-nav">
        <li><a href="/">Home</a></li>
        <li><a href="/the-lounge/index.html">The Lounge</a></li>
        <li><a href="/shop">The Locker Room</a></li>
        <li><a href="/lounge">The Lounge</a></li>
      </ul>
    </div>
    <div class="footer-copy">
      <p>© ${new Date().getFullYear()} Big Sole Vibes. All rights reserved.</p>
    </div>
  </footer>

</body>
</html>`
}

function buildIndexHtml(posts) {
  const year = new Date().getFullYear()
  const postCards = posts.map(p => {
    const d = new Date(p.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    return `
          <article class="post-card">
            <div class="post-card-meta">${escapeHtml(d)}</div>
            <h2 class="post-card-title">
              <a href="/the-lounge/${escapeHtml(p.slug)}.html">${escapeHtml(p.title)}</a>
            </h2>
            <p class="post-card-excerpt">${escapeHtml(p.excerpt)}</p>
            <a href="/the-lounge/${escapeHtml(p.slug)}.html" class="post-card-link">READ MORE →</a>
          </article>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Lounge — Big Sole Vibes</title>
  <meta name="description" content="Proprietor-approved writing on men's grooming, foot care, and the standard. No fluff. No problem-solving. The practice, documented.">
  <link rel="canonical" href="${SITE_URL}/the-lounge/index.html">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg: #0D1B2A; --card: #162233; --amber: #C17D2E; --cream: #F5ECD7; --muted: #4A6380; --font-bebas: 'Bebas Neue', sans-serif; --font-playfair: 'Playfair Display', Georgia, serif; }
    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--cream); font-family: var(--font-playfair); -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    .site-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 50; background: rgba(13,27,42,0.95); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255,255,255,0.10); height: 64px; }
    .nav-inner { max-width: 1280px; margin: 0 auto; padding: 0 1.5rem; height: 100%; display: flex; align-items: center; justify-content: space-between; }
    .nav-brand { font-family: var(--font-bebas); font-size: 1.5rem; letter-spacing: 0.08em; color: var(--amber); }
    .nav-links { display: flex; gap: 1.5rem; list-style: none; }
    .nav-links a { font-size: 0.875rem; color: var(--muted); transition: color 0.15s; }
    .nav-links a:hover, .nav-links a.active { color: var(--cream); }
    .nav-links a.active { color: var(--amber); }
    @media (max-width: 640px) { .nav-links { display: none; } }
    .blog-hero { padding: 8rem 1.5rem 4rem; background: var(--card); border-bottom: 1px solid rgba(255,255,255,0.05); text-align: center; }
    .hero-eyebrow { font-family: var(--font-bebas); font-size: 0.75rem; letter-spacing: 0.1em; color: var(--amber); margin-bottom: 1rem; }
    .hero-title { font-family: var(--font-playfair); font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 700; line-height: 1.1; }
    .hero-sub { font-style: italic; font-size: 1rem; color: var(--muted); margin-top: 1rem; }
    .post-list { max-width: 760px; margin: 0 auto; padding: 4rem 1.5rem 6rem; display: flex; flex-direction: column; gap: 3rem; }
    .post-card { border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 3rem; }
    .post-card-meta { font-size: 0.75rem; color: var(--muted); letter-spacing: 0.04em; margin-bottom: 0.75rem; }
    .post-card-title { font-family: var(--font-playfair); font-size: 1.75rem; font-weight: 700; line-height: 1.2; margin-bottom: 0.75rem; }
    .post-card-title a { color: var(--cream); transition: color 0.15s; }
    .post-card-title a:hover { color: var(--amber); }
    .post-card-excerpt { font-size: 0.9375rem; line-height: 1.75; color: rgba(245,236,215,0.65); margin-bottom: 1.25rem; }
    .post-card-link { font-family: var(--font-bebas); font-size: 0.75rem; letter-spacing: 0.1em; color: var(--amber); transition: opacity 0.15s; }
    .post-card-link:hover { opacity: 0.75; }
    .site-footer { background: var(--card); border-top: 1px solid rgba(255,255,255,0.1); padding: 4rem 1.5rem; }
    .footer-inner { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 2rem; }
    @media (min-width: 768px) { .footer-inner { flex-direction: row; align-items: flex-start; justify-content: space-between; } }
    .footer-brand-name { font-family: var(--font-bebas); font-size: 1.875rem; letter-spacing: 0.08em; color: var(--amber); display: block; margin-bottom: 0.5rem; }
    .footer-tagline { font-size: 0.875rem; color: var(--muted); }
    .footer-nav { display: flex; gap: 2rem; list-style: none; }
    .footer-nav a { font-size: 0.875rem; color: var(--muted); transition: color 0.15s; }
    .footer-nav a:hover { color: var(--cream); }
    .footer-copy { max-width: 1280px; margin: 3rem auto 0; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.05); text-align: center; font-size: 0.75rem; color: var(--muted); }
  </style>
</head>
<body>

  <nav class="site-nav">
    <div class="nav-inner">
      <a href="/" class="nav-brand">BIG SOLE VIBES</a>
      <ul class="nav-links">
        <li><a href="/">Home</a></li>
        <li><a href="/the-lounge/index.html" class="active">The Lounge</a></li>
        <li><a href="/shop">The Locker Room</a></li>
        <li><a href="/lounge">The Lounge</a></li>
      </ul>
    </div>
  </nav>

  <header class="blog-hero">
    <p class="hero-eyebrow">THE PROPRIETOR'S DESK</p>
    <h1 class="hero-title">The Lounge</h1>
    <p class="hero-sub">The practice, documented. No problem-solving. No padding. The standard, in writing.</p>
  </header>

  <main class="post-list">
    ${postCards}
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <div>
        <a href="/" class="footer-brand-name">BIG SOLE VIBES</a>
        <p class="footer-tagline">We found what you were looking for.</p>
      </div>
      <ul class="footer-nav">
        <li><a href="/">Home</a></li>
        <li><a href="/the-lounge/index.html">The Lounge</a></li>
        <li><a href="/shop">The Locker Room</a></li>
        <li><a href="/lounge">The Lounge</a></li>
      </ul>
    </div>
    <div class="footer-copy">
      <p>© ${year} Big Sole Vibes. All rights reserved.</p>
    </div>
  </footer>
</body>
</html>`
}

// ─── Git push ─────────────────────────────────────────────────────────────────

function gitPush(files) {
  try {
    const fileArgs = files.map(f => `"${f}"`).join(' ')
    execSync(`git add ${fileArgs}`, { cwd: ROOT, stdio: 'pipe' })
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim()
    if (!status) { log('Git: no changes — skipping push'); return false }
    const msg = `chore: blog-agent — ${files.length} file(s) updated ${new Date().toISOString().slice(0, 10)}`
    execSync(`git commit -m "${msg}"`, { cwd: ROOT, stdio: 'pipe' })
    require('./git-push-guard').safePushToPreview(ROOT, log)
    return true
  } catch (err) {
    log(`ERROR: git push failed — ${err.stderr?.toString().trim() || err.message}`)
    return false
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR,  { recursive: true })
  fs.mkdirSync(BLOG_DIR,  { recursive: true })

  const dryRun = process.argv.includes('--dry-run')
  log(`━━━ blog-agent start ━━━${dryRun ? ' [dry-run]' : ''}`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const dateObj = new Date()

  // ─── Check for pending draft from previous timed-out run ─────────────────
  let resumedPost = null
  try {
    const draftFiles = execSync(`rclone ls "${REMOTE}/Inbox"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^blog-draft-.+\.json$/.test(f))
      .sort()
    if (draftFiles.length) {
      const draftFile = draftFiles[draftFiles.length - 1]
      log(`Found pending draft: ${draftFile} — restoring for approval loop`)
      execSync(`rclone copy "${REMOTE}/Inbox/${draftFile}" "${TEMP_DIR}/"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const localDraft = path.join(TEMP_DIR, path.basename(draftFile))
      if (fs.existsSync(localDraft)) {
        resumedPost = JSON.parse(fs.readFileSync(localDraft, 'utf8'))
        log(`Resumed post: "${resumedPost.title}" → /${resumedPost.slug}`)
      }
    }
  } catch { /* Drive may be unavailable — continue to normal generation */ }

  // ─── Load Drive context ───────────────────────────────────────────────────
  log('Loading Drive context...')

  const weeklyPlan    = loadLatestDriveFile('Plans')
  const brandReport   = loadLatestDriveFile('Brand')
  const socialReport  = loadLatestDriveFile('Reports', /^social-report-\d{4}-\d{2}-\d{2}\.md$/)
  const directive     = loadDriveFile('BSV-Directive.md')
  const memory        = loadDriveFile('BSV-Memory.md')

  // Load latest dated handoff
  let handoff = null
  try {
    const handoffFiles = execSync(`rclone ls "${REMOTE}/Handoff"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^BSV-Handoff-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (handoffFiles.length) {
      const latest = handoffFiles[handoffFiles.length - 1]
      execSync(`rclone copy "${REMOTE}/Handoff/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      const p = path.join(TEMP_DIR, latest)
      if (fs.existsSync(p)) handoff = fs.readFileSync(p, 'utf8')
    }
  } catch {}

  log(`Weekly plan:    ${weeklyPlan    ? weeklyPlan.filename    : 'none'}`)
  log(`Brand report:   ${brandReport   ? brandReport.filename   : 'none'}`)
  log(`Social report:  ${socialReport  ? socialReport.filename  : 'none'}`)
  log(`Directive:      ${directive ? directive.length + ' chars' : 'none'}`)
  log(`Memory:         ${memory ? memory.length + ' chars' : 'none'}`)
  log(`Handoff:        ${handoff ? handoff.length + ' chars' : 'none'}`)

  // ─── Load approved shelf products ─────────────────────────────────────────
  log('Loading approved shelf products from Google Sheets...')
  let shelfProducts = []
  try {
    const conn = await connect()
    await ensureHeaders(conn)
    const rows = await readAllRows(conn)
    shelfProducts = rows
      .filter(r => (r['Status'] || '').trim().toLowerCase() === 'approved')
      .map(r => ({
        name:            r['Product Name']      || '',
        category:        r['Category']          || '',
        description:     r['Description']       || '',
        reasoning:       r['Reasoning']         || '',
        price:           r['Price']             || '',
        proprietorsNotes: r["Proprietor's Notes"] || '',
        url:             buildProductUrl(r),
        isAmazon:        buildProductUrl(r).includes('amazon.com'),
      }))
    log(`Approved products: ${shelfProducts.length}`)
  } catch (err) {
    log(`WARNING: could not load sheet — ${err.message}`)
  }

  // ─── Build prompt context ─────────────────────────────────────────────────
  const shelfBlock = shelfProducts.length
    ? shelfProducts.map((p, i) => [
        `${i + 1}. **${p.name}** (${p.category})`,
        `   URL: ${p.url}`,
        `   Price: ${p.price}`,
        `   Description: ${p.description}`,
        p.proprietorsNotes ? `   Proprietor's Notes (review complaint patterns — use for CTA box): ${p.proprietorsNotes}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')
    : 'No approved products on shelf yet.'

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the BSV Blog Agent — you write long-form content for bigsolevibes.com.

## Article Structure
Every Lounge article MUST use the six-step chapter structure defined in BSV-Memory.md above. Follow the sequence exactly as written there. Do not default to generic article structure (intro → body → conclusion). If the structure is not yet in memory, use: (1) The Hook, (2) The Diagnosis, (3) The Standard, (4) The Evidence, (5) The Move, (6) The Close.

## Tone — this supersedes "Proprietor voice" for blog posts
Inviting, not judgmental. Confident, not preachy. There is a quiet knowing smile behind every sentence — like the man who already figured this out and is holding the door open for you without making a big deal of it.

The edge is this: his face gets moisturizer every morning. His shoes get cedar shoe trees. His suits get pressed. And his feet — the thing that carried all of that through a 12-hour day — get nothing. That is not a character flaw. That is just a blind spot nobody pointed out yet. BSV is pointing it out. Without judgment. With a slight raise of the eyebrow.

The feeling is: the door is open, the room is warm, the drink is already poured. Come in or don't. But he will want to come in.

**Never:**
- Shames the reader
- Says "you've been neglecting your feet" or any variant
- Uses the word "pamper"
- Sounds like a spa brochure
- Lectures

**Always:**
- Makes the reader feel like this is obvious once you see it
- Makes foot care feel like the natural extension of the standard he already holds
- Makes the shelf feel like it was curated for him specifically
- Leaves him feeling like he is already the kind of man who does this — he just needed the right products

**Craft:**
- Statements, never questions
- Minimal throat-clearing — open on something that matters
- Short paragraphs, room to breathe
- Never explains the brand — assumes the reader already belongs here

## What every post is not
- A listicle
- A problem-solver or medical article
- Anything that would appear in a Walgreens circular
- Generic lifestyle content
- Anything that explains what BSV is

## PRODUCT INTEGRATION RULE — NON-NEGOTIABLE

Every product that appears in this article must earn its mention through the narrative.
Products are never introduced as review subjects, features, or recommendations.
They appear as details that complete the man in the scene.

Wrong: "The FootLogix Mousse is a fast-absorbing formula with urea..."
Right: "He reached for the mousse — not because he'd researched it, but because it was the only thing on the shelf that didn't announce itself."

The product brief informs what's in the scene. The scene is never about the product.
If the product cannot appear naturally in a scene, it does not appear in this article.
No listicles. No feature callouts. No "here's why we picked this."
The story is the argument. The product is the evidence.

## Affiliate link anchor text rule
Every product that earns a scene mention must be linked using context-rich anchor text that names the specific quality or mechanism that belongs in that scene — not ad copy.

Good: <a href="URL" rel="sponsored">Gehwol's fast-acting formula</a>
Good: <a href="URL" rel="sponsored">FootLogix's zero-residue mousse</a>
Good: <a href="URL" rel="sponsored">Niegeloh's Solingen steel set</a>
Never: "click here", "buy now", "check price", "shop now", or any generic anchor text.

## CTA box rule
Whenever a section references a shelf product that has Proprietor's Notes, include a ctaBox field in that section's JSON. The complaint value must be a short, specific phrase drawn directly from that product's Proprietor's Notes — the real complaint pattern, not a generic one. It completes the sentence: Tired of foot balms that [complaint].

Example complaint values from actual notes:
- "leave a greasy film an hour after application"
- "smell like a pharmacy"
- "come in packaging that signals the medicine cabinet, not the shelf"

If a section references multiple products, use the complaint from the one most central to that section. Omit ctaBox entirely on sections where no referenced product has Proprietor's Notes.

## Image brief — one per post, required

Every post ends with an imageBrief field. This is a scene direction for Gemini image generation. The product is never in the frame. The feeling always is.

Choose exactly one of the four BSV visual scenes that fits the post's argument, then write a one-paragraph brief describing the scene, the mood, the light, and what the man in the frame looks like.

The four scenes:

1. **The Transition** — A man in a suit. Leather chair. Glass of whiskey or bourbon on a side table. City skyline through the window, dusk or night. One shoe is coming off. He is not looking at the camera. The moment between the day and whatever comes next. Mood: earned stillness. Light: warm amber interior against cool blue outside.

2. **The Athlete's Toll** — Post-game or post-training locker room. Dirty uniform or kit visible. Cleats or athletic shoes pulled off. The man is alone, or nearly. He is not celebrating — he is accounting. Mood: quiet after effort. Light: institutional overhead with pockets of shadow. The weight of the day is on him and he is fine with it.

3. **The Chef** — Still in chef's whites or a cook's apron, end of service. Recliner or battered sofa. Shoes on the floor beside him, feet up. Eyes possibly closed. He has fed other people for twelve hours. Mood: the specific exhaustion that comes from craft. Light: a single lamp, warm, late. The room is quiet for the first time all day.

4. **The Intimate Moment** — Two people, close. A couple at the end of the day. Shoes off, feet visible. The scene is private without being explicit. The foot care gap is the unspoken thing in the frame — not a problem, just the next thing. Mood: quiet domesticity, warmth without sentimentality. Light: soft, natural or candlelit. The moment feels earned.

The brief must specify: which scene, the specific light quality, what the man is wearing, the exact moment being captured, and the emotional register. One paragraph. Cinematographer's eye. No product in frame.

## Legal compliance — non-negotiable, every post

1. FTC disclosure: Already injected into the HTML template near the post title — do not add it again in the post body.

2. Image rules: Never reference downloaded Amazon product images. Never instruct use of right-click-saved images. Acceptable sources only: Amazon SiteStripe embedded links (images served from Amazon's servers), original BSV photography. When referencing a product, describe it in words.

3. Truthful comparisons: Complaint language in ctaBox must come only from actual mined Amazon reviews passed in Proprietor's Notes — never invented. Never imply any brand is partnering with or endorsing BSV. Frame all product assessments as the Proprietor's independent assessment.

4. Title structure: Never title a post as a product review. The concept or argument always leads. The product is evidence for the argument, never the argument itself.
   Good: "The Texture Audit: Why Fast-Absorbing Mousse is Replacing Slimy Lotions in Elite Grooming Routines" (then cover FootLogix inside)
   Good: "The Standard Doesn't Stop at the Ankle" (then introduce the shelf)
   Never: "FootLogix Review: Is This the Best Foot Mousse for Men?"

## SEO — one term per post, chosen from the social report

Before writing, scan the social intelligence report for the search phrase with the highest signal upside for BSV: something men are actually typing, with clear intent, that fits the article angle and the shelf. If the social report is unavailable, pick from the evergreen list below.

Term placement rules:
- Exact phrase (or a close natural variant) must appear in the title OR the first paragraph — one of these is required
- Once more in an h2 heading — naturally woven in, never forced
- If it sounds stuffed, rework the sentence. Voice always wins over keyword placement.

Evergreen fallback: "luxury apothecary foot balm", "non greasy absorbent foot lotion men", "premium pedicure tools Solingen steel", "fast absorbing foot treatment men", "dry cracked heel treatment athletes", "luxury shoe friction prevention balm", "premium foot care men"

Add a "seoTerm" field to your JSON output — the exact phrase you targeted.

Every post must:
- Open with something that stops the scroll — no "welcome to the blog" energy
- Have h2 subheadings that target secondary keywords
- Reference approved shelf products with their exact affiliate URLs — naturally, as evidence, not as ads
- Include an internal link to /shop
- Close with a statement, not a call to action

## JSON output format — return ONLY this JSON, no markdown fences, no commentary

{
  "title": "Concept-first title — the argument or insight leads, primary keyword embedded naturally. Never a product review title. The product is evidence inside the post, never the subject of the title.",
  "slug": "url-slug-lowercase-hyphens",
  "metaDescription": "Under 160 characters. Primary keyword. Written for the man, not the algorithm.",
  "excerpt": "2–3 sentences for the post listing. Reads like the Proprietor wrote it — not a summary.",
  "seoTerm": "the exact search phrase you targeted — one line, no explanation",
  "keywords": ["primary kw", "secondary kw", "tertiary kw"],
  "openingHtml": "<p>...</p><p>...</p>  (3–5 paragraphs, no h2, no intro heading — just opens strong)",
  "sections": [
    {
      "heading": "Section Heading Targeting Secondary Keyword",
      "html": "<p>...</p><p>...</p>",
      "ctaBox": { "complaint": "specific complaint phrase from Proprietor's Notes — omit key entirely if no notes exist for referenced product" }
    }
  ],
  "closingHtml": "<p>Final statement. Not a CTA. Not a summary. The Proprietor's last word on it.</p>",
  "imageBrief": "One paragraph. Scene name (The Transition / The Athlete's Toll / The Chef / The Intimate Moment), then: the specific light, what the man is wearing, the exact moment being captured, the emotional register. The product is never in the frame. The feeling always is."
}`

  // ─── Check content calendar for queued pieces ─────────────────────────────
  const earlyManifestPath = path.join(BLOG_DIR, 'manifest.json')
  let earlyManifest = []
  if (fs.existsSync(earlyManifestPath)) {
    try { earlyManifest = JSON.parse(fs.readFileSync(earlyManifestPath, 'utf8')) } catch {}
  }
  const publishedSlugs = new Set(earlyManifest.map(m => m.slug))

  // Merge chief-approved Lounge items from sidecar queue (written at Telegram approval time)
  const sidecarPath = path.join(ROOT, 'logs', 'blog-calendar-queue.json')
  let sidecarEntries = []
  try {
    if (fs.existsSync(sidecarPath)) {
      const raw = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))
      sidecarEntries = raw
        .filter(e => e.slug && !publishedSlugs.has(e.slug))
        .map(e => ({
          slug:             e.slug,
          titleDirection:   `"${e.title}." ${e.angle}`.trim(),
          voice:            'The Lounge — long-form warmth. Full essay, not a one-liner. GQ editorial register: technical mastery without condescension.',
          contentDirection: [],
          ctaBox:           { text: 'The shelf is there when you\'re ready.', subtext: '', linkHref: '/shop', linkText: 'The Locker Room' },
          seoTargets:       [],
          lengthWords:      '800–1,200',
        }))
      if (sidecarEntries.length) log(`Calendar sidecar: ${sidecarEntries.length} approved item(s) — ${sidecarEntries.map(e => e.slug).join(', ')}`)
    }
  } catch (err) {
    log(`WARNING: could not read blog-calendar-queue — ${err.message}`)
  }
  // Sidecar entries run before hardcoded calendar so approvals publish first
  const effectiveCalendar = [...sidecarEntries, ...CONTENT_CALENDAR]

  const nextCalendarEntry = effectiveCalendar.find(entry => {
    if (entry.slugPattern) return !Array.from(publishedSlugs).some(s => entry.slugPattern.test(s))
    return !publishedSlugs.has(entry.slug) && entry.titleDirection
  })

  const postRequirementsBlock = nextCalendarEntry
    ? `## Queued piece — write this specific post (calendar directive, overrides hub article direction)
Title direction: ${nextCalendarEntry.titleDirection}
Voice: ${nextCalendarEntry.voice}
Content direction:
${nextCalendarEntry.contentDirection.map((b, i) => `${i + 1}. ${b}`).join('\n')}
${nextCalendarEntry.structureNote ? `Structure: ${nextCalendarEntry.structureNote}` : ''}
CTA box: "${nextCalendarEntry.ctaBox.text}"${nextCalendarEntry.ctaBox.subtext ? ` / "${nextCalendarEntry.ctaBox.subtext}"` : ''} — link href="${nextCalendarEntry.ctaBox.linkHref}" text="${nextCalendarEntry.ctaBox.linkText}"
SEO targets: ${nextCalendarEntry.seoTargets.join(', ')}
Length: ${nextCalendarEntry.lengthWords} words`.replace(/\n\n+/g, '\n')
    : `## Post requirements
- Voice: Proprietor — statements, deadpan, confident. Never preachy.
- Target: "luxury apothecary foot balm", "non greasy absorbent foot lotion men", "premium foot care men"
- Structure: Hub article. Establish authority, define the premium lifestyle angle, introduce the BSV shelf as the curation the BSV man didn't know existed
- Frame: Written for the man who already treats his face well and hasn't thought about what's been carrying him all day
- Shelf products: reference Gehwol, Kneipp, and others naturally — as evidence of the standard, not as ads
- Internal link to /shop at least once
- Length: 1,000–1,400 words`

  if (nextCalendarEntry) {
    log(`Calendar: queuing "${nextCalendarEntry.titleDirection.slice(0, 60)}..."`)
  } else {
    log('Calendar: no queued pieces — falling back to hub article direction')
  }

  const userPrompt = `Write the BSV blog post for this week.

## Media director plan (${weeklyPlan ? weeklyPlan.filename : 'unavailable'})
${weeklyPlan ? weeklyPlan.content.slice(0, 1500) : 'No media plan available — write a hub post on the premium foot care standard.'}
The article angle should reinforce this week's content theme. If a theme is named in the plan, anchor the post to it.

## Brand signals
${brandReport ? brandReport.content.slice(0, 800) : 'No brand report available.'}

## Social intelligence
${socialReport ? socialReport.content.slice(0, 600) : 'No social report available.'}

**SEO:** Before writing, identify the one search phrase from the social intelligence above with the highest signal upside for BSV. Set it in "seoTerm". Place it naturally in the title or first paragraph, and once more in an h2 heading.

## Approved shelf products — reference these naturally with their URLs as affiliate links
${shelfBlock}

${postRequirementsBlock}

Return ONLY the JSON object. No preamble, no explanation.`

  // ─── Call Claude (skipped if resumedPost exists) ─────────────────────────
  const client = new Anthropic({ apiKey })
  let rawText  = ''

  if (!resumedPost) {
    log('Calling Claude API to generate blog post...')
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 6000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })
    rawText = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
    log(`Claude done — ${response.usage?.output_tokens ?? '?'} tokens, stop: ${response.stop_reason}`)
  }

  // ─── Parse JSON ───────────────────────────────────────────────────────────
  let post
  if (resumedPost) {
    // Restored from pending draft — skip generation
    post = resumedPost
    log(`Using resumed post: "${post.title}" → /${post.slug}`)
  } else {
    try {
      const stripped = rawText.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
      const start = stripped.indexOf('{')
      const end   = stripped.lastIndexOf('}')
      if (start === -1 || end === -1) throw new Error('no JSON object found')
      post = JSON.parse(stripped.slice(start, end + 1))
      if (!post.title || !post.slug || !post.openingHtml) throw new Error('missing required fields')
      log(`Post: "${post.title}" → /${post.slug}`)
      if (post.imageBrief) log(`Image brief: ${post.imageBrief}`)
      else log('WARNING: no imageBrief in response')
    } catch (err) {
      log(`ERROR: JSON parse failed — ${err.message}`)
      log(`Raw (first 500): ${rawText.slice(0, 500)}`)
      process.exit(1)
    }
  }

  // ─── Build manifest context (needed for both dry-run and approval loop) ───
  const filename  = `${today}-${post.slug}.html`
  const postPath  = path.join(BLOG_DIR, filename)
  const indexPath = path.join(BLOG_DIR, 'index.html')
  const manifestPath = path.join(BLOG_DIR, 'manifest.json')

  let manifest = []
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}
  }
  manifest = manifest.filter(m => m.slug !== post.slug)
  manifest.unshift({
    slug:        post.slug,
    title:       post.title,
    date:        today,
    excerpt:     post.excerpt,
    filename,
    imageBrief:  post.imageBrief || '',
    imageStatus: 'pending',
  })

  // ─── Dry-run exits before approval loop ──────────────────────────────────
  if (dryRun) {
    const postHtmlDry = buildPostHtml(post, today)
    const preview = path.join(ROOT, 'logs', 'blog-preview.html')
    fs.writeFileSync(preview, postHtmlDry)
    log(`[dry-run] Post HTML written to logs/blog-preview.html`)
    log(`[dry-run] Manifest would have ${manifest.length} posts`)
    log('━━━ blog-agent complete ━━━\n')
    return
  }

  // ─── Approval loop (up to 3 EDIT revisions) ──────────────────────────────

  const MAX_EDITS    = 3
  let   editAttempts = 0
  let   approvalDecision = null

  // Helper: strip HTML tags for read-time and preview
  function stripHtml(html) {
    return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // Helper: save draft to Drive Inbox for later resumption
  async function saveDraftToDrive(postObj) {
    const draftName = `blog-draft-${postObj.slug}.json`
    const tmpDraft  = path.join(os.tmpdir(), draftName)
    fs.writeFileSync(tmpDraft, JSON.stringify(postObj, null, 2))
    try {
      execSync(`rclone copyto "${tmpDraft}" "${REMOTE}/Inbox/${draftName}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      log(`Draft saved to Drive Inbox: ${draftName}`)
    } catch (err) {
      log(`WARNING: could not save draft to Drive: ${err.message}`)
    }
    try { fs.unlinkSync(tmpDraft) } catch {}
  }

  // Helper: archive rejected/expired draft
  async function archiveRejectedDraft(postObj, reason) {
    const rejName  = `blog-rejected-${postObj.slug}-${today}.md`
    const tmpRej   = path.join(os.tmpdir(), rejName)
    fs.writeFileSync(tmpRej, `# Blog Draft Rejected\n\nslug: ${postObj.slug}\ndate: ${today}\nreason: ${reason}\n`)
    try {
      execSync(`rclone copyto "${tmpRej}" "${REMOTE}/Inbox/Processed/${rejName}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {}
    try { fs.unlinkSync(tmpRej) } catch {}
  }

  while (true) {
    // Build approval message
    const postHtmlForApproval = buildPostHtml(post, today)
    const fullText   = post.openingHtml + (post.sections || []).map(s => s.html).join('') + post.closingHtml
    const wordCount  = stripHtml(fullText).split(/\s+/).filter(Boolean).length
    const readTime   = Math.max(1, Math.ceil(wordCount / 200))
    const previewTxt = (post.excerpt
      ? stripHtml(post.excerpt)
      : stripHtml(post.openingHtml)
    ).slice(0, 200)
    const voice = (nextCalendarEntry && nextCalendarEntry.voice)
      ? nextCalendarEntry.voice.split('.')[0]
      : 'Proprietor'

    const driveFile = `blog-${post.slug}-decision.md`

    const telegramMsg = [
      `📝 *NEW LOUNGE DRAFT*`,
      `*Title:* ${post.title}`,
      `*Voice:* ${voice}`,
      `*Est. read time:* ${readTime} min`,
      ``,
      `*Preview:* ${previewTxt}`,
      ``,
      `Reply *APPROVE* to publish`,
      `Reply *REJECT* to discard`,
      `Reply *EDIT [your notes]* to revise`,
    ].join('\n')

    addPendingItem({
      id:              `blog-${post.slug}`,
      type:            'blog',
      driveFile,
      sentAt:          new Date().toISOString(),
      remindAfter:     null,
      metadata:        { slug: post.slug, title: post.title, voice },
      originalMessage: telegramMsg,
    })

    await sendTelegram(telegramMsg)
    log(`Approval request sent — polling Drive for decision (max 4h)...`)

    // Poll Drive every 15 minutes, max 16 polls (4 hours)
    const MAX_POLLS     = 16
    const POLL_INTERVAL_MS = 15 * 60 * 1000
    let   decision      = null

    for (let poll = 0; poll < MAX_POLLS; poll++) {
      if (poll > 0) {
        log(`Waiting 15 minutes before next poll (${poll}/${MAX_POLLS})...`)
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      }
      const result = readDecisionFromDrive(driveFile)
      if (result) {
        decision = result
        log(`Decision received: ${result.decision}${result.notes ? ` — notes: ${result.notes}` : ''}`)
        break
      }
    }

    if (!decision) {
      // Timed out — save draft to Drive Inbox for next run
      log('No approval decision received in 4 hours — saving draft to Drive Inbox')
      await saveDraftToDrive(post)
      await sendTelegram(`⏰ *The Lounge draft timed out — saved to Drive Inbox*\nTitle: ${post.title}\nI'll pick up where we left off next run.`)
      log('━━━ blog-agent complete (awaiting approval) ━━━\n')
      return
    }

    approvalDecision = decision.decision

    if (approvalDecision === 'APPROVE') {
      // Remove from pending queue
      const { loadPendingItems: lp, savePendingItems: sp } = require('./telegram-queue')
      const pending = lp()
      sp(pending.filter(i => i.id !== `blog-${post.slug}`))
      break
    }

    if (approvalDecision === 'REJECT') {
      const { loadPendingItems: lp, savePendingItems: sp } = require('./telegram-queue')
      const pending = lp()
      sp(pending.filter(i => i.id !== `blog-${post.slug}`))
      await archiveRejectedDraft(post, 'Rejected by Big D')
      await sendTelegram(`❌ Rejected and archived.`)
      log(`Post rejected — exiting cleanly`)
      log('━━━ blog-agent complete (rejected) ━━━\n')
      return
    }

    if (approvalDecision === 'EDIT') {
      editAttempts++
      if (editAttempts > MAX_EDITS) {
        log(`Max edit attempts (${MAX_EDITS}) reached — saving draft`)
        await saveDraftToDrive(post)
        await sendTelegram(`⚠️ Max revisions reached for "${post.title}". Draft saved to Drive Inbox.`)
        log('━━━ blog-agent complete (max edits) ━━━\n')
        return
      }
      const notes = decision.notes || ''
      log(`Edit requested (attempt ${editAttempts}/${MAX_EDITS}): ${notes}`)

      // Re-call Claude with revision notes
      const revisionPrompt = `Revision requested: ${notes}. Apply to the draft.\n\n${userPrompt}`
      try {
        const revResponse = await client.messages.create({
          model:      'claude-sonnet-4-6',
          max_tokens: 6000,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: revisionPrompt }],
        })
        const revRaw = revResponse.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
        const stripped = revRaw.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
        const start = stripped.indexOf('{')
        const end   = stripped.lastIndexOf('}')
        if (start === -1 || end === -1) throw new Error('no JSON in revision response')
        const revised = JSON.parse(stripped.slice(start, end + 1))
        if (!revised.title || !revised.slug || !revised.openingHtml) throw new Error('missing required fields in revision')
        post = revised
        log(`Revision ${editAttempts} applied: "${post.title}" → /${post.slug}`)
      } catch (err) {
        log(`ERROR: revision parse failed — ${err.message}`)
        await sendTelegram(`⚠️ Revision failed to parse. Keeping original draft. Reply APPROVE to publish as-is.`)
        // Re-loop with same post
      }
      continue
    }

    // Unexpected decision value — treat as skip and break
    log(`Unexpected decision: ${approvalDecision} — treating as approved`)
    break
  }

  // ─── Write HTML to disk and push ─────────────────────────────────────────

  const postHtml = buildPostHtml(post, today)
  const indexHtml = buildIndexHtml(manifest)

  fs.writeFileSync(postPath,    postHtml)
  fs.writeFileSync(indexPath,   indexHtml)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  log(`Written: ${filename}`)
  log(`Written: index.html (${manifest.length} total post(s))`)
  log(`Written: manifest.json`)

  // Push all three files to preview
  const pushed = gitPush([
    path.join('public', 'sole-report', filename),
    path.join('public', 'sole-report', 'index.html'),
    path.join('public', 'sole-report', 'manifest.json'),
  ])

  log(`Deploy: ${pushed ? 'triggered' : 'skipped (no changes)'}`)

  // Notify Big D
  await sendTelegram(`✅ Published: ${post.title} — ${SITE_URL}/the-lounge/${post.slug}.html`)

  log(`━━━ blog-agent complete — "${post.title}" ━━━\n`)
})()
