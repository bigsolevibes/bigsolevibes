require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-test-pipeline')
const REMOTE   = 'big sole vibes:Big Sole Vibes'
const TEST_DIR = `${REMOTE}/Test`

const IMAGE_MODEL = 'gemini-2.5-flash-image'
const GEMINI_API  = 'https://generativelanguage.googleapis.com/v1beta'

// ─── Minimal test plan fixture ────────────────────────────────────────────────
// A hard-coded 1-day plan that always parses correctly.
// Step 1 replaces the visual prompt line with a Claude-generated one —
// that's what tests the Claude API while keeping the rest of the plan stable.

const TODAY      = new Date().toISOString().slice(0, 10)
const DAY_NAMES  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const TODAY_NAME = DAY_NAMES[new Date().getDay()]

const FIXTURE_PLAN = (visualPrompt) => `**Arc note:** Test pipeline run / Test pipeline run

### ${TODAY_NAME} ${TODAY} — The Lounge

**Post time:** 07:30
**Theme:** Pipeline smoke test
**Copy angle:** Verify the full Sunday automation works end-to-end before it matters.
**Visual / Flow prompt:**
> ${visualPrompt}
**Platform notes:** Instagram primary. Skip TikTok for test day.
**Caption:** The details that go unnoticed are the ones that matter most. #BigSoleVibes #FootCare #TheLounge
`

// ─── Result tracking ──────────────────────────────────────────────────────────

const results = []

function pass(step, detail) {
  results.push({ step, status: 'PASS', detail })
  console.log(`  ✓ PASS  ${step}${detail ? ' — ' + detail : ''}`)
}

function fail(step, detail) {
  results.push({ step, status: 'FAIL', detail })
  console.log(`  ✗ FAIL  ${step}${detail ? ' — ' + detail : ''}`)
}

function skip(step, reason) {
  results.push({ step, status: 'SKIP', detail: reason })
  console.log(`  ─ SKIP  ${step} — ${reason}`)
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function driveUpload(localPath, remotePath) {
  execSync(`rclone copyto "${localPath}" "${remotePath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function driveList(remotePath) {
  try {
    const out = execSync(`rclone ls "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.trim().split('\n').filter(Boolean).map(line => {
      const m = line.trim().match(/^\d+\s+(.+)$/)
      return m ? m[1] : null
    }).filter(Boolean)
  } catch { return [] }
}

// ─── Parsing helpers (exact logic from gemini-bridge.js / image-gen.js) ───────

