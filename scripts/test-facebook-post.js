require('dotenv').config()
const fs   = require('fs')
const path = require('path')
// ─────────────────────────────────────────────────────────────────────────────
// test-facebook-post.js — one-off, contained test: post ONE real photo to the
// Facebook Page using the existing META_ACCESS_TOKEN, outside the normal
// distribute.js pipeline (does not touch PAUSED_PLATFORMS/SKIPPED_PLATFORMS).
//
// Reuses today's real tue-pm image + caption (already live on Instagram) so
// this is a genuine content test, not a placeholder post.
//
// Usage: node scripts/test-facebook-post.js
// ─────────────────────────────────────────────────────────────────────────────

const CAPTION = `He stopped asking if it mattered. The Brickell Daily Essential Face Moisturizer earned its place the same way everything else on the shelf did — quietly, without a conversation. Shop the shelf: https://bigsolevibes.com/shop/ #BigSoleVibes #mensgrooming #selfcare #menwellness`

const IMAGE_CANDIDATES = [
  path.join(__dirname, '..', 'posts', 'output', 'tue-pm-instagram.png'),
  path.join(__dirname, '..', 'public', 'posts', 'output', 'tue-pm-instagram.png'),
]

;(async function run() {
  const { META_ACCESS_TOKEN, META_PAGE_ID: RAW_PAGE_ID } = process.env
  const META_PAGE_ID = (RAW_PAGE_ID || '').trim()

  if (!META_ACCESS_TOKEN || !META_PAGE_ID) {
    console.log('Missing META_ACCESS_TOKEN / META_PAGE_ID — cannot test.')
    process.exit(1)
  }

  const imagePath = IMAGE_CANDIDATES.find(p => fs.existsSync(p))
  if (!imagePath) {
    console.log(`No image found at any of: ${IMAGE_CANDIDATES.join(', ')}`)
    process.exit(1)
  }
  console.log(`Using image: ${imagePath}`)

  try {
    // Step 1: exchange for Page Access Token
    const tokenUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}?fields=access_token,name&access_token=${META_ACCESS_TOKEN}`
    const pageTokenRes  = await fetch(tokenUrl)
    const pageTokenData = await pageTokenRes.json()
    if (!pageTokenRes.ok || pageTokenData.error) {
      throw new Error(`Page token exchange failed: ${pageTokenData.error?.message || pageTokenRes.status}`)
    }
    const pageAccessToken = pageTokenData.access_token
    console.log(`Got Page Access Token for "${pageTokenData.name}"`)

    // Step 2: post the photo
    // Using native FormData/Blob (Node 18+) instead of the 'form-data' package —
    // mixing 'form-data' + form.getHeaders() with native fetch (undici) is a known
    // incompatibility: undici doesn't reliably stream a 'form-data' body when the
    // boundary header is set manually, which produced "(#100) 0 does not resolve
    // to a valid user ID" on the first attempt (Facebook received a malformed/
    // effectively empty multipart body). Native FormData + fetch sets its own
    // correct multipart boundary and streams correctly.
    const fileBuffer = fs.readFileSync(imagePath)
    const form = new FormData()
    form.append('caption', CAPTION)
    form.append('access_token', pageAccessToken)
    form.append('source', new Blob([fileBuffer], { type: 'image/png' }), path.basename(imagePath))

    const photoUrl = `https://graph.facebook.com/v19.0/${META_PAGE_ID}/photos`
    const res  = await fetch(photoUrl, { method: 'POST', body: form })
    const data = await res.json()

    if (!res.ok || data.error) {
      throw new Error(data.error?.message || `HTTP ${res.status}`)
    }

    console.log(`\n✓ POSTED — photo ID: ${data.id}`)
    console.log(`View: https://www.facebook.com/${data.id}`)
  } catch (err) {
    console.log(`\n✗ FAILED: ${err.message}`)
    process.exit(1)
  }
})()
