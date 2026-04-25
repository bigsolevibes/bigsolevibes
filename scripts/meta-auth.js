require('dotenv').config()
const http = require('http')
const { exec } = require('child_process')
const { URL, URLSearchParams } = require('url')

const APP_ID     = process.env.META_APP_ID
const APP_SECRET = process.env.META_APP_SECRET
const PORT       = 3333
const REDIRECT   = `http://localhost:${PORT}/callback`
const SCOPES     = 'instagram_business_basic,instagram_business_content_publish'

if (!APP_ID || !APP_SECRET) {
  console.error('✗ META_APP_ID and META_APP_SECRET must be set in .env')
  console.error('  Get them from: https://developers.facebook.com/apps/')
  process.exit(1)
}

// ─── Step 1: exchange code for short-lived token ──────────────────────────────

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id:     APP_ID,
    client_secret: APP_SECRET,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT,
    code,
  })
  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body:   params,
  })
  const data = await res.json()
  if (data.error_message) throw new Error(data.error_message)
  if (data.error)         throw new Error(data.error.message || JSON.stringify(data.error))
  return { token: data.access_token, userId: data.user_id }
}

// ─── Step 2: exchange for long-lived token (60 days) ─────────────────────────

async function getLongLivedToken(shortToken) {
  const params = new URLSearchParams({
    grant_type:    'ig_exchange_token',
    client_secret: APP_SECRET,
    access_token:  shortToken,
  })
  const res = await fetch(`https://graph.instagram.com/access_token?${params}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data.access_token
}

// ─── Step 3: fetch Instagram account info ────────────────────────────────────

async function fetchIgAccount(token) {
  const res = await fetch(
    `https://graph.instagram.com/me?fields=id,username,name&access_token=${token}`
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data
}

// ─── OAuth callback server ────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`)

      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end()
        return
      }

      const error = url.searchParams.get('error')
      if (error) {
        const desc = url.searchParams.get('error_description') || error
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="font-family:sans-serif;padding:2rem;color:red"><h2>Auth failed: ${desc}</h2><p>Close this tab and check the terminal.</p></body></html>`)
        server.close()
        reject(new Error(`OAuth error: ${desc}`))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400)
        res.end('Missing code')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`
        <html><body style="font-family:sans-serif;padding:2rem;background:#0D1B2A;color:#F5ECD7">
          <h2>✓ Authenticated</h2>
          <p>You can close this tab and return to your terminal.</p>
        </body></html>
      `)
      server.close()

      try {
        console.log('\n✓ Callback received — exchanging tokens...')

        const { token: shortToken } = await exchangeCodeForToken(code)
        const longToken = await getLongLivedToken(shortToken)
        console.log('✓ Long-lived token obtained (valid ~60 days)\n')

        const account = await fetchIgAccount(longToken)

        console.log('─── Add these to your .env ────────────────────────────────')
        console.log()
        if (account.username) console.log(`# Instagram: @${account.username}`)
        if (account.name)     console.log(`# Name:      ${account.name}`)
        console.log()
        console.log(`META_IG_ACCOUNT_ID=${account.id}`)
        console.log(`META_ACCESS_TOKEN=${longToken}`)
        console.log()
        console.log('───────────────────────────────────────────────────────────')

        resolve()
      } catch (err) {
        console.error('\n✗', err.message)
        reject(err)
      }
    })

    server.listen(PORT, () => {
      const authUrl = new URL('https://api.instagram.com/oauth/authorize')
      authUrl.searchParams.set('client_id',     APP_ID)
      authUrl.searchParams.set('redirect_uri',  REDIRECT)
      authUrl.searchParams.set('scope',         SCOPES)
      authUrl.searchParams.set('response_type', 'code')

      console.log('\nOpening browser for Instagram login...')
      console.log(`\nIf it does not open automatically, visit:\n${authUrl.toString()}\n`)

      exec(`open "${authUrl.toString()}"`)
    })

    server.on('error', reject)
  })
}

// ─── Run ─────────────────────────────────────────────────────────────────────

startServer().catch(err => {
  console.error('✗', err.message)
  process.exit(1)
})
