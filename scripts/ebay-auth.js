require('dotenv').config()

const fs   = require('fs')
const path = require('path')

// ─────────────────────────────────────────────────────────────────────────────
// ebay-auth.js — eBay OAuth (Authorization Code Grant) flow, User access token
//
// Same shape as tiktok-auth.js: no localhost callback server. eBay's OAuth
// redirect target is a "RuName" (a custom identifier eBay generates, not a
// literal URL) configured in the Developer Portal under Application Keys ->
// User Tokens, with Auth Accepted URL pointed at
// https://bigsolevibes.com/api/auth/ebay/callback (app/api/auth/ebay/callback/
// page.tsx — same no-secrets client-side pattern as the TikTok callback).
//
// Sandbox vs Production is selected with --env (defaults to sandbox, since
// that's the only keyset with real values as of 2026-09-01 — see
// EBAY_PROD_* being present-but-empty in .env until Big D creates that
// keyset in the portal and completes its account-deletion-notification
// compliance step).
//
// Usage:
//   node scripts/ebay-auth.js                      — print + open the sandbox authorize URL
//   node scripts/ebay-auth.js --env prod            — same, for production
//   node scripts/ebay-auth.js --code "abc123"       — exchange code for tokens, save (sandbox)
//   node scripts/ebay-auth.js --code "abc123" --env prod
//   node scripts/ebay-auth.js --refresh             — force-refresh using stored refresh_token
//
// Tokens saved to config/ebay-token.json (gitignored, one file covers both
// environments, keyed by env). access_token expires in ~2h; refresh_token is
// long-lived (~547 days per eBay's docs) and does NOT rotate on refresh
// (unlike TikTok's), so it does not need to be re-obtained via this
// authorize-URL flow every time — only the first time per environment, or if
// the seller ever revokes access.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(__dirname, '..', 'config', 'ebay-token.json')
const REDIRECT_URI = process.env.EBAY_RUNAME || '' // the RuName value from the Developer Portal, not a URL

// Base scope is always required; sell.inventory covers the listing-creation
// calls ebay-lister.js's phase 2 needs (createOrReplaceInventoryItem,
// createOffer, publishOffer). Add more scopes here later if a specific call
// comes back with an insufficient-permissions error naming one.
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
].join(' ')

const ENDPOINTS = {
  sandbox: {
    authorize: 'https://auth.sandbox.ebay.com/oauth2/authorize',
    token:     'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
  },
  prod: {
    authorize: 'https://auth.ebay.com/oauth2/authorize',
    token:     'https://api.ebay.com/identity/v1/oauth2/token',
  },
}

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const codeArg   = getArg('--code')
const isRefresh = args.includes('--refresh')
const env       = getArg('--env') || 'sandbox'

if (!ENDPOINTS[env]) {
  console.error(`✗ Unknown --env "${env}" — must be "sandbox" or "prod"`)
  process.exit(1)
}

const APP_ID  = process.env[`EBAY_${env.toUpperCase()}_APP_ID`]
const CERT_ID = process.env[`EBAY_${env.toUpperCase()}_CERT_ID`]

if (!APP_ID || !CERT_ID) {
  console.error(`✗ Missing EBAY_${env.toUpperCase()}_APP_ID / EBAY_${env.toUpperCase()}_CERT_ID in .env`)
  process.exit(1)
}

// ─── Token file I/O — { sandbox: {...}, prod: {...} } ───────────────────────

function loadTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveTokenForEnv(envName, data) {
  const all = loadTokenFile()
  all[envName] = { ...data, obtained_at: new Date().toISOString() }
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(all, null, 2))
  return all[envName]
}

// ─── Token exchange / refresh ────────────────────────────────────────────────

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${APP_ID}:${CERT_ID}`).toString('base64')
}

async function exchangeCode(code) {
  const res = await fetch(ENDPOINTS[env].token, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    console.error(`\n[debug] HTTP ${res.status} · env: ${env} · redirect_uri (RuName) sent: ${REDIRECT_URI}`)
    console.error(`[debug] eBay response: ${JSON.stringify(data)}`)
    throw new Error(`Token exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data
}

async function refreshAccessToken(refresh_token) {
  const res = await fetch(ENDPOINTS[env].token, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token,
      scope:         SCOPES,
    }).toString(),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data
}

// getValidAccessToken(envName) — for other scripts (the phase-2 listing
// creation script) to require(). Refreshes automatically if the stored
// access_token is expired or close to it; throws if no token exists yet for
// that environment (meaning the authorize flow below hasn't been run).
async function getValidAccessToken(envName = 'sandbox') {
  const all   = loadTokenFile()
  const entry = all[envName]
  if (!entry) {
    throw new Error(`No eBay token stored for env "${envName}" — run: node scripts/ebay-auth.js --env ${envName}`)
  }

  const obtainedAt = new Date(entry.obtained_at).getTime()
  const expiresAt  = obtainedAt + (entry.expires_in * 1000)
  const bufferMs   = 5 * 60 * 1000 // refresh 5 min early

  if (Date.now() < expiresAt - bufferMs) {
    return entry.access_token
  }

  if (!entry.refresh_token) {
    throw new Error(`eBay access token for "${envName}" expired and no refresh_token stored — re-run the authorize flow: node scripts/ebay-auth.js --env ${envName}`)
  }

  // Temporarily point module-level `env` at the right environment for the
  // refresh call's endpoint/credential lookup — getValidAccessToken() can be
  // called for either env regardless of which --env this process started with.
  const refreshed = await refreshAccessToken(entry.refresh_token)
  // eBay does not rotate refresh_token on refresh — keep the original.
  saveTokenForEnv(envName, { ...refreshed, refresh_token: refreshed.refresh_token || entry.refresh_token })
  return refreshed.access_token
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

async function main() {
  if (isRefresh) {
    const all   = loadTokenFile()
    const entry = all[env]
    if (!entry?.refresh_token) {
      console.error(`✗ No stored refresh_token for env "${env}" — run the authorize flow first`)
      process.exit(1)
    }
    const data = await refreshAccessToken(entry.refresh_token)
    saveTokenForEnv(env, { ...data, refresh_token: data.refresh_token || entry.refresh_token })
    console.log(`✓ Refreshed ${env} access token — expires in ${data.expires_in}s`)
    return
  }

  if (codeArg) {
    if (!REDIRECT_URI) {
      console.error('✗ EBAY_RUNAME not set in .env — this must exactly match the RuName from the Developer Portal (not a URL, the RuName identifier itself)')
      process.exit(1)
    }
    const data = await exchangeCode(codeArg)
    saveTokenForEnv(env, data)
    console.log(`✓ eBay ${env} token saved to config/ebay-token.json`)
    console.log(`  access_token expires in ${data.expires_in}s, refresh_token expires in ${data.refresh_token_expires_in}s`)
    return
  }

  // No args — print the authorize URL to visit.
  if (!REDIRECT_URI) {
    console.error('✗ EBAY_RUNAME not set in .env yet — create the RuName in the Developer Portal first (Application Keys -> User Tokens), then add EBAY_RUNAME=<the RuName value> to .env before running this.')
    process.exit(1)
  }

  const url = new URL(ENDPOINTS[env].authorize)
  url.searchParams.set('client_id', APP_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)

  console.log(`\nOpen this URL, log in with your ${env === 'sandbox' ? 'eBay SANDBOX test user' : 'real eBay seller account'}, and grant access:\n`)
  console.log(url.toString())
  console.log(`\nAfter granting access you'll land on the eBay callback page with the exact command to run next.`)
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`)
  process.exit(1)
})

module.exports = { getValidAccessToken }
