require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT      = path.join(__dirname, '..')
const LOG_FILE  = path.join(ROOT, 'logs', 'social-listening.log')
const LOCK_FILE = path.join(ROOT, 'logs', 'social-listening.lock')
const TEMP_DIR  = path.join(os.homedir(), 'tmp', 'bsv-social-listening')
const REMOTE    = 'big sole vibes:Big Sole Vibes'

const { VOICES } = require('../config/bsv-voices')

// ─── BSV DUAL-TRACK MANDATE ───────────────────────────────────────────────────
// The BSV man is the coal miner AND the CFO. The shelf serves both.
// Track 1: Premium/luxury transposition — brands the BSV man hasn't been introduced to yet
// Track 2: Cultural crossover — products already working, not yet claimed for the male audience
// The filter is fit for the BSV man. Not brand recognition. Not retail tier.
// A $29 gel sock on national TV earns its place. A $150 cream nobody's heard of earns its place.
// Both belong. Both make money. Both tell the BSV story.

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Lockfile guard ───────────────────────────────────────────────────────────

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim()
    log(`Already running (PID ${pid}) — exiting to avoid double-instance`)
    process.exit(0)
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid))
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE) } catch {}
}

process.on('exit',            releaseLock)
process.on('SIGTERM',         () => process.exit(0))
process.on('SIGINT',          () => process.exit(0))
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT: ${err.stack || err.message}`)
  process.exit(1)
})

// ─── Drive helpers ────────────────────────────────────────────────────────────

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


function getPreviousReport() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^social-report-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()

    if (!files.length) return null
    const latest = files[files.length - 1]
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  acquireLock()
  log('━━━ social-listening start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `social-report-${today}.md`

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const previous    = getPreviousReport()
  log(`Previous report: ${previous ? previous.filename : 'none'}`)

  const voiceNames = Object.values(VOICES).map(v => `${v.name} (${v.description})`).join(' | ')

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the BSV Intelligence Agent. One job: deliver actionable signal from three specific audience communities.

BSV serves three men:
- **The Professional** — invests in quality, cares about craft, owns good leather. Lives in r/malefashionadvice, r/goodyearwelt, r/bootroom, r/suits. Reads Huckberry, Esquire, GQ.
- **The Athlete** — pushes his body, cares about recovery and performance. Lives in r/running, r/cycling, r/crossfit, r/nba, r/basketball. Foot and lower-body pain points are a direct BSV entry.
- **The Style-Conscious** — detail-obsessed, ritual-driven, follows drops. Lives in r/streetwear, r/sneakers, r/malefashionadvice. Reads Highsnobiety, Mr Porter, Complex.

Your report is read by media-director before it briefs a single content slot. Everything in it must be usable tomorrow morning.

Rules:
- Quote real language verbatim. Paraphrase is worthless. A phrase from a real thread is leverage.
- Name the source (subreddit, publication, platform). No links needed.
- Gaps are named problems with no solution in sight — not vague "unmet needs."
- Story angles must be specific enough that media-director can brief them without re-researching.
- If signal is thin on a topic, say so. Do not fabricate.

## BSV Voice Spectrum
Tag story angles by voice: ${voiceNames}. Use brackets: [PROPRIETOR], [CALLOUT], etc.

## Track 2 — Cultural Crossover Monitoring
BSV runs two tracks. Track 1 is premium transposition (luxury/niche brands introduced to men for the first time). Track 2 is cultural crossover: products already working in the mainstream or women's space that are crossing over to men organically, with no one having planted the flag yet.

Watch for these crossover signals in every community you monitor:
- National TV coverage: The View, GMA, Today, Rachael Ray — any grooming, foot care, or recovery product mentioned
- Reddit language patterns: "my wife/girlfriend recommended", "borrowed from her", "she put it on my nightstand", "men can use this too", "my husband uses", "my boyfriend uses", "guys this is worth it", "actually works" + foot/grooming context
- "as seen on" or "seen on TV" + personal care context
- Products going viral in unexpected male spaces
- Women explicitly vouching for products for men in public threads

When you detect a crossover signal, tag it [CROSSOVER] inline. At the end of the report, set crossover_signal: true if any products were flagged, and list them in the Crossover Detections section.`

  const userPrompt = `Run the BSV audience intelligence sweep. Today is ${today}.

${previous ? `## Previous report: ${previous.filename}\nFlag any threads still running or language shifts since yesterday.\n${previous.content.slice(0, 1200)}${previous.content.length > 1200 ? '\n[truncated]' : ''}\n\n---\n` : ''}

Search each persona's communities now. Use web search to pull current Reddit threads, publication coverage, and hashtag activity. Prioritize posts and threads from the past 7 days.

---

# BSV Social Intelligence Report — ${today}

## MAN 1 — THE PROFESSIONAL
*Communities: r/malefashionadvice, r/goodyearwelt, r/bootroom, r/suits | Sites: Huckberry, Esquire, GQ*
*Hashtags: #BigSoleVibes #mensgrooming #selfcare #menwellness*

### Top 3 Conversations Right Now
For each: thread title or headline, platform/source, approximate engagement signal, and what the conversation is actually about underneath the surface topic.

### Verbatim Language
Exact phrases and words this community is using — not paraphrased. Pull directly from post titles, comments, article subheads. At least 6–8 phrases.

### Gaps
What problems are being named in these communities that no product or brand is visibly solving? Be specific — name the exact complaint.

