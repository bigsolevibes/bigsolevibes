require('dotenv').config({ quiet: true })
const { connect, ensureHeaders, readAllRows } = require('./sheets-client')
;(async () => {
  const conn = await connect()
  await ensureHeaders(conn)
  const rows = await readAllRows(conn)
  const approved = rows.filter(r => (r['Status'] || '').trim().toLowerCase() === 'approved')
  console.log(`Total approved: ${approved.length}`)
  const seen = {}
  for (const r of approved) {
    const name = (r['Product Name'] || '').trim()
    seen[name] = (seen[name] || 0) + 1
  }
  const dupes = Object.entries(seen).filter(([, n]) => n > 1)
  if (dupes.length) {
    console.log('DUPLICATES:', dupes.map(([n, c]) => `"${n}" x${c}`).join(', '))
  } else {
    console.log('No duplicates found.')
  }
  console.log('\nAll approved products:')
  for (const r of approved) {
    console.log(` ${seen[r['Product Name'].trim()] > 1 ? '⚠ DUP' : '    '} | ${r['Product Name']} | ${r['Category']}`)
  }
})().catch(e => console.error('ERROR:', e.message))
