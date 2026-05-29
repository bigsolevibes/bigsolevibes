// ─────────────────────────────────────────────────────────────────────────────
// _consolidate-memory.js — one-time script to consolidate BSV-Memory.md on Drive
//
// Usage: node scripts/_consolidate-memory.js
//
// 1. Reads the merged content from the local BSV-Memory.md
// 2. Updates the canonical Drive file (ID: 1KbpRvtgBD-W9SeQ49HOcCb8SB4l_cyIW)
// 3. Finds all other files named "BSV-Memory.md" on Drive
// 4. Deletes duplicates — keeps only the canonical file
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config()
const { google } = require('googleapis')
const fs   = require('fs')
const path = require('path')

const CANONICAL_ID   = '1KbpRvtgBD-W9SeQ49HOcCb8SB4l_cyIW'
const LOCAL_MEMORY   = path.join(__dirname, '..', 'BSV-Memory.md')

function getAuth() {
  const svcPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  if (!svcPath) {
    console.error('ERROR: GOOGLE_SERVICE_ACCOUNT_PATH not set in .env')
    process.exit(1)
  }
  let credentials
  try {
    credentials = JSON.parse(fs.readFileSync(svcPath, 'utf8'))
  } catch (err) {
    console.error(`ERROR: could not read service account file at ${svcPath}: ${err.message}`)
    process.exit(1)
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

;(async function run() {
  console.log('━━━ _consolidate-memory start ━━━')

  // ── Read local merged content ──────────────────────────────────────────────

  if (!fs.existsSync(LOCAL_MEMORY)) {
    console.error(`ERROR: Local BSV-Memory.md not found at ${LOCAL_MEMORY}`)
    process.exit(1)
  }

  const content = fs.readFileSync(LOCAL_MEMORY, 'utf8')
  console.log(`Local BSV-Memory.md: ${content.length} chars`)

  const auth  = getAuth()
  const drive = google.drive({ version: 'v3', auth })

  // ── Update canonical file ──────────────────────────────────────────────────

  console.log(`Updating canonical file (${CANONICAL_ID})...`)
  try {
    await drive.files.update({
      fileId: CANONICAL_ID,
      media:  { mimeType: 'text/plain', body: content },
    })
    console.log(`✓ Canonical file updated`)
  } catch (err) {
    console.error(`ERROR: failed to update canonical file — ${err.message}`)
    if (err.message.includes('401') || err.message.includes('403')) {
      console.error('  Auth error: check GOOGLE_SERVICE_ACCOUNT_PATH and that the service account has Drive access')
    }
    process.exit(1)
  }

  // ── Find all BSV-Memory.md files ───────────────────────────────────────────

  console.log('Searching for all BSV-Memory.md files on Drive...')
  let files = []
  try {
    const res = await drive.files.list({
      q:      `name = 'BSV-Memory.md' and trashed = false`,
      fields: 'files(id, name, parents)',
    })
    files = res.data.files || []
    console.log(`Found ${files.length} file(s) named BSV-Memory.md`)
  } catch (err) {
    console.error(`ERROR: Drive search failed — ${err.message}`)
    process.exit(1)
  }

  // ── Delete duplicates ──────────────────────────────────────────────────────

  const duplicates = files.filter(f => f.id !== CANONICAL_ID)
  if (!duplicates.length) {
    console.log('No duplicates found — nothing to delete')
  } else {
    console.log(`Deleting ${duplicates.length} duplicate(s)...`)
    for (const dup of duplicates) {
      try {
        await drive.files.delete({ fileId: dup.id })
        console.log(`  ✓ Deleted: ${dup.id} (parents: ${(dup.parents || []).join(', ')})`)
      } catch (err) {
        console.error(`  WARNING: could not delete ${dup.id} — ${err.message}`)
      }
    }
  }

  console.log('━━━ _consolidate-memory complete ━━━')
  console.log(`Canonical file ID: ${CANONICAL_ID}`)
  console.log(`Content: ${content.length} chars`)
  console.log(`Duplicates deleted: ${duplicates.length}`)
})()
