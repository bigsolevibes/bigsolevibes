require('dotenv').config()

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

// ─────────────────────────────────────────────────────────────────────────────
// tiktok-auth.js — TikTok OAuth v2 flow
//
// Unlike youtube-auth.js, this does NOT spin up a localhost callback server.
// TikTok's redirect_uri must be a pre-registered HTTPS URL (no localhost), so
// the registered target is https://bigsolevibes.com/api/auth/tiktok/callback
// (app/api/auth/tiktok/callback/route.ts). That page holds no secrets — it just
// surfaces the one-time `code` and tells Big D the exact command to run here,
// where TIKTOK_CLIENT_SECRET actually lives.
//
// Usage:
//   node scripts/tiktok-auth.js                  — print + open the authorize URL
//   node scripts/tiktok-auth.js --code "abc123"   — exchange code for tokens, save
//   node scripts/tiktok-auth.js --refresh         — force-refresh using stored refresh_token
//
// Tokens are saved to config/tiktok-token.json (gitignored). access_token expires
// in ~24h; refresh_token expires in ~365h days per TikTok's docs — refresh_token
// also rotates on every refresh, so the file is always overwritten with the latest.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(__dirname, '..', 'config', 'tiktok-token.json')

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const codeArg      = getArg('--code')
const isRefresh     = args.includes('--refresh')
const redirectUri    = getArg('--redirect-uri') || 'https://bigsolevibes.com/api/auth/tiktok/callback'
// video.upload is enough for the draft/inbox posting flow (tiktok-post.js).
// video.publish (Direct Post) needs app audit approval — not used here.
const scope          = getArg('--scope') || 'user.info.basic,video.upload'

// ─── Config ──────────────────────────────────────────────────────────────────

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error('✗ Missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in .env')
  process.exit(1)
}

// ─── Token file I/O ──────────────────────────────────────────────────────────

function loadTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch {
    return null
  }
}

function saveTokenFile(data) {
  const payload = { ...data, obtained_at: new Date().toISOString() }
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(payload, null, 2))
  return payload
}

// ─── Token exchange / refresh ────────────────────────────────────────────────

async function exchangeCode(code) {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body:    new URLSearchParams({
      client_key:    CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    }).toString(),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    console.error(`\n[debug] HTTP ${res.status} · redirect_uri sent: ${redirectUri} · code length: ${code.length}`)
    console.error(`[debug] TikTok response: ${JSON.stringify(data)}`)
    throw new Error(`Token exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data
}

async function refreshAccessToken(refresh_token) {
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body:    new URLSearchParams({
      client_key:    CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token,
    }).toString(),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data
}

// getValidAccessToken() — for other scripts (tiktok-post.js) to require().
// Returns a usable access_token, auto-refreshing if expired or within 5 min of
// expiring. Throws with a clear message if no token is on file yet.
async function getValidAccessToken() {
  const stored = loadTokenFile()
  if (!stored?.access_token) {
    throw new Error('No TikTok token on file — run `node scripts/tiktok-auth.js` to authorize first')
  }

  const obtainedAt = new Date(stored.obtained_at).getTime()
  const expiresAt  = obtainedAt + (Number(stored.expires_in) || 0) * 1000
  const BUFFER_MS  = 5 * 60 * 1000

  if (Number.isFinite(expiresAt) && Date.now() < expiresAt - BUFFER_MS) {
    return stored.access_token
  }

  if (!stored.refresh_token) {
    throw new Error('Access token expired and no refresh_token on file — re-run `node scripts/tiktok-auth.js`')
  }

  const fresh = await refreshAccessToken(stored.refresh_token)
  const saved = saveTokenFile(fresh)
  return saved.access_token
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  ;(async () => {
    try {
      if (isRefresh) {
        const stored = loadTokenFile()
        if (!stored?.refresh_token) {
          console.error('✗ No refresh_token on file — run `node scripts/tiktok-auth.js` to authorize from scratch')
          process.exit(1)
        }
        console.log('Refreshing TikTok access token...')
        const fresh = saveTokenFile(await refreshAccessToken(stored.refresh_token))
        console.log(`\n✓ Refreshed — saved to ${path.relative(process.cwd(), TOKEN_FILE)}`)
        console.log(`  expires_in: ${fresh.expires_in}s (access) / ${fresh.refresh_expires_in}s (refresh)`)
        return
      }

      if (codeArg) {
        console.log('Exchanging authorization code for tokens...')
        const saved = saveTokenFile(await exchangeCode(codeArg))
        console.log(`\n✓ TikTok authorized — saved to ${path.relative(process.cwd(), TOKEN_FILE)}`)
        console.log(`  open_id:    ${saved.open_id}`)
        console.log(`  scope:      ${saved.scope}`)
        console.log(`  expires_in: ${saved.expires_in}s (access) / ${saved.refresh_expires_in}s (refresh)`)
        if (!saved.refresh_token) {
          console.warn('\n⚠ No refresh_token returned — re-run the full flow when the access token expires.')
        }
        return
      }

      // Default: build + open the authorize URL
      const state = crypto.randomBytes(12).toString('hex')
      const authUrl = 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
        client_key:    CLIENT_KEY,
        scope,
        response_type: 'code',
        redirect_uri:  redirectUri,
        state,
      }).toString()

      console.log('\nBig Sole Vibes — TikTok OAuth setup\n')
      console.log(`Redirect URI: ${redirectUri}`)
      console.log(`Scope:        ${scope}`)
      console.log(`State:        ${state}`)
      console.log('\nIf TikTok rejects the scope, enable it for this app in the TikTok')
      console.log('developer portal first, then re-run.\n')
      console.log('Opening browser for TikTok consent...\n')
      try {
        execSync(`open "${authUrl}"`)
      } catch {
        console.log('Could not open browser automatically. Paste this URL manually:\n')
      }
      console.log(authUrl + '\n')
      console.log('After you approve, TikTok redirects to the callback page, which shows')
      console.log('the exact command to run next, e.g.:\n')
      console.log('  node scripts/tiktok-auth.js --code "<code from page>"\n')
    } catch (err) {
      console.error(`\n✗ ${err.message}`)
      process.exit(1)
    }
  })()
}

module.exports = { getValidAccessToken, loadTokenFile, saveTokenFile, refreshAccessToken }
