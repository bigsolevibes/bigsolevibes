require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'gemini-bridge.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-gemini-bridge')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function listDriveFiles(remotePath) {
  try {
    const out = execSync(`rclone ls "${remotePath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    return out.trim().split('\n').filter(Boolean).map(line => {
      const m = line.trim().match(/^\d+\s+(.+)$/)
      return m ? m[1] : null
    }).filter(Boolean)
  } catch { return [] }
}

function downloadFile(remotePath, localDir) {
  execSync(`rclone copy "${remotePath}" "${localDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function uploadFile(localPath, remotePath) {
  execSync(`rclone copyto "${localPath}" "${remotePath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

// ─── Plan loading ─────────────────────────────────────────────────────────────

function currentWeekKey() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7)
  return `${d.getFullYear()}-${String(week).padStart(2, '0')}`
}

// Returns the current or nearest upcoming week plan from Drive.
function loadCurrentWeekPlan() {
  const files = listDriveFiles(`${REMOTE}/Content Plan`)
  const plans = files.filter(f => /^week-\d{4}-\d{2}\.md$/.test(f)).sort()
  if (!plans.length) return null

  const current  = currentWeekKey()
  const upcoming = plans.filter(f => { const m = f.match(/^week-(\d{4}-\d{2})\.md$/); return m && m[1] >= current })
  const filename = upcoming.length ? upcoming[0] : plans[plans.length - 1]

  fs.mkdirSync(TEMP_DIR, { recursive: true })
  log(`Fetching plan: ${filename}`)
  try { downloadFile(`${REMOTE}/Content Plan/${filename}`, TEMP_DIR) } catch (err) {
    log(`ERROR: download failed for ${filename}: ${err.message}`)
    return null
  }

  const localPath = path.join(TEMP_DIR, filename)
  if (!fs.existsSync(localPath)) { log(`ERROR: ${filename} not found after download`); return null }
  return { filename, content: fs.readFileSync(localPath, 'utf8') }
}

// ─── Day parsing ──────────────────────────────────────────────────────────────

const KNOWN_KEYS = new Set(['slot','day','date','theme','world','post_time','platform','image_prompt','video_prompt','audio_prompt','caption'])

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

function parseDays(planContent) {
  const blocks = planContent.split(/^(?=slot:\s*\w+-(?:am|pm)\b)/m).filter(s => s.trim())
  const days = []
  for (const block of blocks) {
    const f = parseFields(block)
    if (!f.slot) continue
    const slug      = f.slot.trim()
    const dateMatch = (f.date || '').match(/(\w+)[,\s]+(\d{4}-\d{2}-\d{2})/)
    const label     = dateMatch ? dateMatch[1] : slug
    const date      = dateMatch ? dateMatch[2] : (f.date || '').trim()
    days.push({ slug, label, date, voice: f.world || '', brief: block.trim() })
  }
  return days
}

function daySlug(day) { return day.slug }

// ─── Content extraction ───────────────────────────────────────────────────────

function extractArcNote(planContent) {
  const preamble = planContent.split(/^(?=###\s)/m)[0] || ''
  const match = preamble.match(/\*\*Arc note[:\*]*\*\*[^\n]*\n?([\s\S]*?)(?=\n##|\n###|$)/i)
  if (!match) return null
  return match[0].replace(/\*\*/g, '').trim()
}

function extractVisualPrompt(brief) {
  const f = parseFields(brief)
  return f.image_prompt || null
}

function extractVideoPrompt(brief) {
  const f = parseFields(brief)
  return f.video_prompt || null
}

function extractPostTime(brief) {
  const f = parseFields(brief)
  if (!f.post_time) return null
  const m = f.post_time.match(/(\d{1,2}:\d{2})/)
  return m ? m[1] : null
}

// ─── Copy generation ──────────────────────────────────────────────────────────

async function generateCopy(client, day) {
  const systemPrompt = `You are a social media copywriter for Big Sole Vibes (BSV) — a premium men's foot care brand.

Brand voice: confident, dry, authoritative. Never cute. Never clinical. Never preachy. Speaks to the man who already knows what good looks like.
Tone: like a knowing nod between two men who take quality seriously.
Hashtags: #BigSoleVibes and 2–4 relevant niche tags max. No spam hashtag blocks.

Produce final approved copy for each platform. Output ONLY the structured sections — no preamble, no commentary.`

  const userPrompt = `Here is today's content brief from the Media Director:

${day.brief}

---

## instagram
[Caption for Instagram and Facebook — 150–300 words, punchy opener, story in the middle, clear close. Include #BigSoleVibes and 3–4 hashtags at the end.]

## twitter
[X/Twitter caption — sharp, opinionated, under 240 characters. No hashtags unless one fits naturally.]

## facebook
[Facebook caption — same as Instagram is fine, or slightly longer if the angle suits it.]

## tiktok
[TikTok caption — 100–150 chars, hook-first, 2–3 trending or niche hashtags.]

## bluesky
[Bluesky caption — one strong line, then 2–3 hashtags. 200 characters maximum including hashtags. No paragraphs. No filler.]

## youtube
[YouTube video description — 2–3 sentences, strong first line for SEO, end with a CTA to follow BSV.]`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })
  return msg.content[0].text
}

// ─── Prompt distillation ──────────────────────────────────────────────────────

async function distillPrompt(client, rawPrompt) {
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 160,
    messages: [{
      role:    'user',
      content: `Distill this into ONE image generation sentence. Format: "Generate a [specific scene description], 1:1 square ratio, no text, no logos, no watermarks." Include: setting, subject (age/ethnicity/what they're doing), key visual detail. Nothing else — no explanation, no alternatives, no punctuation after the final period.\n\n${rawPrompt}`,
    }],
  })
  return msg.content[0].text.trim()
}

async function distillFlowPrompt(client, rawPrompt) {
  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 220,
    messages: [{
      role:    'user',
      content: `Write a single paragraph for Google Flow video generation based on this scene brief. Cover exactly: (1) the scene and subject, (2) the motion — what moves and how, (3) the mood, (4) the lighting. End the paragraph with exactly this sentence: "9:16 vertical ratio, no text overlays, no logos, no watermarks, AI-generated content." Output only the paragraph — no intro, no label, no explanation.\n\n${rawPrompt}`,
    }],
  })
  return msg.content[0].text.trim()
}

