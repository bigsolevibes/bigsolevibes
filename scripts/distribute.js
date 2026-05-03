require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { TwitterApi } = require('twitter-api-v2')
const { AtpAgent, RichText } = require('@atproto/api')
const FormData = require('form-data')

const RESULTS_FILE = path.join(__dirname, '..', 'logs', 'distribute-results.json')

// Platforms temporarily paused (code stays intact; remove from array to re-enable)
const PAUSED_PLATFORMS = ['twitter', 'facebook']

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const imageDir     = getArg('--image-dir') || 'posts/output'
const baseUrl      = getArg('--base-url') || process.env.BASE_URL || null
const isSetup      = args.includes('--setup')
const captionFile  = getArg('--caption-file')

// ─── Caption file parsing ─────────────────────────────────────────────────────
// When --caption-file is given, read the .md file and extract header fields
// (platform:, post_time:) plus the caption body. Header lines are stripped
// before the body is used as the caption text.

function parseCaptionFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  let platform = null
  let postTime = null

  // Strip recognised header lines from the top of the file
  const bodyLines = []
  let pastHeaders = false
  for (const line of raw.split('\n')) {
    if (!pastHeaders) {
      const pm = line.match(/^platform:\s*(\S+)/i)
      if (pm) { platform = pm[1].trim().toLowerCase(); continue }
      const tm = line.match(/^post_time:\s*(\d{1,2}:\d{2})/i)
      if (tm) { postTime = tm[1].trim(); continue }
      // First non-header line ends the header block
      pastHeaders = true
    }
    bodyLines.push(line)
  }

  return { platform, postTime, body: bodyLines.join('\n').trim() }
}

// Resolve caption and platform from either --caption-file or --caption / --platforms
let caption
let filePlatform = null

if (captionFile) {
  const parsed = parseCaptionFile(captionFile)
  caption      = parsed.body
  filePlatform = parsed.platform

  if (parsed.postTime) {
    const [h, m]   = parsed.postTime.split(':').map(Number)
    const now      = new Date()
    const nowMins  = now.getHours() * 60 + now.getMinutes()
    if (nowMins < h * 60 + m) {
      const cur = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      console.log(`⏰ ${path.basename(captionFile)}: scheduled for ${parsed.postTime} — current time ${cur}, exiting`)
      process.exit(0)
    }
  }
} else {
  caption = getArg('--caption')
}

// Platform resolution: file-level platform: field > --platforms flag > all active
const platformsArg = getArg('--platforms')
const activePlatforms = filePlatform
  ? new Set([filePlatform])
  : platformsArg
    ? new Set(platformsArg.split(',').map(s => s.trim().toLowerCase()))
    : new Set(['x', 'bluesky', 'facebook', 'instagram', 'youtube'])

if (filePlatform) {
  console.log(`platform lock (from file): ${filePlatform}`)
}

if (!isSetup && !caption) {
  console.error('Usage: node scripts/distribute.js --caption-file path/to/day3b.md [--image-dir posts/output/]')
  console.error('       node scripts/distribute.js --caption "text" [--platforms x,bluesky] [--image-dir posts/output/]')
  console.error('       node scripts/distribute.js --setup')
  process.exit(1)
}

// ─── Image matching ───────────────────────────────────────────────────────────

function findImage(dir, platform) {
  const files = fs.readdirSync(dir)
  const matches = files.filter(f => f.includes(`-${platform}.`))
  if (!matches.length) return null
  // prefer sanitized filenames (no apostrophes) to avoid Cloudflare CDN URL mismatch
  const clean = matches.find(f => !f.includes("'"))
  return path.resolve(dir, clean || matches[0])
}

const images = {
  twitter:   findImage(imageDir, 'twitter'),    // 1600x900
  facebook:  findImage(imageDir, 'facebook'),   // 1080x1080
  instagram: findImage(imageDir, 'instagram'),  // 1080x1080
  bluesky:   findImage(imageDir, 'bluesky') || findImage(imageDir, 'twitter'), // 1600x900 fallback
}

