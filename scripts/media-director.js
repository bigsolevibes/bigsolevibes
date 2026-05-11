require('dotenv').config()
const Anthropic  = require('@anthropic-ai/sdk').default
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT      = path.join(__dirname, '..')
const LOG_FILE  = path.join(ROOT, 'logs', 'media-director.log')
const TEMP_DIR  = path.join(os.homedir(), 'tmp', 'bsv-media-director')
const REMOTE    = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_KEYS = new Set(['slot','day','date','theme','world','post_time','platform','image_prompt','video_prompt','audio_prompt','caption'])
const VALID_DAYS = ['mon','tue','wed','thu','fri','sat','sun']
const DOW_TO_SLUG = ['sun','mon','tue','wed','thu','fri','sat']
const DAY_NAMES  = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' }
const DAY_TO_DOW = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFields(block) {
  const fields = {}
  let key = null
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/)
    if (m && KNOWN_KEYS.has(m[1])) { key = m[1]; fields[key] = m[2].trim() }
    else if (key && line.trim())    fields[key] += ' ' + line.trim()
  }
  return fields
}

function computeSlug(f) {
  return (f.slot || '').trim() || 'unknown'
}

// Replaces a named slot block in the plan text, or appends it if absent.
function replaceSlotInPlan(planContent, slug, newBlock) {
  const parts = planContent.split(/^(?=slot:\s*\w+-(?:am|pm)\b)/m)
  const idx = parts.findIndex(p => {
    const m = p.trimStart().match(/^slot:\s*(\S+)/)
    return m && m[1] === slug
  })
  if (idx >= 0) {
    parts[idx] = newBlock.trim() + '\n\n'
    return parts.join('')
  }
  return planContent.trimEnd() + '\n\n' + newBlock.trim() + '\n'
}

function isoWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7)
  return [d.getFullYear(), String(week).padStart(2, '0')]
}

// Returns the next calendar date for the given day slug (always at least 1 day ahead).
function nextDateForSlug(slug) {
  const target = DAY_TO_DOW[slug]
  const now    = new Date()
  const diff   = ((target - now.getDay()) + 7) % 7 || 7
  const d = new Date(now)
  d.setDate(now.getDate() + diff)
  return d
}

function getHandoff() {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Handoff/BSV-Handoff-v5.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const localPath = path.join(TEMP_DIR, 'BSV-Handoff-v5.md')
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf8')
  } catch {}
  return null
}

// ─── Single-slot fill (called by gemini-bridge healer) ────────────────────────

