require('dotenv').config()
const Anthropic  = require('@anthropic-ai/sdk').default
const nodemailer = require('nodemailer')
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

const BRIDGE_TEMP = path.join(os.homedir(), 'tmp', 'bsv-gemini-bridge')
const ADMIN_EMAIL = 'admin@bigsolevibes.com'

// ─── Plan parser (flat day: N format) ────────────────────────────────────────

const KNOWN_KEYS = new Set(['day','date','theme','world','post_time','platform','image_prompt','video_prompt','audio_prompt','caption'])

// Derives the day-of-week slug (e.g. "mon-am", "thu-pm") from a parsed fields object.
function computeSlug(f) {
  const dayMatch = (f.date || '').match(/^(\w+)/)
  const dayName  = dayMatch ? dayMatch[1].toLowerCase().slice(0, 3) : `d${f.day || '?'}`
  const hourMatch = (f.post_time || '').match(/^(\d{1,2}):/)
  const hour     = hourMatch ? parseInt(hourMatch[1], 10) : 6
  return `${dayName}-${hour < 12 ? 'am' : 'pm'}`
}

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

// ─── Sunday checklist email ───────────────────────────────────────────────────

async function sendSundayChecklist(generatedPlans) {
  const { ZOHO_SMTP_HOST, ZOHO_SMTP_USER, ZOHO_SMTP_PASSWORD } = process.env
  if (!ZOHO_SMTP_HOST || !ZOHO_SMTP_USER || !ZOHO_SMTP_PASSWORD) {
    log('WARNING: ZOHO_SMTP_HOST/USER/PASSWORD not set — skipping checklist email')
    return
  }

  // Build one section per week
  const weekSections = []
  for (const { planFileName, fullText } of generatedPlans) {
    const blocks = fullText.split(/^(?=day:\s*\d+\b)/m).filter(s => s.trim())
    const days = []
    for (const block of blocks) {
      const f = parseFields(block)
      if (!f.day) continue

      const dayNum    = parseInt(f.day, 10)
      const dateMatch = (f.date || '').match(/(\w+)[,\s]+(\d{4}-\d{2}-\d{2})/)
      const label     = dateMatch ? dateMatch[1] : `Day${dayNum}`
      const date      = dateMatch ? dateMatch[2] : (f.date || '').trim()
      const voice     = f.world || ''
      const slug      = computeSlug(f)

      const imgFile  = path.join(BRIDGE_TEMP, `${slug}-prompt.txt`)
      const flowFile = path.join(BRIDGE_TEMP, `${slug}-flow-prompt.txt`)

      const imagePrompt = fs.existsSync(imgFile)
        ? fs.readFileSync(imgFile, 'utf8').trim()
        : f.image_prompt ? `${f.image_prompt.slice(0, 300)}… [full prompt in Drive]` : '(not available)'

      const flowPrompt = fs.existsSync(flowFile)
        ? fs.readFileSync(flowFile, 'utf8').trim()
        : f.video_prompt || '(not available)'

      days.push({ dayNum, label, date, voice, imagePrompt, flowPrompt })
    }

    if (!days.length) continue

    const weekKey    = planFileName.replace('week-', '').replace('.md', '')
    const dateRange  = `${days[0].date} → ${days[days.length - 1].date}`
    const dayBlocks  = days.map(d => [
      `DAY ${d.dayNum} — ${d.label} ${d.date} — ${d.voice}`,
      '─'.repeat(52),
      'IMAGE PROMPT (paste into Gemini / DALL-E / Midjourney):',
      d.imagePrompt,
      '',
      'FLOW PROMPT (paste into Google Flow):',
      d.flowPrompt,
    ].join('\n')).join('\n\n')

    weekSections.push({ weekKey, dateRange, dayBlocks })
  }

  if (!weekSections.length) {
    log('WARNING: no day prompts extracted — skipping checklist email')
    return
  }

  const firstWeek = weekSections[0].weekKey
  const subject   = `BSV Sunday Checklist — Week ${firstWeek}${weekSections.length > 1 ? ` + Week ${weekSections[weekSections.length - 1].weekKey}` : ''}`

  const intro = [
    'BSV SUNDAY CONTENT CHECKLIST',
    weekSections.map(w => `Week ${w.weekKey} — ${w.dateRange}`).join(' | '),
    '',
    '━━━ HOW IT WORKS ━━━',
    '',
    '1. Open Google Drive → Big Sole Vibes → Ready to Post',
    '2. Open gemini-weekly-brief.md — it has all your prompts',
    '3. For each day:',
    '   a. Paste the IMAGE PROMPT into Gemini (or DALL-E / Midjourney)',
    '      → Save the result as dayX-image.png',
    '      → Drop it in Ready to Post/',
    '   b. Paste the FLOW PROMPT into Google Flow',
    '      → Save the result as dayX-video.mp4',
    '      → Drop it in Ready to Post/',
    '4. That\'s it — the pipeline handles everything else',
    '',
    '━━━ YOUR PROMPTS ━━━',
  ].join('\n')

  const body = intro + '\n\n' + weekSections.map(w =>
    `══ WEEK ${w.weekKey} (${w.dateRange}) ══\n\n${w.dayBlocks}`
  ).join('\n\n' + '═'.repeat(54) + '\n\n')

  try {
    const transporter = nodemailer.createTransport({
      host:   ZOHO_SMTP_HOST,
      port:   465,
      secure: true,
      auth:   { user: ZOHO_SMTP_USER, pass: ZOHO_SMTP_PASSWORD },
    })
    const info = await transporter.sendMail({
      from:    `"BSV Media Director" <${ZOHO_SMTP_USER}>`,
      to:      ADMIN_EMAIL,
      subject,
      text:    body,
    })
    log(`Checklist email sent — ${subject} (${info.messageId})`)
  } catch (err) {
    log(`ERROR: checklist email failed: ${err.message}`)
  }
}

