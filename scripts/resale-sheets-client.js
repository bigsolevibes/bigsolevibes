require('dotenv').config()
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')

// Sheets client for the BSV Resale/eBay listings sheet — separate spreadsheet
// and schema from sheets-client.js's shop product queue (different domain:
// thrift-sourced resale inventory, not BSV's own shop products). Mirrors that
// file's connect/ensureHeaders/append pattern so both share one auth style
// (GOOGLE_SERVICE_ACCOUNT_PATH). See SHEETS_RESALE_LISTINGS_ID in .env.
// Built 2026-09-01 for scripts/ebay-lister.js.

const HEADERS = [
  'Item',              // short human label, e.g. "Nike Air Max 90"
  'Source Store',
  'Cost',
  'Condition Notes',   // Big D's own notes from notes.txt, verbatim
  'eBay Title',        // Claude-drafted, <=80 chars (eBay's title limit)
  'Brand',
  'Size',
  'Color',
  'Item Condition',    // eBay-style condition wording (e.g. "Pre-owned - Good")
  'Category',          // suggested eBay category
  'Description',
  'Suggested Price',
  'Price Reasoning',
  'Status',            // Draft / Reviewed / Posted / Sold / Archived
  'Photos',            // filenames included in the draft, for reference
  'Drive Folder',      // link to the archived Resale Inbox/Processed item folder
  'eBay Listing URL',  // filled in manually today; phase-2 auto-post writes here
]

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

  const spreadsheetId = process.env.SHEETS_RESALE_LISTINGS_ID
  if (!spreadsheetId) throw new Error('SHEETS_RESALE_LISTINGS_ID not set in .env')

  return { sheets, spreadsheetId }
}

// Ensure all canonical headers exist in row 1. New/blank sheet: writes the
// full set. Existing sheet: only appends columns that are absent, never
// reorders — same contract as sheets-client.js's ensureHeaders.
async function ensureHeaders({ sheets, spreadsheetId }) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:Z1',
  })
  const existing = (res.data.values || [])[0] || []

  if (!existing.length || existing[0] !== 'Item') {
    const endCol = colLetter(HEADERS.length)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!A1:${endCol}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    })
    return
  }

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

// Appends one drafted listing row. Reads the live header row to determine
// column positions, same safety contract as sheets-client.js's appendPick.
async function appendListing({ sheets, spreadsheetId }, listing) {
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:Z1',
  })
  const headers = (headerRes.data.values || [])[0] || []

  const fieldMap = {
    'Item':             listing.item           || '',
    'Source Store':     listing.sourceStore     || '',
    'Cost':             listing.cost            || '',
    'Condition Notes':  listing.conditionNotes  || '',
    'eBay Title':       listing.title           || '',
    'Brand':            listing.brand           || '',
    'Size':             listing.size            || '',
    'Color':            listing.color           || '',
    'Item Condition':   listing.itemCondition   || '',
    'Category':         listing.category        || '',
    'Description':      listing.description     || '',
    'Suggested Price':  listing.suggestedPrice  || '',
    'Price Reasoning':  listing.priceReasoning  || '',
    'Status':           listing.status          || 'Draft',
    'Photos':           listing.photos          || '',
    'Drive Folder':     listing.driveFolder     || '',
    'eBay Listing URL': listing.ebayListingUrl  || '',
  }

  const row = headers.map(h => fieldMap[h] ?? '')

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:Z',
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  })
}

// Updates specific columns of one existing row (1-indexed among data rows,
// i.e. rowIndex 0 is the first row under the header — same indexing
// readAllRows()'s returned array uses). Only touches the columns present in
// `fields` (by header name), leaves everything else in that row alone.
// Added 2026-09-02 for ebay-list-publish.js to write back Status/eBay
// Listing URL after a successful publish, without needing to know column
// letters (looks them up from the live header row, same safety contract as
// appendListing/ensureHeaders).
async function updateRowFields({ sheets, spreadsheetId }, rowIndex, fields) {
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A1:Z1',
  })
  const headers = (headerRes.data.values || [])[0] || []
  const sheetRow = rowIndex + 2 // +1 for header row, +1 for 1-indexing

  const data = Object.entries(fields).map(([headerName, value]) => {
    const colIndex = headers.indexOf(headerName)
    if (colIndex === -1) throw new Error(`updateRowFields: unknown column "${headerName}" — not in sheet header row`)
    return {
      range: `Sheet1!${colLetter(colIndex + 1)}${sheetRow}`,
      values: [[value]],
    }
  })

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  })
}

module.exports = { HEADERS, connect, ensureHeaders, readAllRows, appendListing, updateRowFields }
