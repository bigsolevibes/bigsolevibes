require('dotenv').config()

const fs   = require('fs')
const path = require('path')

const INBOX_STATE_FILE = path.join(__dirname, '..', 'logs', 'telegram-inbox-state.json')
const INBOX_LOG_FILE   = path.join(__dirname, '..', 'logs', 'telegram-inbox.log')

// sendTelegram(message) — fire-and-forget Telegram Bot API wrapper.
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env.
// Tries Markdown first; retries as plain text if Telegram rejects the formatting.
// Never throws — logs the error and returns undefined on failure.
async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  for (const parse_mode of ['Markdown', null]) {
    const body = { chat_id: chatId, text: message }
    if (parse_mode) body.parse_mode = parse_mode
    try {
      const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      // Telegram always returns HTTP 200; real success is data.ok === true
      if (data?.ok === true) return data.result  // {message_id, chat, date, ...}
      const isParseError = data.description?.toLowerCase().includes('parse') ||
                           data.description?.toLowerCase().includes('entity')
      if (parse_mode && isParseError) continue
      console.error(`[telegram] API error: ${JSON.stringify(data)}`)
      return
    } catch (err) {
      console.error(`[telegram] send failed: ${err.message}`)
      return
    }
  }
}

// fetchUpdates() — pulls new messages from the bot's update queue.
// Uses TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env.
// Persists last_update_id across calls so each message is returned exactly once.
// Logs all messages to telegram-inbox.log.
// Returns array of {update_id, message_id, text, date} for messages from TELEGRAM_CHAT_ID.
// Never throws — returns [] on any failure.
async function fetchUpdates() {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return []

  let state = { last_update_id: null }
  try {
    if (fs.existsSync(INBOX_STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(INBOX_STATE_FILE, 'utf8'))
    }
  } catch {}

  try {
    const params = new URLSearchParams({ limit: '100', timeout: '0' })
    if (state.last_update_id != null) params.set('offset', String(state.last_update_id + 1))

    const res  = await fetch(`https://api.telegram.org/bot${token}/getUpdates?${params}`)
    const data = await res.json()
    if (!data?.ok) {
      console.error(`[telegram] getUpdates API error: ${JSON.stringify(data)}`)
      return []
    }

    const updates = data.result || []
    if (!updates.length) return []

    // Advance offset so these are not returned again
    state.last_update_id = updates[updates.length - 1].update_id
    fs.mkdirSync(path.dirname(INBOX_STATE_FILE), { recursive: true })
    fs.writeFileSync(INBOX_STATE_FILE, JSON.stringify(state, null, 2))

    // Filter to messages from the configured chat only; log every incoming message
    const messages = []
    for (const u of updates) {
      const msg = u.message
      if (!msg) continue
      const fromChat = String(msg.chat?.id)
      const logLine  = `[${new Date().toISOString()}] update_id=${u.update_id} chat=${fromChat} text=${JSON.stringify(msg.text || '')}`
      fs.appendFileSync(INBOX_LOG_FILE, logLine + '\n')
      if (fromChat !== String(chatId)) continue
      messages.push({
        update_id:  u.update_id,
        message_id: msg.message_id,
        text:       (msg.text || '').trim(),
        date:       msg.date,
      })
    }
    return messages
  } catch (err) {
    console.error(`[telegram] fetchUpdates failed: ${err.message}`)
    return []
  }
}

// parseInboxKeyword(text) — maps a message to a canonical action keyword.
// Returns 'approved' | 'denied' | 'hold' | null.
function parseInboxKeyword(text) {
  const t = text.toLowerCase().trim()
  if (/\b(approved?|yes|yep|yeah|do it)\b/.test(t)) return 'approved'
  if (/\b(den(ied?)?|no|nope|skip|reject)\b/.test(t)) return 'denied'
  if (/\b(hold|later|wait|defer|tomorrow)\b/.test(t)) return 'hold'
  return null
}

module.exports = { sendTelegram, fetchUpdates, parseInboxKeyword }
