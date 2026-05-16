require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// reddit-agent.js — posts to r/bigsolevibes on a Mon/Wed/Fri schedule
//
// Credentials: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME,
//              REDDIT_PASSWORD in .env (script app — "password" grant type)
//
// Run modes:
//   node scripts/reddit-agent.js --day mon    Monday 9AM weekly discussion
//   node scripts/reddit-agent.js --day wed    Wednesday cross-post latest article
//   node scripts/reddit-agent.js --day fri    Friday community engagement
//   node scripts/reddit-agent.js --post "title" "body"   manual/on-demand
//
// Falls back to Puppeteer browser automation if Reddit API auth fails
// (API access pending approval on new subreddits).
// ─────────────────────────────────────────────────────────────────────────────

const { execSync }  = require('child_process')
const path          = require('path')
const fs            = require('fs')
const os            = require('os')
const Anthropic     = require('@anthropic-ai/sdk')

const ROOT         = path.join(__dirname, '..')
const LOG_FILE     = path.join(ROOT, 'logs', 'reddit-agent.log')
const STATE_FILE   = path.join(ROOT, 'logs', 'reddit-state.json')
const SUBREDDIT    = 'bigsolevibes'
const SITE_URL     = 'https://bigsolevibes.com'

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── State ───────────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {}
  return { posts: [] }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function recordPost(state, entry) {
  state.posts.unshift(entry)
  if (state.posts.length > 30) state.posts = state.posts.slice(0, 30)
  saveState(state)
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) { log('Telegram not configured — skipping ping'); return }
  for (const parse_mode of ['Markdown', null]) {
    const body = { chat_id: chatId, text }
    if (parse_mode) body.parse_mode = parse_mode
    try {
      const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) return
      const isParseErr = data.description?.toLowerCase().includes('parse') ||
                         data.description?.toLowerCase().includes('entity')
      if (parse_mode && isParseErr) continue
      log(`WARNING: Telegram error — ${JSON.stringify(data)}`)
      return
    } catch (err) {
      log(`WARNING: Telegram fetch failed — ${err.message}`)
      return
    }
  }
}

// ─── Reddit API auth ─────────────────────────────────────────────────────────

async function getRedditToken() {
  const clientId     = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const username     = process.env.REDDIT_USERNAME
  const password     = process.env.REDDIT_PASSWORD

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD must be set in .env')
  }

  const creds  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body   = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    scope: 'submit',
  })

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'BSVBot/1.0 (+https://bigsolevibes.com)',
    },
    body: body.toString(),
  })

  if (!res.ok) throw new Error(`Reddit auth HTTP ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(`Reddit auth error: ${data.error}`)
  log(`Reddit API: authenticated as u/${username}`)
  return data.access_token
}

// ─── Reddit API post ─────────────────────────────────────────────────────────

async function postViaApi(token, title, body) {
  const params = new URLSearchParams({
    sr:       SUBREDDIT,
    kind:     'self',
    title,
    text:     body,
    resubmit: 'true',
    nsfw:     'false',
  })

  const res = await fetch('https://oauth.reddit.com/api/submit', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'BSVBot/1.0 (+https://bigsolevibes.com)',
    },
    body: params.toString(),
  })

  if (!res.ok) throw new Error(`Reddit submit HTTP ${res.status}`)
  const data = await res.json()

  const success = data?.json?.errors?.length === 0
  if (!success) {
    const errs = data?.json?.errors?.map(e => e.join(': ')).join('; ')
    throw new Error(`Reddit submit error: ${errs || JSON.stringify(data)}`)
  }

  const url    = data?.json?.data?.url
  const postId = data?.json?.data?.id
  if (!url) throw new Error('Reddit submit succeeded but no URL returned')

  log(`Posted via API → ${url}`)
  return { url, postId }
}

// ─── Puppeteer fallback ───────────────────────────────────────────────────────

async function postViaPuppeteer(title, body) {
  log('Falling back to Puppeteer browser automation...')

  let puppeteer
  try {
    puppeteer = require('puppeteer')
  } catch {
    throw new Error('puppeteer not installed — run: npm install puppeteer')
  }

  const username = process.env.REDDIT_USERNAME
  const password = process.env.REDDIT_PASSWORD
  if (!username || !password) throw new Error('REDDIT_USERNAME and REDDIT_PASSWORD required for Puppeteer fallback')

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page    = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36')

  try {
    // Login
    log('Puppeteer: navigating to Reddit login...')
    await page.goto('https://www.reddit.com/login/', { waitUntil: 'networkidle2', timeout: 30000 })
    await page.type('#loginUsername', username, { delay: 80 })
    await page.type('#loginPassword', password, { delay: 80 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button[type=submit]'),
    ])
    log('Puppeteer: logged in')

    // Submit form
    const submitUrl = `https://www.reddit.com/r/${SUBREDDIT}/submit`
    await page.goto(submitUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    // Title
    const titleSel = 'textarea[placeholder*="Title"], input[name="title"], [data-testid="post-title-textarea"]'
    await page.waitForSelector(titleSel, { timeout: 10000 })
    await page.click(titleSel)
    await page.type(titleSel, title, { delay: 50 })

    // Body
    const bodySel  = '[data-testid="post-body-textarea"], .public-DraftEditor-content, textarea[name="text"]'
    await page.waitForSelector(bodySel, { timeout: 10000 })
    await page.click(bodySel)
    await page.type(bodySel, body, { delay: 30 })

    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.click('button[type=submit]'),
    ])

    const finalUrl = page.url()
    log(`Puppeteer: posted → ${finalUrl}`)
    return { url: finalUrl, postId: null }
  } finally {
    await browser.close()
  }
}

