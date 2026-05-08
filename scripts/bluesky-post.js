require('dotenv').config()
const { AtpAgent, RichText } = require('@atproto/api')
const sharp = require('sharp')
const fs   = require('fs')
const path = require('path')

const args = process.argv.slice(2)
function getArg(flag) {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : null
}

const imagePath = getArg('--image')
const caption   = getArg('--caption')

if (!imagePath || !caption) {
  console.error('Usage: node scripts/bluesky-post.js --image /path/to/image.png --caption "text"')
  process.exit(1)
}
if (!fs.existsSync(imagePath)) {
  console.error(`Image not found: ${imagePath}`)
  process.exit(1)
}

const HANDLE   = process.env.BLUESKY_HANDLE
const PASSWORD = process.env.BLUESKY_APP_PASSWORD

if (!HANDLE || !PASSWORD) {
  console.error('✗ BLUESKY_HANDLE and BLUESKY_APP_PASSWORD must be set in .env')
  process.exit(1)
}

const BLUESKY_MAX_BYTES = 2_000_000

// Resize to 1080x1080 with Midnight background, compress to JPEG under 2MB
async function prepareImage(filePath) {
  let quality = 90
  let bytes
  do {
    bytes = await sharp(filePath)
      .resize(1000, 1000, {
        fit:        'contain',
        background: { r: 13, g: 27, b: 42 }, // #0D1B2A Midnight
      })
      .jpeg({ quality })
      .toBuffer()
    quality -= 10
  } while (bytes.length > BLUESKY_MAX_BYTES && quality >= 40)

  if (bytes.length > BLUESKY_MAX_BYTES) {
    throw new Error(`Image cannot be compressed under 2MB (got ${bytes.length} at quality ${quality + 10})`)
  }
  console.log(`✓ Image resized to 1000x1000, compressed to ${Math.round(bytes.length / 1024)}KB (quality ${quality + 10})`)
  return bytes
}

;(async () => {
  const agent = new AtpAgent({ service: 'https://bsky.social' })

  await agent.login({ identifier: HANDLE, password: PASSWORD })
  console.log(`✓ Logged in as ${HANDLE}`)

  // Compress and upload image blob
  const imageBytes = await prepareImage(imagePath)
  const { data: blobData } = await agent.uploadBlob(imageBytes, { encoding: 'image/jpeg' })
  console.log(`✓ Image uploaded`)

  // Parse rich text (detects URLs, mentions, hashtags as facets)
  const rt = new RichText({ text: caption })
  await rt.detectFacets(agent)

  // Post
  const post = await agent.post({
    text:   rt.text,
    facets: rt.facets,
    embed: {
      $type:  'app.bsky.embed.images',
      images: [{ image: blobData.blob, alt: caption.slice(0, 300) }],
    },
  })

  console.log(`✓ Posted — uri: ${post.uri}`)
})().catch(err => {
  console.error(`✗ Bluesky post failed: ${err.message}`)
  process.exit(1)
})
