const http = require('http')
const path = require('path')
const fs   = require('fs')
const { execSync } = require('child_process')

const ROOT         = path.join(__dirname)
const SECRET_FILE  = path.join(ROOT, 'config', 'youtube-credentials.json')
const TOKEN_FILE   = path.join(ROOT, 'config', 'youtube-token.json')
const PORT         = 3456
const REDIRECT_URI = `http://localhost:${PORT}`
const SCOPES       = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
].join(' ')

// ─── Load credentials ─────────────────────────────────────────────────────────

if (!fs.existsSync(SECRET_FILE)) {
  console.error(`✗ Not found: ${SECRET_FILE}`)
  console.error('  Download from Google Cloud Console → Credentials → your OAuth client → Download JSON')
  console.error(`  Save it as ${SECRET_FILE}`)
  process.exit(1)
}

let raw
try {
  raw = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'))
} catch (err) {
  console.error(`✗ Failed to parse ${SECRET_FILE}: ${err.message}`)
  process.exit(1)
}

const creds = raw.installed || raw.web
if (!creds) {
  console.error('✗ Unexpected credentials format — expected "installed" or "web" key')
  process.exit(1)
}

const {
  client_id,
  client_secret,
  token_uri = 'https://oauth2.googleapis.com/token',
} = creds

if (!client_id || !client_secret) {
  console.error('✗ client_id or client_secret missing from credentials file')
  process.exit(1)
}

// ─── Build auth URL ───────────────────────────────────────────────────────────

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id,
  redirect_uri:  REDIRECT_URI,
  response_type: 'code',
  scope:         SCOPES,
  access_type:   'offline',
  prompt:        'consent',  // mandatory — forces Google to issue a new refresh token
}).toString()

// ─── Local callback server ────────────────────────────────────────────────────

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url   = new URL(req.url, REDIRECT_URI)
      const code  = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h2>Authorization denied.</h2><p>You can close this tab.</p>')
        server.close()
        reject(new Error(`OAuth error: ${error}`))
        return
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h2>Authorization complete.</h2><p>You can close this tab and return to the terminal.</p>')
        server.close()
        resolve(code)
      }
    })

    server.listen(PORT, () => {
      console.log(`Listening on http://localhost:${PORT} for OAuth callback...\n`)
    })

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${PORT} is already in use — stop any other process using it and retry`))
      } else {
        reject(err)
      }
    })
  })
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCode(code) {
  const res = await fetch(token_uri, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: REDIRECT_URI,
      grant_type:   'authorization_code',
    }).toString(),
  })

  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data
}

// ─── Run ──────────────────────────────────────────────────────────────────────

;(async () => {
  console.log('\nBig Sole Vibes — YouTube reauth\n')
  console.log(`Make sure http://localhost:${PORT} is listed as an authorized redirect URI`)
  console.log('in Google Cloud Console → APIs & Services → Credentials → your OAuth client.\n')

  try {
    execSync(`open "${authUrl}"`)
  } catch {
    console.log('Could not open browser automatically. Open this URL manually:\n')
    console.log(authUrl + '\n')
  }

  let code
  try {
    code = await waitForCode()
  } catch (err) {
    console.error(`\n✗ ${err.message}`)
    process.exit(1)
  }

  console.log('✓ Callback received — exchanging code for tokens...')

  let tokens
  try {
    tokens = await exchangeCode(code)
  } catch (err) {
    console.error(`\n✗ ${err.message}`)
    process.exit(1)
  }

  if (!tokens.refresh_token) {
    console.error('\n✗ No refresh_token returned.')
    console.error('  Google only issues one when prompt=consent and the app has not already been authorized.')
    console.error('  Revoke access at https://myaccount.google.com/permissions then run again.')
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2))

  console.log(`\n✓ Token written to ${TOKEN_FILE}`)
  console.log(`  refresh_token: ${tokens.refresh_token.slice(0, 20)}...`)
  console.log('\nAdd to .env:')
  console.log('─────────────────────────────────────────────────')
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`)
  console.log('─────────────────────────────────────────────────\n')
})()
