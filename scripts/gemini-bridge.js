require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
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
// Splits the plan on ### headers, returns array of { label, date, brief }

function parseDays(planContent) {
  // Split on lines starting with ### (day headers)
  const sections = planContent.split(/^(?=###\s)/m).filter(s => s.trim())
  const days = []

  for (const section of sections) {
    // Current format:  ### Thursday 2026-04-30 — The Drop
    // Legacy format:   ### Monday — 2026-04-27 — The Lounge
    const headerMatch =
      section.match(/^###\s+(\w+)\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)/) ||
      section.match(/^###\s+(\w+)\s*[—–-]+\s*(\d{4}-\d{2}-\d{2})/)
    if (!headerMatch) continue
    days.push({
      label: headerMatch[1].trim(),          // e.g. "Thursday"
      date:  headerMatch[2].trim(),          // e.g. "2026-04-30"
      voice: (headerMatch[3] || '').trim(),  // e.g. "The Drop"
      brief: section.trim(),
    })
  }

  return days
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

// Extracts post_time (HH:MM) from a day brief, if the plan includes one.
function extractPostTime(brief) {
  const m = brief.match(/\*\*Post\s+time:\*\*\s*(\d{1,2}:\d{2})/i)
  return m ? m[1].trim() : null
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

// Extracts the raw visual/flow prompt block from a day brief.
function extractVisualPrompt(brief) {
  const match = brief.match(
    /\*\*(?:Visual\s*\/\s*Flow|Flow)\s*prompt[:\*]*\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*|\n###|$)/i
  )
  if (!match) return null

  const clean = match[1]
    .split('\n')
    .map(l => l.replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join(' ')

  return clean || null
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

  for (const { dayNum, label, date, voice, prompt } of dayPrompts) {
    lines.push(`### Day ${dayNum} — ${label} ${date}${voice ? ` — ${voice}` : ''}`)
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

    const days = parseDays(plan.content)
    if (!days.length) {
      log(`  ERROR: Could not parse any days from ${plan.filename} — skipping`)
      continue
    }
    log(`  Parsed ${days.length} day(s)`)

    const arcNote    = extractArcNote(plan.content)
    const dayPrompts = []

    for (let i = 0; i < days.length; i++) {
      const day        = days[i]
      const dayNum     = i + 1
      const outFileName = `day${dayNum}.md`

      log(`  Day ${dayNum}/${days.length} — ${day.label} ${day.date}`)

      let generatedCopy
      try {
        generatedCopy = await generateCopy(client, day)
      } catch (err) {
        log(`    ERROR: copy generation failed for day ${dayNum}: ${err.message}`)
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
          log(`    WARNING: distill failed for day ${dayNum}: ${err.message} — falling back to raw`)
          oneLiner = `Generate a ${rawPrompt.slice(0, 200).replace(/\.$/, '')}, 1:1 square ratio, no text, no logos, no watermarks.`
        }

        const promptFileName = `day${dayNum}-prompt.txt`
        const promptPath     = path.join(TEMP_DIR, promptFileName)
        fs.writeFileSync(promptPath, oneLiner)
        try {
          uploadFile(promptPath, `${REMOTE}/Ready to Post/${promptFileName}`)
          log(`    ✓ uploaded → ${REMOTE}/Ready to Post/${promptFileName}`)
        } catch (err) {
          log(`    ERROR: upload failed for ${promptFileName}: ${err.message}`)
        }

        dayPrompts.push({ dayNum, label: day.label, date: day.date, voice: day.voice, prompt: oneLiner })

        // dayX-flow-prompt.txt — Google Flow video generation paragraph
        let flowPrompt
        try {
          flowPrompt = await distillFlowPrompt(client, rawPrompt)
          log(`    Flow prompt: ${flowPrompt.slice(0, 80)}…`)
        } catch (err) {
          log(`    WARNING: flow prompt distill failed for day ${dayNum}: ${err.message} — skipping`)
        }

        if (flowPrompt) {
          const flowFileName = `day${dayNum}-flow-prompt.txt`
          const flowPath     = path.join(TEMP_DIR, flowFileName)
          fs.writeFileSync(flowPath, flowPrompt)
          try {
            uploadFile(flowPath, `${REMOTE}/Ready to Post/${flowFileName}`)
            log(`    ✓ uploaded → ${REMOTE}/Ready to Post/${flowFileName}`)
          } catch (err) {
            log(`    ERROR: upload failed for ${flowFileName}: ${err.message}`)
          }
        }
      } else {
        log(`    WARNING: no visual prompt found for day ${dayNum} — skipping prompt file`)
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
