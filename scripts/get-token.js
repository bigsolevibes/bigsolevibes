require('dotenv').config()

const APP_ID     = process.env.META_APP_ID
const APP_SECRET = process.env.META_APP_SECRET
const USER_TOKEN = process.env.META_ACCESS_TOKEN

if (!APP_ID || !APP_SECRET) {
  console.error('✗ META_APP_ID and META_APP_SECRET must be set in .env')
  process.exit(1)
}

async function graph(path, token, params = {}) {
  const url = new URL(`https://graph.facebook.com/v19.0/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res  = await fetch(url.toString())
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data
}

;(async () => {
  // Step 1: App Access Token — pure server-to-server, no browser
  console.log('\nFetching App Access Token...')
  const appTokenUrl = new URL('https://graph.facebook.com/oauth/access_token')
  appTokenUrl.searchParams.set('client_id',     APP_ID)
  appTokenUrl.searchParams.set('client_secret', APP_SECRET)
  appTokenUrl.searchParams.set('grant_type',    'client_credentials')

  const appRes  = await fetch(appTokenUrl.toString())
  const appData = await appRes.json()
  if (appData.error) {
    console.error('✗ App Token failed:', appData.error.message)
    process.exit(1)
  }
  const appToken = appData.access_token
  console.log('✓ App Access Token acquired\n')

  // Step 2: Use stored User Access Token to get Page tokens
  if (!USER_TOKEN) {
    console.error('✗ META_ACCESS_TOKEN not set in .env')
    console.error('  Run node scripts/meta-auth.js once to get a User Access Token, then add it to .env.')
    process.exit(1)
  }

  console.log('Fetching Pages via /me/accounts...\n')
  const pagesData = await graph('me/accounts', USER_TOKEN, { fields: 'id,name,access_token' })
  const pages     = pagesData.data || []

  if (pages.length === 0) {
    console.log('No Facebook Pages found for this token.')
    return
  }

  const envLines = []

  for (const page of pages) {
    console.log(`Page:  ${page.name}`)
    console.log(`  META_PAGE_ID=${page.id}`)
    console.log(`  META_PAGE_ACCESS_TOKEN=${page.access_token}`)
    envLines.push(`META_PAGE_ID=${page.id}`)
    envLines.push(`META_PAGE_ACCESS_TOKEN=${page.access_token}`)

    // Step 3: Get linked Instagram Business Account
    try {
      const pageInfo = await graph(page.id, page.access_token, { fields: 'instagram_business_account' })

      if (pageInfo.instagram_business_account?.id) {
        const igId   = pageInfo.instagram_business_account.id
        const igInfo = await graph(igId, page.access_token, { fields: 'username' })
        const handle = igInfo.username ? `@${igInfo.username}` : igId

        console.log(`  Instagram: ${handle}`)
        console.log(`  META_IG_ACCOUNT_ID=${igId}`)
        envLines.push(`META_IG_ACCOUNT_ID=${igId}`)
      } else {
        console.log('  Instagram: no Business Account linked to this Page')
      }
    } catch (err) {
      console.log(`  Instagram: error — ${err.message}`)
    }

    console.log()
  }

  console.log('─── Add to your .env ──────────────────────────')
  envLines.forEach(l => console.log(l))
  console.log()
})()
