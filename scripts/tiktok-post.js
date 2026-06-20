require('dotenv').config()
const fs   = require('fs')
const path = require('path')
const { getValidAccessToken } = require('./tiktok-auth')

// ─────────────────────────────────────────────────────────────────────────────
// tiktok-post.js — posts a video to TikTok as a DRAFT via the inbox endpoint.
//
// Uses /v2/post/publish/inbox/video/init/ (scope: video.upload), not Direct
// Post (/v2/post/publish/video/init/, scope: video.publish). Direct Post
// requires TikTok app audit approval before it'll work for an unaudited app;
// the inbox/draft flow works today. The tradeoff: TikTok does NOT accept
// post_info (title/caption/privacy) on this endpoint — the video lands in the
// TikTok app's inbox as a draft, and Big D has to open the app, paste the
// caption, set privacy, and tap Post manually.
//
// Access token comes from config/tiktok-token.json via tiktok-auth.js,
// auto-refreshed if expired. Run `node scripts/tiktok-auth.js` first if no
// token is on file yet.
// ─────────────────────────────────────────────────────────────────────────────

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const videoPath = getArg('--video')
const caption = getArg('--caption') || ''

if (!videoPath) {
  console.error('Usage: node scripts/tiktok-post.js --video /path/to/video.mp4 [--caption "Your caption #BigSoleVibes"]')
  console.error('  Note: caption is NOT sent to TikTok (the draft/inbox endpoint does not accept it) —')
  console.error('  it is only echoed back here as a reminder to paste into the app.')
  process.exit(1)
}

if (!fs.existsSync(videoPath)) {
  console.error(`Video file not found: ${videoPath}`)
  process.exit(1)
}

// ─── Step 1: Initialize Upload (draft/inbox) ─────────────────────────────────

async function initializeUpload(accessToken, fileSizeBytes) {
  console.log('\nStep 1: Initializing TikTok draft upload...')

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSizeBytes,
        chunk_size: fileSizeBytes,
        total_chunk_count: 1,
      },
    }),
  })

  const data = await res.json()

  if (!res.ok || data.error?.code !== 'ok') {
    throw new Error(`Init failed: ${data.error?.message || JSON.stringify(data)}`)
  }

  console.log(`✓ Draft upload initialized — publish_id: ${data.data.publish_id}`)
  return data.data
}

// ─── Step 2: Upload Video Chunk ───────────────────────────────────────────────

async function uploadVideo(uploadUrl, videoPath, fileSizeBytes) {
  console.log('\nStep 2: Uploading video...')

  const videoBuffer = fs.readFileSync(videoPath)

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes 0-${fileSizeBytes - 1}/${fileSizeBytes}`,
      'Content-Length': fileSizeBytes,
    },
    body: videoBuffer,
  })

  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status}`)
  }

  console.log('✓ Video uploaded successfully')
}

// ─── Step 3: Check Status ────────────────────────────────────────────────────
// The draft/inbox flow ends with the video sitting in TikTok's inbox for Big D
// to finish (caption, privacy, post) inside the app — it never reaches
// PUBLISH_COMPLETE on its own. Poll generically: keep waiting while TikTok
// reports a PROCESSING state, stop on anything else (success-ish unless FAILED).

async function checkStatus(accessToken, publishId) {
  console.log('\nStep 3: Checking upload status...')

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000))

    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    })

    const data = await res.json()

    if (!res.ok || data.error?.code !== 'ok') {
      throw new Error(`Status check failed: ${data.error?.message || JSON.stringify(data)}`)
    }

    const status = data.data?.status
    console.log(`  Status: ${status}`)

    if (status === 'FAILED') {
      throw new Error(`Upload failed: ${data.data?.fail_reason || 'unknown reason'}`)
    }

    if (status && !status.includes('PROCESSING')) {
      console.log(`✓ Sent to TikTok inbox — finish the draft (caption, privacy, post) in the app.`)
      return data.data
    }
  }

  console.log('⚠ Timed out waiting for a terminal status — video may still be processing. Check the TikTok app inbox.')
}

// ─── Run ─────────────────────────────────────────────────────────────────────

;(async () => {
  try {
    console.log(`\nPosting to TikTok (draft/inbox) — ${path.basename(videoPath)}`)
    if (caption) console.log(`Caption (paste manually in-app — not sent to TikTok): "${caption}"`)
    console.log()

    const accessToken = await getValidAccessToken()

    const fileSizeBytes = fs.statSync(videoPath).size
    console.log(`File size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`)

    // Step 1: Initialize
    const { publish_id, upload_url } = await initializeUpload(accessToken, fileSizeBytes)

    // Step 2: Upload
    await uploadVideo(upload_url, videoPath, fileSizeBytes)

    // Step 3: Check status
    await checkStatus(accessToken, publish_id)

    console.log('\n─── TikTok Draft Upload Complete ──────────')
    console.log('Open the TikTok app → Inbox → finish the draft to actually publish.')
    if (caption) console.log(`Caption to paste: "${caption}"`)
    console.log()

  } catch (err) {
    console.error(`\n✗ TikTok posting failed: ${err.message}`)
    process.exit(1)
  }
})()
