require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'social-listening.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-social-listening')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function getPreviousReport() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^social-listening-\d{4}-\d{2}-\d{2}\.md$/))
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

  log('━━━ social-listening start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `social-listening-${today}.md`

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  const previous = getPreviousReport()
  log(`Previous report: ${previous ? previous.filename : 'none'}`)

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}You are the Social Intelligence Director for Big Sole Vibes (BSV). Your findings must align with and serve the Proprietor's Directive above.

BSV has two content voices: The Lounge (premium/bourbon, men 35–55) and The Drop (sneaker culture/streetwear, men 18–34). The man in both voices is the same man — different day, same standard.

Your job: monitor the conversation happening online right now and extract signal — what men are actually saying about foot care, grooming, sneaker culture, and the competitor landscape. You are looking for content opportunities, emerging trends, unmet needs, and cultural moments BSV can own.

You are not looking for vanity. You are looking for leverage.

Search with precision. Find real posts, real threads, real conversations. Quote directly when you find something worth quoting. Attribute sources (subreddit, handle, platform) without linking.

Flag anything that represents:
- A content angle BSV hasn't used but should
- A competitor doing something right (learn from it) or wrong (exploit the gap)
- A cultural moment arriving in the next 7–14 days that either voice could own
- A question men are asking that BSV could answer authoritatively`

  const userPrompt = `Conduct a social listening sweep for Big Sole Vibes and produce a report dated ${today}.

## Search areas

**1. Men's foot care conversations on Reddit**
Search r/malefashionadvice, r/malegrooming, r/sneakers, r/frugalmalefashion, r/AskMen, r/streetwear for recent threads mentioning foot care, cracked heels, foot balm, dry feet, foot cream, lotion for feet. What are men actually saying? What are their frustrations? What products are they recommending?

**2. Sneaker culture foot care**
Search for conversations at the intersection of sneaker culture and foot care — how are sneakerheads talking about foot hygiene? Is there a growing awareness or is it still taboo? Any influencers or accounts crossing both worlds?

**3. Competitor activity**
Search for recent activity from men's foot care brands: Gold Bond Men's, O'Keeffe's Working Feet, Gehwol, Kerasal, Burt's Bees, and any premium/indie competitors. What are they posting? What's landing? What's falling flat?

**4. Trending grooming hashtags**
What hashtags are currently active in men's grooming, foot care, sneaker care, and self-care on Instagram and TikTok? Any emerging tags BSV isn't using?

**5. Cultural calendar scan**
What's happening in the next 7–14 days in sneaker culture (major releases, anniversaries, events), men's grooming culture, or the broader cultural calendar that either The Lounge or The Drop voice could authentically reference?

${previous ? `## Previous report (flag anything that has evolved or should be revisited)\nFrom ${previous.filename}:\n${previous.content.slice(0, 3000)}${previous.content.length > 3000 ? '\n[truncated]' : ''}` : '## No previous report — establish baseline findings.'}

---

# BSV Social Listening Report — ${today}

## Reddit Intelligence
Real threads, real quotes, real frustration and desire. What are men saying about foot care right now?

## Sneaker Culture × Foot Care
Is the intersection growing? Key conversations, accounts, or moments.

## Competitor Landscape
What each major competitor is doing right now. One sentence on the opportunity each creates for BSV.

## Hashtag Opportunities
Active tags BSV should be using. Tags BSV is using that are underperforming. Emerging tags to watch.

## Cultural Calendar (next 14 days)
Specific moments, releases, or events. Flag which BSV voice owns it: **Lounge**, **Drop**, or **Bridge**.

## Top 3 Content Opportunities
The three highest-leverage content angles BSV could execute in the next 7 days based on this scan. Be specific — not "do a post about sneakers" but "Drop voice: Jordan 45th anniversary drops [date], angle is [specific angle], caption hook: [draft line]."

## Signal vs. Noise
One thing that looks important but probably isn't. One thing that's easy to miss but matters.`

  log('Calling Claude API with web search...')
  const client = new Anthropic({ apiKey })

  let messages  = [{ role: 'user', content: userPrompt }]
  let fullText  = ''
  let turns     = 0
  const MAX_TURNS = 12

  while (turns < MAX_TURNS) {
    turns++
    log(`Turn ${turns}...`)

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8192,
      system:     systemPrompt,
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }],
      messages,
      betas:      ['web-search-2025-03-05'],
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