function findVideo(dir, platform) {
  try {
    const files = fs.readdirSync(dir)
    const match = files.find(f => f.includes(`-${platform}.`) && f.match(/\.mp4$/i))
    return match ? path.resolve(dir, match) : null
  } catch { return null }
}

const youtubeVideo = findVideo(imageDir, 'youtube')

// ─── Results log ─────────────────────────────────────────────────────────────

const results = []
const platformResults = {}

function log(platform, status, detail) {
  const icon = status === 'ok' ? '✓' : status === 'pause' ? '⏸' : '✗'
  const msg = `${icon} ${platform}: ${detail}`
  results.push(msg)
  console.log(msg)
  platformResults[platform.toLowerCase()] = status
}

function isPaused(platform) {
  return PAUSED_PLATFORMS.includes(platform.toLowerCase())
}

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

async function postToX() {
  if (isPaused('twitter')) { log('X', 'pause', 'paused — skipping'); return }
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
    const detail = err.data ? JSON.stringify(err.data) : err.errors ? JSON.stringify(err.errors) : err.message
    log('X', 'fail', detail)
  }
}

// ─── Bluesky ─────────────────────────────────────────────────────────────────

async function postToBluesky() {
  if (isPaused('bluesky')) { log('Bluesky', 'pause', 'paused — skipping'); return }
  const { BLUESKY_HANDLE, BLUESKY_APP_PASSWORD } = process.env
  if (!BLUESKY_HANDLE || !BLUESKY_APP_PASSWORD) {
    log('Bluesky', 'fail', 'Missing BLUESKY_HANDLE / BLUESKY_APP_PASSWORD')
    return
  }
  if (!images.bluesky) {
    log('Bluesky', 'fail', `No bluesky/twitter image found in ${imageDir}`)
    return
  }

  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' })
    await agent.login({ identifier: BLUESKY_HANDLE, password: BLUESKY_APP_PASSWORD })

    // Compress to JPEG under Bluesky's 2MB limit
    let bytes = await require('sharp')(images.bluesky).jpeg({ quality: 90 }).toBuffer()
    if (bytes.length > 2_000_000) {
      bytes = await require('sharp')(images.bluesky).jpeg({ quality: 70 }).toBuffer()
    }
    const { data: blobData } = await agent.uploadBlob(bytes, { encoding: 'image/jpeg' })

    const BSKY_LIMIT = 300
    const BSKY_SUFFIX = '... #BigSoleVibes'
    const bskyText = caption.length > BSKY_LIMIT
      ? caption.slice(0, BSKY_LIMIT - BSKY_SUFFIX.length) + BSKY_SUFFIX
      : caption

    const rt = new RichText({ text: bskyText })
    await rt.detectFacets(agent)

    const post = await agent.post({
      text:   rt.text,
      facets: rt.facets,
      embed: {
        $type:  'app.bsky.embed.images',
        images: [{ image: blobData.blob, alt: bskyText }],
      },
    })
    log('Bluesky', 'ok', `Posted — ${post.uri}`)
  } catch (err) {
    log('Bluesky', 'fail', err.message)
  }
}

// ─── Facebook ────────────────────────────────────────────────────────────────

