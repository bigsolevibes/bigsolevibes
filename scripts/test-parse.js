// Parse test for the new flat day format produced by media-director.js.
// No Drive reads, no API calls, no .env needed.
// Run: node scripts/test-parse.js

const SAMPLE_PLAN = `
day: 1
date: Thursday, 2026-05-08
theme: The man who earned the quiet
world: The Lounge
post_time: 19:00
platform: instagram
image_prompt: Photorealistic dark cinematic still. A 45-year-old Black man's bare feet rest on a worn leather ottoman, warm amber side lamp casts long shadows. Bourbon glass on side table, out of focus. Minimal depth of field. Dark mahogany walls. 1:1 square ratio, no text, no logos, no watermarks.
video_prompt: Static camera, low angle. Bare feet on leather ottoman, amber lamp flickers slowly. Bourbon glass at edge of frame, light refracts through glass. No human movement — only the slow pulse of the flame. Dark, warm, unhurried. Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop.
audio_prompt: Soft crackling fireplace, low ambient jazz saxophone, unhurried and warm.
caption: The day is done. Everything else can wait. #BigSoleVibes #TheLounge #MensGrooming #FootCare

day: 2
date: Tuesday, 2026-05-12
theme: Fresh kicks on Chicago pavement
world: The Court
post_time: 12:00
platform: tiktok
image_prompt: Macro low-angle shot of pristine white Air Force 1s on wet Chicago concrete, golden-hour reflections, gritty urban texture, high contrast. A 24-year-old Latino man mid-stride, cropped at ankle. 1:1 square ratio, no text, no logos, no watermarks.
video_prompt: Low angle tracking shot. Crisp sneakers hit wet pavement mid-stride, water beads scatter, steam rises from a grate. Camera holds low, world moves through frame. City energy, purposeful motion. Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop.
audio_prompt: Up-tempo lo-fi hip hop, heavy bass, crisp snare, distant city sounds.
caption: Can't be fresh from the ankle up if you're not fresh below it. 👟 #BigSoleVibes #SneakerCulture #ChicagoStreets
`.trim()

// ─── Inline parser (mirrors the logic in all updated scripts) ─────────────────

const KNOWN_KEYS = new Set(['day','date','theme','world','post_time','platform','image_prompt','video_prompt','audio_prompt','caption'])

function parseFields(block) {
  const fields = {}
  let key = null
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/)
    if (m && KNOWN_KEYS.has(m[1])) {
      key = m[1]
      fields[key] = m[2].trim()
    } else if (key && line.trim()) {
      fields[key] += ' ' + line.trim()
    }
  }
  return fields
}

// image-gen.js: parseDayPrompts → needs dayNum, label, date, visualPrompt (image_prompt)
function parseDayPrompts_imageGen(planContent) {
  const blocks = planContent.split(/^(?=day:\s*\d+\b)/m).filter(s => s.trim())
  const days = []
  for (const block of blocks) {
    const f = parseFields(block)
    if (!f.day) continue
    const dayNum    = parseInt(f.day, 10)
    const dateMatch = (f.date || '').match(/(\w+)[,\s]+(\d{4}-\d{2}-\d{2})/)
    const label     = dateMatch ? dateMatch[1] : `Day${dayNum}`
    const date      = dateMatch ? dateMatch[2] : (f.date || '').trim()
    if (!f.image_prompt) continue
    days.push({ dayNum, label, date, visualPrompt: f.image_prompt })
  }
  return days
}

// video-gen.js: parseDayPrompts → needs dayNum, label, date, videoPrompt (video_prompt)
function parseDayPrompts_videoGen(planContent) {
  const blocks = planContent.split(/^(?=day:\s*\d+\b)/m).filter(s => s.trim())
  const days = []
  for (const block of blocks) {
    const f = parseFields(block)
    if (!f.day) continue
    const dayNum    = parseInt(f.day, 10)
    const dateMatch = (f.date || '').match(/(\w+)[,\s]+(\d{4}-\d{2}-\d{2})/)
    const label     = dateMatch ? dateMatch[1] : `Day${dayNum}`
    const date      = dateMatch ? dateMatch[2] : (f.date || '').trim()
    if (!f.video_prompt) continue
    days.push({ dayNum, label, date, videoPrompt: f.video_prompt })
  }
  return days
}

// gemini-bridge.js: parseDays + extractVisualPrompt + extractPostTime + extractVideoPrompt
function parseDays_bridge(planContent) {
  const blocks = planContent.split(/^(?=day:\s*\d+\b)/m).filter(s => s.trim())
  const days = []
  for (const block of blocks) {
    const f = parseFields(block)
    if (!f.day) continue
    const dayNum    = parseInt(f.day, 10)
    const dateMatch = (f.date || '').match(/(\w+)[,\s]+(\d{4}-\d{2}-\d{2})/)
    const label     = dateMatch ? dateMatch[1] : `Day${dayNum}`
    const date      = dateMatch ? dateMatch[2] : (f.date || '').trim()
    days.push({ dayNum, label, date, voice: f.world || '', brief: block.trim() })
  }
  return days
}

