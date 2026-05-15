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

function loadMemory() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Memory.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Memory.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function loadLatestBrandHealth() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^brand-health-\d{4}-\d{2}-\d{2}\.md$/))
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
  const memory = loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const previous    = getPreviousReport()
  log(`Previous report: ${previous ? previous.filename : 'none'}`)

  const brandHealth = loadLatestBrandHealth()
  log(`Brand health: ${brandHealth ? brandHealth.filename : 'none'}`)

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the BSV Intelligence Agent. One job: deliver signal, not noise.

You monitor conversations across men's lifestyle, grooming, sneaker culture, and the broader cultural moment. You produce a structured intelligence report that media-director and creative-agent read before generating any content. Your output is raw material — what's happening, what men are saying, what's gaining traction.

You do not generate creative content. You do not suggest copy. You surface intelligence and let the creative agents do their job.

Be specific. Quote real sources (subreddit, handle, platform — no links). A vague trend observation is worthless. A direct quote from a real thread with 400 upvotes is leverage.`

  const userPrompt = `Run the daily BSV intelligence sweep. Today is ${today}.

Search Reddit, X/Twitter, TikTok comment culture, and specialty communities. Find signal, not surface noise.

${brandHealth ? `## Current Audience (from Brand Health Report ${brandHealth.filename})\nUse these numbers to calibrate what counts as significant traction — a community that would matter to an audience of this size.\n${brandHealth.content.split('\n').slice(0, 20).join('\n')}\n` : ''}
${previous ? `## Previous report: ${previous.filename}\nNote any evolutions or threads worth following.\n${previous.content.slice(0, 1500)}${previous.content.length > 1500 ? '\n[truncated]' : ''}` : '## No previous report — establish baseline.'}

---

# BSV Social Intelligence Report — ${today}

## What Men Are Talking About
Real threads, real quotes, real language. What are men saying about grooming, foot care, self-maintenance, standards, and the man who takes care of himself? Not what the brands are saying — what the men are saying. Pull from r/malefashionadvice, r/malegrooming, r/sneakers, r/AskMen, r/streetwear and equivalent X/TikTok communities.

## Formats Getting Shared
What content formats are performing in men's lifestyle and grooming this week — not as theory, but as observation. What's getting reposted, screenshotted, saved. Be specific: "dark cinematic product shots are getting 3–4× the engagement of talking-head videos in grooming" is useful. "Video content is trending" is not.

## The Cultural Moment
What is the specific thing happening in culture right now — a drop, an anniversary, a conversation, a meme format, a news event — that the BSV man would recognize and care about. Flag which BSV voice it belongs to: **The Lounge** or **The Drop**.

## The Tension BSV Can Enter
What frustration, debate, or unmet expectation is alive right now that BSV is positioned to say something real about? Not a topic — a tension. The gap between what men want and what they're getting. The thing they're tired of being sold. The standard they're holding themselves to that no brand is acknowledging.

## 3–5 Content Angles
Each angle must include:
- The specific hook or entry point
- Which BSV voice executes it (Lounge / Drop / Bridge)
- One draft opening line to test the angle
- Why right now (what makes this timely this week, not just evergreen)

## Signal vs. Noise
One thing that looks important but probably isn't. One thing easy to miss that matters.`

  log('Calling Claude API with web search...')
  const client = new Anthropic({ apiKey })

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
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }],
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
