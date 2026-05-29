require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// promote-sole-report.js — promote one Sole Report article to main
//
// Usage: node scripts/promote-sole-report.js <slug>
//
// Checks out a temporary git worktree on main, copies the target MDX file
// from origin/preview/full-site into it, commits, and pushes to main.
// Never touches the current working branch. Never force-pushes.
// Cloudflare picks up the push to main and deploys automatically.
// ─────────────────────────────────────────────────────────────────────────────

const matter = require('gray-matter')
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { sendTelegram } = require('./telegram')

const ROOT         = path.join(__dirname, '..')
const LOG_FILE     = path.join(ROOT, 'logs', 'promote-sole-report.log')
const WORKTREE_DIR = path.join(os.tmpdir(), 'bsv-promote-main')
const TEMP_DIR     = path.join(os.tmpdir(), 'bsv-promote-sole-report')
const SITE_URL     = 'https://bigsolevibes.com'
const REMOTE       = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive context loaders ────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

async function loadMemory() {
  const { loadMemoryById } = require('./lib/memory')
  return loadMemoryById()
}

// ─── Worktree cleanup ─────────────────────────────────────────────────────────

function cleanupWorktree() {
  try {
    execSync(`git worktree remove --force "${WORKTREE_DIR}"`, { cwd: ROOT, stdio: 'pipe' })
    log('Worktree cleaned up')
  } catch {}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)
  log('Loading memory...')
  const memory = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const slug = process.argv[2]
  if (!slug) {
    console.error('Usage: node scripts/promote-sole-report.js <slug>')
    console.error('Example: node scripts/promote-sole-report.js groomed-from-the-neck-up')
    process.exit(1)
  }

  const mdxRelPath = `content/posts/${slug}.mdx`
  log(`━━━ promote-sole-report: ${slug} ━━━`)

  // ── Fetch latest remote state ──────────────────────────────────────────────

  log('Fetching origin...')
  try {
    execSync('git fetch origin', { cwd: ROOT, stdio: 'pipe' })
  } catch (err) {
    const msg = `git fetch failed: ${err.stderr?.toString().trim() || err.message}`
    log(`ERROR: ${msg}`)
    await sendTelegram(`✗ *BSV promote failed* — ${slug}\n${msg}`).catch(() => {})
    process.exit(1)
  }

  // ── Verify the file exists on preview/full-site ────────────────────────────

  log(`Verifying ${mdxRelPath} on origin/preview/full-site...`)
  try {
    execSync(`git cat-file -e "origin/preview/full-site:${mdxRelPath}"`, { cwd: ROOT, stdio: 'pipe' })
  } catch {
    const msg = `${mdxRelPath} not found on origin/preview/full-site`
    log(`ERROR: ${msg}`)
    await sendTelegram(`✗ *BSV promote failed* — ${slug}\n${msg}`).catch(() => {})
    process.exit(1)
  }

  // ── Read frontmatter for Telegram message ──────────────────────────────────

  let title = slug
  try {
    const raw = execSync(`git show "origin/preview/full-site:${mdxRelPath}"`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    const { data } = matter(raw)
    if (data.title) title = data.title
  } catch {
    log('WARNING: could not parse frontmatter — using slug as title')
  }
  log(`Title: "${title}"`)

  // ── Create worktree on main ────────────────────────────────────────────────

  cleanupWorktree()  // clear any leftover from a previous failed run

  log('Creating worktree on origin/main...')
  try {
    execSync(`git worktree add "${WORKTREE_DIR}" origin/main`, { cwd: ROOT, stdio: 'pipe' })
  } catch (err) {
    const msg = `git worktree add failed: ${err.stderr?.toString().trim() || err.message}`
    log(`ERROR: ${msg}`)
    await sendTelegram(`✗ *BSV promote failed* — ${slug}\n${msg}`).catch(() => {})
    process.exit(1)
  }

  try {
    // ── Copy file from preview/full-site into the worktree ───────────────────

    const fileContent = execSync(`git show "origin/preview/full-site:${mdxRelPath}"`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    })

    fs.mkdirSync(path.join(WORKTREE_DIR, 'content', 'posts'), { recursive: true })
    fs.writeFileSync(path.join(WORKTREE_DIR, mdxRelPath), fileContent)

    // ── Check whether anything actually changed ───────────────────────────────

    const status = execSync('git status --porcelain', {
      cwd: WORKTREE_DIR, encoding: 'utf8', stdio: 'pipe',
    }).trim()

    if (!status) {
      log(`${slug} is already identical on main — nothing to promote`)
      await sendTelegram(
        `ℹ️ *BSV promote* — ${slug} is already live on main. No changes.`
      ).catch(() => {})
      return
    }

    // ── Commit ────────────────────────────────────────────────────────────────

    execSync(`git add "${mdxRelPath}"`, { cwd: WORKTREE_DIR, stdio: 'pipe' })
    execSync(`git commit -m "promote: sole-report ${slug}"`, { cwd: WORKTREE_DIR, stdio: 'pipe' })
    log(`Committed: promote: sole-report ${slug}`)

    // ── Push to main (no --force, ever) ───────────────────────────────────────

    log('Pushing to main...')
    try {
      execSync('git push origin HEAD:main', { cwd: WORKTREE_DIR, stdio: 'pipe' })
    } catch (err) {
      const msg = err.stderr?.toString().trim() || err.message
      log(`ERROR: push to main failed — ${msg}`)
      await sendTelegram(
        `✗ *BSV promote failed* — ${slug}\nPush rejected: ${msg}\n\nRun \`git fetch origin && git push origin HEAD:main\` from the worktree if this was a timing conflict.`
      ).catch(() => {})
      process.exit(1)
    }

    log(`Pushed → main`)
    log(`Live at: ${SITE_URL}/sole-report/${slug}`)

    await sendTelegram(
      `✅ *${title}* is live on ${SITE_URL}/sole-report/${slug}`
    ).catch(() => {})

    log(`━━━ promote-sole-report complete ━━━\n`)

  } finally {
    cleanupWorktree()
  }
})()
