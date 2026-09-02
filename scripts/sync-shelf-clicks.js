require('dotenv').config()
const fs   = require('fs')
const path = require('path')

// Pulls shelf click counts down from Cloudflare KV into logs/shelf-clicks.json,
// which lib/dashboard/state-adapter.ts reads (unchanged) to show clicks per
// product on the local dashboard.
//
// Why this exists: functions/api/go/[key].ts (the click-through redirect,
// live on bigsolevibes.com) runs as a Cloudflare Pages Function — an edge
// Worker with no filesystem — so it can't write logs/shelf-clicks.json
// directly the way the old (broken, Next.js-route, never-actually-live)
// version did. It writes counts into a Cloudflare KV namespace instead; this
// script is the bridge that brings that data back down to the same local
// JSON file the dashboard already expects, on whatever schedule Big D wants
// (run manually, or wire into an existing cron/launchd job alongside
// sync-shop.js). Built 2026-09-01 alongside the KV-backed redirect function.
//
// Requires, in .env (from the Cloudflare dashboard — API Tokens page for the
// token, and Workers & Pages -> KV for the namespace ID):
//   CLOUDFLARE_ACCOUNT_ID
//   CLOUDFLARE_API_TOKEN        (needs "Workers KV Storage:Read" permission)
//   CLOUDFLARE_SHELF_CLICKS_KV_NAMESPACE_ID

const ACCOUNT_ID    = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN     = process.env.CLOUDFLARE_API_TOKEN
const NAMESPACE_ID  = process.env.CLOUDFLARE_SHELF_CLICKS_KV_NAMESPACE_ID
const CLICKS_FILE   = path.join(__dirname, '..', 'logs', 'shelf-clicks.json')
const API_BASE      = 'https://api.cloudflare.com/client/v4'

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

async function cfFetch(urlPath) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  })
  if (!res.ok) {
    throw new Error(`Cloudflare API ${urlPath} -> ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function listAllKeys() {
  const keys = []
  let cursor = null
  do {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const body = await cfFetch(
      `/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/keys${qs}`
    )
    keys.push(...body.result.map((k) => k.name))
    cursor = body.result_info?.cursor || null
  } while (cursor)
  return keys
}

async function getValue(key) {
  const res = await fetch(
    `${API_BASE}/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${API_TOKEN}` } }
  )
  if (!res.ok) return null
  return res.text()
}

async function main() {
  if (!ACCOUNT_ID || !API_TOKEN || !NAMESPACE_ID) {
    log('SKIP: missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / CLOUDFLARE_SHELF_CLICKS_KV_NAMESPACE_ID in .env — see header comment for where to get these.')
    process.exit(0)
  }

  const keys = await listAllKeys()
  log(`found ${keys.length} keys in SHELF_CLICKS_KV`)

  const counts = {}
  for (const key of keys) {
    const value = await getValue(key)
    const n = parseInt(value, 10)
    if (!Number.isNaN(n)) counts[key] = n
  }

  fs.mkdirSync(path.dirname(CLICKS_FILE), { recursive: true })
  fs.writeFileSync(CLICKS_FILE, JSON.stringify(counts, null, 2))
  log(`wrote ${Object.keys(counts).length} counts to ${CLICKS_FILE}`)
}

main().catch((err) => {
  log(`ERROR: ${err.message}`)
  process.exit(1)
})
