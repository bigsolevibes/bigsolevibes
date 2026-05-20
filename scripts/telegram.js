require('dotenv').config()

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
      if (res.ok) return data
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

module.exports = { sendTelegram }
