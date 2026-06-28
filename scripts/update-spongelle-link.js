require('dotenv').config({ quiet: true })
const { google } = require('googleapis')
const fs = require('fs')
const path = require('path')

const ROOT = '/sessions/serene-friendly-dirac/mnt/bigsolevibes-web'
const SPONGELLE_AFFILIATE_URL = 'https://spongelle.com/SFGCP6TP'

async function run() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  const key = JSON.parse(fs.readFileSync(path.resolve("/sessions/serene-friendly-dirac/mnt/bigsolevibes-web", "gen-lang-client-0889892842-773d23cdfbb3.json"), 'utf8'))
  const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = process.env.SHEETS_PRODUCT_QUEUE_ID

  // Get all data to find Spongelle row and column positions
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sheet1' })
  const rows = res.data.values || []
  const headers = rows[0]

  const nameCol = headers.indexOf('Product Name')
  const affiliateLinkCol = headers.indexOf('Affiliate Link')
  const affiliateUrlCol = headers.indexOf('Affiliate_URL')
  const affiliateNetworkCol = headers.indexOf('Affiliate Network')

  console.log(`Headers found: name=${nameCol}, Affiliate Link=${affiliateLinkCol}, Affiliate_URL=${affiliateUrlCol}, Affiliate Network=${affiliateNetworkCol}`)

  // Find Spongelle rows
  const updates = []
  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][nameCol] || '').toLowerCase()
    if (name.includes('spongelle')) {
      console.log(`Found Spongelle at row ${i + 1}: "${rows[i][nameCol]}"`)
      
      // Update Affiliate Link column
      if (affiliateLinkCol >= 0) {
        const cell = `Sheet1!${colLetter(affiliateLinkCol + 1)}${i + 1}`
        updates.push({ range: cell, values: [[SPONGELLE_AFFILIATE_URL]] })
      }
      // Update Affiliate Network column
      if (affiliateNetworkCol >= 0) {
        const cell = `Sheet1!${colLetter(affiliateNetworkCol + 1)}${i + 1}`
        updates.push({ range: cell, values: [['Spongelle Direct']] })
      }
    }
  }

  if (updates.length === 0) {
    console.log('No Spongelle rows found in sheet')
    return
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data: updates }
  })
  console.log(`Updated ${updates.length} cells for Spongelle`)
}

function colLetter(n) {
  let s = ''
  while (n > 0) { const rem = (n-1)%26; s = String.fromCharCode(65+rem)+s; n=Math.floor((n-1)/26) }
  return s
}

run().catch(err => { console.error('ERROR:', err.message); process.exit(1) })
