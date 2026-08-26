require('dotenv').config()
const fs   = require('fs')
const path = require('path')
const { getValidAccessToken } = require('./tiktok-auth')

// ─────────────────────────────────────────────────────────────────────────────
// tiktok-direct-post.js — posts a video to TikTok via Direct Post (auto-
// publish), not the draft/inbox flow tiktok-post.js uses.
//
// Uses /v2/post/publish/video/init/ (scope: video.publish). Unlike the inbox
// endpoint, this one accepts full post_info (title, privacy, comment/duet/
// stitch, brand disclosure, AI-generated disclosure) and actually publishes
// — no manual finish step in the TikTok app.
//
// Requires app audit approval from TikTok before it'll post publicly. Until
// then, TikTok's unaudited-client sandbox mode still accepts calls under
// these limits: 5 users/24h, account must be private, posts land SELF_ONLY
// regardless of the privacy_level requested — useful for testing and for
// recording the demo video TikTok's audit submission requires.
//
// Access token comes from config/tiktok-token.json via tiktok-auth.js (must
// have been authorized with the video.publish scope — re-run
// `node scripts/tiktok-auth.js` if the token on file predates that scope).
//
// CLI usage:
//   node scripts/tiktok-direct-post.js --video path.mp4 --title "caption" --privacy SELF_ONLY [flags]
//   node scripts/tiktok-direct-post.js --creator-info          (prints creator_info as JSON)
//   node scripts/tiktok-direct-post.js --status <publish_id>   (checks a prior post's status)
//
// Flags: --disable-comment --disable-duet --disable-stitch --brand-organic
//        --brand-content --cover-ms <int> --json (machine-readable output)
// ─────────────────────────────────────────────────────────────────────────────

const API_ROOT = 'https://open.tiktokapis.com/v2/post/publish'