function parseDays(planContent) {
  const sections = planContent.split(/^(?=###\s)/m).filter(s => s.trim())
  const days = []
  for (const section of sections) {
    const h =
      section.match(/^###\s+(\w+)\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)/) ||
      section.match(/^###\s+(\w+)\s*[—–-]+\s*(\d{4}-\d{2}-\d{2})/)
    if (!h) continue
    days.push({ label: h[1].trim(), date: h[2].trim(), voice: (h[3]||'').trim(), brief: section.trim() })
  }
  return days
}

function parseDayPrompts(planContent) {
  const sections = planContent.split(/^(?=###\s)/m).filter(s => s.trim())
  const days = []
  let dayNum = 0
  for (const section of sections) {
    const h =
      section.match(/^###\s+(\w+)\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)/) ||
      section.match(/^###\s+(\w+)\s*[—–-]+\s*(\d{4}-\d{2}-\d{2})/)
    if (!h) continue
    dayNum++
    const m = section.match(
      /\*\*(?:Visual\s*\/\s*Flow|Flow)\s*prompt[:\*]*\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*|\n###|$)/i
    )
    if (!m) continue
    const raw = m[1].split('\n').map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean).join(' ')
    if (raw) days.push({ dayNum, label: h[1].trim(), date: h[2].trim(), visualPrompt: raw })
  }
  return days
}

function extractPostTime(brief) {
  const m = brief.match(/\*\*Post\s+time:\*\*\s*(\d{1,2}:\d{2})/i)
  return m ? m[1].trim() : null
}

function buildCaptionFile(day, generatedCopy) {
  const postTime = extractPostTime(day.brief)
  const header   = postTime ? `post_time: ${postTime}\n` : ''
  return `${header}# ${day.label} — ${day.date}\n\n${generatedCopy.trim()}\n`
}

// groupFiles (exact logic from watch-drive.js)
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv'])

function groupFiles(fileNames) {
  const groups = {}
  for (const name of fileNames) {
    const ext      = path.extname(name).toLowerCase()
    const fullBase = path.basename(name, ext)
    const base     = fullBase.replace(/-(?:video|image)$/, '')
    if (!groups[base]) groups[base] = { media: null, caption: null }
    if (ext === '.md')             groups[base].caption = name
    else if (IMAGE_EXTS.has(ext)) groups[base].media = { name, type: 'image' }
    else if (VIDEO_EXTS.has(ext)) groups[base].media = { name, type: 'video' }
  }
  return groups
}

// ─── Step 1: media-director ───────────────────────────────────────────────────
// Call Claude API to generate a one-sentence visual prompt, inject it into the
// fixture plan, and upload test-plan.md to Drive Test/. This proves:
//   • ANTHROPIC_API_KEY is valid
//   • Claude API responds
//   • rclone can write to Drive Test/

async function step1_mediaPlan(client) {
  console.log('\n── Step 1: media-director (Claude API + Drive write) ──')

  let visualPrompt
  try {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 80,
      messages: [{
        role:    'user',
        content: 'Write ONE image generation sentence for a BSV foot care ad: a man in a specific real-world setting with a detail about his feet or footwear. Format: "Photorealistic [scene], [man description], [key visual detail], 1:1 square ratio, no text." Output only the sentence.',
      }],
    })
    visualPrompt = msg.content[0].text.trim()
    pass('1a Claude API', `${visualPrompt.length} chars — "${visualPrompt.slice(0, 60)}…"`)
  } catch (err) {
    fail('1a Claude API', err.message)
    return null
  }

  const planText  = FIXTURE_PLAN(visualPrompt)
  const localPath = path.join(TEMP_DIR, 'test-plan.md')
  fs.writeFileSync(localPath, planText)

  try {
    driveUpload(localPath, `${TEST_DIR}/test-plan.md`)
    pass('1b Drive write', `test-plan.md → ${TEST_DIR}/`)
  } catch (err) {
    fail('1b Drive write', err.message)
    return null
  }

  // Verify plan parses correctly
  const days = parseDays(planText)
  if (!days.length) {
    fail('1c Plan parse', 'parseDays returned 0 days — fixture format broken')
    return null
  }
  pass('1c Plan parse', `${days.length} day(s) parsed — ${days[0].label} ${days[0].date} "${days[0].voice}"`)

  return planText
}

// ─── Step 2: gemini-bridge ────────────────────────────────────────────────────
// Parse the test plan, generate a caption with Claude, build the caption file
// (with post_time: header and ## platform sections), and upload to Test/.

async function step2_geminiBridge(client, planText) {
  console.log('\n── Step 2: gemini-bridge (caption generation + Drive write) ──')

  if (!planText) { skip('Step 2', 'Step 1 failed'); return false }

  const days = parseDays(planText)
  const day  = days[0]

  // Use the same system + user prompts as gemini-bridge.js
  const systemPrompt = `You are a social media copywriter for Big Sole Vibes (BSV) — a premium men's foot care brand.
Brand voice: confident, dry, authoritative. Never cute. Never clinical. Never preachy.
Produce final approved copy for each platform. Output ONLY the structured sections — no preamble, no commentary.`

  const userPrompt = `Here is today's content brief from the Media Director:

${day.brief}

---

## instagram
[Caption for Instagram — 50–150 words, punchy opener, clear close. Include #BigSoleVibes and 2–3 hashtags.]

## twitter
[X/Twitter caption — sharp, under 240 characters. One hashtag max.]

## tiktok
[TikTok caption — hook-first, under 120 chars, 2 hashtags.]`

  let copy
  try {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })
    copy = msg.content[0].text.trim()
    pass('2a Claude API', `caption generated (${copy.length} chars)`)
  } catch (err) {
    fail('2a Claude API', err.message)
    return false
  }

  const fileContent = buildCaptionFile(day, copy)
  const localPath   = path.join(TEMP_DIR, 'test-day1.md')
  fs.writeFileSync(localPath, fileContent)

  try {
    driveUpload(localPath, `${TEST_DIR}/test-day1.md`)
    pass('2b Drive write', `test-day1.md → ${TEST_DIR}/`)
  } catch (err) {
    fail('2b Drive write', err.message)
    return false
  }

  // Verify caption file structure
  const hasPostTime = fileContent.startsWith('post_time:')
  const hasSections = /^## instagram/im.test(fileContent)
  if (!hasPostTime) fail('2c Caption format', 'missing post_time: header')
  else if (!hasSections) fail('2c Caption format', 'missing ## instagram section')
  else pass('2c Caption format', `post_time header ✓, platform sections ✓`)

  return hasPostTime && hasSections
}

// ─── Step 3: image-gen ────────────────────────────────────────────────────────
// Parse the visual prompt from the test plan, call Gemini image generation,
// and upload test-day1-image.png to Drive Test/.

async function step3_imageGen(geminiKey, planText) {
  console.log('\n── Step 3: image-gen (Gemini API + Drive write) ──')

  if (!planText) { skip('Step 3', 'Step 1 failed'); return false }
  if (!geminiKey) { fail('Step 3', 'GEMINI_API_KEY not set'); return false }

  const days = parseDayPrompts(planText)
  if (!days.length) { fail('3a Prompt parse', 'no visual prompt found in test plan'); return false }

  const { visualPrompt } = days[0]
  pass('3a Prompt parse', `"${visualPrompt.slice(0, 60)}…"`)

  let buf
  try {
    const url  = `${GEMINI_API}/models/${IMAGE_MODEL}:generateContent?key=${geminiKey}`
    const body = {
      contents:        [{ parts: [{ text: visualPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }
    const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${data?.error?.message || JSON.stringify(data)}`)
    const parts     = data?.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'))
    if (!imagePart) throw new Error(`no image part in response — keys: ${JSON.stringify(parts.map(p => Object.keys(p)))}`)
    buf = Buffer.from(imagePart.inlineData.data, 'base64')
    pass('3b Gemini API', `image received (${Math.round(buf.length / 1024)}KB)`)
  } catch (err) {
    fail('3b Gemini API', err.message)
    return false
  }

  const localPath = path.join(TEMP_DIR, 'test-day1-image.png')
  fs.writeFileSync(localPath, buf)

  try {
    driveUpload(localPath, `${TEST_DIR}/test-day1-image.png`)
    pass('3c Drive write', `test-day1-image.png → ${TEST_DIR}/`)
  } catch (err) {
    fail('3c Drive write', err.message)
    return false
  }

  return true
}

// ─── Step 4: watch-drive pairing ─────────────────────────────────────────────
// Verify that groupFiles() — the exact same function watch-drive.js uses —
// correctly pairs test-day1.md with test-day1-image.png under base "test-day1".
// Also confirm both files are actually visible in the Drive Test/ folder.

async function step4_pairingCheck(captionOk, imageOk) {
  console.log('\n── Step 4: watch-drive pairing (groupFiles logic + Drive verify) ──')

  // Local groupFiles check — pure logic, no network needed
  const files  = ['test-day1.md', 'test-day1-image.png']
  const groups = groupFiles(files)
  const group  = groups['test-day1']

  if (!group)                     fail('4a groupFiles', `no group for "test-day1" — got keys: ${Object.keys(groups).join(', ')}`)
  else if (!group.caption)        fail('4a groupFiles', 'test-day1.md not recognised as caption')
  else if (!group.media)          fail('4a groupFiles', 'test-day1-image.png not recognised as media')
  else if (group.media.type !== 'image') fail('4a groupFiles', `media type "${group.media.type}" — expected "image"`)
  else pass('4a groupFiles', `"test-day1.md" + "test-day1-image.png" → base "test-day1" (caption ✓, image ✓)`)

  // Drive presence check
  if (!captionOk || !imageOk) {
    skip('4b Drive verify', 'one or both uploads failed — skipping Drive listing check')
    return
  }

  try {
    const listed = driveList(TEST_DIR)
    const hasCaption = listed.some(f => f === 'test-day1.md')
    const hasImage   = listed.some(f => f === 'test-day1-image.png')
    if (hasCaption && hasImage)
      pass('4b Drive verify', `both files confirmed in ${TEST_DIR}`)
    else
      fail('4b Drive verify', `Drive listing: ${listed.join(', ')} — caption:${hasCaption} image:${hasImage}`)
  } catch (err) {
    fail('4b Drive verify', err.message)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  console.log('━━━ BSV Pipeline Dry-Run Test ━━━')
  console.log(`Test folder : ${TEST_DIR}`)
  console.log(`Timestamp   : ${new Date().toISOString()}`)
  console.log('No posts will be made. Ready to Post/ is never touched.\n')

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const geminiKey    = process.env.GEMINI_API_KEY

  if (!anthropicKey) {
    console.error('ERROR: ANTHROPIC_API_KEY not set — cannot run test')
    process.exit(1)
  }
  if (!geminiKey) {
    console.warn('WARNING: GEMINI_API_KEY not set — Step 3 (image-gen) will fail')
  }

  const client = new Anthropic({ apiKey: anthropicKey })

  const planText   = await step1_mediaPlan(client)
  const captionOk  = await step2_geminiBridge(client, planText)
  const imageOk    = await step3_imageGen(geminiKey, planText)
  await step4_pairingCheck(captionOk, imageOk)

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log('\n━━━ Summary ━━━')
  const maxLen = Math.max(...results.map(r => r.step.length))
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '─'
    console.log(`  ${icon} ${r.status}  ${r.step.padEnd(maxLen)}  ${r.detail || ''}`)
  }

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length
  console.log(`\n  ${passed} passed · ${failed} failed · ${skipped} skipped`)

  if (failed === 0) {
    console.log('\n  Pipeline is healthy. ✓')
  } else {
    console.log('\n  Fix the failures above before Sunday.')
    process.exit(1)
  }
})()
