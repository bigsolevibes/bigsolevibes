require('dotenv').config()
const fs = require('fs')
const path = require('path')

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const videoPath = getArg('--video')
const caption = getArg('--caption')

if (!videoPath || !caption) {
  console.error('Usage: node scripts/tiktok-post.js --video /path/to/video.mp4 --caption "Your caption #BigSoleVibes"')
  process.exit(1)
}

if (!fs.existsSync(videoPath)) {
  console.error(`Video file not found: ${videoPath}`)
  process.exit(1)
}

// ─── Config ──────────────────────────────────────────────────────────────────

const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET

if (!TIKTOK_ACCESS_TOKEN) {
  console.error('✗ Missing TIKTOK_ACCESS_TOKEN in .env')
  process.exit(1)
}

// ─── Step 1: Initialize Upload ────────────────────────────────────────────────

async function initializeUpload(fileSizeBytes) {
  console.log('\nStep 1: Initializing TikTok upload...')

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 150), // TikTok caption limit
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        ai_generated_content: true,
      },
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

  console.log(`✓ Upload initialized — publish_id: ${data.data.publish_id}`)
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

// ─── Step 3: Check Publish Status ────────────────────────────────────────────

async function checkStatus(publishId) {
  console.log('\nStep 3: Checking publish status...')

  // Poll up to 10 times with 3 second intervals
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000))

    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}`,
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

    if (status === 'PUBLISH_COMPLETE') {
      console.log(`✓ Published! Video ID: ${data.data?.publicaly_available_post_id?.[0] || 'check TikTok'}`)
      return data.data
    }

    if (status === 'FAILED') {
      throw new Error(`Publish failed: ${data.data?.fail_reason || 'unknown reason'}`)
    }
  }

  console.log('⚠ Timed out waiting for publish confirmation — video may still be processing. Check TikTok.')
}

// ─── Run ─────────────────────────────────────────────────────────────────────

;(async () => {
  try {
    console.log(`\nPosting to TikTok — ${path.basename(videoPath)}`)
    console.log(`Caption: "${caption}"\n`)

    const fileSizeBytes = fs.statSync(videoPath).size
    console.log(`File size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`)

    // Step 1: Initialize
    const { publish_id, upload_url } = await initializeUpload(fileSizeBytes)

    // Step 2: Upload
    await uploadVideo(upload_url, videoPath, fileSizeBytes)

    // Step 3: Check status
    await checkStatus(publish_id)

    console.log('\n─── TikTok Post Complete ───────────────────')
    console.log('✓ X: check TikTok app to confirm post is live')
    console.log()

  } catch (err) {
    console.error(`\n✗ TikTok posting failed: ${err.message}`)
    process.exit(1)
  }
})()
