require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// fetch-reddit.js — pulls r/bigsolevibes Atom RSS, writes public/community/threads.json
//
// Runs daily at 9:00AM via launchd (after chief-of-staff at 8AM).
// Commits the JSON if changed and pushes to preview/full-site so
// Cloudflare Pages re-deploys with fresh thread data.
// The Lounge page client-fetches /community/threads.json at runtime.
// ─────────────────────────────────────────────────────────────────────────────

const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')

const ROOT       = path.join(__dirname, '..')
const LOG_FILE   = path.join(ROOT, 'logs', 'fetch-reddit.log')
const OUT_FILE   = path.join(ROOT, 'public', 'community', 'threads.json')
const RSS_URL    = 'https://www.reddit.com/r/bigsolevibes/.rss'
const USER_AGENT = 'BSVBot/1.0 (+https://bigsolevibes.com; RSS reader)'

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? decodeHtml(m[1].trim()) : ''
}

function parseEntries(xml) {
  const entries = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi
  let match
  while ((match = entryRe.exec(xml)) !== null) {
    const chunk = match[1]

    const title = extractTag(chunk, 'title')
    if (!title) continue

    const authorMatch = chunk.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)
    const author = authorMatch ? decodeHtml(authorMatch[1].trim()) : 'unknown'

    // Atom link: <link rel="alternate" href="..." />
    const linkMatch = chunk.match(/<link[^>]+href="([^"]+)"/)
    const url = linkMatch ? linkMatch[1] : ''
    if (!url) continue

    const published = extractTag(chunk, 'published') || extractTag(chunk, 'updated')

    // Reddit score is in a media/score-like namespace element
    const scoreMatch = chunk.match(/<[^>:]*:score[^>]*>(\d+)</) ||
                       chunk.match(/score[^>]*>(\d+)</)
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0

    // Strip HTML from content for a plain-text summary
    const content = extractTag(chunk, 'content')
    const summary = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220) || null

    entries.push({ title, author, url, published, score, summary })
  }
  return entries
}

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  log('━━━ fetch-reddit start ━━━')

  let xml
  try {
    const res = await fetch(RSS_URL, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    xml = await res.text()
    log(`Feed fetched — ${xml.length} bytes`)
  } catch (err) {
    log(`ERROR: fetch failed — ${err.message}`)
    log('━━━ fetch-reddit failed ━━━\n')
    process.exit(1)
  }

  const posts = parseEntries(xml)
  log(`Parsed ${posts.length} post(s)`)

  const output = {
    subreddit:     'r/bigsolevibes',
    subreddit_url: 'https://www.reddit.com/r/bigsolevibes/',
    fetched_at:    new Date().toISOString(),
    post_count:    posts.length,
    posts,
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2))
  log('Written: public/community/threads.json')

  // Commit and push if changed
  try {
    execSync('git add public/community/threads.json', { cwd: ROOT, stdio: 'pipe' })
    const status = execSync(
      'git status --porcelain public/community/threads.json',
      { cwd: ROOT, encoding: 'utf8' }
    ).trim()
    if (!status) {
      log('git: threads.json unchanged — no commit needed')
    } else {
      execSync(
        `git commit -m "chore: refresh r/bigsolevibes threads — ${posts.length} post(s)"`,
        { cwd: ROOT, stdio: 'pipe' }
      )
      require('./git-push-guard').safePushToPreview(ROOT, log)
    }
  } catch (gitErr) {
    log(`WARNING: git step failed — ${gitErr.message}`)
  }

  log('━━━ fetch-reddit complete ━━━\n')
})()
