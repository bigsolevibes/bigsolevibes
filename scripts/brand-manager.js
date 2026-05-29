require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT      = path.join(__dirname, '..')
const LOG_FILE  = path.join(ROOT, 'logs', 'brand-manager.log')
const TEMP_DIR  = path.join(os.homedir(), 'tmp', 'bsv-brand-manager')
const REMOTE    = 'big sole vibes:Big Sole Vibes'
const KLAVIYO   = 'https://a.klaviyo.com/api'
const IG_API    = 'https://graph.facebook.com/v21.0'

const { VOICES } = require('../config/bsv-voices')

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Metrics helpers ──────────────────────────────────────────────────────────

function klaviyoHeaders(apiKey) {
  return {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'revision':      '2023-12-15',
    'Content-Type':  'application/json',
  }
}

async function getListProfiles(apiKey, listId) {
  const profiles = []
  let url = `${KLAVIYO}/lists/${listId}/profiles/?fields[profile]=email,created`
  while (url) {
    const res  = await fetch(url, { headers: klaviyoHeaders(apiKey) })
    const data = await res.json()
    if (!res.ok) throw new Error(`Klaviyo list profiles: ${JSON.stringify(data)}`)
    profiles.push(...(data.data || []))
    url = data.links?.next || null
  }
  return profiles
}

function summariseGrowth(profiles) {
  const now     = new Date()
  const cutoff7  = new Date(now - 7  * 86400000).toISOString()
  const cutoff30 = new Date(now - 30 * 86400000).toISOString()
  return {
    total:  profiles.length,
    last7:  profiles.filter(p => (p.attributes?.created || '') >= cutoff7).length,
    last30: profiles.filter(p => (p.attributes?.created || '') >= cutoff30).length,
  }
}

async function getInstagramMetrics() {
  const token    = process.env.META_ACCESS_TOKEN
  const igUserId = process.env.META_IG_ACCOUNT_ID
  if (!token || !igUserId) return null
  try {
    const [profileRes, insightsRes] = await Promise.all([
      fetch(`${IG_API}/${igUserId}?fields=followers_count,media_count&access_token=${token}`),
      fetch(`${IG_API}/${igUserId}/insights?metric=reach,profile_views&period=week&access_token=${token}`),
    ])
    const profile  = await profileRes.json()
    const insights = await insightsRes.json()
    if (profile.error) throw new Error(profile.error.message)
    const reach        = insights.data?.find(m => m.name === 'reach')?.values?.slice(-1)[0]?.value
    const profileViews = insights.data?.find(m => m.name === 'profile_views')?.values?.slice(-1)[0]?.value
    return {
      followers:        profile.followers_count,
      mediaCount:       profile.media_count,
      reachWeek:        reach,
      profileViewsWeek: profileViews,
    }
  } catch (err) {
    log(`Instagram metrics error: ${err.message}`)
    return null
  }
}

async function getBlueskyMetrics() {
  const handle = process.env.BLUESKY_HANDLE
  if (!handle) return null
  try {
    const res  = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Bluesky API error')
    return { followers: data.followersCount, posts: data.postsCount }
  } catch (err) {
    log(`Bluesky metrics error: ${err.message}`)
    return null
  }
}

function buildMetricsBlock(ig, bsky, lounge, drop, date) {
  const n = (v) => v !== undefined && v !== null ? v.toLocaleString() : '[unavailable]'
  const lines = [`## Growth Metrics — ${date}`, '']

  lines.push('### Social Channels')
  if (ig) {
    const insightsParts = []
    if (ig.reachWeek        !== undefined) insightsParts.push(`reach (week): ${n(ig.reachWeek)}`)
    if (ig.profileViewsWeek !== undefined) insightsParts.push(`profile views (week): ${n(ig.profileViewsWeek)}`)
    const insightsStr = insightsParts.length ? ` | ${insightsParts.join(' | ')}` : ''
    lines.push(`- Instagram: ${n(ig.followers)} followers | ${n(ig.mediaCount)} posts${insightsStr}`)
  } else {
    lines.push('- Instagram: [unavailable]')
  }
  lines.push(`- Bluesky: ${bsky ? `${n(bsky.followers)} followers` : '[unavailable]'}`)

  lines.push('')
  lines.push('### Email Lists (Klaviyo)')
  lines.push(lounge
    ? `- The Lounge: ${n(lounge.total)} subscribers (+${lounge.last7} this week, +${lounge.last30} this month)`
    : '- The Lounge: [unavailable]')
  lines.push(drop
    ? `- The Drop: ${n(drop.total)} subscribers (+${drop.last7} this week, +${drop.last30} this month)`
    : '- The Drop: [unavailable]')

  return lines.join('\n')
}

