require('dotenv').config()
const fs   = require('fs')
const path = require('path')

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const videoPath  = getArg('--video')
const videoTitle = getArg('--title')
const videoDesc  = getArg('--description') || ''

if (!videoPath || !videoTitle) {
  console.error('Usage: node scripts/youtube-post.js --video /path/video.mp4 --title "title" --description "text"')
  process.exit(1)
}

if (!fs.existsSync(videoPath)) {
  console.error(`✗ Video not found: ${videoPath}`)
  process.exit(1)
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('✗ Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN in .env')
  process.exit(1)
}

// ─── OAuth2 access token ──────────────────────────────────────────────────────

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString(),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error || `HTTP ${res.status}`}`)
  }
  return data.access_token
}

// ─── Video Upload ─────────────────────────────────────────────────────────────
// Resumable upload: initiate session → stream in chunks → confirm

async function uploadVideo(videoPath, title, description) {
  const accessToken = await getAccessToken()
  console.log('✓ Access token obtained')

  const fileSize = fs.statSync(videoPath).size
  console.log(`Uploading: ${path.basename(videoPath)} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`)

  // Step 1: initiate resumable upload session
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method:  'POST',
      headers: {
        'Authorization':           `Bearer ${accessToken}`,
        'Content-Type':            'application/json',
        'X-Upload-Content-Type':   'video/mp4',
        'X-Upload-Content-Length': fileSize,
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: description + '\n\n⚠️ This video contains AI-generated content created with Google Flow / Veo.',
          categoryId: '22', // People & Blogs
        },
        status: {
          privacyStatus:           'public',
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia:  true,
        },
      }),
    }
  )

  if (!initRes.ok) {
    const err = await initRes.text()
    throw new Error(`Upload init failed: HTTP ${initRes.status} — ${err}`)
  }

  const uploadUrl = initRes.headers.get('location')
  if (!uploadUrl) throw new Error('No resumable upload URL returned')
  console.log('✓ Upload session created')

  // Step 2: stream in 8MB chunks
  const CHUNK_SIZE = 8 * 1024 * 1024
  const fd = fs.openSync(videoPath, 'r')
  let offset = 0

  try {
    while (offset < fileSize) {
      const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset)
      const chunk     = Buffer.alloc(chunkSize)
      fs.readSync(fd, chunk, 0, chunkSize, offset)

      const chunkRes = await fetch(uploadUrl, {
        method:  'PUT',
        headers: {
          'Content-Length': chunkSize,
          'Content-Range':  `bytes ${offset}-${offset + chunkSize - 1}/${fileSize}`,
          'Content-Type':   'video/mp4',
        },
        body: chunk,
      })

      if (chunkRes.status === 308) {
        const range = chunkRes.headers.get('range')
        offset = range ? parseInt(range.split('-')[1]) + 1 : offset + chunkSize
        process.stdout.write(`\r  Uploaded ${Math.round(offset / fileSize * 100)}%`)
      } else if (chunkRes.status === 200 || chunkRes.status === 201) {
        process.stdout.write('\r  Uploaded 100%\n')
        const data = await chunkRes.json()
        return data
      } else {
        const err = await chunkRes.text()
        throw new Error(`Chunk upload failed: HTTP ${chunkRes.status} — ${err}`)
      }
    }
  } finally {
    fs.closeSync(fd)
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

;(async () => {
  try {
    console.log(`\nUploading to YouTube`)
    console.log(`Title:       "${videoTitle}"`)
    console.log(`Video:       ${path.basename(videoPath)}`)
    if (videoDesc) console.log(`Description: "${videoDesc.slice(0, 80)}${videoDesc.length > 80 ? '…' : ''}"`)
    console.log()

    const result = await uploadVideo(videoPath, videoTitle, videoDesc)
    console.log(`\n✓ Uploaded — video ID: ${result?.id || 'check YouTube Studio'}`)
    if (result?.id) console.log(`  https://www.youtube.com/watch?v=${result.id}`)
  } catch (err) {
    console.error(`\n✗ YouTube upload failed: ${err.message}`)
    process.exit(1)
  }
})()
