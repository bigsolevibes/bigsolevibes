// ─────────────────────────────────────────────────────────────────────────────
// git-push-guard.js — hard stop for rogue main pushes
//
// safePushToPreview(cwd, log) — push site content to preview/full-site.
//   Used by blog-agent, sync-shop, fetch-reddit. Triggers Cloudflare preview.
//
// safePushToPipeline(cwd, log) — push processed media to pipeline/media.
//   Used by resize-post only. Never triggers a Cloudflare Pages build.
//
// If something attempts to push to main, a Telegram alert fires and the
// calling script aborts.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()
const { execSync } = require('child_process')
const https        = require('https')
const os           = require('os')
const path         = require('path')

const TARGET = 'preview/full-site'

function sendTelegramAlert(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
  const req  = https.request({
    hostname: 'api.telegram.org',
    path:     `/bot${token}/sendMessage`,
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  })
  req.on('error', () => {})
  req.write(body)
  req.end()
}

// Throws if targetRef resolves to "main" — call before any push.
function assertNotMain(targetRef) {
  const normalized = (targetRef || '').replace(/^origin\//, '').replace(/^refs\/heads\//, '').trim()
  if (normalized === 'main') {
    const msg =
      `🚨 *BSV Pipeline — HARD STOP*\n\n` +
      `A script attempted to push directly to \`main\`.\n\n` +
      `Target: \`${targetRef}\`\n` +
      `Script: \`${process.argv[1]}\`\n\n` +
      `Push aborted. Only Big D promotes to main.`
    sendTelegramAlert(msg)
    throw new Error(`BLOCKED: direct push to main is not allowed. Target was: ${targetRef}`)
  }
}

// The one sanctioned pipeline push. All scripts must call this instead of raw execSync.
function safePushToPreview(cwd, log) {
  const logFn = log || console.log
  try {
    execSync(`git push origin HEAD:${TARGET}`, { cwd, stdio: 'pipe' })
    logFn(`Git: pushed → ${TARGET} → Cloudflare Pages deploy triggered`)
    return true
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message
    logFn(`ERROR: git push failed — ${msg}`)
    return false
  }
}

// Pipeline-only push — processed media goes here, never triggers Cloudflare.
// Uses a temp worktree + cherry-pick so the current branch is never touched.
// Only the single media commit just made on HEAD is replayed onto pipeline/media.
const PIPELINE_TARGET = 'pipeline/media'
function safePushToPipeline(cwd, log) {
  const logFn = log || console.log
  const worktreePath = path.join(os.tmpdir(), `bsv-pipeline-${Date.now()}`)
  try {
    const mediaCommit = execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' }).toString().trim()
    execSync(`git fetch origin ${PIPELINE_TARGET}`, { cwd, stdio: 'pipe' })
    execSync(`git worktree add "${worktreePath}" origin/${PIPELINE_TARGET}`, { cwd, stdio: 'pipe' })
    execSync(`git cherry-pick ${mediaCommit}`, { cwd: worktreePath, stdio: 'pipe' })
    execSync(`git push origin HEAD:${PIPELINE_TARGET}`, { cwd: worktreePath, stdio: 'pipe' })
    execSync(`git worktree remove "${worktreePath}" --force`, { cwd, stdio: 'pipe' })
    logFn(`Git: pushed → ${PIPELINE_TARGET} (pipeline/media — no Cloudflare build)`)
    return true
  } catch (err) {
    try { execSync(`git worktree remove "${worktreePath}" --force`, { cwd, stdio: 'pipe' }) } catch {}
    const msg = err.stderr?.toString().trim() || err.message
    logFn(`ERROR: git push failed — ${msg}`)
    return false
  }
}

module.exports = { safePushToPreview, safePushToPipeline, assertNotMain, sendTelegramAlert }