// ─── Brief reader — voice tracking ────────────────────────────────────────────

function readRecentBriefs() {
  const briefsDir = path.join(ROOT, 'posts', 'briefs')
  if (!fs.existsSync(briefsDir)) return []

  const results = []
  const files   = fs.readdirSync(briefsDir).filter(f => f.endsWith('-brief.txt')).sort()

  for (const file of files) {
    const text    = fs.readFileSync(path.join(briefsDir, file), 'utf8')
    const lines   = text.split('\n')
    const get     = (key) => {
      const line = lines.find(l => l.startsWith(`${key}:`))
      return line ? line.slice(key.length + 1).trim() : null
    }

    const slot      = get('SLOT')
    const voice     = get('VOICE')
    const voiceUsed = get('VOICE_USED')

    // Pull a snippet of the Instagram caption for voice analysis
    const igIdx = lines.findIndex(l => l.startsWith('INSTAGRAM:'))
    const igSnippet = igIdx !== -1 ? lines[igIdx].slice('INSTAGRAM:'.length).trim().slice(0, 200) : null

    results.push({ slot: slot || file.replace('-brief.txt', ''), voice, voiceUsed, igSnippet })
  }
  return results
}

function buildVoiceBriefBlock(briefs) {
  if (!briefs.length) return '(no briefs found)'
  const lines = ['| Slot | Assigned Voice | Voice Used | Drift |']
  lines.push('|------|---------------|------------|-------|')
  for (const b of briefs) {
    const assigned = b.voice     || '(legacy)'
    const used     = b.voiceUsed || '(legacy)'
    const drift    = assigned !== used && b.voice && b.voiceUsed ? '⚠ YES' : 'No'
    lines.push(`| ${b.slot} | ${assigned} | ${used} | ${drift} |`)
  }

  const legacyCount = briefs.filter(b => !b.voice).length
  if (legacyCount > 0) lines.push(`\n_${legacyCount} brief(s) pre-date the five-voice system (VOICE field absent)._`)

  // Instagram caption samples for Claude to analyze voice execution
  lines.push('\n### Caption samples for voice execution analysis')
  for (const b of briefs) {
    if (b.igSnippet) lines.push(`\n**${b.slot}** (${b.voice || 'legacy'}):\n> ${b.igSnippet}`)
  }
  return lines.join('\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function getPostedLastNDays(n = 7) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - n)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  try {
    const dirs = execSync(`rclone lsd "${REMOTE}/Posted/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (!dirs) return '(no posted content found)'

    const lines = []
    for (const line of dirs.split('\n')) {
      const folder = line.trim().split(/\s+/).pop()
      if (!folder || folder < cutoffStr) continue
      try {
        const files = execSync(`rclone ls "${REMOTE}/Posted/${folder}"`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        lines.push(`\n### ${folder}`)
        for (const f of files.split('\n')) {
          const name = f.trim().split(/\s+/).slice(1).join(' ')
          if (name) lines.push(`- ${name}`)
        }
        for (const f of files.split('\n')) {
          const name = f.trim().split(/\s+/).slice(1).join(' ')
          if (name && name.endsWith('.md')) {
            try {
              fs.mkdirSync(TEMP_DIR, { recursive: true })
              execSync(`rclone copy "${REMOTE}/Posted/${folder}/${name}" "${TEMP_DIR}/"`, {
                stdio: ['pipe', 'pipe', 'pipe'],
              })
              const local = path.join(TEMP_DIR, name)
              if (fs.existsSync(local)) lines.push('\n```\n' + fs.readFileSync(local, 'utf8').trim() + '\n```')
            } catch {}
          }
        }
      } catch {}
    }
    return lines.join('\n') || '(no content posted in the last 7 days)'
  } catch { return '(rclone unavailable)' }
}

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

async function loadMemory() {
  const { loadMemoryById } = require('./lib/memory')
  return loadMemoryById()
}

