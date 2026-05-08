require('dotenv').config()
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')

// Column order in BSV Product Queue sheet (A–H)
const HEADERS = [
  'Product Name',
  'Category',
  'ASIN',
  'Price',
  'Score',
  'Status',       // Pending / Approved / Rejected
  'Description',  // BSV voice — shown on shop card
  'Reasoning',    // why it qualified — for Big D's review context
]

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

// Ensure the header row exists. Idempotent — only writes if A1 is empty.
async function ensureHeaders({ sheets, spreadsheetId }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:H1',
  })
  const existing = (res.data.values || [])[0] || []
  if (existing[0] === HEADERS[0]) return  // already initialised
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1:H1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  })
}

// Returns every data row as an object keyed by header name.
// Skips the header row itself.
async function readAllRows({ sheets, spreadsheetId }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A:H',
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

// Appends a single pick row. Call after ensureHeaders.
async function appendPick({ sheets, spreadsheetId }, pick) {
  const row = [
    pick.name,
    pick.category,
    pick.asin,
    pick.price,
    pick.score,
    'Pending',
    pick.description,
    pick.reasoning,
  ]
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:H',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  })
}

module.exports = { HEADERS, connect, ensureHeaders, readAllRows, appendPick }