// ─── Caption file format ──────────────────────────────────────────────────────

function buildCaptionFile(day, generatedCopy) {
  const postTime = extractPostTime(day.brief)
  const header   = postTime ? `post_time: ${postTime}\n` : ''
  return `${header}# ${day.label} — ${day.date}\n\n${generatedCopy.trim()}\n`
}

// ─── Day processing ───────────────────────────────────────────────────────────

async function processDaySlots(targetDay, client) {
  log(`━━━ processing day slots: ${targetDay}-am, ${targetDay}-pm ━━━`)

  const plan = loadCurrentWeekPlan()
  if (!plan) { log('ERROR: no week plan available'); process.exit(1) }

  const targetSlots = [`${targetDay}-am`, `${targetDay}-pm`]
  let allDays  = parseDays(plan.content)
  let days     = allDays.filter(d => targetSlots.includes(d.slug))
  let planContent = plan.content

  // Heal any missing slots via media-director --slot
  for (const slug of targetSlots) {
    if (days.find(d => d.slug === slug)) continue
    log(`  Slot ${slug} missing — calling media-director --slot ${slug}`)
    const fill = spawnSync(process.execPath, [path.join(__dirname, 'media-director.js'), '--slot', slug], {
      env: process.env, stdio: 'inherit',
    })
    if (fill.status !== 0) { log(`ERROR: could not heal slot ${slug} — aborting`); process.exit(1) }
    // Re-download and re-parse
    try { downloadFile(`${REMOTE}/Content Plan/${plan.filename}`, TEMP_DIR) } catch {}
    const localPath = path.join(TEMP_DIR, plan.filename)
    if (fs.existsSync(localPath)) {
      planContent = fs.readFileSync(localPath, 'utf8')
      allDays     = parseDays(planContent)
      days        = allDays.filter(d => targetSlots.includes(d.slug))
    }
    if (!days.find(d => d.slug === slug)) {
      log(`ERROR: slot ${slug} still missing after heal attempt — aborting`)
      process.exit(1)
    }
  }

  log(`  Found ${days.length} slot(s): ${days.map(d => d.slug).join(', ')}`)

  for (const day of days) {
    const slug = daySlug(day)
    log(`  ${slug} — ${day.label} ${day.date}`)

    // Generate per-platform copy and upload .md
    let generatedCopy
    try {
      generatedCopy = await generateCopy(client, day)
    } catch (err) {
      log(`    ERROR: copy generation failed for ${slug}: ${err.message}`)
      continue
    }

    const fileContent = buildCaptionFile(day, generatedCopy)
    const mdPath      = path.join(TEMP_DIR, `${slug}.md`)
    fs.writeFileSync(mdPath, fileContent)
    try {
      uploadFile(mdPath, `${REMOTE}/Ready to Post/${slug}.md`)
      log(`    ✓ uploaded → Ready to Post/${slug}.md`)
    } catch (err) {
      log(`    ERROR: upload failed for ${slug}.md: ${err.message}`)
    }

    // Distill and upload image prompt
    const rawPrompt = extractVisualPrompt(day.brief)
    if (!rawPrompt) {
      log(`    WARNING: no image_prompt for ${slug} — skipping prompt files`)
      continue
    }

    let oneLiner
    try {
      oneLiner = await distillPrompt(client, rawPrompt)
      log(`    Distilled image prompt: ${oneLiner.slice(0, 80)}...`)
    } catch (err) {
      log(`    WARNING: distill failed for ${slug}: ${err.message} — using raw`)
      oneLiner = `Generate a ${rawPrompt.slice(0, 200).replace(/\.$/, '')}, 1:1 square ratio, no text, no logos, no watermarks.`
    }

    const promptPath = path.join(TEMP_DIR, `${slug}-prompt.txt`)
    fs.writeFileSync(promptPath, oneLiner)
    try {
      uploadFile(promptPath, `${REMOTE}/Ready to Post/${slug}-prompt.txt`)
      log(`    ✓ uploaded → Ready to Post/${slug}-prompt.txt`)
    } catch (err) {
      log(`    ERROR: upload failed for ${slug}-prompt.txt: ${err.message}`)
    }

    // Upload video prompt (raw Veo prompt from plan — already fully formed)
    const videoPrompt = extractVideoPrompt(day.brief)
    if (!videoPrompt) {
      throw new Error(`FATAL: no video_prompt for ${slug} — aborting`)
    }

    const flowPath = path.join(TEMP_DIR, `${slug}-flow-prompt.txt`)
    fs.writeFileSync(flowPath, videoPrompt)
    try {
      uploadFile(flowPath, `${REMOTE}/Ready to Post/${slug}-flow-prompt.txt`)
      log(`    ✓ uploaded → Ready to Post/${slug}-flow-prompt.txt`)
    } catch (err) {
      log(`    ERROR: upload failed for ${slug}-flow-prompt.txt: ${err.message}`)
    }
  }

  log(`━━━ day slots complete: ${targetDay} ━━━`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ gemini-bridge start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }
  const client = new Anthropic({ apiKey })

  const VALID_DAYS = ['mon','tue','wed','thu','fri','sat','sun']
  const dayArg = process.argv.indexOf('--day')
  if (dayArg === -1) {
    log('ERROR: --day <slug> required (e.g. --day mon)')
    process.exit(1)
  }

  const targetDay = (process.argv[dayArg + 1] || '').toLowerCase()
  if (!VALID_DAYS.includes(targetDay)) {
    log(`ERROR: --day requires a valid slug (${VALID_DAYS.join('|')})`)
    process.exit(1)
  }

  await processDaySlots(targetDay, client)

  log('━━━ gemini-bridge complete ━━━\n')
})()