function getHandoff() {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Handoff/BSV-Handoff-v5.md" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, 'BSV-Handoff-v5.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function loadLatestSocialReport() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^social-report-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Build voice reference block for system prompt ────────────────────────────

function buildVoiceReferenceBlock() {
  const lines = ['## BSV Five-Voice Spectrum', '']
  for (const [key, v] of Object.entries(VOICES)) {
    lines.push(`### ${v.name}`)
    lines.push(`${v.description}`)
    lines.push(`Example: "${v.example}"`)
    lines.push(`Guardrails: ${v.negative.slice(0, 2).join(' | ')}`)
    lines.push('')
  }
  lines.push('**Voice drift** = a slot assigned CALLOUT but executing BARBER warmth, or assigned NOD but writing three paragraphs. Flag it by name.')
  lines.push('**Consecutive repeat** = same voice assigned back-to-back across AM→PM or across days. Flag it.')
  return lines.join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ brand-manager start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `brand-health-${today}.md`

  log('Gathering growth metrics...')
  const klaviyoKey   = process.env.KLAVIYO_API_KEY
  const loungeListId = process.env.KLAVIYO_LOUNGE_LIST_ID
  const dropListId   = process.env.KLAVIYO_DROP_LIST_ID

  const [igMetrics, bskyMetrics] = await Promise.all([
    getInstagramMetrics(),
    getBlueskyMetrics(),
  ])
  if (igMetrics)   log(`Instagram: ${igMetrics.followers} followers`)
  if (bskyMetrics) log(`Bluesky: ${bskyMetrics.followers} followers`)

  let loungeGrowth = null
  let dropGrowth   = null
  if (klaviyoKey && loungeListId) {
    try {
      loungeGrowth = summariseGrowth(await getListProfiles(klaviyoKey, loungeListId))
      log(`Lounge: ${loungeGrowth.total} total, +${loungeGrowth.last7} this week`)
    } catch (err) { log(`Klaviyo Lounge error: ${err.message}`) }
  }
  if (klaviyoKey && dropListId) {
    try {
      dropGrowth = summariseGrowth(await getListProfiles(klaviyoKey, dropListId))
      log(`Drop: ${dropGrowth.total} total, +${dropGrowth.last7} this week`)
    } catch (err) { log(`Klaviyo Drop error: ${err.message}`) }
  }

  const metricsBlock = buildMetricsBlock(igMetrics, bskyMetrics, loungeGrowth, dropGrowth, today)

  log('Loading directive and collecting context...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const postedContent = getPostedLastNDays(7)
  const handoff       = getHandoff()
  log(`Handoff: ${handoff ? handoff.length + ' chars' : 'not found'}`)

  log('Reading recent briefs for voice tracking...')
  const recentBriefs   = readRecentBriefs()
  const voiceBriefBlock = buildVoiceBriefBlock(recentBriefs)
  log(`Briefs read: ${recentBriefs.length}`)

  log('Loading social intelligence for voice signals...')
  const socialReport = loadLatestSocialReport()
  log(`Social report: ${socialReport ? socialReport.filename : 'none'}`)

  const voiceRefBlock = buildVoiceReferenceBlock()

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the Brand Manager for Big Sole Vibes (BSV). Everything you review must be measured against the Proprietor's Directive above.

Your role is quality control. You review everything that has gone out under the BSV name and hold it to a single standard: does this make a serious man respect the brand, or does it make him scroll past?

## Your Guardrail

Your job is to protect the voice and the standard — not flatten the creative edge. Apply this hierarchy when reviewing content:

1. **Pass** — content that is scroll-stopping, premium, and on-directive. Edge, tension, dark humor, provocation: these are features, not risks. If it earns attention and holds the standard, it goes out.
2. **Fix** — content that has the right instinct but executes incorrectly: wrong voice, wrong platform fit, hashtag violation, muddled message. Name the specific fix.
3. **Block** — content that violates platform guidelines OR genuinely drops below the BSV standard (looks drugstore, sounds junior, compromises the man's dignity).

"Safe and predictable" is not a reason to approve something. Safe and predictable is a reason to send it back. The brand has an edge. Your job is to confirm it landed — not sand it down.

${voiceRefBlock}

## Rules that apply to all voices
- **Visual identity:** Midnight (#0D1B2A), Bourbon (#C17D2E), Steel (#4A6380). No clutter. No stock-photo energy.
- **Hashtags:** Always #BigSoleVibes (plural, never #BigSoleVibe). Max 4 hashtags per post. No hashtag spam.
- **Message clarity:** Every post has one clear point. If you can't state it in one sentence, the post fails.
- **Platform fit:** TikTok = hook-first, punchy. Instagram = brand equity, visual-led. X = one sharp line.
- **Voice mixing:** Voices must not bleed into each other mid-post. A PROPRIETOR post that suddenly gets warm is BARBER drift. A NOD post that runs three sentences is not NOD.

## Weekly balance check
AM slots run PROPRIETOR / BARBER / STANDARD (Lounge register). PM slots run CALLOUT / NOD / PROPRIETOR (Drop register). A healthy week uses multiple voices. Consecutive same-voice assignments are a flag. A full week in one voice is a problem.

You output a Brand Health Report. Be direct and specific. Name what works and what doesn't. Never soften a criticism — this is an internal document, not a press release.`

  const userPrompt = `Review all BSV content posted in the last 7 days and produce a Brand Health Report.

${metricsBlock}

## Content posted last 7 days
${postedContent}

## Voice Assignment vs Execution (from brief files)
${voiceBriefBlock}

${socialReport ? `## Social Intelligence (${socialReport.filename})\nUse voice-tagged observations where present.\n${socialReport.content.slice(0, 2000)}${socialReport.content.length > 2000 ? '\n[truncated]' : ''}` : ''}

${handoff ? `## Brand strategy context\n${handoff.slice(0, 1000)}` : ''}

---

Structure your report as follows:

# BSV Brand Health Report — ${today}

## Overall Score
Rate overall brand health this week: **Strong / Acceptable / Needs Work / Off-Brand**. One sentence explaining the rating.

## Voice Spectrum Usage
List which of the five voices (PROPRIETOR / BARBER / CALLOUT / NOD / STANDARD) ran this week. Count by voice. Identify any voice that ran zero times and flag it if it should have run. Flag any week where more than two consecutive slots ran the same voice.

## Voice Drift Report
For each slot with a VOICE and VOICE_USED field: did the executed caption match the assigned voice? Cite specific lines from the caption samples. Name the drift if present — e.g., "CALLOUT assigned but BARBER warmth in execution" or "NOD assigned but three-sentence caption breaks NOD rules."

## Voice Execution Quality
For each slot: did it execute its assigned voice cleanly against that voice's guardrails? Quote specific lines that landed and specific lines that missed.

## Voice Balance
AM register (Lounge: PROPRIETOR / BARBER / STANDARD) vs PM register (Drop: CALLOUT / NOD / PROPRIETOR). Count the split. Flag any imbalance.

## Voice Performance
Cross-reference voice assignments against any engagement signals from the social intelligence report. Which voices are showing traction? Which are getting forwarded, saved, or commented on? Which are going flat? Note where data is thin — this section improves as signal accumulates.

## Visual Compliance
Were the visual outputs on-brand? Midnight/Bourbon/Steel palette? Clean composition? Flag anything that looks off.

## Hashtag Audit
Check every post: #BigSoleVibes present? Correct plural form? Count correct (≤4)? List any violations.

## Message Clarity
Did each post have one clear point? Identify any posts that felt muddled.

## Platform Fit
Was each piece matched to the right platform with appropriate tone adjustment?

## Top 3 This Week
The three strongest pieces and why they worked — include which voice they ran.

## Fix List
Specific, actionable changes for next week. Not suggestions — directives. Include at least one voice-specific directive if drift was detected.`

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  let fullText = ''

  const originalMessages = [{ role: 'user', content: userPrompt }]

  const stream = await client.messages.stream({
    model:      'claude-sonnet-4-6',
    max_tokens: 6000,
    system:     systemPrompt,
    messages:   originalMessages,
  })

  process.stdout.write('Generating')
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n')

  const final = await stream.finalMessage()
  log(`Done — ${final.usage?.output_tokens ?? '?'} tokens, stop: ${final.stop_reason}`)

  if (final.stop_reason === 'max_tokens') {
    log('[brand-manager] Hit max_tokens — requesting continuation...')
    const continuation = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     systemPrompt,
      messages: [
        ...originalMessages,
        { role: 'assistant', content: fullText },
        { role: 'user', content: 'Continue exactly where you left off. Do not repeat anything.' },
      ],
    })
    fullText += continuation.content[0]?.text ?? ''
    log(`Continuation done — ${continuation.usage?.output_tokens ?? '?'} tokens`)
  }

  if (!fullText.trim()) { log('ERROR: empty response'); process.exit(1) }

  const reportContent = metricsBlock + '\n\n---\n\n' + fullText

  const localPath = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localPath, reportContent)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Reports/${outFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log(`Uploaded → ${REMOTE}/Reports/${outFile}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  log('━━━ brand-manager complete ━━━\n')
})()
