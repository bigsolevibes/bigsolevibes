require('dotenv').config({ quiet: true })
const { connect, readAllRows } = require('./sheets-client')
;(async () => {
  const conn = await connect()
  const rows = await readAllRows(conn)
  console.log(`Total rows: ${rows.length}`)

  const footKeywords = /nail|pedicure|clipper|foot|sole|callus|file|buffer|scrub|sock/i
  const footRows = rows.filter(r =>
    footKeywords.test(r['Product Name'] || '') || footKeywords.test(r['Category'] || '')
  )
  console.log(`\nFoot/nail-related rows (any status): ${footRows.length}`)
  for (const r of footRows) {
    console.log(` - "${r['Product Name']}" | Category: ${r['Category']} | Status: ${r['Status']} | Price: ${r['Price']}`)
  }

  console.log('\nStatus breakdown:')
  const statusCount = {}
  for (const r of rows) {
    const s = (r['Status'] || '(blank)').trim()
    statusCount[s] = (statusCount[s] || 0) + 1
  }
  for (const [s, c] of Object.entries(statusCount)) console.log(`  ${s}: ${c}`)

  console.log('\nCategory breakdown (Approved only):')
  const catCount = {}
  for (const r of rows.filter(r => (r['Status']||'').trim() === 'Approved')) {
    const c = (r['Category'] || '(blank)').trim()
    catCount[c] = (catCount[c] || 0) + 1
  }
  for (const [c, n] of Object.entries(catCount)) console.log(`  ${c}: ${n}`)
})().catch(e => console.error('ERROR:', e.message))