async function fillSingleSlot(slug, client) {
  log(`━━━ slot fill: ${slug} ━━━`)

  let planFilename, planContent
  try {
    const listing = execSync(`rclone ls "${REMOTE}/Content Plan/"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const plans = listing.trim().split('\n').filter(Boolean)
      .map(l => l.trim().replace(/^\d+\s+/, ''))
      .filter(f => /^week-\d{4}-\d{2}\.md$/.test(f))
      .sort()
    if (!plans.length) throw new Error('no week plans found in Content Plan/')

    const now = new Date()
    const [curYear, curWeek] = isoWeek(now)
    const currentKey = `${curYear}-${curWeek}`
    const upcoming = plans.filter(f => { const m = f.match(/^week-(\d{4}-\d{2})\.md$/); return m && m[1] >= currentKey })
    planFilename = upcoming.length ? upcoming[0] : plans[plans.length - 1]

    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Content Plan/${planFilename}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, planFilename)
    if (!fs.existsSync(p)) throw new Error(`download failed for ${planFilename}`)
    planContent = fs.readFileSync(p, 'utf8')
    log(`Loaded plan: ${planFilename}`)
  } catch (err) {
    log(`ERROR: could not load week plan: ${err.message}`)
    process.exit(1)
  }

  const systemPrompt = `You are the Media Director for Big Sole Vibes (BSV) — a premium men's foot care lifestyle brand.

BSV speaks to the man who does both: leather chair and bourbon on Thursday, sneakers and tequila on Friday night.
Brand palette: Midnight #0D1B2A, Bourbon #C17D2E, Cream #F5ECD7, Steel #4A6380.
Content worlds: The Court (athletic), The Boardroom (professional), The Lounge (home ritual), The Grind (work/outdoors).
Video: Always 7–8 seconds, 9:16 vertical. End video_prompt with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."

Output format — use this exact structure and nothing else:

slot: [slug]
date: [Day name, YYYY-MM-DD]
theme: [one line]
world: [The Court / The Boardroom / The Lounge / The Grind]
post_time: [09:00 CDT for AM — 19:00 CDT for PM]
image_prompt: [self-contained Imagen 4 prompt, dark cinematic, 1:1, no text or logos, paste-ready]
video_prompt: [Veo 3.1 prompt, 7–8s, 9:16, no text or logos, end with seamless loop instruction]
audio_prompt: [one line ambient sound description]
caption: [draft caption with #BigSoleVibes]

Output ONLY the single slot block — no preamble, no commentary, no other slots.`

  const userPrompt = `The following week plan exists but slot ${slug} is missing or invalid. Generate ONLY that slot.

Use the same week dates as the surrounding slots. Choose a world not already used in adjacent slots.

Existing plan for context:
${planContent.slice(0, 4000)}${planContent.length > 4000 ? '\n[truncated]' : ''}`

  log(`Calling Claude API for slot: ${slug}...`)
  let newSlotBlock
  try {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })
    newSlotBlock = msg.content[0].text.trim()
  } catch (err) {
    log(`ERROR: Claude API failed for slot ${slug}: ${err.message}`)
    process.exit(1)
  }

  if (!newSlotBlock.startsWith('slot:')) {
    log(`ERROR: response for ${slug} does not begin with "slot:" — aborting`)
    log(`Response preview: ${newSlotBlock.slice(0, 200)}`)
    process.exit(1)
  }

  const updatedPlan = replaceSlotInPlan(planContent, slug, newSlotBlock)
  const localPath   = path.join(TEMP_DIR, planFilename)
  fs.writeFileSync(localPath, updatedPlan)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Content Plan/${planFilename}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    log(`Uploaded updated plan → ${REMOTE}/Content Plan/${planFilename}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.message}`)
    process.exit(1)
  }

  log(`━━━ slot fill complete: ${slug} ━━━`)
}

// ─── Daily generation — 2 slots for one day ───────────────────────────────────

async function generateDay(targetDay, client) {
  log(`━━━ generate day: ${targetDay} ━━━`)

  const targetDate = nextDateForSlug(targetDay)
  const dateStr    = targetDate.toISOString().slice(0, 10)
  const dayName    = DAY_NAMES[targetDay]
  const [year, week] = isoWeek(targetDate)
  const planFileName = `week-${year}-${week}.md`

  // Load existing week plan for context (may not exist yet)
  let existingPlan = ''
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Content Plan/${planFileName}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, planFileName)
    if (fs.existsSync(p)) existingPlan = fs.readFileSync(p, 'utf8')
  } catch {}

  log(existingPlan ? `Loaded existing plan: ${planFileName}` : `No existing plan — will create ${planFileName}`)

  const handoff = getHandoff()

  const systemPrompt = `You are the Media Director for Big Sole Vibes (BSV).

## Who BSV Is

Big Sole Vibes is not a foot care brand. It is a lifestyle brand that starts at the feet.

The foot care is the entry point. The lounge is the destination. One day — a physical space where a man walks in, gets taken care of, has a bourbon or a tequila, and leaves feeling like himself. That vision lives in every piece of content we make.

BSV is for the man who does both. He has the leather chair and bourbon on Thursday. He has the sneakers and tequila on Friday night. Same man. Same standard. Different energy depending on the day. We speak to both versions of him equally.

"It's what happens when he takes his shoes and socks off that matters to us."

## Brand Voice
BSV is the friend who actually knows about feet but never makes it weird. Not a podiatrist. Not a spa. The guy at the party who makes you want to fix your heels.

- Light, enjoyable, funny — but always with a point
- Educational without being preachy
- Self-aware without being try-hard
- Confident without being loud
- Makes feet interesting — that is the whole job

Every post should do at least one of these:
- Make someone laugh
- Make someone feel something
- Teach someone something they didn't know
- Make someone look down at their feet

The dark cinematic posts set the vibe. The funny posts earn the follow. The educational posts earn the trust. All three build the brand.

### The Self-Awareness Rule
Once per week, write a caption that winks at the AI generation. Own it. Never apologize for it. BSV takes feet seriously — not itself.

## Brand Palette
- Midnight #0D1B2A
- Bourbon #C17D2E
- Cream #F5ECD7
- Navy #162233
- Steel #4A6380

## Content Worlds — Rotate, Never Repeat Back to Back
- The Court (athletic, 20s–30s)
- The Boardroom (professional, 40s–60s)
- The Lounge (home ritual, 30s–50s)
- The Grind (work/outdoors, any age)

Vary race, age, and setting. Never the same world back to back. AM and PM slots must use different worlds and different visual approaches.

## Video Standards — Non-Negotiable
- Always 7–8 seconds. Never 30.
- End every video_prompt with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."

## Output Format — EXACTLY 2 Slots

Generate exactly these 2 slots in order:

slot: ${targetDay}-am
date: ${dayName}, ${dateStr}
theme: [one line]
world: [The Court / The Boardroom / The Lounge / The Grind]
post_time: 09:00 CDT
image_prompt: [Fully self-contained photorealistic Imagen 4 prompt — dark cinematic, no text, no logos, square 1:1. Paste-ready. No references to other slots.]
video_prompt: [Veo 3.1 motion prompt — 7–8 seconds, 9:16 vertical, no text, no logos, no watermarks. End with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."]
audio_prompt: [one line ambient sound description]
caption: [draft caption with #BigSoleVibes]

slot: ${targetDay}-pm
date: ${dayName}, ${dateStr}
theme: [one line]
world: [The Court / The Boardroom / The Lounge / The Grind]
post_time: 19:00 CDT
image_prompt: [...]
video_prompt: [...]
audio_prompt: [...]
caption: [...]

Output ONLY these 2 slot blocks — no preamble, no commentary, no additional slots.`

  const userPrompt = `Generate BSV content for ${dayName} ${dateStr} — 2 slots only.

${targetDay}-am posts at 9:00am. ${targetDay}-pm posts at 7:00pm. Use different worlds and opposite energy between AM and PM.

Push into visual territory that is fresh and specific to a real man in a real moment. Do not default to the leather ottoman or bourbon glass setup.

${existingPlan ? `## Existing week plan (do not repeat these worlds or visuals):\n${existingPlan.slice(0, 2000)}${existingPlan.length > 2000 ? '\n[truncated]' : ''}` : ''}

${handoff ? `## Brand strategy context\n${handoff.slice(0, 1500)}${handoff.length > 1500 ? '\n[truncated]' : ''}` : ''}`

  log('Calling Claude API...')
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const response = msg.content[0].text.trim()
  log(`Done — ${msg.usage?.output_tokens ?? '?'} tokens, stop: ${msg.stop_reason}`)

  const amPresent = response.includes(`slot: ${targetDay}-am`)
  const pmPresent = response.includes(`slot: ${targetDay}-pm`)
  if (!amPresent || !pmPresent) {
    log(`ERROR: response missing slots — amPresent=${amPresent} pmPresent=${pmPresent}`)
    log(`Response preview: ${response.slice(0, 300)}`)
    process.exit(1)
  }

  // Patch both slots into the week plan file
  let planContent = existingPlan || ''
  const slotBlocks = response.split(/^(?=slot:\s*\w+-(?:am|pm)\b)/m).filter(s => s.trim())
  for (const block of slotBlocks) {
    const m = block.trimStart().match(/^slot:\s*(\S+)/)
    if (m) planContent = replaceSlotInPlan(planContent, m[1], block)
  }

  const localPath = path.join(TEMP_DIR, planFileName)
  fs.writeFileSync(localPath, planContent)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Content Plan/${planFileName}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    log(`Uploaded → ${REMOTE}/Content Plan/${planFileName}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  log(`━━━ day generation complete: ${targetDay} ━━━`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ media-director start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }
  const client = new Anthropic({ apiKey })

  // --slot: fill a single missing slot (called by gemini-bridge healer)
  const slotArg = process.argv.indexOf('--slot')
  if (slotArg !== -1) {
    const singleSlot = process.argv[slotArg + 1]
    if (!singleSlot) { log('ERROR: --slot requires a slug (e.g. --slot mon-am)'); process.exit(1) }
    await fillSingleSlot(singleSlot, client)
    log('━━━ media-director complete ━━━\n')
    return
  }

  // --day <slug>: generate 2 slots for that day; defaults to tomorrow when omitted
  let targetDay
  const dayArg = process.argv.indexOf('--day')
  if (dayArg !== -1) {
    targetDay = (process.argv[dayArg + 1] || '').toLowerCase()
    if (!VALID_DAYS.includes(targetDay)) {
      log(`ERROR: --day requires a slug (${VALID_DAYS.join('|')})`)
      process.exit(1)
    }
  } else {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    targetDay = DOW_TO_SLUG[tomorrow.getDay()]
    log(`No --day flag — defaulting to tomorrow: ${targetDay}`)
  }

  await generateDay(targetDay, client)

  // Chain to gemini-bridge --day
  log(`Spawning gemini-bridge.js --day ${targetDay}...`)
  const bridge = spawnSync(process.execPath, [path.join(__dirname, 'gemini-bridge.js'), '--day', targetDay], {
    stdio: 'inherit',
    env:   process.env,
  })
  if (bridge.status !== 0) log(`ERROR: gemini-bridge exited ${bridge.status}`)

  log('━━━ media-director complete ━━━\n')
})()
