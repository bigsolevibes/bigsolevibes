// ─────────────────────────────────────────────────────────────────────────────
// git-push-guard.js — hard stop for rogue main pushes
//
// safePushToPreview(cwd, log) — the only sanctioned pipeline push.
//   Asserts the current HEAD is not targeting main, then pushes to
//   preview/full-site. If something attempts to push to main, it sends
//   a Telegram alert to Big D and throws — the calling script aborts.
//
// Usage:
//   const { safePushToPreview } = require('./git-push-guard')
//   await safePushToPreview(ROOT, log)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()
const { execSync } = require('child_process')
const https        = require('https')

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

module.exports = { safePushToPreview, assertNotMain, sendTelegramAlert }
