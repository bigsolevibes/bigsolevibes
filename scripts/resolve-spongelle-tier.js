require('dotenv').config({ quiet: true })
const { google } = require('googleapis')
const fs = require('fs')
const path = require('path')

const TARGET_ASINS = ['B0G1N5417Z', 'B0GSCVLHY4']
const NOTE = "Tier resolved 2026-06-17 (Big D + Big C): keep both in queue. Price stays $14-28 (Entry/Standard), but positioning stays full aspirational/inventive voice -- same head-to-toe ritual treatment as the nail kit and pedicure tools, not a downgraded 'honest/cheap' tone. Affordability is not a reason to write plainer copy."

async function run() {
  const key = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'gen-lang-client-0889892842-773d23cdfbb3.json'), 'utf8'))
  const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = process.env.SHEETS_PRODUCT_QUEUE_ID

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' })
  const rows = res.data.values || []
  const headers = rows[0]

  const asinCol = headers.indexOf('ASIN')
  const nameCol = headers.indexOf('Product Name')
  const notesCol = headers.indexOf("Proprietor's Notes")

  console.log(`Headers: ASIN=${asinCol}, Product Name=${nameCol}, Proprietor's Notes=${notesCol}`)

  const updates = []
  for (let i = 1; i < rows.length; i++) {
    const asin = (rows[i][asinCol] || '').trim()
    if (TARGET_ASINS.includes(asin)) {
      console.log(`Found row ${i + 1}: "${rows[i][nameCol]}" (ASIN ${asin})`)
      if (notesCol >= 0) {
        const cell = `Sheet1!${colLetter(notesCol + 1)}${i + 1}`
        updates.push({ range: cell, values: [[NOTE]] })
      }
    }
  }

  if (updates.length === 0) {
    console.log('No matching rows found')
    return
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: updates }
  })
  console.log(`Updated ${updates.length} cells`)
}

function colLetter(n) {
  let s = ''
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26) }
  return s
}

run().catch(err => { console.error('ERROR:', err.message); process.exit(1) })
