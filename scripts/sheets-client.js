require('dotenv').config()
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')

// Canonical field list. On a new sheet these become columns A–K in this order.
// On an existing sheet, ensureHeaders only appends columns that are absent —
// it never reorders, so existing data stays clean.
const HEADERS = [
  'Product Name',
  'ASIN',
  'Category',
  'Description',   // One sentence, BSV voice — shown on shop card
  'Narrative',     // 80–120 words, Proprietor voice, scene not description. [DRAFT] prefix until reviewed.
  'Score',
  'Status',        // Pending / Approved / Rejected
  'Brand Story',   // 2–3 sentence brand narrative — used by Sole Report for editorial context
  'Price',
  'Reasoning',     // Proprietor's Audit — why it qualified, for Big D's review context
  'Locker Image',  // public image URL for the locker card hero (legacy)
  'Image_URL',     // official brand image URL or NEEDS_RENDER (triggers BSV render pipeline)
]

// 1-indexed column number → letter(s) (A, B, …, Z, AA, …)
function colLetter(n) {
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

async function connect() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_PATH not set in .env')

  const key = JSON.parse(fs.readFileSync(path.resolve(keyPath), 'utf8'))

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const sheets = google.sheets({ version: 'v4', auth })

  const spreadsheetId = process.env.SHEETS_PRODUCT_QUEUE_ID
  if (!spreadsheetId) throw new Error('SHEETS_PRODUCT_QUEUE_ID not set in .env')

  return { sheets, spreadsheetId }
}

// Ensure all canonical headers exist in row 1.
// New sheet: writes the full HEADERS list starting at A1.
// Existing sheet: appends only the columns that are absent — never reorders.
async function ensureHeaders({ sheets, spreadsheetId }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:Z1',
  })
  const existing = (res.data.values || [])[0] || []

  if (!existing.length || existing[0] !== 'Product Name') {
    // New or blank sheet — write full canonical header set
    const endCol = colLetter(HEADERS.length)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A1:${endCol}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    })
    return
  }

  // Existing sheet — only append columns that are not already present
  const missing = HEADERS.filter(h => !existing.includes(h))
  if (!missing.length) return

  for (let i = 0; i < missing.length; i++) {
    const col = colLetter(existing.length + i + 1)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!${col}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[missing[i]]] },
    })
  }
}

// Returns every data row as an object keyed by header name.
// Skips the header row itself.
async function readAllRows({ sheets, spreadsheetId }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A:Z',
  })
  const rows = res.data.values || []
  if (rows.length < 2) return []

  const headers = rows[0]
  return rows.slice(1).map(row => {
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim() })
    return obj
  })
}

// Appends a single pick row. Reads the live header row to determine column
// positions — safe regardless of whether columns have been reordered or added.
// Pass { status: 'Approved' } as the third argument to override the default 'Pending'.
async function appendPick({ sheets, spreadsheetId }, pick, { status = 'Pending' } = {}) {
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:Z1',
  })
  const headers = (headerRes.data.values || [])[0] || []

  const fieldMap = {
    'Product Name': pick.name        || '',
    'ASIN':         pick.asin        || '',
    'Category':     pick.category    || '',
    'Description':  pick.description || '',
    'Narrative':    pick.narrative   || '',
    'Score':        pick.score       || '',
    'Status':       status,
    'Brand Story':  pick.brand_story || '',
    'Price':        pick.price       || '',
    'Reasoning':    pick.reasoning   || '',
    'Locker Image': pick.lockerImage || '',
    'Image_URL':    pick.imageUrl    || '',
  }

  const row = headers.map(h => fieldMap[h] ?? '')

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:Z',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  })
}

module.exports = { HEADERS, connect, ensureHeaders, readAllRows, appendPick }
