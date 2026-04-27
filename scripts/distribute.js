require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { TwitterApi } = require('twitter-api-v2')

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const imageDir = getArg('--image-dir') || 'posts/output'
const caption = getArg('--caption')
const baseUrl = getArg('--base-url') || process.env.BASE_URL || null
const isSetup = args.includes('--setup')

if (!isSetup && !caption) {
  console.error('Usage: node scripts/distribute.js --caption "text" [--image-dir posts/output/] [--base-url https://example.com/posts/output]')
  console.error('       node scripts/distribute.js --setup')
  process.exit(1)
}

// ─── Image matching ───────────────────────────────────────────────────────────

function findImage(dir, platform) {
  const files = fs.readdirSync(dir)
  const match = files.find(f => f.includes(`-${platform}.`))
  if (!match) return null
  return path.resolve(dir, match)
}

const images = {
  twitter:   findImage(imageDir, 'twitter'),    // 1600x900
  facebook:  findImage(imageDir, 'facebook'),   // 1080x1080
  instagram: findImage(imageDir, 'instagram'),  // 1080x1080
}

// ─── Results log ─────────────────────────────────────────────────────────────

const results = []

function log(platform, status, detail) {
  const icon = status === 'ok' ? '✓' : '✗'
  const msg = `${icon} ${platform}: ${detail}`
  results.push(msg)
  console.log(msg)
}

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

async function postToX() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    log('X', 'fail', 'Missing X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET')
    return
  }
  if (!images.twitter) {
    log('X', 'fail', `No twitter image found in ${imageDir}`)
    return
  }

  try {
    const client = new TwitterApi({
      appKey: X_API_KEY,
      appSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN,
      accessSecret: X_ACCESS_TOKEN_SECRET,
    })
    const mediaId = await client.v1.uploadMedia(images.twitter)
    const tweet = await client.v2.tweet({ text: caption, media: { media_ids: [mediaId] } })
    log('X', 'ok', `Posted — tweet ID ${tweet.data.id}`)
  } catch (err) {
    log('X', 'fail', err.message)
  }
}

// ─── Facebook ────────────────────────────────────────────────────────────────

async function postToFacebook() {
  const { META_ACCESS_TOKEN, META_PAGE_ID } = process.env
  if (!META_ACCESS_TOKEN || !META_PAGE_ID) {
    log('Facebook', 'fail', 'Missing META_ACCESS_TOKEN / META_PAGE_ID')
    return
  }
  if (!images.facebook) {
    log('Facebook', 'fail', `No facebook image found in ${imageDir}`)
    return
  }

  try {
    const form = new FormData()
    form.append('caption', caption)
    form.append('access_token', META_ACCESS_TOKEN)
    form.append(
      'source',
      new Blob([fs.readFileSync(images.facebook)]),
      path.basename(images.facebook)
    )

    const res = await fetch(`https://graph.facebook.com/v19.0/${META_PAGE_ID}/photos`, {
      method: 'POST',
      body: form,
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`)
    log('Facebook', 'ok', `Posted — photo ID ${data.id}`)
  } catch (err) {
    log('Facebook', 'fail', err.message)
  }
}

// ─── Instagram ───────────────────────────────────────────────────────────────
// Posts via the Facebook Graph API using the Page Access Token.
// Uses /PAGE_ID/photos — no Instagram Login or public image URL required.

async function postToInstagram() {
  const { META_ACCESS_TOKEN, META_PAGE_ID } = process.env
  if (!META_ACCESS_TOKEN || !META_PAGE_ID) {
    log('Instagram', 'fail', 'Missing META_ACCESS_TOKEN / META_PAGE_ID')
    return
  }
  if (!images.instagram) {
    log('Instagram', 'fail', `No instagram image found in ${imageDir}`)
    return
  }

  try {
    const form = new FormData()
    form.append('caption', caption)
    form.append('access_token', META_ACCESS_TOKEN)
    form.append(
      'source',
      new Blob([fs.readFileSync(images.instagram)]),
      path.basename(images.instagram)
    )

    const res = await fetch(`https://graph.facebook.com/v19.0/${META_PAGE_ID}/photos`, {
      method: 'POST',
      body: form,
    })
    const data = await res.json()
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`)
    log('Instagram', 'ok', `Posted — photo ID ${data.id}`)
  } catch (err) {
    log('Instagram', 'fail', err.message)
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

async function runSetup() {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    console.error('✗ META_ACCESS_TOKEN not set in .env — cannot run setup.')
    process.exit(1)
  }

  console.log('\nFetching your Meta accounts...\n')

  // 1. Get all Facebook Pages this token has access to
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`
  )
  const pagesData = await pagesRes.json()

  if (!pagesRes.ok || pagesData.error) {
    console.error(`✗ Failed to fetch pages: ${pagesData.error?.message || `HTTP ${pagesRes.status}`}`)
    console.error('  Make sure META_ACCESS_TOKEN is a valid User access token with pages_show_list permission.')
    process.exit(1)
  }

  const pages = pagesData.data || []
  if (pages.length === 0) {
    console.log('No Facebook Pages found for this token.')
    return
  }

  console.log(`Found ${pages.length} Facebook Page(s):\n`)

  for (const page of pages) {
    console.log(`  Page name:  ${page.name}`)
    console.log(`  META_PAGE_ID=${page.id}`)

    // 2. For each page, check for a linked Instagram Business Account
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${token}`
    )
    const igData = await igRes.json()

    if (igData.instagram_business_account?.id) {
      const igId = igData.instagram_business_account.id

      // Fetch IG username for clarity
      const igDetailRes = await fetch(
        `https://graph.facebook.com/v19.0/${igId}?fields=username&access_token=${token}`
      )
      const igDetail = await igDetailRes.json()
      const username = igDetail.username ? `@${igDetail.username}` : ''

      console.log(`  Instagram:  ${username}`)
      console.log(`  META_IG_ACCOUNT_ID=${igId}`)
    } else {
      console.log('  Instagram:  No Instagram Business Account linked to this page')
    }

    console.log()
  }

  console.log('─── Add these to your .env ────────────────')
  for (const page of pages) {
    console.log(`META_PAGE_ID=${page.id}`)
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${token}`
    )
    const igData = await igRes.json()
    if (igData.instagram_business_account?.id) {
      console.log(`META_IG_ACCOUNT_ID=${igData.instagram_business_account.id}`)
    }
  }
  console.log()
}

// ─── Run ─────────────────────────────────────────────────────────────────────

;(async () => {
  if (isSetup) {
    await runSetup()
    return
  }

  console.log(`\nDistributing — caption: "${caption}"\n`)
  console.log('Images found:')
  for (const [platform, file] of Object.entries(images)) {
    console.log(`  ${platform}: ${file ? path.basename(file) : 'NOT FOUND'}`)
  }
  console.log()

  await postToX()
  await postToFacebook()
  await postToInstagram()

  console.log('\n─── Summary ───────────────────────────────')
  results.forEach(r => console.log(r))
  console.log()
})()
