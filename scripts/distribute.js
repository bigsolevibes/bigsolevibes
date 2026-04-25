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

if (!caption) {
  console.error('Usage: node scripts/distribute.js --caption "text" [--image-dir posts/output/] [--base-url https://example.com/posts/output]')
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
// Instagram Graph API requires a publicly accessible image URL.
// Pass --base-url or set BASE_URL in .env pointing to where posts/output/ is served.
// Example: --base-url https://bigsolevibes.com/posts/output

async function postToInstagram() {
  const { META_ACCESS_TOKEN, META_IG_ACCOUNT_ID } = process.env
  if (!META_ACCESS_TOKEN || !META_IG_ACCOUNT_ID) {
    log('Instagram', 'fail', 'Missing META_ACCESS_TOKEN / META_IG_ACCOUNT_ID')
    return
  }
  if (!images.instagram) {
    log('Instagram', 'fail', `No instagram image found in ${imageDir}`)
    return
  }
  if (!baseUrl) {
    log('Instagram', 'fail', 'Requires a public image URL — pass --base-url https://your-domain.com/posts/output or set BASE_URL in .env')
    return
  }

  const imageUrl = `${baseUrl.replace(/\/$/, '')}/${path.basename(images.instagram)}`

  try {
    // Step 1: create media container
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${META_IG_ACCOUNT_ID}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, caption, access_token: META_ACCESS_TOKEN }),
      }
    )
    const container = await containerRes.json()
    if (!containerRes.ok || container.error) throw new Error(container.error?.message || `HTTP ${containerRes.status}`)

    // Step 2: publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${META_IG_ACCOUNT_ID}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id, access_token: META_ACCESS_TOKEN }),
      }
    )
    const publish = await publishRes.json()
    if (!publishRes.ok || publish.error) throw new Error(publish.error?.message || `HTTP ${publishRes.status}`)
    log('Instagram', 'ok', `Posted — media ID ${publish.id}`)
  } catch (err) {
    log('Instagram', 'fail', err.message)
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

;(async () => {
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