// ─── ISO week number ──────────────────────────────────────────────────────────

function isoWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7)
  return [d.getFullYear(), String(week).padStart(2, '0')]
}

// ─── Context collectors ───────────────────────────────────────────────────────

function getRecentLogs(n = 100) {
  try {
    const content = fs.readFileSync(path.join(ROOT, 'logs', 'watch-drive.log'), 'utf8')
    return content.trim().split('\n').slice(-n).join('\n')
  } catch { return '(no watch-drive.log found)' }
}

function getPostedContent() {
  try {
    // List dated subfolders under Posted/
    const dirs = execSync(
      `rclone lsd "${REMOTE}/Posted/"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    if (!dirs) return '(Posted/ folder is empty)'

    // For each subfolder, list the files inside
    const lines = []
    for (const line of dirs.split('\n')) {
      const folder = line.trim().split(/\s+/).pop()
      if (!folder) continue
      try {
        const files = execSync(
          `rclone ls "${REMOTE}/Posted/${folder}"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim()
        lines.push(`${folder}:`)
        for (const f of files.split('\n')) {
          const name = f.trim().split(/\s+/).slice(1).join(' ')
          if (name) lines.push(`  - ${name}`)
        }
      } catch { lines.push(`  ${folder}: (could not list)`) }
    }
    return lines.join('\n') || '(no posted content found)'
  } catch { return '(rclone unavailable — cannot read Posted/)' }
}

