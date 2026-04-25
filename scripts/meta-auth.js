require('dotenv').config()
const http = require('http')
const { exec } = require('child_process')
const { URL, URLSearchParams } = require('url')

const APP_ID     = process.env.META_APP_ID
const APP_SECRET = process.env.META_APP_SECRET
const PORT       = 3333
const REDIRECT   = `http://localhost:${PORT}/callback`

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_content_publish',
].join(',')

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
    redirect_uri:  REDIRECT,
    code,
  })
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.access_token
}

// ─── Step 2: exchange short-lived token for long-lived (60 days) ─────────────

async function getLongLivedToken(shortToken) {
  const params = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         APP_ID,
    client_secret:     APP_SECRET,
    fb_exchange_token: shortToken,
  })
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.access_token
}

// ─── Step 3: fetch pages + Instagram accounts ─────────────────────────────────

async function fetchAccounts(token) {
  const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)

  const pages = data.data || []
  const results = []

  for (const page of pages) {
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${token}`
    )
    const igData = await igRes.json()

    let igId = null
    let igUsername = null

    if (igData.instagram_business_account?.id) {
      igId = igData.instagram_business_account.id
      const detailRes = await fetch(
        `https://graph.facebook.com/v19.0/${igId}?fields=username&access_token=${token}`
      )
      const detail = await detailRes.json()
      igUsername = detail.username || null
    }

    results.push({ page, igId, igUsername })
  }

  return results
}

// ─── Step 4: get a Page access token (long-lived, for posting) ────────────────

async function getPageToken(pageId, userToken) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${userToken}`
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.access_token || null
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
        res.end(`<h2 style="font-family:sans-serif;color:red">Auth failed: ${desc}</h2><p>You can close this tab.</p>`)
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
        const shortToken = await exchangeCodeForToken(code)
        const longToken  = await getLongLivedToken(shortToken)
        console.log('✓ Long-lived user token obtained (valid ~60 days)\n')

        const accounts = await fetchAccounts(longToken)

        if (accounts.length === 0) {
          console.log('No Facebook Pages found for this account.')
          resolve()
          return
        }

        console.log('─── Results ───────────────────────────────────────────────')
        console.log()

        for (const { page, igId, igUsername } of accounts) {
          const pageToken = await getPageToken(page.id, longToken)

          console.log(`Facebook Page:  ${page.name}`)
          console.log(`META_PAGE_ID=${page.id}`)
          if (pageToken) console.log(`META_PAGE_ACCESS_TOKEN=${pageToken}`)

          if (igId) {
            console.log(`Instagram:      ${igUsername ? '@' + igUsername : igId}`)
            console.log(`META_IG_ACCOUNT_ID=${igId}`)
          } else {
            console.log('Instagram:      No Business Account linked to this page')
          }
          console.log()
        }

        console.log('─── User token (for META_ACCESS_TOKEN in .env) ────────────')
        console.log(`META_ACCESS_TOKEN=${longToken}`)
        console.log()
        console.log('Add the lines above to your .env file.')

        resolve()
      } catch (err) {
        console.error('✗', err.message)
        reject(err)
      }
    })

    server.listen(PORT, () => {
      const authUrl = new URL('https://www.facebook.com/dialog/oauth')
      authUrl.searchParams.set('client_id',    APP_ID)
      authUrl.searchParams.set('redirect_uri', REDIRECT)
      authUrl.searchParams.set('scope',        SCOPES)
      authUrl.searchParams.set('response_type','code')

      console.log('\nOpening browser for Meta login...')
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