// ─── Claude copy generation ───────────────────────────────────────────────────

async function generateCopy(day, context) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const systemPrompt = `You are the voice of Big Sole Vibes (BSV), a premium men's foot care brand.
The Proprietor's voice: statements not questions where possible. Deadpan, confident, slightly amused.
Never preachy. Never explains itself. Already made up his mind — inviting you to catch up.
BSV is not a foot care account. It's a men's lifestyle brand that happens to sell foot care.
The BSV Man: takes care of everything at a high standard. BSV's argument: feet are part of that standard.
r/bigsolevibes is the community space — no judgment, real conversations.`

  const typeMap = {
    mon: 'Weekly discussion starter. The subject is drawn from social intelligence below. Start the conversation — post title that stops mid-scroll, body 2–3 short paragraphs.',
    wed: 'Cross-post of the latest Sole Report article. Title references the article subject. Body is 1–2 sentences that make someone click, plus the article URL.',
    fri: 'End-of-week community engagement. "What worked this week?" energy — but in the Proprietor voice, not a generic check-in.',
  }

  const userPrompt = `Generate a Reddit post for r/${SUBREDDIT} — ${typeMap[day] || 'community post'}.

${context}

Return ONLY valid JSON:
{
  "title": "post title here",
  "body": "post body here"
}`

  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const raw = msg.content[0]?.text?.trim() || ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${raw.slice(0, 200)}`)
  return JSON.parse(jsonMatch[0])
}

// ─── Context loading ──────────────────────────────────────────────────────────

function loadSocialReport() {
  // Try local cache first, then Drive
  const tempDir = path.join(os.homedir(), 'tmp', 'bsv-social-listening')
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir)
      .filter(f => f.match(/^social-report-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse()
    if (files.length) {
      const p = path.join(tempDir, files[0])
      return { filename: files[0], content: fs.readFileSync(p, 'utf8') }
    }
  }
  // Try Drive
  try {
    const REMOTE = 'big sole vibes:Big Sole Vibes'
    const ls = execSync(`rclone ls "${REMOTE}/Reports"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const latest = ls.trim().split('\n')
      .map(l => l.trim().split(/\s+/).pop())
      .filter(f => f.match(/^social-report-\d{4}-\d{2}-\d{2}\.md$/))
      .sort().pop()
    if (latest) {
      const localPath = path.join(os.tmpdir(), latest)
      execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${os.tmpdir()}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
      return { filename: latest, content: fs.readFileSync(localPath, 'utf8') }
    }
  } catch {}
  return null
}

