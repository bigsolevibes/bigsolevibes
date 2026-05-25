require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// sole-report-agent.js — weekly Sole Report article generator
//
// Runs Sunday 10:00PM via launchd. Reads the latest social intelligence report
// and existing MDX posts, picks a fresh angle, writes a 300–500 word
// barbershop-voice article, drops the MDX into content/posts/, commits, and
// pushes to preview/full-site. Chief reads the output in Monday's stand-up.
// Big D reviews Monday morning — pulls the commit if wrong, ships if right.
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk').default
const matter    = require('gray-matter')
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { safePushToPreview } = require('./git-push-guard')
const { sendTelegram }      = require('./telegram')

const ROOT      = path.join(__dirname, '..')
const LOG_FILE  = path.join(ROOT, 'logs', 'sole-report-agent.log')
const POSTS_DIR = path.join(ROOT, 'content', 'posts')
const TEMP_DIR  = path.join(os.homedir(), 'tmp', 'bsv-sole-report-agent')
const REMOTE    = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Existing posts inventory ─────────────────────────────────────────────────
// Returns array of { slug, title, excerpt, date } sorted newest first.

function loadExistingPosts() {
  if (!fs.existsSync(POSTS_DIR)) return []
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.mdx'))
    .map(f => {
      try {
        const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8')
        const { data } = matter(raw)
        return { slug: data.slug, title: data.title, excerpt: data.excerpt, date: data.date }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDriveFile(remotePath) {
  try {
    execSync(`rclone copy "${REMOTE}/${remotePath}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, path.basename(remotePath))
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null
  } catch { return null }
}

function loadLatestDriveReport(pattern) {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => pattern.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, path.basename(latest))
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf-8') } : null
  } catch { return null }
}

function loadLatestMediaPlan() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Plans"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /content-plan.*\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Plans/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, path.basename(latest))
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf-8') } : null
  } catch { return null }
}

// ─── Publish date ─────────────────────────────────────────────────────────────
// Runs Sunday night → article date is Monday (next day).

function nextMondayDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Output parser ────────────────────────────────────────────────────────────
// Claude returns a structured block. Parse it into { meta, body }.
// Format:
//   TITLE: ...
//   SLUG: ...
//   EXCERPT: ...
//   TAGS: tag1, tag2, tag3
//   INTERNAL_LINK: /sole-report/slug-here  (or NONE)
//   ---
//   [article body in markdown]

function parseArticleOutput(raw) {
  const sep = raw.indexOf('\n---\n')
  if (sep === -1) throw new Error('missing --- separator between header and body')

  const header = raw.slice(0, sep).trim()
  const body   = raw.slice(sep + 5).trim()

  const get = (key) => {
    const m = header.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'))
    return m ? m[1].trim() : null
  }

  const title        = get('TITLE')
  const slug         = get('SLUG')
  const excerpt      = get('EXCERPT')
  const tagsRaw      = get('TAGS')
  const seoTerm      = get('SEO_TERM')
  const internalLink = get('INTERNAL_LINK')

  if (!title || !slug || !excerpt || !body) {
    throw new Error(`missing required fields — title=${!!title} slug=${!!slug} excerpt=${!!excerpt} body=${!!body}`)
  }

  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : ['The Standard']

  return { title, slug, excerpt, tags, seoTerm, internalLink: internalLink === 'NONE' ? null : internalLink, body }
}

// ─── MDX builder ─────────────────────────────────────────────────────────────

function buildMdx({ title, slug, excerpt, tags, date, body }) {
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `slug: ${slug}`,
    `date: ${JSON.stringify(date)}`,
    `excerpt: ${JSON.stringify(excerpt)}`,
    `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]`,
    '---',
  ].join('\n')

  const disclosure = '*Disclosure: As an Amazon Associate, Big Sole Vibes earns from qualifying purchases.*'

  return `${frontmatter}\n\n${disclosure}\n\n${body}\n`
}

// ─── Git commit + push ────────────────────────────────────────────────────────

function gitCommitAndPush(filePath, slug) {
  try {
    execSync(`git add "${filePath}"`, { cwd: ROOT, stdio: 'pipe' })
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim()
    if (!status) { log('Git: no changes to commit'); return false }
    execSync(`git commit -m "feat: sole-report ${slug}"`, { cwd: ROOT, stdio: 'pipe' })
    return safePushToPreview(ROOT, log)
  } catch (err) {
    log(`ERROR: git operation failed — ${err.stderr?.toString().trim() || err.message}`)
    return false
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(POSTS_DIR, { recursive: true })
  fs.mkdirSync(TEMP_DIR,  { recursive: true })

  const dryRun = process.argv.includes('--dry-run')
  log(`━━━ sole-report-agent start ━━━${dryRun ? ' [dry-run]' : ''}`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  // ── Inventory existing posts ───────────────────────────────────────────────

  const existingPosts = loadExistingPosts()
  log(`Existing posts: ${existingPosts.length}`)
  existingPosts.forEach(p => log(`  → ${p.slug} — "${p.title}"`))

  // ── Load Drive context ─────────────────────────────────────────────────────

  log('Loading Drive context...')
  const directive    = loadDriveFile('BSV-Directive.md')
  const memory       = loadDriveFile('BSV-Memory.md')
  const socialReport = loadLatestDriveReport(/^social-report-\d{4}-\d{2}-\d{2}\.md$/)
  const mediaPlan    = loadLatestMediaPlan()

  log(`Directive:     ${directive    ? directive.length + ' chars'         : 'not found'}`)
  log(`Memory:        ${memory       ? memory.length + ' chars'            : 'not found'}`)
  log(`Social report: ${socialReport ? socialReport.filename               : 'none'}`)
  log(`Media plan:    ${mediaPlan    ? mediaPlan.filename                  : 'none'}`)

  // ── Build prompts ──────────────────────────────────────────────────────────

  const publishDate = nextMondayDate()
  log(`Publish date: ${publishDate}`)

  const existingTopicsBlock = existingPosts.length
    ? existingPosts.map(p => `- "${p.title}" (slug: ${p.slug})`).join('\n')
    : '(none yet — this is the first article)'

  const internalLinkBlock = existingPosts.length
    ? `One of these existing articles is a valid internal link target. Pick the most relevant one:\n${existingPosts.map(p => `- /sole-report/${p.slug} — "${p.title}"`).join('\n')}\nIf none fit naturally, write NONE.`
    : 'No existing articles yet — write NONE for INTERNAL_LINK.'

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the BSV Sole Report agent. One job: write one article per week in the Proprietor's voice.

## The Voice — hard rules, no exceptions

Reads like a barbershop conversation, not a blog post. The Proprietor is talking — not lecturing, not pitching. He has already figured this out and is telling you what he noticed. Deadpan, confident, slightly amused. Never preachy. Never explains itself.

**Structure:**
- Open in a specific scene. Put the man in a chair, a locker room, the end of a workday, getting dressed for something. Make it concrete. He is a real person in a real moment.
- The gap (feet, below the ankle, the bottom of the kit) surfaces naturally inside the scene — not as a problem but as an observation.
- Build the argument in short paragraphs. Room to breathe. Punchy lines. One idea per paragraph.
- Close at the shelf. Not a hard sell — more like: here's where that goes. The shelf link to /shop is the last natural stop.

**Length:** 300–500 words. Tight. No padding. Every sentence earns its place.

**Tone tests — run every draft through these:**
- If a skincare brand could run this without changing a word, rewrite it. This is for men, specifically.
- If it sounds like it belongs in a men's health magazine, cut the softening language and make it harder.
- If it explains what BSV is, delete it — the man reading it already knows.
- If it tells the reader to "take care of themselves," delete it — he already does. The foot care is the one blind spot.

**What this article is not:**
- A listicle
- A product review
- A how-to guide
- A problem-solving article
- Anything that begins "As a man who..."

## SEO — baked in, not bolted on

Each article must target one specific search term the BSV man might actually type. The term comes from the social intelligence report — pick the highest-signal phrase that aligns with the article angle. If no social report is available, default to an evergreen term in men's foot care or grooming (e.g. "men's foot care routine", "how to fix cracked heels men", "best foot balm for men").

Rules for the SEO term:
- The exact phrase (or a close natural variant) must appear in the title OR the first paragraph
- It should appear once more in a subheading or mid-body paragraph — naturally, never forced
- Never sacrifice voice for the term. If it sounds stuffed, rework the sentence around it.

## Output format — exactly this, no deviations

TITLE: [Title in title case — the argument or observation leads, never a product name]
SLUG: [lowercase-hyphenated-url-slug]
EXCERPT: [2–3 sentences. Reads like the Proprietor wrote it. Not a summary — more like the thing he says as you're sitting down.]
TAGS: [2–4 tags, comma-separated, e.g. The Standard, Premium Grooming, The Ritual]
SEO_TERM: [the exact phrase you targeted — one line, no explanation]
INTERNAL_LINK: [/sole-report/existing-slug OR NONE]
---
[Article body in clean markdown. No frontmatter. No disclosure line — that's injected automatically. Start directly with the article.]`

  const mediaPlanBlock = mediaPlan
    ? `## Weekly media plan (${mediaPlan.filename})\n${mediaPlan.content.slice(0, 1500)}${mediaPlan.content.length > 1500 ? '\n[truncated]' : ''}`
    : '## Weekly media plan\n(unavailable — proceed without it)'

  const userPrompt = `Write this week's Sole Report article.

## Existing articles — do not repeat these topics
${existingTopicsBlock}

## Social intelligence (${socialReport ? socialReport.filename : 'unavailable'})
${socialReport ? socialReport.content.slice(0, 2000) + (socialReport.content.length > 2000 ? '\n[truncated]' : '') : '(no social report available — pick an evergreen angle that fits the BSV man)'}

${mediaPlanBlock}

## Internal link options
${internalLinkBlock}

## What to write
Pick an angle that is NOT covered by any existing article above. Use the social intelligence to find what the audience is talking about this week and ground the article in that moment — a specific cultural signal, a tension, something the BSV man would recognize. If the social report is unavailable, pick a timely evergreen angle that a man in his late 30s–mid 40s would encounter on a Wednesday evening.

**SEO:** Before writing, identify the one search phrase from the social report (or evergreen alternatives) that best matches the article angle. Put this in SEO_TERM. Then work it naturally into the title or first paragraph, and once more in the body. This is the only structural constraint — the voice still drives everything.

The article must:
- Open in a specific scene (one paragraph)
- Reveal the gap naturally — never lecture
- Stay in the 300–500 word range
- End at the shelf (/shop or /lounge), naturally
- Include the internal link where it fits — in the body, as a natural reference, not a call to action

Output the structured block. Nothing else — no preamble, no explanation after.`

  // ── Call Claude ────────────────────────────────────────────────────────────

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const rawText = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
  log(`Claude done — ${response.usage?.output_tokens ?? '?'} tokens, stop: ${response.stop_reason}`)

  if (!rawText) { log('ERROR: empty response'); process.exit(1) }

  // ── Parse output ───────────────────────────────────────────────────────────

  let article
  try {
    article = parseArticleOutput(rawText)
    log(`Article: "${article.title}" → ${article.slug}`)
    log(`Tags: ${article.tags.join(', ')}`)
    log(`SEO term: ${article.seoTerm || 'none'}`)
    log(`Internal link: ${article.internalLink || 'none'}`)
    log(`Body: ${article.body.split(/\s+/).length} words`)
  } catch (err) {
    log(`ERROR: parse failed — ${err.message}`)
    log(`Raw output:\n${rawText.slice(0, 600)}`)
    await sendTelegram(`✗ *BSV Sole Report agent failed*\nParse error: ${err.message}`).catch(() => {})
    process.exit(1)
  }

  // ── Quality gate: short article → preview, not publish ────────────────────

  const wordCount = article.body.split(/\s+/).length
  if (wordCount < 250) {
    const preview = path.join(ROOT, 'logs', `sole-report-preview-${article.slug}.md`)
    const mdxShort = buildMdx({ ...article, date: publishDate })
    fs.writeFileSync(preview, mdxShort)
    log(`WARNING: article too short (${wordCount} words < 250) — saved as preview, not published`)
    log(`Preview: logs/sole-report-preview-${article.slug}.md`)
    await sendTelegram(
      `⚠️ *BSV Sole Report — quality gate triggered*\n"${article.title}"\n${wordCount} words — too short to publish.\nPreview saved to logs/.`
    ).catch(() => {})
    process.exit(0)
  }

  // ── Collision guard: never overwrite an existing slug ──────────────────────

  const outPath = path.join(POSTS_DIR, `${article.slug}.mdx`)
  if (fs.existsSync(outPath)) {
    log(`WARNING: ${article.slug}.mdx already exists — skipping to avoid overwrite`)
    log('Re-run with --dry-run to preview what would have been written.')
    await sendTelegram(`⚠️ *BSV Sole Report* — slug \`${article.slug}\` already exists. No file written.`).catch(() => {})
    process.exit(0)
  }

  // ── Build and write MDX ────────────────────────────────────────────────────

  const mdx = buildMdx({ ...article, date: publishDate })

  if (dryRun) {
    const preview = path.join(ROOT, 'logs', `sole-report-preview-${article.slug}.md`)
    fs.writeFileSync(preview, mdx)
    log(`[dry-run] MDX written to logs/sole-report-preview-${article.slug}.md`)
    log('━━━ sole-report-agent complete (dry-run) ━━━\n')
    return
  }

  fs.writeFileSync(outPath, mdx)
  log(`Written: content/posts/${article.slug}.mdx`)

  // ── Git commit + push ──────────────────────────────────────────────────────

  const pushed = gitCommitAndPush(outPath, article.slug)
  log(`Deploy: ${pushed ? 'pushed to preview/full-site' : 'skipped'}`)

  // ── Telegram notification ──────────────────────────────────────────────────

  const status = pushed ? '✓' : '⚠️'
  await sendTelegram(
    `${status} *BSV Sole Report — ${publishDate}*\n` +
    `*"${article.title}"*\n\n` +
    `${article.excerpt.slice(0, 120)}...\n\n` +
    `${wordCount} words · pushed to preview/full-site\n` +
    `Review Monday morning — pull the commit if wrong.`
  ).catch(() => {})

  log(`━━━ sole-report-agent complete — "${article.title}" ━━━\n`)
})()
