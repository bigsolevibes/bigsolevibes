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

// ─── Content plan loading ─────────────────────────────────────────────────────

// Returns the current ISO week key as "YYYY-WW" for comparison against filenames.
function currentWeekKey() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7)
  return `${d.getFullYear()}-${String(week).padStart(2, '0')}`
}

// Returns all plans with a week key >= the current week, sorted ascending.
// Falls back to just the latest plan if none qualify (e.g. mid-week manual run).
function getPlansToProcess() {
  const files = listDriveFiles(`${REMOTE}/Content Plan`)
  const plans = files.filter(f => f.match(/^week-\d{4}-\d{2}\.md$/)).sort()
  if (!plans.length) return []

  const current = currentWeekKey()
  // e.g. "week-2026-18.md" → key "2026-18"
  const upcoming = plans.filter(f => {
    const m = f.match(/^week-(\d{4}-\d{2})\.md$/)
    return m && m[1] >= current
  })

  const toFetch = upcoming.length ? upcoming : [plans[plans.length - 1]]
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  return toFetch.map(filename => {
    log(`Fetching plan: ${filename}`)
    downloadFile(`${REMOTE}/Content Plan/${filename}`, TEMP_DIR)
    const localPath = path.join(TEMP_DIR, filename)
    if (!fs.existsSync(localPath)) { log(`  WARNING: download failed for ${filename}`); return null }
    return { filename, content: fs.readFileSync(localPath, 'utf8') }
  }).filter(Boolean)
}

// ─── Day parsing ──────────────────────────────────────────────────────────────
// Parses slot: mon-am style blocks produced by media-director.

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

const EXPECTED_SLOTS = ['mon-am','mon-pm','tue-am','tue-pm','wed-am','wed-pm','thu-am','thu-pm','fri-am','fri-pm','sat-am','sat-pm','sun-am','sun-pm']

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

function validateSlots(days) {
  const present = new Set(days.map(d => d.slug))
  const missing = EXPECTED_SLOTS.filter(s => !present.has(s))
  if (missing.length) throw new Error(`plan is missing ${missing.length} slot(s): ${missing.join(', ')}`)
  for (const day of days) {
    const f = parseFields(day.brief)
    if (!f.image_prompt?.trim()) throw new Error(`${day.slug} — image_prompt is empty or missing`)
    if (!f.video_prompt?.trim()) throw new Error(`${day.slug} — video_prompt is empty or missing`)
  }
}

const MAX_SLOT_RETRIES = 3

// For each invalid/missing slot, calls media-director --slot <slug> to regenerate it,
// then re-downloads the plan and re-validates. Hard exits after MAX_SLOT_RETRIES failures.
async function healSlots(plan, days) {
  let current = [...days]

  for (const slug of EXPECTED_SLOTS) {
    for (let attempt = 0; attempt <= MAX_SLOT_RETRIES; attempt++) {
      const day  = current.find(d => d.slug === slug)
      const f    = day ? parseFields(day.brief) : {}
      const good = !!(day && f.image_prompt?.trim() && f.video_prompt?.trim())

      if (good) break
      if (attempt === MAX_SLOT_RETRIES) {
        throw new Error(`FATAL: slot ${slug} failed to fill after ${MAX_SLOT_RETRIES} attempt(s) — aborting week build`)
      }

      log(`  Slot ${slug} missing/invalid — media-director --slot ${slug} (attempt ${attempt + 1}/${MAX_SLOT_RETRIES})`)
      const fill = spawnSync(process.execPath, [path.join(__dirname, 'media-director.js'), '--slot', slug], {
        env: process.env, stdio: 'inherit',
      })
      if (fill.status !== 0) log(`  WARNING: media-director --slot ${slug} exited ${fill.status}`)

      // Re-download plan from Drive and re-parse
      try { downloadFile(`${REMOTE}/Content Plan/${plan.filename}`, TEMP_DIR) } catch {}
      const localPath = path.join(TEMP_DIR, plan.filename)
      if (fs.existsSync(localPath)) {
        plan.content = fs.readFileSync(localPath, 'utf8')
        current = parseDays(plan.content)
      }
    }
  }

  return current
}

// ─── Gemini copy generation ───────────────────────────────────────────────────

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

// ─── Output file formatting ───────────────────────────────────────────────────
// watch-drive.js parseCaptions() looks for ## instagram / ## twitter / ## facebook