function getHandoff() {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(
      `rclone copy "${REMOTE}/Handoff/BSV-Handoff-v5.md" "${TEMP_DIR}/"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    const localPath = path.join(TEMP_DIR, 'BSV-Handoff-v5.md')
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf8')
  } catch {}
  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ media-director start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log('ERROR: ANTHROPIC_API_KEY not set in .env')
    process.exit(1)
  }

  const now        = new Date()
  const weeksArg   = process.argv.indexOf('--weeks')
  const numWeeks   = weeksArg !== -1 ? Math.max(1, parseInt(process.argv[weeksArg + 1], 10) || 1) : 1
  const planOnly   = process.argv.includes('--plan-only')   // skip bridge/video-gen/email spawns
  const startToday = process.argv.includes('--start-today') // start from today even on Sundays

  log(`Weeks to generate: ${numWeeks}`)
  if (planOnly)   log('--plan-only: skipping gemini-bridge, video-gen, and checklist email')
  if (startToday) log('--start-today: starting from today regardless of day of week')
  log('Collecting context...')

  const recentLogs    = getRecentLogs(100)
  const postedContent = getPostedContent()
  const handoff       = getHandoff()

  log(`Handoff doc: ${handoff ? `${handoff.length} chars` : 'not found'}`)

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const isSunday = now.getDay() === 0

  // generateWeek: weekOffset 0 = first week, 1 = second week, etc.
  // --start-today: week 0 always starts from today, even on Sundays.
  // Default (Sunday): advances to next Monday so the full Mon-Sun week is planned.
  async function generateWeek(weekOffset, client, priorPlanText) {
    let startDay
    if (weekOffset === 0) {
      startDay = new Date(now)
      if (isSunday && !startToday) startDay.setDate(now.getDate() + 1)
    } else {
      // Week 1+ always starts on the Monday following the previous week
      const base = new Date(now)
      if (isSunday && !startToday) base.setDate(now.getDate() + 1)
      else if (!isSunday) base.setDate(now.getDate() + (7 - now.getDay() + 1))
      startDay = new Date(base)
      startDay.setDate(base.getDate() + (weekOffset - 1) * 7)
    }

    // Days from today through the nearest Saturday (inclusive).
    // On Sunday with --start-today: 6 - 0 + 1 = 7 days (Sun–Sat).
    const daysLeft = (weekOffset === 0 && (!isSunday || startToday)) ? (6 - now.getDay() + 1) : 7
    const weekDays = Array.from({ length: daysLeft }, (_, i) => {
      const d = new Date(startDay)
      d.setDate(startDay.getDate() + i)
      return `${dayNames[d.getDay()]} ${d.toISOString().slice(0, 10)}`
    })

    const [year, week] = isoWeek(startDay)
    const planFileName = `week-${year}-${week}.md`
    log(`Generating ${planFileName} (${weekDays[0]} → ${weekDays[weekDays.length - 1]})`)

  const systemPrompt = `You are the Media Director for Big Sole Vibes (BSV).

## Who BSV Is

Big Sole Vibes is not a foot care brand. It is a lifestyle brand that starts at the feet.

The foot care is the entry point. The lounge is the destination. One day — a physical space where a man walks in, gets taken care of, has a bourbon or a tequila, and leaves feeling like himself. That vision lives in every piece of content we make.

BSV is for the man who does both. He has the leather chair and bourbon on Thursday. He has the sneakers and tequila on Friday night. Same man. Same standard. Different energy depending on the day. We speak to both versions of him equally.

"It's what happens when he takes his shoes and socks off that matters to us."

## Brand Voice
BSV is the friend who actually knows about feet but never makes it weird.
Not a podiatrist. Not a spa. The guy at the party who makes you want to fix your heels.

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

The dark cinematic posts set the vibe.
The funny posts earn the follow.
The educational posts earn the trust.
All three build the brand.

### The Self-Awareness Rule
Once per week, write a caption that winks at the AI generation.
Own it. Never apologize for it. BSV takes feet seriously — not itself.
Examples of the tone:
- "The AI tried its best. Your feet deserve better."
- "Yeah we know. The AI had thoughts. We had foot care. Only one of us showed up."
- "Not every frame is perfect. Neither are your heels. We can fix one of those."
Never forced. Never every post. One a week, when it fits naturally.

## Brand Palette
- Midnight #0D1B2A
- Bourbon #C17D2E
- Cream #F5ECD7
- Navy #162233
- Steel #4A6380

## Content Split — 50/50 Every Week
Half the week lives in The Lounge. Half lives on The Street. Never two of the same world back to back.

### The Lounge Side (50%)
Stillness. Earned. Thursday energy.
- Bare feet on leather ottoman
- Bourbon glass catching amber light
- Dark warm interiors, fireplace, jazz
- The man who has arrived
- Post: Thursday 7pm, Saturday 8am

### The Street Side (50%)
Energy. Movement. Friday night energy.
- Fresh kicks on Chicago pavement
- Urban texture — asphalt, concrete, neon
- Sneakers mid-stride, macro shots of sole architecture
- The man who is going somewhere
- Post: Tuesday 11am–1pm, Wednesday 11am–1pm

### The Bridge (when it fits)
The transition shot — leather chair, bourbon, camera pans down to reveal fresh sneakers instead of bare feet. The Lounge is not a place. It is a mindset you take with you.

## Content Worlds — Rotate, Never Repeat Back to Back
- The Court (athletic, 20s–30s)
- The Boardroom (professional, 40s–60s)
- The Lounge (home ritual, 30s–50s)
- The Grind (work/outdoors, any age)
Vary race, age, and setting every day. Never the same world or demographic back to back.

### Humor & Animation (1-2x per week)
BSV takes feet seriously. BSV does not take itself seriously.
Once or twice a week generate content that is funny, playful, or animated.
- Cartoon or illustrated style feet — Imagen 4 handles this well
- Exaggerated before/after foot scenarios
- Feet with personality — tired feet, proud feet, neglected feet
- Self-aware captions that wink at the AI or at foot care in general
- Always ties back to the core truth: nice feet matter, BSV makes it easy
Style: playful, warm, never mean. Punching up at neglected feet, never at the person.

## Chicago Posting Schedule (CDT)
- Monday: 6:30am — the man who starts before the world
- Tuesday: 11am–1pm — Street energy, lifestyle
- Wednesday: 11am–1pm — Street energy, lifestyle
- Thursday: 7pm — Lounge energy, earned stillness
- Friday: 7pm — Bridge content, both worlds
- Saturday: 8am — The ritual, earned weekend

## Video Standards — Non-Negotiable
- Always 7–8 seconds. Never 30.
- End every video_prompt with: "Ensure the final frame matches the first frame in lighting and position exactly, creating a seamless infinite loop."
- Lounge audio: soft crackling fireplace, low ambient jazz saxophone
- Street audio: up-tempo lo-fi hip hop, heavy bass, crisp snare, distant city sounds

## Per-Day Output Format
For each day produce exactly:

day: [number]
date: [day of week, YYYY-MM-DD]
theme: [one line]
world: [The Court / The Boardroom / The Lounge / The Grind]
post_time: [HH:MM CDT]
platform: [instagram / tiktok / youtube]
image_prompt: [photorealistic Imagen 4 prompt, dark cinematic, no text, no logos, square 1:1]
video_prompt: [Veo 3.1 motion prompt, 7-8 seconds, 9:16 vertical, no text, no logos, no watermarks, seamless loop instruction at end]
audio_prompt: [one line ambient sound description]
caption: [platform caption with hashtags]

## The Vision
Every piece of content builds toward the day BSV opens its first physical lounge. Chicago first. A place where a man walks in, gets taken care of, has a drink, and leaves feeling like himself. The product funds the brand. The brand builds the audience. The audience fills the lounge. Content is not marketing. It is the foundation.`

  const userPrompt = `Generate the BSV content plan covering these ${daysLeft} day${daysLeft === 1 ? '' : 's'} (Day 1 = ${weekDays[0]}):
${weekDays.join('\n')}

## Recent pipeline activity (last 100 log lines)
\`\`\`
${recentLogs}
\`\`\`

## What has been posted (Google Drive Posted/ folder)
\`\`\`
${postedContent}
\`\`\`

${priorPlanText ? `## Week ${weekOffset} plan (already generated — do NOT repeat any of these visuals or themes):\n${priorPlanText.slice(0, 3000)}${priorPlanText.length > 3000 ? '\n[truncated]' : ''}` : ''}

${handoff ? `## Brand & strategy context (BSV Handoff)\n${handoff}` : '## Brand context\n(Handoff doc not available — rely on brand voice guidelines above)'}

---

## CRITICAL — Visual innovation requirement

The leather ottoman + bourbon glass + barber lounge scene is DONE. It is the brand baseline, not the content. Do not brief it again. Ever.

New visual prompts must push into new territory every single week. Required visual territories to draw from:

- **The Drop aesthetic** — sneaker culture, athletic recovery, locker room, court, street corner, pre-game ritual
- **Settings never or rarely used** — job site, boardroom, hotel room, home bathroom at 6am, hospital locker room, gym shower area, barbershop chair (not just the lounge), airport terminal
- **Times of day** — predawn, golden hour, midday harsh light, late night, post-workout fluorescent
- **Moods beyond premium** — gritty, humid, exhausted-but-disciplined, celebratory, focused, vulnerable

**Weekly requirement:** Every week must introduce at least 3 visual concepts BSV has never used before. Before writing day briefs, audit the posted history above and explicitly identify what has already been done — then plan around it. Repeating an established visual is not safety, it is creative failure.

**The test:** If a visual prompt could have been written six months ago and used as is, it is not good enough. Every prompt must earn its place by being specific, fresh, and tied to a real man in a real moment.

---

Avoid repeating angles or visuals that have clearly been used recently. Build on what's been posted — extend themes, flip perspectives, escalate. The best plan is one that feels like a coherent story across all days, not unrelated posts dropped into a calendar.`

    // Call Claude API with streaming
    log('Calling Claude API (claude-sonnet-4-6)...')
    let fullText = ''

    try {
      const stream = await client.messages.stream({
        model:      'claude-sonnet-4-6',
        max_tokens: 16000,
        thinking:   { type: 'adaptive' },
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      })

      process.stdout.write(`Generating ${planFileName}`)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text
          process.stdout.write('.')
        }
      }
      process.stdout.write('\n')

      const finalMsg = await stream.finalMessage()
      log(`Done — ${finalMsg.usage?.output_tokens ?? '?'} output tokens, stop_reason: ${finalMsg.stop_reason}`)
    } catch (err) {
      log(`ERROR: Claude API call failed: ${err.message}`)
      process.exit(1)
    }

    if (!fullText.trim()) {
      log('ERROR: Claude returned empty response')
      process.exit(1)
    }

    // Save locally and upload to Drive
    const localPath = path.join(TEMP_DIR, planFileName)
    fs.writeFileSync(localPath, fullText)
    log(`Saved locally: ${localPath} (${fullText.length} chars)`)

    try {
      execSync(
        `rclone copyto "${localPath}" "${REMOTE}/Content Plan/${planFileName}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )
      log(`Uploaded → ${REMOTE}/Content Plan/${planFileName}`)
    } catch (err) {
      log(`ERROR: rclone upload failed: ${err.stderr?.toString().trim() || err.message}`)
      process.exit(1)
    }

    return { planFileName, fullText }
  } // end generateWeek

  const client = new Anthropic({ apiKey })
  const generatedPlans = []

  for (let w = 0; w < numWeeks; w++) {
    const priorText = w > 0 ? generatedPlans[w - 1].fullText : null
    const result = await generateWeek(w, client, priorText)
    generatedPlans.push(result)
  }

  if (planOnly) {
    log('--plan-only: skipping gemini-bridge, video-gen, and checklist email')
  } else {
    // Automatically chain into gemini-bridge
    log('Spawning gemini-bridge.js...')
    const bridge = spawnSync(process.execPath, [path.join(__dirname, 'gemini-bridge.js')], {
      stdio: 'inherit',
      env:   process.env,
    })
    if (bridge.status === 0) {
      log('gemini-bridge triggered automatically.')
    } else {
      log(`ERROR: gemini-bridge exited with code ${bridge.status}`)
    }

    // Automatically chain into video-gen after gemini-bridge
    log('Spawning video-gen.js...')
    const videoGen = spawnSync(process.execPath, [path.join(__dirname, 'video-gen.js')], {
      stdio: 'inherit',
      env:   process.env,
    })
    if (videoGen.status === 0) {
      log('video-gen triggered automatically.')
    } else {
      log(`ERROR: video-gen exited with code ${videoGen.status}`)
    }

    // Send Sunday checklist email with all prompts
    await sendSundayChecklist(generatedPlans)
  }

  log('━━━ media-director complete ━━━\n')
})()
