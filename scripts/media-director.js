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

// ─── Sunday checklist email ───────────────────────────────────────────────────

async function sendSundayChecklist(generatedPlans) {
  const { ZOHO_SMTP_HOST, ZOHO_SMTP_USER, ZOHO_SMTP_PASSWORD } = process.env
  if (!ZOHO_SMTP_HOST || !ZOHO_SMTP_USER || !ZOHO_SMTP_PASSWORD) {
    log('WARNING: ZOHO_SMTP_HOST/USER/PASSWORD not set — skipping checklist email')
    return
  }

  // Parse day headers from plan text to get label/date/voice per day
  const DAY_RE = /^###\s+(\w+)\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)/m

  // Build one section per week
  const weekSections = []
  for (const { planFileName, fullText } of generatedPlans) {
    const sections = fullText.split(/^(?=###\s)/m).filter(s => s.trim())
    const days = []
    let dayNum = 1
    for (const section of sections) {
      const h = section.match(/^###\s+(\w+)\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)/)
      if (!h) continue
      const label = h[1], date = h[2], voice = h[3].trim()

      // Read distilled image prompt from bridge temp dir if available
      const imgFile  = path.join(BRIDGE_TEMP, `day${dayNum}-prompt.txt`)
      const flowFile = path.join(BRIDGE_TEMP, `day${dayNum}-flow-prompt.txt`)

      // Fall back to extracting raw visual prompt from plan text
      const rawMatch = section.match(/\*\*(?:Visual\s*\/\s*Flow|Flow)\s*prompt[:\*]*\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*|\n###|$)/i)
      const rawPrompt = rawMatch
        ? rawMatch[1].split('\n').map(l => l.replace(/^>\s?/, '').trim()).filter(Boolean).join(' ')
        : null

      const imagePrompt = fs.existsSync(imgFile)
        ? fs.readFileSync(imgFile, 'utf8').trim()
        : (rawPrompt ? `${rawPrompt.slice(0, 300)}… [full prompt in Drive]` : '(not available)')

      const flowPrompt = fs.existsSync(flowFile)
        ? fs.readFileSync(flowFile, 'utf8').trim()
        : '(generate after running gemini-bridge — check dayX-flow-prompt.txt in Drive)'

      days.push({ dayNum, label, date, voice, imagePrompt, flowPrompt })
      dayNum++
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

  const now      = new Date()
  const weeksArg = process.argv.indexOf('--weeks')
  const numWeeks = weeksArg !== -1 ? Math.max(1, parseInt(process.argv[weeksArg + 1], 10) || 1) : 1

  log(`Weeks to generate: ${numWeeks}`)
  log('Collecting context...')

  const recentLogs    = getRecentLogs(100)
  const postedContent = getPostedContent()
  const handoff       = getHandoff()

  log(`Handoff doc: ${handoff ? `${handoff.length} chars` : 'not found'}`)

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const isSunday = now.getDay() === 0

  // generateWeek: weekOffset 0 = first week, 1 = second week, etc.
  // For week 0, use the normal date logic (today or next Mon).
  // For week N>0, always start the Monday 7*N days after the first week's start.
  async function generateWeek(weekOffset, client, priorPlanText) {
    let startDay
    if (weekOffset === 0) {
      startDay = new Date(now)
      if (isSunday) startDay.setDate(now.getDate() + 1) // next Monday on Sundays
    } else {
      // Week 1+ always starts on the Monday following the previous week
      const base = new Date(now)
      if (isSunday) base.setDate(now.getDate() + 1)
      else base.setDate(now.getDate() + (7 - now.getDay() + 1)) // next Monday from today
      startDay = new Date(base)
      startDay.setDate(base.getDate() + (weekOffset - 1) * 7)
    }

    const daysLeft = (weekOffset === 0 && !isSunday) ? (6 - now.getDay() + 1) : 7
    const weekDays = Array.from({ length: daysLeft }, (_, i) => {
      const d = new Date(startDay)
      d.setDate(startDay.getDate() + i)
      return `${dayNames[d.getDay()]} ${d.toISOString().slice(0, 10)}`
    })

    const [year, week] = isoWeek(startDay)
    const planFileName = `week-${year}-${week}.md`
    log(`Generating ${planFileName} (${weekDays[0]} → ${weekDays[weekDays.length - 1]})`)

  const systemPrompt = `You are the Media Director for Big Sole Vibes (BSV) — a premium men's foot care brand built around the idea that serious men take care of every detail, including their feet.

Visual identity: Midnight (#0D1B2A), Bourbon (#C17D2E), Steel (#4A6380). Clean compositions. No clutter.
Platforms: TikTok (primary growth), Instagram (brand equity), X/Twitter (voice and reach), Facebook (community), Bluesky (early adopter).

Your job is to produce a rigorous, strategic weekly content plan that a solo operator can execute directly. Every day gets a specific brief — not vague direction. Think of this as a production order.

## The Two BSV Voices

BSV speaks to two distinct audiences through two distinct registers. Both are correct. Neither is a dilution of the other. The brand is big enough to hold both.

### The Lounge
**Audience:** Men 35–55. He has arrived. He isn't trying to prove anything.
**World:** Bourbon, leather chairs, dark wood, barbershop rituals, tailored clothes, late nights with good company. Foot care is the last detail before he's done.
**Tone:** Slow, confident, unhurried. Dry wit. Authority that doesn't need to announce itself.
**Copy register:** Long exhale. Declarative. One perfect sentence over three mediocre ones.
**Signature line:** "The good life starts at the foundation."
**Visual prompts:** Dimly lit bathroom counter with a glass of bourbon nearby. Leather lounge chair, dress shoes on the floor. Barber tools arranged with care. Dark marble, brass fixtures. Candles. No rush.
**Platform fit:** Instagram (primary), Facebook, Bluesky.

### The Drop
**Audience:** Men 18–34. He moves fast. He knows what's next before it drops.
**World:** Sneaker culture, streetwear, clean kicks, court culture, locker rooms, pre-game rituals. Foot care is part of the fit — always has been.
**Tone:** Sharp, energetic, street-credible. Insider without being exclusive. Knows when to be serious and when to flex.
**Copy register:** Short and loaded. Hook-first. Punchy closer. Cultural fluency over explanation.
**Signature line:** "Can't be fresh from the ankle up if you're not fresh below it."
**Visual prompts:** Fresh sneakers on clean concrete. Locker room bench, unlaced Jordans. Pre-game ritual, hands on knees. Urban court, golden hour. Clean kicks under stadium lights. Product shot next to a grail pair.
**Platform fit:** TikTok (primary), X/Twitter, Instagram Reels.

## Week structure rules

1. **Alternating voices:** No two consecutive days in the same voice. The week must alternate — Lounge, Drop, Lounge, Drop, or Drop, Lounge, Drop, Lounge, etc. Decide the starting voice based on which voice was used last in the posted history.
2. **Sunday bridge:** Sunday always closes the week with a unified BSV message that speaks to both audiences simultaneously — without being generic. Find the intersection: the man who appreciates craft, regardless of whether he drinks bourbon or wears heat. This is the hardest brief of the week. It should feel inevitable, not compromised.
3. **Voice integrity:** A Lounge day that starts referencing sneaker drops is broken. A Drop day that starts quoting bourbon rituals is broken. The brief must commit fully.

## CRITICAL: Diversity directive

BSV represents ALL men. This is not a disclaimer — it is a core brand truth and a commercial imperative. The Proprietor's Standard applies to every man equally.

**Visual prompts must reflect genuine diversity across all four dimensions:**

- **Race and ethnicity:** Black, Latino, Asian, White, Mixed — rotate intentionally across the week. Never default to any single race. A default is a choice. Make it consciously.
- **Age:** 20s through 70s and beyond. Older men are an underserved market with real foot care needs, real purchasing power, and no one talking to them. A 65-year-old man's feet carry more history and need more care — that is a content angle, not an afterthought.
- **Footwear culture:** Dress shoes, sneakers, work boots, barefoot at home, recovery slides, steel-toed boots, loafers. The brand lives at the foot — show all the feet.
- **Lifestyle:** Corporate, trades, athletic, retired, street, blue-collar, creative. BSV is not a luxury brand for one type of man. It is a standard every man can meet.

**Weekly requirement:** Each week's visual prompts must represent at least 3 different demographic combinations. Plan the diversity across the week before writing individual day briefs — don't let it become an afterthought on the last day.

**The test:** A 65-year-old Black man in house slippers and a 22-year-old Latino sneakerhead have the same foundation. BSV speaks to both with equal respect and authority. If a week's visual prompts could only belong to one type of man, the plan has failed.

**In practice:** The Lounge voice is not only for older white men. The Drop voice is not only for young Black men. Both voices are for all men — the voice sets the tone, not the demographic. A 50-year-old Asian man can be The Drop. A 25-year-old Black man can be The Lounge. Assign the demographic and the voice independently.

## Official BSV brand lines

These are the approved brand lines. They are not suggestions — they are copy assets to be deployed intentionally, not sprinkled randomly. At least one must appear in the week's content. Track which days use them.

**Primary tagline:** "Your feet work hard. Start acting like it."
— Universal. Works in both voices. The most direct call to action BSV has. Deploy when a post needs a strong close or a hook that cuts through.

**Inclusivity statement:** "The Foundation Doesn't Discriminate."
— Particularly powerful for The Drop audience and for the Sunday Bridge. Use when the content is explicitly about the brand's reach across demographics, or when a visual is doing the diversity work and the copy needs to name it without over-explaining.

**Supporting line:** "20 or 80. Boots or Jordans. The standard is the same."
— The cleanest expression of BSV's universal positioning. Best used as a standalone closer or a caption anchor on a post that features age or footwear diversity in the visual.

**Hashtag rotation:** #EveryManEveryFoot · #TheFoundationForAll · #BigSoleVibes
— Rotate #EveryManEveryFoot and #TheFoundationForAll into the weekly hashtag mix. #BigSoleVibes appears on every post. The inclusivity hashtags are especially fitting for posts using the inclusivity statement or diverse visual casting.

**Usage rule:** At least one of the three brand lines must appear in the week's caption drafts. Do not use the same line on consecutive weeks — track what was used in posted history and rotate. The Sunday Bridge post is the natural home for these lines when not placed earlier in the week.

## Strategic directives

**Theme continuity:** Review all previously posted content. Extract themes already used per voice (Lounge themes and Drop themes tracked separately). Do not repeat a theme within the same voice in the last 3 weeks. Themes can cross voices if the angle is genuinely different.

**Escalating arc:** Each week advances a brand narrative. At the top of the plan, include a one-line **Arc note** explaining how this week's Lounge arc and Drop arc each advance from last week.

**Format rotation:** Every 3rd week, introduce one non-standard format for at least two days: audience polls, direct questions, or behind-the-scenes. Apply this per voice — a Drop poll ("Jordan 1 or Air Force 1 for foot care visibility?") is different from a Lounge poll ("Balm before bed or after shower?").

**Cultural calendar:** Reference seasonal moments and cultural events only when genuinely relevant to each voice's audience. Sneaker drops and release dates matter to The Drop. Seasonal rituals and occasions matter to The Lounge.

## Output format

Format the output as clean Markdown. Token budget is tight — be ruthlessly concise. Every field has a hard limit:

### [Day] — [Date] — [Voice: The Lounge / The Drop / Sunday Bridge]
**Post time:** HH:MM — use 07:30 for The Lounge, 12:00 for The Drop, 10:00 for Sunday Bridge
**Theme:** one line
**Copy angle:** two lines max
**Flow prompt:** 3–4 lines — specific enough to generate without edits, no padding
**Platform notes:** one line per platform (TikTok / Instagram / X / Facebook)
**Caption:** ready-to-post, hashtags included, no preamble

No commentary between sections. No explanations of choices. No introductory paragraphs. Start the first day header immediately after the arc note.

At the top of the plan, one line only: **Arc note:** [Lounge arc this week] / [Drop arc this week]

At the very end: **## Weekly Growth Insight** — one observation, one action. Two sentences max.

Be direct. Every output should be usable as-is.`

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

  // Send Sunday checklist email with all prompts
  await sendSundayChecklist(generatedPlans)

  log('━━━ media-director complete ━━━\n')
})()
