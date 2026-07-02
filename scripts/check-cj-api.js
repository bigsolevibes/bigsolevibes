require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// check-cj-api.js — one-off diagnostic: is the CJ commissions API reachable?
//
// Does exactly one thing: pings the same endpoint checkRevenue() (in
// chief-of-staff.js) hits, and prints the raw HTTP status + response body so
// we can see whether the 404 is a credential issue, a wrong website-id, or an
// endpoint that's moved. Never prints CJ_API_TOKEN or CJ_CID values.
//
// Usage: node scripts/check-cj-api.js
// ─────────────────────────────────────────────────────────────────────────────

;(async function run() {
  const cjToken = process.env.CJ_API_TOKEN
  const cjCid   = process.env.CJ_CID

  console.log(`CJ_API_TOKEN: ${cjToken ? `present (${cjToken.length} chars)` : 'MISSING'}`)
  console.log(`CJ_CID:       ${cjCid ? `present (${cjCid.length} chars)` : 'MISSING'}`)

  if (!cjToken || !cjCid) {
    console.log('Cannot test — one or both env vars missing.')
    process.exit(1)
  }

  const end   = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 7)
  const fmt = d => d.toISOString().slice(0, 19) + 'Z'

  // CJ's Commission Detail API is GraphQL now (REST v3 is retired — that's the
  // 404). Single endpoint for all queries: https://commissions.api.cj.com/query
  const url = 'https://commissions.api.cj.com/query'
  const query = `{publisherCommissions(forPublishers: ["${cjCid}"], sincePostingDate: "${fmt(start)}", beforePostingDate: "${fmt(end)}") { count payloadComplete records { actionTrackerName websiteName advertiserName postingDate pubCommissionAmountUsd } } }`

  console.log(`\nPOST ${url}`)
  console.log(`Query (CID redacted): ${query.replace(cjCid, '[CID-REDACTED]')}`)

  try {
    const res  = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${cjToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    })
    const body = await res.text()
    console.log(`\nHTTP status: ${res.status} ${res.statusText}`)
    console.log(`Response headers content-type: ${res.headers.get('content-type')}`)
    console.log(`\nResponse body (first 1500 chars):\n${body.slice(0, 1500)}`)
  } catch (err) {
    console.log(`\nFETCH FAILED (network/DNS level, not an HTTP error): ${err.message}`)
  }
})()
