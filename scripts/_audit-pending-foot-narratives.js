require('dotenv').config({ quiet: true })
const { connect, readAllRows } = require('./sheets-client')
;(async () => {
  const conn = await connect()
  const rows = await readAllRows(conn)
  const targets = [
    'Niegeloh Solingen Imantado TopInox Pedicure Set',
    'Margaret Dabbs Professional Foot File',
    'Edjy nail clipper',
    'FootLogix Pediceuticals Mousse',
    'Camillen 60 Fudes Healing Foot Cream',
  ]
  for (const t of targets) {
    const r = rows.find(row => (row['Product Name'] || '').trim() === t)
    if (!r) { console.log(`NOT FOUND: ${t}`); continue }
    console.log(`\n=== ${r['Product Name']} (${r['Status']}, ${r['Price']}) ===`)
    console.log('Narrative:', (r['Narrative'] || '(blank)').slice(0, 400))
    console.log('Reasoning:', (r['Reasoning'] || '(blank)').slice(0, 300))
  }
})().catch(e => console.error('ERROR:', e.message))
