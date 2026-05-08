require('dotenv').config()
const fs   = require('fs')
const path = require('path')

const args  = process.argv.slice(2)
const i     = args.indexOf('--token')
const token = i !== -1 ? args[i + 1] : null

if (!token) {
  console.error('Usage: node scripts/manual-token.js --token EAA...')
  process.exit(1)
}

async function graph(endpoint, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/v19.0/${endpoint}`)
  url.searchParams.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res  = await fetch(url.toString())
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data
}

function upsertEnv(filePath, updates) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*`, 'm')
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`)
    } else {
      content = content.endsWith('\n') || content === ''
        ? content + `${key}=${value}\n`
        : content + `\n${key}=${value}\n`
    }
  }
  fs.writeFileSync(filePath, content)
}

;(async () => {
  const envPath = path.resolve(__dirname, '../.env')

  console.log('\nFetching Pages via /me/accounts...')
  let pages
  try {
    const data = await graph('me/accounts', token, { fields: 'id,name,access_token' })
    pages = data.data || []
  } catch (err) {
    console.error(`✗ ${err.message}`)
    process.exit(1)
  }

  if (pages.length === 0) {
    console.error('✗ No Facebook Pages found for this token.')
    process.exit(1)
  }

  // Find Big Sole Vibes page, fall back to first page
  const page = pages.find(p => /big\s*sole\s*vibes/i.test(p.name)) || pages[0]

  if (pages.length > 1) {
    console.log(`\nPages found: ${pages.map(p => p.name).join(', ')}`)
    console.log(`Using: ${page.name}\n`)
  } else {
    console.log(`\nPage: ${page.name}\n`)
  }

  // Get linked Instagram Business Account
  let igId = null
  try {
    const pageInfo = await graph(page.id, page.access_token, { fields: 'instagram_business_account' })
    igId = pageInfo.instagram_business_account?.id || null
  } catch (err) {
    console.warn(`  Instagram lookup failed: ${err.message}`)
  }

  let igHandle = igId
  if (igId) {
    try {
      const igInfo = await graph(igId, page.access_token, { fields: 'username' })
      igHandle = igInfo.username ? `@${igInfo.username}` : igId
    } catch (_) {}
  }

  // Build updates
  const updates = {
    META_ACCESS_TOKEN: token,
    META_PAGE_ID:      page.id,
  }
  if (igId) updates.META_IG_ACCOUNT_ID = igId

  // Print
  console.log('─── Values ────────────────────────────────────')
  console.log(`META_ACCESS_TOKEN=${token}`)
  console.log(`META_PAGE_ID=${page.id}`)
  if (igId) console.log(`META_IG_ACCOUNT_ID=${igId}  (${igHandle})`)
  else      console.log('META_IG_ACCOUNT_ID — no Instagram Business Account linked to this Page')
  console.log()

  // Write to .env
  upsertEnv(envPath, updates)
  console.log(`✓ .env updated (${Object.keys(updates).join(', ')})`)
  console.log()
})()