// Extracts post_time (HH:MM) from a day brief.
function extractPostTime(brief) {
  const f = parseFields(brief)
  if (!f.post_time) return null
  const m = f.post_time.match(/(\d{1,2}:\d{2})/)
  return m ? m[1] : null
}

function buildCaptionFile(day, generatedCopy) {
  const postTime = extractPostTime(day.brief)
  const header   = postTime ? `post_time: ${postTime}\n` : ''
  return `${header}# ${day.label} — ${day.date}\n\n${generatedCopy.trim()}\n`
}

// Extracts the Arc note line(s) from the top of the plan (before the first ### day header).
function extractArcNote(planContent) {
  const preamble = planContent.split(/^(?=###\s)/m)[0] || ''
  const match = preamble.match(/\*\*Arc note[:\*]*\*\*[^\n]*\n?([\s\S]*?)(?=\n##|\n###|$)/i)
  if (!match) return null
  return match[0].replace(/\*\*/g, '').trim()
}

// Extracts image_prompt from a day brief (used to distill dayX-prompt.txt).
function extractVisualPrompt(brief) {
  const f = parseFields(brief)
  return f.image_prompt || null
}

// Extracts video_prompt from a day brief (saved directly as dayX-flow-prompt.txt).
function extractVideoPrompt(brief) {
  const f = parseFields(brief)
  return f.video_prompt || null
}

// Slug is set directly from the slot: field — no derivation needed.
function daySlug(day) {
  return day.slug
}

// Generates a Google Flow video prompt from the day's brief.
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

// Distills a full visual prompt to a single image generation sentence via Claude.
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

// Builds the single-paste weekly brief for Gemini image generation.
function buildWeeklyBrief(planFilename, arcNote, dayPrompts) {
  const lines = []

  lines.push('# Big Sole Vibes — Weekly Image Generation Brief')
  lines.push(`Source plan: ${planFilename}`)
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Brand Guidelines')
  lines.push('')
  lines.push('**Brand:** Big Sole Vibes (BSV) — premium men\'s foot care.')
  lines.push('**Visual palette:** Midnight #0D1B2A background, Bourbon #C17D2E gold accents, Cream #F5ECD7 text.')
  lines.push('**Style:** Photorealistic editorial. Clean compositions. No clutter. No studio backgrounds unless specified.')
  lines.push('**Subject:** Real men in real moments. Never posed. Never stock-photo.')
  lines.push('**Diversity:** Rotate race, ethnicity, age (20s–70s), lifestyle, and footwear across the week. No demographic defaults.')
  lines.push('**Product:** When shown, the BSV foot balm jar has a Midnight label with Bourbon gold type. Present but not staged.')
  lines.push('**Banned:** Leather ottoman setup, bourbon glass on barber counter, bare feet on marble — these scenes are retired.')
  lines.push('**All images:** Square 1:1 ratio. No text overlays. No logos. No watermarks.')
  lines.push('')

  if (arcNote) {
    lines.push('## Week Arc')
    lines.push('')
    lines.push(arcNote)
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('## Day-by-Day Image Prompts')
  lines.push('')
  lines.push('Generate one image per day. Each prompt is self-contained — paste directly into your image tool.')
  lines.push('')

  for (const { slug, label, date, voice, prompt } of dayPrompts) {
    lines.push(`### ${slug} — ${label} ${date}${voice ? ` — ${voice}` : ''}`)
    lines.push('')
    lines.push(prompt)
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ gemini-bridge start ━━━')

  const geminiKey = process.env.ANTHROPIC_API_KEY
  if (!geminiKey) {
    log('ERROR: ANTHROPIC_API_KEY not set in .env')
    process.exit(1)
  }

  // Load all plans to process (current week and any future weeks)
  log('Fetching content plans from Drive...')
  const plans = getPlansToProcess()
  if (!plans.length) {
    log('ERROR: No content plans found in big sole vibes:Big Sole Vibes/Content Plan/')
    process.exit(1)
  }
  log(`Plans to process: ${plans.map(p => p.filename).join(', ')}`)

  // Init Anthropic
  const client = new Anthropic({ apiKey: geminiKey })

  for (const plan of plans) {
    log(`── Processing ${plan.filename} ──`)

    let days = parseDays(plan.content)
    if (!days.length) {
      log(`  ERROR: Could not parse any slots from ${plan.filename} — skipping`)
      continue
    }
    log(`  Parsed ${days.length} slot(s)`)

    try {
      days = await healSlots(plan, days)
      log(`  All ${EXPECTED_SLOTS.length} slots validated`)
    } catch (err) {
      log(`  ${err.message}`)
      process.exit(1)
    }

    const arcNote    = extractArcNote(plan.content)
    const dayPrompts = []

    for (let i = 0; i < days.length; i++) {
      const day         = days[i]
      const slug        = daySlug(day)
      const outFileName = `${slug}.md`

      log(`  ${slug} — ${day.label} ${day.date}`)

      let generatedCopy
      try {
        generatedCopy = await generateCopy(client, day)
      } catch (err) {
        log(`    ERROR: copy generation failed for ${slug}: ${err.message}`)
        continue
      }

      const fileContent = buildCaptionFile(day, generatedCopy)
      const localPath   = path.join(TEMP_DIR, outFileName)
      fs.writeFileSync(localPath, fileContent)

      try {
        uploadFile(localPath, `${REMOTE}/Ready to Post/${outFileName}`)
        log(`    ✓ uploaded → ${REMOTE}/Ready to Post/${outFileName}`)
      } catch (err) {
        log(`    ERROR: upload failed for ${outFileName}: ${err.message}`)
      }

      // Extract and distill visual prompt
      const rawPrompt = extractVisualPrompt(day.brief)
      if (rawPrompt) {
        let oneLiner
        try {
          oneLiner = await distillPrompt(client, rawPrompt)
          log(`    Distilled prompt: ${oneLiner}`)
        } catch (err) {
          log(`    WARNING: distill failed for ${slug}: ${err.message} — falling back to raw`)
          oneLiner = `Generate a ${rawPrompt.slice(0, 200).replace(/\.$/, '')}, 1:1 square ratio, no text, no logos, no watermarks.`
        }

        const promptFileName = `${slug}-prompt.txt`
        const promptPath     = path.join(TEMP_DIR, promptFileName)
        fs.writeFileSync(promptPath, oneLiner)
        try {
          uploadFile(promptPath, `${REMOTE}/Ready to Post/${promptFileName}`)
          log(`    ✓ uploaded → ${REMOTE}/Ready to Post/${promptFileName}`)
        } catch (err) {
          log(`    ERROR: upload failed for ${promptFileName}: ${err.message}`)
        }

        dayPrompts.push({ slug, label: day.label, date: day.date, voice: day.voice, prompt: oneLiner })

        // slug-flow-prompt.txt — use video_prompt directly (already a complete Veo prompt)
        const videoPrompt = extractVideoPrompt(day.brief)
        if (videoPrompt) {
          const flowFileName = `${slug}-flow-prompt.txt`
          const flowPath     = path.join(TEMP_DIR, flowFileName)
          fs.writeFileSync(flowPath, videoPrompt)
          try {
            uploadFile(flowPath, `${REMOTE}/Ready to Post/${flowFileName}`)
            log(`    ✓ uploaded → ${REMOTE}/Ready to Post/${flowFileName}`)
          } catch (err) {
            log(`    ERROR: upload failed for ${flowFileName}: ${err.message}`)
          }
        } else {
          throw new Error(`FATAL: no video_prompt for ${slug} — source material was empty or distillation failed. Aborting week build.`)
        }
      } else {
        log(`    WARNING: no visual prompt found for ${slug} — skipping prompt file`)
      }
    }

    // Build and upload gemini-weekly-brief.md (one per plan, named by week)
    if (dayPrompts.length) {
      const weekMatch      = plan.filename.match(/^(week-\d{4}-\d{2})\.md$/)
      const weeklyFileName = weekMatch ? `gemini-brief-${weekMatch[1]}.md` : 'gemini-weekly-brief.md'
      const weeklyBrief    = buildWeeklyBrief(plan.filename, arcNote, dayPrompts)
      const weeklyPath     = path.join(TEMP_DIR, weeklyFileName)
      fs.writeFileSync(weeklyPath, weeklyBrief)
      try {
        uploadFile(weeklyPath, `${REMOTE}/Ready to Post/${weeklyFileName}`)
        log(`  ✓ uploaded → ${REMOTE}/Ready to Post/${weeklyFileName}`)
      } catch (err) {
        log(`  ERROR: upload failed for ${weeklyFileName}: ${err.message}`)
      }
    } else {
      log(`  WARNING: no visual prompts collected for ${plan.filename} — skipping brief`)
    }
  }

  log('━━━ gemini-bridge complete ━━━\n')
})()