function extractPostTime(brief) {
  const f = parseFields(brief)
  if (!f.post_time) return null
  const m = f.post_time.match(/(\d{1,2}:\d{2})/)
  return m ? m[1] : null
}

function extractVisualPrompt(brief) {
  const f = parseFields(brief)
  return f.image_prompt || null
}

function extractVideoPrompt(brief) {
  const f = parseFields(brief)
  return f.video_prompt || null
}

function extractAudioPrompt(brief) {
  const f = parseFields(brief)
  return f.audio_prompt || null
}

// ─── Assertions ───────────────────────────────────────────────────────────────

let pass = 0
let fail = 0

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓  ${label}`)
    pass++
  } else {
    console.error(`  ✗  ${label}`)
    console.error(`       expected: ${JSON.stringify(expected)}`)
    console.error(`       actual:   ${JSON.stringify(actual)}`)
    fail++
  }
}

function assertContains(label, actual, substring) {
  if (typeof actual === 'string' && actual.includes(substring)) {
    console.log(`  ✓  ${label}`)
    pass++
  } else {
    console.error(`  ✗  ${label}`)
    console.error(`       expected to contain: ${JSON.stringify(substring)}`)
    console.error(`       actual: ${JSON.stringify(actual)}`)
    fail++
  }
}

console.log('\n━━━ image-gen parseDayPrompts ━━━\n')
const imgDays = parseDayPrompts_imageGen(SAMPLE_PLAN)
assert('parses 2 days',              imgDays.length,          2)
assert('day1 dayNum',                imgDays[0].dayNum,       1)
assert('day1 label',                 imgDays[0].label,        'Thursday')
assert('day1 date',                  imgDays[0].date,         '2026-05-08')
assertContains('day1 image_prompt',  imgDays[0].visualPrompt, 'leather ottoman')
assert('day2 dayNum',                imgDays[1].dayNum,       2)
assert('day2 label',                 imgDays[1].label,        'Tuesday')
assertContains('day2 image_prompt',  imgDays[1].visualPrompt, 'Air Force 1')

console.log('\n━━━ video-gen parseDayPrompts ━━━\n')
const vidDays = parseDayPrompts_videoGen(SAMPLE_PLAN)
assert('parses 2 days',              vidDays.length,          2)
assert('day1 dayNum',                vidDays[0].dayNum,       1)
assert('day1 label',                 vidDays[0].label,        'Thursday')
assertContains('day1 video_prompt',  vidDays[0].videoPrompt,  'seamless infinite loop')
assert('day2 dayNum',                vidDays[1].dayNum,       2)
assertContains('day2 video_prompt',  vidDays[1].videoPrompt,  'water beads scatter')

console.log('\n━━━ gemini-bridge parseDays ━━━\n')
const bridgeDays = parseDays_bridge(SAMPLE_PLAN)
assert('parses 2 days',              bridgeDays.length,       2)
assert('day1 dayNum',                bridgeDays[0].dayNum,    1)
assert('day1 label',                 bridgeDays[0].label,     'Thursday')
assert('day1 date',                  bridgeDays[0].date,      '2026-05-08')
assert('day1 voice/world',           bridgeDays[0].voice,     'The Lounge')
assert('day2 voice/world',           bridgeDays[1].voice,     'The Court')

console.log('\n━━━ gemini-bridge field extractors ━━━\n')
const brief1 = bridgeDays[0].brief
const brief2 = bridgeDays[1].brief
assert('day1 post_time',             extractPostTime(brief1),     '19:00')
assert('day2 post_time',             extractPostTime(brief2),     '12:00')
assertContains('day1 image_prompt',  extractVisualPrompt(brief1), 'leather ottoman')
assertContains('day2 image_prompt',  extractVisualPrompt(brief2), 'Air Force 1')
assertContains('day1 video_prompt',  extractVideoPrompt(brief1),  'seamless infinite loop')
assertContains('day2 video_prompt',  extractVideoPrompt(brief2),  'water beads scatter')
assertContains('day1 audio_prompt',  extractAudioPrompt(brief1),  'jazz saxophone')
assertContains('day2 audio_prompt',  extractAudioPrompt(brief2),  'lo-fi hip hop')

console.log(`\n━━━ result: ${pass} passed, ${fail} failed ━━━\n`)
if (fail > 0) process.exit(1)
