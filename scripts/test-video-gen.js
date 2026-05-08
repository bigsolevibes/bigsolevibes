require('dotenv').config()
const { GoogleGenAI } = require('@google/genai')
const path = require('path')
const fs   = require('fs')

const VIDEO_MODEL   = 'veo-3.1-fast-generate-preview'
const POLL_INTERVAL = 10_000
const OUT_PATH      = path.join(__dirname, '..', 'test-video.mp4')

const VIDEO_PROMPT =
  'Static camera. Dark cinematic lounge. A man\'s well-groomed bare feet rest on a leather ottoman. ' +
  'Warm amber lamplight flickers slowly. Bourbon glass catches the light. No hands. No human movement. ' +
  'Only environmental motion — subtle light shift and shadows. ' +
  '9:16 vertical, no text, no logos, no watermarks.'

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

async function generateVideo(ai, apiKey, prompt) {
  let operation = await ai.models.generateVideos({
    model:  VIDEO_MODEL,
    prompt,
    config: { aspectRatio: '9:16' },
  })

  log(`operation started: ${operation.name}`)

  while (!operation.done) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    operation = await ai.operations.getVideosOperation({ operation })
    log(`polling... done=${operation.done}`)
  }

  const videos = operation.response?.generatedVideos
  if (!videos?.length) throw new Error('No generated videos in operation response')

  const uri = videos[0].video.uri
  if (!uri) throw new Error('generatedVideo.video.uri is empty')

  const fetchUrl = uri.includes('?') ? `${uri}&key=${apiKey}` : `${uri}?key=${apiKey}`
  const res = await fetch(fetchUrl)
  if (!res.ok) throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`)

  return Buffer.from(await res.arrayBuffer())
}

;(async function run() {
  log('━━━ test-video-gen start ━━━')
  log(`model: ${VIDEO_MODEL}`)
  log(`prompt: ${VIDEO_PROMPT.slice(0, 100)}…`)

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) { log('ERROR: GEMINI_API_KEY not set'); process.exit(1) }

  const ai = new GoogleGenAI({ apiKey })

  try {
    const buf = await generateVideo(ai, apiKey, VIDEO_PROMPT)
    fs.writeFileSync(OUT_PATH, buf)
    log(`✓ saved → ${OUT_PATH} (${Math.round(buf.length / 1024)}KB)`)
  } catch (err) {
    log(`ERROR: ${err.message}`)
    process.exit(1)
  }

  log('━━━ test-video-gen complete ━━━')
})()