---

## MAN 2 — THE ATHLETE
*Communities: r/running, r/cycling, r/crossfit, r/nba, r/basketball*
*Hashtags: #BigSoleVibes #recovery #musclerecovery #mensgrooming #selfcare*

### Top 3 Conversations Right Now
Focus on recovery conversation, foot and lower-body pain points, performance rituals. Same format: source, engagement signal, what's underneath it.

### Verbatim Language
Exact phrases from posts, threads, comments. Especially language around foot pain, recovery routines, and self-care rituals. At least 6–8 phrases.

### Gaps
Specific problems being named — especially around foot health, recovery products, and the gap between athletic performance culture and grooming/care culture.

---

## MAN 3 — THE STYLE-CONSCIOUS
*Communities: r/streetwear, r/sneakers, r/malefashionadvice | Sites: Highsnobiety, Mr Porter, Complex*
*Hashtags: #BigSoleVibes #mensgrooming #selfcaremen #groomingformen*

### Top 3 Conversations Right Now
Focus on boot and shoe care, detail-oriented grooming, ritual and routine. Same format.

### Verbatim Language
Exact phrases — especially anything about care rituals, product quality, brand trust, and the language of detail-consciousness. At least 6–8 phrases.

### Gaps
What detail-level problems are named that no brand is addressing with the seriousness this community expects?

---

## Story Angles for Media-Director
Three angles, one per persona. Each must be briefable tomorrow morning.

**Angle 1 — The Professional**
- Hook (one sentence, specific)
- BSV voice: [VOICE NAME]
- Why this week, not next week
- Draft opening line

**Angle 2 — The Athlete**
- Hook (one sentence, specific)
- BSV voice: [VOICE NAME]
- Why this week, not next week
- Draft opening line

**Angle 3 — The Style-Conscious**
- Hook (one sentence, specific)
- BSV voice: [VOICE NAME]
- Why this week, not next week
- Draft opening line

---

## Hashtag Performance Signal
Which hashtags from the three persona lists are getting traction this week vs. going quiet? Use search to check recent post volume and engagement patterns. Flag any rising tags not on the list that BSV should be watching.

Hashtags to assess: #BigSoleVibes #mensgrooming #selfcare #menwellness #selfcaremen #groomingformen #recovery #musclerecovery #footcare #foothealth #skincare #skincareformen

---

## TRACK 2 — CULTURAL CROSSOVER MONITOR
*Communities: r/everymanshouldknow, r/Frugal (men's grooming threads), r/BuyItForLife (foot care / grooming tools), r/malefashionadvice (crossover threads), r/malegrooming (expanded keyword scope)*
*Also scan: recent daytime TV (The View, GMA, Today, Rachael Ray) for grooming / foot care / recovery product mentions*

Search these communities and sources now. Look specifically for:

### Crossover Language Scan
Products or threads containing any of these signals:
- "my wife/girlfriend recommended" | "borrowed from her" | "she put it on my nightstand"
- "my husband uses" | "my boyfriend uses" — female-to-male recommendation confirmation
- "men can use this too" | "guys this is worth it" | "actually works" + foot or grooming context
- "seen on TV" | "as seen on" + personal care product
- Any daytime TV show name + grooming or foot care or recovery product

### Crossover Products Detected [CROSSOVER]
For each product that generated a crossover signal this week, report:
- **Product name and brand**
- **Signal type:** TV appearance / Reddit thread / viral moment / female recommendation
- **Evidence:** Exact quote or show + date
- **Platform/source**
- **Why the BSV man would reach for this** (one sentence — Proprietor voice)
- **Estimated price and Amazon availability** (check and report)

If no crossover products were detected this week, say so explicitly.

### Track 2 Output Summary
crossover_signal: [true / false]
Products flagged for Track 2 shelf consideration: [list names, or "none this week"]`

  log('Calling Claude API with web search...')
  // timeout/maxRetries added 2026-07-16 — this is the heaviest API call in
  // the pipeline (up to 12 turns, up to 18 web searches per turn), and was
  // using the SDK default, which produced "Request timed out" 10 times over
  // the last ~6 weeks — by far the most of any script in the eng backlog.
  // Explicit generous timeout + retries gives a genuinely long research call
  // room to finish instead of getting cut off mid-run.
  const client = new Anthropic({ apiKey, timeout: 10 * 60 * 1000, maxRetries: 3 })

  let messages = [{ role: 'user', content: userPrompt }]
  let fullText = ''
  let turns    = 0
  const MAX_TURNS = 12

  while (turns < MAX_TURNS) {
    turns++
    log(`Turn ${turns}...`)

    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      system:     systemPrompt,
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 18 }],
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    const textBlocks = response.content.filter(b => b.type === 'text')
    if (textBlocks.length) fullText = textBlocks.map(b => b.text).join('\n')

    if (response.stop_reason === 'end_turn') break

    if (response.stop_reason === 'tool_use') {
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }))
      messages.push({ role: 'user', content: toolResults })
    } else {
      break
    }
  }

  log(`Complete — ${turns} turn(s)`)

  if (!fullText.trim()) { log('ERROR: empty response'); process.exit(1) }

  const localPath = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localPath, fullText)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Reports/${outFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log(`Uploaded → ${REMOTE}/Reports/${outFile}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  log('━━━ social-listening complete ━━━\n')
})()