async function postToFacebook() {
  if (isPaused('facebook')) { log('Facebook', 'pause', 'paused — skipping'); return }
  const { META_ACCESS_TOKEN, META_PAGE_ID: META_PAGE_ID_RAW } = process.env
  const META_PAGE_ID = (META_PAGE_ID_RAW || '').trim()
  console.log(`  [debug] META_PAGE_ID raw = "${META_PAGE_ID_RAW}" trimmed = "${META_PAGE_ID}" (len: ${META_PAGE_ID.length})`)
  if (!META_ACCESS_TOKEN || !META_PAGE_ID) {
    log('Facebook', 'fail', 'Missing META_ACCESS_TOKEN / META_PAGE_ID')
    return
  }
  if (!images.facebook) {
    log('Facebook', 'fail', `No facebook image found in ${imageDir}`)
    return
  }

  try {
    // Exchange User Access Token for Page Access Token
    const tokenUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}?fields=access_token&access_token=${META_ACCESS_TOKEN}`
    console.log(`  [debug] Page token exchange URL: ${tokenUrl.replace(META_ACCESS_TOKEN, '[REDACTED]')}`)
    const pageTokenRes = await fetch(tokenUrl)
    const pageTokenData = await pageTokenRes.json()
    console.log('  [debug] Page token exchange response:', JSON.stringify(pageTokenData, null, 2))
    if (!pageTokenRes.ok || pageTokenData.error) {
      throw new Error(`Failed to get Page Access Token: ${pageTokenData.error?.message || `HTTP ${pageTokenRes.status}`}`)
    }
    const pageAccessToken = pageTokenData.access_token
    if (!pageAccessToken) throw new Error('Page Access Token not returned — ensure token has pages_show_list and pages_read_engagement permissions')
    console.log(`  [debug] Page Access Token (first 30): ${pageAccessToken.slice(0, 30)}`)

    const form = new FormData()
    form.append('caption', caption)
    form.append('access_token', pageAccessToken)
    form.append('source', fs.createReadStream(images.facebook), {
      filename:    path.basename(images.facebook),
      contentType: 'image/jpeg',
    })

    const photoUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/photos`
    console.log(`  [debug] Facebook photo upload URL: ${photoUrl}`)
    console.log(`  [debug] Facebook request body fields: caption="${caption.slice(0, 60)}...", source="${path.basename(images.facebook)}", access_token=[Page token, first 30: ${pageAccessToken.slice(0, 30)}]`)
    const res = await fetch(photoUrl, {
      method:  'POST',
      body:    form,
      headers: form.getHeaders(),
    })
    const data = await res.json()
    console.log('  [debug] Facebook response:', JSON.stringify(data, null, 2))
    if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`)
    log('Facebook', 'ok', `Posted — photo ID ${data.id}`)
  } catch (err) {
    log('Facebook', 'fail', err.message)
  }
}

// ─── Instagram ───────────────────────────────────────────────────────────────
// Two-step Graph API publish: create media container → media_publish.
// Images must be in public/posts/output/ so Cloudflare Pages serves them at /posts/output/.

async function postToInstagram() {
  if (isPaused('instagram')) { log('Instagram', 'pause', 'paused — skipping'); return }
  const { META_ACCESS_TOKEN, META_IG_ACCOUNT_ID } = process.env
  if (!META_ACCESS_TOKEN || !META_IG_ACCOUNT_ID) {
    log('Instagram', 'fail', 'Missing META_ACCESS_TOKEN / META_IG_ACCOUNT_ID')
    return
  }
  if (!images.instagram) {
    log('Instagram', 'fail', `No instagram image found in ${imageDir}`)
    return
  }

  const encodedName = encodeURIComponent(path.basename(images.instagram))
  const imageUrl    = `https://bigsolevibes.com/posts/output/${encodedName}`
  console.log(`  [debug] Instagram image_url = "${imageUrl}"`)
  console.log(`  [debug] META_IG_ACCOUNT_ID  = "${META_IG_ACCOUNT_ID}"`)
  console.log(`  [debug] Local file exists: ${require('fs').existsSync(images.instagram)}, size: ${require('fs').statSync(images.instagram).size} bytes`)

  // Verify URL is reachable before sending to Instagram
  try {
    const probe = await fetch(imageUrl, { method: 'HEAD' })
    console.log(`  [debug] URL probe: HTTP ${probe.status} ${probe.statusText}`)
    if (!probe.ok) {
      log('Instagram', 'fail', `Image URL returned HTTP ${probe.status} — not publicly accessible yet. Wait for Cloudflare Pages deploy.`)
      return
    }
    // Wait for Cloudflare CDN to propagate globally before Instagram fetches the image
    console.log(`  [debug] CDN probe OK — waiting 45s for global propagation...`)
    await new Promise(r => setTimeout(r, 45000))
    console.log(`  [debug] CDN wait complete`)
  } catch (err) {
    console.log(`  [debug] URL probe failed: ${err.message}`)
  }

  try {
    // Step 1: create media container
    const containerRes = await fetch(
      `https://graph.facebook.com/v19.0/${META_IG_ACCOUNT_ID}/media`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image_url: imageUrl, caption, access_token: META_ACCESS_TOKEN }),
      }
    )
    const container = await containerRes.json()
    console.log('  [debug] Instagram container response:', JSON.stringify(container, null, 2))
    if (!containerRes.ok || container.error) throw new Error(container.error?.message || `HTTP ${containerRes.status}`)
    if (!container.id) throw new Error(`Container created but no ID returned — full response: ${JSON.stringify(container)}`)

    // Poll container status until FINISHED or timeout (30s max, every 3s)
    const POLL_INTERVAL = 3000
    const POLL_TIMEOUT  = 30000
    const pollStart     = Date.now()
    let statusCode      = null

    while (Date.now() - pollStart < POLL_TIMEOUT) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      const statusRes  = await fetch(
        `https://graph.facebook.com/v19.0/${container.id}?fields=status_code&access_token=${META_ACCESS_TOKEN}`
      )
      const statusBody = await statusRes.json()
      statusCode       = statusBody.status_code
      console.log(`  [debug] Instagram container status: ${statusCode} (${Math.round((Date.now() - pollStart) / 1000)}s)`)
      if (statusCode === 'FINISHED') break
      if (statusCode === 'ERROR') {
        throw new Error(`Container processing failed with status ERROR — ${JSON.stringify(statusBody)}`)
      }
    }

    if (statusCode !== 'FINISHED') {
      throw new Error(`Container not ready after ${POLL_TIMEOUT / 1000}s — last status: ${statusCode}`)
    }

    // Step 2: publish
    const publishRes = await fetch(
      `https://graph.facebook.com/v19.0/${META_IG_ACCOUNT_ID}/media_publish`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ creation_id: container.id, access_token: META_ACCESS_TOKEN }),
      }
    )
    const publish = await publishRes.json()
    if (!publishRes.ok || publish.error) throw new Error(publish.error?.message || `HTTP ${publishRes.status}`)
    log('Instagram', 'ok', `Posted — media ID ${publish.id}`)
  } catch (err) {
    log('Instagram', 'fail', err.message)
  }
}

