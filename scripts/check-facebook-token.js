require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// check-facebook-token.js — one-off diagnostic: can META_ACCESS_TOKEN get a
// Page Access Token for META_PAGE_ID right now?
//
// Read-only. Does NOT post anything. Just runs the first step of
// postToFacebook() (distribute.js) in isolation — the Page token exchange —
// and prints the real response so we know whether this is a permissions/
// verification issue or something else, before touching PAUSED_PLATFORMS.
// Never prints token values.
//
// Usage: node scripts/check-facebook-token.js
// ─────────────────────────────────────────────────────────────────────────────

;(async function run() {
  const { META_ACCESS_TOKEN, META_PAGE_ID: RAW_PAGE_ID, META_APP_ID, META_APP_SECRET } = process.env
  const META_PAGE_ID = (RAW_PAGE_ID || '').trim()

  console.log(`META_ACCESS_TOKEN: ${META_ACCESS_TOKEN ? `present (${META_ACCESS_TOKEN.length} chars)` : 'MISSING'}`)
  console.log(`META_PAGE_ID:      ${META_PAGE_ID ? `present ("${META_PAGE_ID}")` : 'MISSING'}`)
  console.log(`META_APP_ID:       ${META_APP_ID ? 'present' : 'MISSING'}`)
  console.log(`META_APP_SECRET:   ${META_APP_SECRET ? 'present' : 'MISSING'}`)

  if (!META_ACCESS_TOKEN || !META_PAGE_ID) {
    console.log('\nCannot test — token or page id missing.')
    process.exit(1)
  }

  // Step 1: what is this token, and what can it do? (debug_token — safe, read-only)
  if (META_APP_ID && META_APP_SECRET) {
    try {
      const dbgUrl = `https://graph.facebook.com/debug_token?input_token=${META_ACCESS_TOKEN}&access_token=${META_APP_ID}|${META_APP_SECRET}`
      const dbgRes = await fetch(dbgUrl)
      const dbg    = await dbgRes.json()
      console.log('\n--- Token introspection (debug_token) ---')
      console.log(JSON.stringify(dbg.data ? {
        app_id: dbg.data.app_id,
        type: dbg.data.type,
        is_valid: dbg.data.is_valid,
        expires_at: dbg.data.expires_at ? new Date(dbg.data.expires_at * 1000).toISOString() : 'never',
        scopes: dbg.data.scopes,
        granular_scopes: dbg.data.granular_scopes,
      } : dbg, null, 2))
    } catch (err) {
      console.log(`\nToken introspection failed: ${err.message}`)
    }
  }

  // Step 2: can we exchange it for a Page Access Token? (the real question)
  try {
    const tokenUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}?fields=access_token,name&access_token=${META_ACCESS_TOKEN}`
    const res  = await fetch(tokenUrl)
    const data = await res.json()
    console.log('\n--- Page Access Token exchange ---')
    console.log(`HTTP status: ${res.status}`)
    if (data.error) {
      console.log(`Error: ${JSON.stringify(data.error, null, 2)}`)
    } else {
      console.log(`Success — page name: "${data.name}", access_token returned: ${data.access_token ? 'yes' : 'NO'}`)
    }
  } catch (err) {
    console.log(`\nPage token exchange FAILED (network level): ${err.message}`)
  }
})()