function getArg(args, flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

// ─── creator_info/query — call before showing the post form: privacy
// options, whether comment/duet/stitch are already disabled account-wide,
// and the max video duration this creator can post. ──────────────────────────

async function queryCreatorInfo(accessToken) {
  const res = await fetch(`${API_ROOT}/creator_info/query/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  })
  const data = await res.json()
  if (!res.ok || data.error?.code !== 'ok') {
    throw new Error(`creator_info/query failed: ${data.error?.message || JSON.stringify(data)}`)
  }
  return data.data
}

// ─── Step 1: Initialize Direct Post ──────────────────────────────────────────
// postInfo fields (all from creator_info/query + Big D's choices on the
// dashboard form — never defaulted silently here except is_aigc, which is
// always true: every video this pipeline produces is Veo-generated):
//   privacy_level        — required, must be one of creator_info's
//                           privacy_level_options
//   title                — caption, max 2200 UTF-16 runes
//   disable_comment/duet/stitch — optional booleans
//   brand_organic_toggle — "Your Brand" — BSV promoting its own product
//   brand_content_toggle — "Branded Content" — paid partnership; TikTok
//                           rejects this paired with privacy_level SELF_ONLY
//   video_cover_timestamp_ms — optional
//   is_aigc               — always true here

async function initDirectPost(accessToken, fileSizeBytes, postInfo) {
  if (!postInfo.privacy_level) throw new Error('privacy_level is required')
  if (postInfo.brand_content_toggle && postInfo.privacy_level === 'SELF_ONLY') {
    throw new Error('TikTok rejects brand_content_toggle=true paired with privacy_level=SELF_ONLY')
  }

  const body = {
    post_info: {
      privacy_level: postInfo.privacy_level,
      title: postInfo.title || '',
      disable_comment: !!postInfo.disable_comment,
      disable_duet: !!postInfo.disable_duet,
      disable_stitch: !!postInfo.disable_stitch,
      brand_organic_toggle: !!postInfo.brand_organic_toggle,
      brand_content_toggle: !!postInfo.brand_content_toggle,
      is_aigc: true,
      ...(postInfo.video_cover_timestamp_ms != null
        ? { video_cover_timestamp_ms: postInfo.video_cover_timestamp_ms }
        : {}),
    },
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: fileSizeBytes,
      chunk_size: fileSizeBytes,
      total_chunk_count: 1,
    },
  }

  const res = await fetch(`${API_ROOT}/video/init/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data.error?.code !== 'ok') {
    throw new Error(`Direct Post init failed: ${data.error?.message || JSON.stringify(data)}`)
  }
  return data.data // { publish_id, upload_url }
}

// ─── Step 2: Upload video — identical PUT mechanic to tiktok-post.js ────────

async function uploadVideo(uploadUrl, videoPath, fileSizeBytes) {
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
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`)
}

// ─── Step 3: Check publish status ────────────────────────────────────────────
// Direct Post actually publishes (unlike the inbox flow), so a terminal
// status here means the post either went live (respecting the sandbox's
// SELF_ONLY override until audited) or failed — never "waiting on Big D to
// finish a draft."

async function checkPublishStatus(accessToken, publishId) {
  const res = await fetch(`${API_ROOT}/status/fetch/`, {
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
  return data.data // { status, publicaly_available_post_id?, fail_reason? }
}

async function pollUntilTerminal(accessToken, publishId, { attempts = 10, delayMs = 3000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, delayMs))
    const result = await checkPublishStatus(accessToken, publishId)
    if (result.status === 'FAILED') throw new Error(`Publish failed: ${result.fail_reason || 'unknown reason'}`)
    if (result.status && !result.status.includes('PROCESSING')) return result
  }
  return null // timed out — still processing, caller should keep checking later
}

module.exports = { queryCreatorInfo, initDirectPost, uploadVideo, checkPublishStatus, pollUntilTerminal }

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (require.main === module) {
  ;(async () => {
    const args = process.argv.slice(2)
    const asJson = args.includes('--json')

    // Validate local, no-network preconditions first (matches tiktok-post.js's
    // ordering) so a missing/bad --video argument fails fast with a clear
    // message instead of burning a token refresh first.
    const videoPath = getArg(args, '--video')
    const statusId  = getArg(args, '--status')
    const wantsCreatorInfo = args.includes('--creator-info')

    if (!wantsCreatorInfo && !statusId) {
      if (!videoPath) {
        console.error('Usage: node scripts/tiktok-direct-post.js --video path.mp4 --title "caption" --privacy SELF_ONLY [--disable-comment] [--disable-duet] [--disable-stitch] [--brand-organic] [--brand-content] [--cover-ms N] [--json]')
        console.error('       node scripts/tiktok-direct-post.js --creator-info')
        console.error('       node scripts/tiktok-direct-post.js --status <publish_id>')
        process.exit(1)
      }
      if (!fs.existsSync(videoPath)) {
        console.error(`Video file not found: ${videoPath}`)
        process.exit(1)
      }
    }

    try {
      const accessToken = await getValidAccessToken()

      if (wantsCreatorInfo) {
        const info = await queryCreatorInfo(accessToken)
        console.log(asJson ? JSON.stringify(info) : JSON.stringify(info, null, 2))
        return
      }

      if (statusId) {
        const result = await checkPublishStatus(accessToken, statusId)
        console.log(asJson ? JSON.stringify(result) : JSON.stringify(result, null, 2))
        return
      }

      const coverMs = getArg(args, '--cover-ms')
      const postInfo = {
        privacy_level: getArg(args, '--privacy'),
        title: getArg(args, '--title') || '',
        disable_comment: args.includes('--disable-comment'),
        disable_duet: args.includes('--disable-duet'),
        disable_stitch: args.includes('--disable-stitch'),
        brand_organic_toggle: args.includes('--brand-organic'),
        brand_content_toggle: args.includes('--brand-content'),
        video_cover_timestamp_ms: coverMs != null ? parseInt(coverMs, 10) : undefined,
      }

      const fileSizeBytes = fs.statSync(videoPath).size
      if (!asJson) console.log(`\nDirect Post — ${path.basename(videoPath)} (${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB)`)

      const { publish_id, upload_url } = await initDirectPost(accessToken, fileSizeBytes, postInfo)
      if (!asJson) console.log(`✓ Initialized — publish_id: ${publish_id}`)

      await uploadVideo(upload_url, videoPath, fileSizeBytes)
      if (!asJson) console.log('✓ Video uploaded')

      const result = await pollUntilTerminal(accessToken, publish_id)
      if (asJson) {
        console.log(JSON.stringify({ publish_id, result }))
      } else if (result) {
        console.log(`✓ Terminal status: ${result.status}`)
      } else {
        console.log(`⚠ Still processing after polling — check later with --status ${publish_id}`)
      }
    } catch (err) {
      if (args.includes('--json')) {
        console.error(JSON.stringify({ error: err.message }))
      } else {
        console.error(`\n✗ ${err.message}`)
      }
      process.exit(1)
    }
  })()
}