// ─── YouTube Video Upload ─────────────────────────────────────────────────────

async function postToYouTube() {
  if (isPaused('youtube')) { log('YouTube', 'pause', 'paused — skipping'); return }
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    log('YouTube', 'fail', 'Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN')
    return
  }
  if (!youtubeVideo) {
    log('YouTube', 'skip', `No youtube .mp4 found in ${imageDir} — skipping video upload`)
    return
  }

  try {
    const scriptPath  = path.join(__dirname, 'youtube-post.js')
    const safeVideo   = youtubeVideo.replace(/"/g, '\\"')
    const safeTitle   = 'Big Sole Vibes — The Standard'
    const safeDesc    = caption.replace(/"/g, '\\"').replace(/\n/g, ' ')

    execSync(
      `node "${scriptPath}" --video "${safeVideo}" --title "${safeTitle}" --description "${safeDesc}"`,
      { stdio: 'inherit' }
    )
    log('YouTube', 'ok', `Video uploaded — ${path.basename(youtubeVideo)}`)
  } catch (err) {
    log('YouTube', 'fail', err.message)
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

  if (activePlatforms.has('x'))         await postToX()
  if (activePlatforms.has('bluesky'))   await postToBluesky()
  if (activePlatforms.has('facebook'))  await postToFacebook()
  if (activePlatforms.has('instagram')) await postToInstagram()
  if (activePlatforms.has('youtube'))   await postToYouTube()

  console.log('\n─── Summary ───────────────────────────────')
  results.forEach(r => console.log(r))
  console.log()

  // Write machine-readable results for watch-drive.js retry logic
  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true })
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(platformResults, null, 2))
})()