function loadLatestArticle() {
  const manifestPath = path.join(ROOT, 'public', 'sole-report', 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!manifest.length) return null
    const latest = manifest[0]
    return {
      title:   latest.title,
      excerpt: latest.excerpt,
      url:     `${SITE_URL}/sole-report/${latest.slug}`,
    }
  } catch { return null }
}

// ─── Post dispatcher ──────────────────────────────────────────────────────────

async function runScheduledPost(day) {
  log(`Scheduled run — day: ${day}`)
  let title, body

  if (day === 'mon') {
    const report = loadSocialReport()
    const context = report
      ? `## Social Intelligence Report (${report.filename})\n${report.content.slice(0, 1500)}`
      : '## No social report available — generate from recent men\'s lifestyle/grooming trends.'
    const copy = await generateCopy('mon', context)
    title = copy.title
    body  = copy.body

  } else if (day === 'wed') {
    const article = loadLatestArticle()
    const context = article
      ? `## Latest Sole Report Article\nTitle: ${article.title}\nExcerpt: ${article.excerpt}\nURL: ${article.url}`
      : '## No article found — write a post about premium foot care as part of the BSV standard.'
    const copy = await generateCopy('wed', context)
    title = copy.title
    body  = copy.body

  } else if (day === 'fri') {
    const copy = await generateCopy('fri', '## Friday community engagement — end of week.')
    title = copy.title
    body  = copy.body

  } else {
    throw new Error(`Unknown --day value: ${day}. Use mon, wed, or fri.`)
  }

  return { title, body }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  log('━━━ reddit-agent start ━━━')

  const args     = process.argv.slice(2)
  const dayIdx   = args.indexOf('--day')
  const postIdx  = args.indexOf('--post')
  const day      = dayIdx !== -1 ? args[dayIdx + 1]?.toLowerCase() : null
  const manualTitle = postIdx !== -1 ? args[postIdx + 1] : null
  const manualBody  = postIdx !== -1 ? args[postIdx + 2] : null

  if (!day && !manualTitle) {
    log('ERROR: no run mode specified. Use --day mon|wed|fri or --post "title" "body"')
    process.exit(1)
  }

  const state = loadState()

  let title, body
  if (manualTitle) {
    title = manualTitle
    body  = manualBody || ''
    log(`Manual post — title: "${title}"`)
  } else {
    try {
      const copy = await runScheduledPost(day)
      title = copy.title
      body  = copy.body
    } catch (err) {
      log(`ERROR: copy generation failed — ${err.message}`)
      process.exit(1)
    }
  }

  log(`Title: "${title}"`)
  log(`Body length: ${body.length} chars`)

  // Attempt API post, fall back to Puppeteer
  let postUrl, postId
  let usedPuppeteer = false
  try {
    const token = await getRedditToken()
    const result = await postViaApi(token, title, body)
    postUrl = result.url
    postId  = result.postId
  } catch (apiErr) {
    log(`API post failed: ${apiErr.message}`)
    log('Attempting Puppeteer fallback...')
    try {
      const result = await postViaPuppeteer(title, body)
      postUrl      = result.url
      postId       = result.postId
      usedPuppeteer = true
    } catch (puppErr) {
      log(`ERROR: Puppeteer fallback also failed — ${puppErr.message}`)
      log('━━━ reddit-agent failed ━━━\n')
      process.exit(1)
    }
  }

  const entry = {
    date:          new Date().toISOString(),
    day:           day || 'manual',
    title,
    url:           postUrl,
    post_id:       postId || null,
    via_puppeteer: usedPuppeteer,
  }
  recordPost(state, entry)
  log(`Recorded → logs/reddit-state.json`)

  await sendTelegram(
    `*Reddit* — r/${SUBREDDIT}\n` +
    `*"${title}"*\n` +
    `${postUrl}\n` +
    (usedPuppeteer ? '_Posted via browser (API fallback)_' : '_Posted via API_')
  )

  log('━━━ reddit-agent complete ━━━\n')
})()
