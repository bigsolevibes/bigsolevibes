require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// chief-of-staff.js — BSV daily morning brief, handoff update, Telegram ping
//
// Runs every morning at 8:00AM via launchd.
// Reads everything. Synthesizes. Reports to the Proprietor.
//
// Required .env additions (add manually — this script never writes .env):
//   TELEGRAM_BOT_TOKEN=<your bot token from @BotFather>
//   TELEGRAM_CHAT_ID=<your personal chat ID — send /start to @userinfobot>
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'chief-of-staff.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-chief-of-staff')
const REMOTE   = 'big sole vibes:Big Sole Vibes'

const DAILY_API_CEILING   = 2.00   // $ — hard daily limit Chief enforces
const CLAUDE_INPUT_PER_M  = 3.00   // $ per 1M input tokens (Sonnet 4.x)
const CLAUDE_OUTPUT_PER_M = 15.00  // $ per 1M output tokens

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function rcloneCopy(src, destDir) {
  execSync(`rclone copy "${src}" "${destDir}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function rcloneCopyTo(src, dest) {
  execSync(`rclone copyto "${src}" "${dest}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function loadDriveFile(remotePath, localDir) {
  try {
    rcloneCopy(remotePath, localDir)
    const local = path.join(localDir, path.basename(remotePath))
    return fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null
  } catch { return null }
}

function loadLatestReport(prefix, folder = 'Reports') {
  try {
    const files = execSync(`rclone ls "${REMOTE}/${folder}"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.startsWith(prefix + '-') && f.endsWith('.md'))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    const content = loadDriveFile(`${REMOTE}/${folder}/${latest}`, TEMP_DIR)
    return content ? { filename: latest, content } : null
  } catch { return null }
}

// ─── Local state collectors ───────────────────────────────────────────────────

function getRecentLog(filename, lines = 80) {
  try {
    const p = path.join(ROOT, 'logs', filename)
    if (!fs.existsSync(p)) return null
    const all = fs.readFileSync(p, 'utf8').trim().split('\n')
    return all.slice(-lines).join('\n')
  } catch { return null }
}

function getPostState() {
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function detectUnverifiedSlots(watchLogContent) {
  if (!watchLogContent) return []

  // Slots watch-drive archived (marked done + moved to Posted/)
  const archivedSlots = new Set()
  for (const line of watchLogContent.split('\n')) {
    const m = line.match(/\] ([\w-]+): archived/)
    if (m) archivedSlots.add(m[1])
  }
  if (!archivedSlots.size) return []

  // Slots confirmed in post-state.json with at least one success entry
  const confirmedSlots = new Set()
  try {
    const p = path.join(ROOT, 'logs', 'post-state.json')
    if (fs.existsSync(p)) {
      const entries = JSON.parse(fs.readFileSync(p, 'utf8'))
      for (const e of entries) {
        if (e.status === 'success') confirmedSlots.add(e.slot)
      }
    }
  } catch {}

  return [...archivedSlots].filter(s => !confirmedSlots.has(s))
}

function getOutputFiles() {
  try {
    return fs.readdirSync(path.join(ROOT, 'posts', 'output'))
      .filter(f => !f.startsWith('.'))
      .sort()
  } catch { return [] }
}

function getBriefFiles() {
  try {
    return fs.readdirSync(path.join(ROOT, 'posts', 'briefs'))
      .filter(f => f.endsWith('-brief.txt'))
      .sort()
  } catch { return [] }
}

// ─── Token budget ────────────────────────────────────────────────────────────

function buildTokenBudget() {
  const now      = new Date()
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)

  const AGENT_LOGS = [
    { name: 'eng-bot',             file: 'eng-bot.log' },
    { name: 'social-listening',    file: 'social-listening.log' },
    { name: 'media-director',      file: 'media-director.log' },
    { name: 'brand-manager',       file: 'brand-manager.log' },
    { name: 'marketing-manager',   file: 'marketing-manager.log' },
    { name: 'product-development', file: 'product-development.log' },
    { name: 'product-research',    file: 'product-research.log' },
    { name: 'change-agent',        file: 'change-agent.log' },
    { name: 'update-handoff',      file: 'update-handoff.log' },
    { name: 'chief-of-staff',      file: 'chief-of-staff.log' },
  ]

  const agentBreakdown = []
  for (const { name, file } of AGENT_LOGS) {
    const logPath = path.join(ROOT, 'logs', file)
    if (!fs.existsSync(logPath)) continue
    let outputTokens = 0, calls = 0
    try {
      for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
        const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
        if (!tsMatch || new Date(tsMatch[1]) < dayStart) continue
        // Matches: "Done — N tokens", "Stand-up done — N tokens", "Continuation done — N output tokens"
        const m = line.match(/done[^\d]*(\d+)\s*(?:output\s+)?tokens/i)
        if (m) { outputTokens += parseInt(m[1], 10); calls++ }
      }
    } catch {}
    if (calls === 0) continue
    // Input not logged — estimate at 2× output (conservative for long system prompts)
    const inputEst = outputTokens * 2
    const cost = (inputEst / 1_000_000) * CLAUDE_INPUT_PER_M
              + (outputTokens / 1_000_000) * CLAUDE_OUTPUT_PER_M
    agentBreakdown.push({ name, calls, outputTokens, cost })
  }
  agentBreakdown.sort((a, b) => b.cost - a.cost)

  const totalEstCost = agentBreakdown.reduce((s, r) => s + r.cost, 0)

  // Pull today's official total from cost-report.log if cost-report ran today
  let officialTotal = null
  try {
    const crLogPath = path.join(ROOT, 'logs', 'cost-report.log')
    if (fs.existsSync(crLogPath)) {
      const todayStr = now.toISOString().slice(0, 10)
      for (const line of fs.readFileSync(crLogPath, 'utf8').split('\n').reverse()) {
        if (!line.includes(todayStr)) continue
        const m = line.match(/Today.*cost:\s*\$?([\d.]+)/i)
        if (m) { officialTotal = parseFloat(m[1]); break }
      }
    }
  } catch {}

  const reportedTotal = officialTotal ?? totalEstCost
  const pctOfCeiling  = (reportedTotal / DAILY_API_CEILING) * 100

  return {
    agentBreakdown,
    totalEstCost,
    officialTotal,
    reportedTotal,
    pctOfCeiling,
  }
}

// ─── Drive state collectors ───────────────────────────────────────────────────

function getReadyToPost() {
  try {
    const out = execSync(`rclone ls --max-depth 1 "${REMOTE}/Ready to Post/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (!out) return '(empty)'
    return out.split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(Boolean)
      .join(', ')
  } catch { return '(unavailable)' }
}

function getPostedLast24h() {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - 24)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  try {
    const dirs = execSync(`rclone lsd "${REMOTE}/Posted/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const lines = []
    for (const line of dirs.split('\n')) {
      const folder = line.trim().split(/\s+/).pop()
      if (!folder || folder < cutoffDate) continue
      try {
        const files = execSync(`rclone ls "${REMOTE}/Posted/${folder}"`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        const names = files.split('\n').map(f => f.trim().split(/\s+/).slice(1).join(' ')).filter(Boolean)
        lines.push(`${folder}: ${names.join(', ')}`)
      } catch {}
    }
    return lines.join('\n') || '(nothing posted in last 24h)'
  } catch { return '(unavailable)' }
}

function getProductDevState() {
  try {
    const p = path.join(ROOT, 'logs', 'product-development-state.json')
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
  } catch { return null }
}

function getChangeState() {
  try {
    const p = path.join(ROOT, 'logs', 'change-state.json')
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
  } catch { return null }
}

// ─── Org chart helpers ────────────────────────────────────────────────────────

function loadOrgChart() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Org-Chart.svg" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, 'BSV-Org-Chart.svg')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function parseOrgChartAgents(svgContent) {
  const seen = new Set()
  const re = /[\w-]+\.js/g
  let m
  while ((m = re.exec(svgContent)) !== null) seen.add(m[0])
  return [...seen]
}

function checkLogActivity(agentFilenames, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return agentFilenames.filter(name => {
    const logPath = path.join(ROOT, 'logs', name.replace('.js', '.log'))
    if (!fs.existsSync(logPath)) return true
    try { return fs.statSync(logPath).mtimeMs < cutoff } catch { return true }
  })
}

async function runOrgChartUpdate(client, orgChartSvg, newScripts, inactiveAgents) {
  const changes = []
  if (newScripts.length)     changes.push(`Add new agents as nodes: ${newScripts.join(', ')}`)
  if (inactiveAgents.length) changes.push(`Mark as inactive (grey fill, "(inactive)" label suffix): ${inactiveAgents.join(', ')}`)

  if (!changes.length) {
    log('Org chart update: no changes to apply')
    return { updated: false, reason: 'no changes needed' }
  }

  log(`Org chart update: applying — ${changes.join(' | ')}`)
  try {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8192,
      system:     'You are updating an SVG org chart. Return ONLY the complete updated SVG — no explanation, no markdown fencing, just raw SVG XML starting with <?xml or <svg.',
      messages:   [{
        role:    'user',
        content: `Update this BSV agent org chart SVG with the following approved changes:\n\n${changes.join('\n')}\n\nFor new agents: add them as nodes matching the visual style of existing nodes in their logical layer. For inactive agents: change their node fill to #888888 and append " (inactive)" to the label text.\n\nReturn the complete updated SVG.\n\nCurrent SVG:\n${orgChartSvg}`,
      }],
    })

    const updatedSvg = msg.content[0]?.text?.trim() || ''
    if (!updatedSvg.includes('<svg') && !updatedSvg.includes('<?xml')) {
      log('ERROR: Claude returned invalid SVG for org chart update')
      return { updated: false, reason: 'invalid SVG response' }
    }

    const localSvg = path.join(TEMP_DIR, 'BSV-Org-Chart.svg')
    fs.writeFileSync(localSvg, updatedSvg)
    execSync(`rclone copyto "${localSvg}" "${REMOTE}/BSV-Org-Chart.svg"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log('Org chart updated and uploaded to Drive ✓')
    changes.forEach(c => log(`  → ${c}`))
    return { updated: true, changes }
  } catch (err) {
    log(`ERROR: org chart update failed: ${err.message}`)
    return { updated: false, reason: err.message }
  }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Telegram error: ${JSON.stringify(data)}`)
  return data
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ chief-of-staff start ━━━')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const client           = new Anthropic({ apiKey })
  const today            = new Date().toISOString().slice(0, 10)
  const dayName          = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  const dayOfWeek        = new Date().getDay()   // 0=Sun, 1=Mon
  const isMonday         = dayOfWeek === 1
  const isMidWeekLate    = dayOfWeek >= 3 && dayOfWeek <= 5  // Wed–Fri
  const outFile          = `standup-${today}.md`
  const updateOrgChart   = process.argv.includes('--update-org-chart')

  // ── Collect context ──────────────────────────────────────────────────────────

  log('Collecting context...')

  const tokenBudget = buildTokenBudget()
  log(`Token budget: est $${tokenBudget.totalEstCost.toFixed(4)} today${tokenBudget.officialTotal != null ? `, official $${tokenBudget.officialTotal.toFixed(4)}` : ''} (${tokenBudget.pctOfCeiling.toFixed(1)}% of $${DAILY_API_CEILING} ceiling)`)

  const directive      = loadDriveFile(`${REMOTE}/BSV-Directive.md`, TEMP_DIR)
  const strategyState  = loadDriveFile(`${REMOTE}/BSV-Strategy-State.md`, TEMP_DIR)
  const memory         = loadDriveFile(`${REMOTE}/BSV-Memory.md`, TEMP_DIR)
  const handoff        = loadDriveFile(`${REMOTE}/Handoff/BSV-Handoff-v5.md`, TEMP_DIR)
  const socialReport   = loadLatestReport('social-report')
  const brandReport    = loadLatestReport('brand-health')
  const marketingReport = loadLatestReport('marketing')
  const productResearch    = loadLatestReport('research', 'Product Research')
  const productBrief       = loadLatestReport('product-brief', 'Product Development')
  const costReport         = loadLatestReport('cost-report')
  const productDevState    = getProductDevState()
  const changeState        = getChangeState()

  log(`Directive: ${directive ? 'loaded' : 'missing'}`)
  log(`Strategy state: ${strategyState ? 'loaded' : 'missing'}`)
  log(`Memory: ${memory ? 'loaded' : 'missing'}`)
  log(`Handoff: ${handoff ? 'loaded' : 'missing'}`)
  log(`Social report: ${socialReport?.filename || 'none'}`)
  log(`Brand report: ${brandReport?.filename || 'none'}`)
  log(`Marketing report: ${marketingReport?.filename || 'none'}`)
  log(`Product research: ${productResearch?.filename || 'none'}`)
  log(`Product brief: ${productBrief?.filename || 'none'}`)
  log(`Product dev state: ${productDevState ? `milestone="${productDevState.milestone}" action_needed=${productDevState.action_needed}` : 'none'}`)
  log(`Change state: ${changeState ? `open=${changeState.open_issues} action_needed=${changeState.action_needed}` : 'none'}`)
  log(`Cost report: ${costReport?.filename || 'none'}`)

  const watchLog       = getRecentLog('watch-drive.log', 150)
  const unverifiedSlots = detectUnverifiedSlots(watchLog)
  if (unverifiedSlots.length) {
    log(`Unverified slots (archived in log but not in post-state.json): ${unverifiedSlots.join(', ')}`)
  }
  const socialLog      = getRecentLog('social-listening.log', 40)
  const mediaLog       = getRecentLog('media-director.log', 40)
  const creativeLog    = getRecentLog('creative-agent.log', 40)
  const bridgeLog      = getRecentLog('gemini-bridge.log', 40)
  const imageLog       = getRecentLog('image-gen.log', 40)
  const videoLog       = getRecentLog('video-gen.log', 40)
  const engBotLog      = getRecentLog('eng-bot.log', 30)
  const productDevLog  = getRecentLog('product-development.log', 30)
  const changeAgentLog = getRecentLog('change-agent.log', 30)

  const postState      = getPostState()
  const outputFiles    = getOutputFiles()
  const briefFiles     = getBriefFiles()
  const readyToPost    = getReadyToPost()
  const postedLast24h  = getPostedLast24h()

  log(`Ready to Post: ${readyToPost}`)
  log(`Posted last 24h: ${postedLast24h}`)
  log(`Output files: ${outputFiles.join(', ') || 'none'}`)
  log(`Brief files: ${briefFiles.join(', ') || 'none'}`)

  // ── Org chart gap detection ──────────────────────────────────────────────────

  log('Running org chart gap detection...')
  const orgChartSvg    = loadOrgChart()
  const knownAgents    = orgChartSvg ? parseOrgChartAgents(orgChartSvg) : []
  const scriptFiles    = fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter(f => f.endsWith('.js')).sort()
  const inactiveAgents = checkLogActivity(knownAgents, 7)
  const newScripts     = scriptFiles.filter(s => !knownAgents.includes(s))
  const orgHasGaps     = newScripts.length > 0 || inactiveAgents.length > 0

  log(`Org chart: ${orgChartSvg ? `loaded (${knownAgents.length} agents known)` : 'missing from Drive'}`)
  log(`New scripts not in chart: ${newScripts.join(', ') || 'none'}`)
  log(`Inactive agents (7d): ${inactiveAgents.join(', ') || 'none'}`)

  // ── Org chart update (if approved by Big D via --update-org-chart) ───────────

  let orgUpdateResult = null
  if (updateOrgChart) {
    if (!orgChartSvg) {
      log('ERROR: --update-org-chart requires org chart in Drive — BSV-Org-Chart.svg not found')
    } else {
      log('--update-org-chart flag set — executing approved update...')
      orgUpdateResult = await runOrgChartUpdate(client, orgChartSvg, newScripts, inactiveAgents)
    }
  }

  // ── Stand-up generation ──────────────────────────────────────────────────────

  log('Calling Claude API for stand-up...')

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${strategyState ? `${strategyState}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the Chief of Staff for Big Sole Vibes.

The first voice the Proprietor hears every morning. Not a dashboard. Not a digest. A point of view.

Every morning you read the Directive, the Memory, the logs, the reports, the queue, the audience numbers — and you ask one question: are we closer to earning the Foot Balm's launch than we were yesterday? The launch condition is 10,000 engaged men who hold the standard, with affiliate revenue proving the audience converts. That is the only scoreboard that matters. Everything else — the pipeline running clean, the agents firing on schedule, the brand health scores — is infrastructure. Infrastructure in service of that scoreboard.

Your primary output every morning is one recommendation. Not a list. Not options. One specific ask of the Proprietor, stated directly, with a reason attached. The rest of the brief is context for that recommendation. If nothing needs a decision, say so — but that is rare. There is almost always one thing standing between where BSV is and where it needs to be.

You manage a team. Their job is not to run — it's to grow the audience. A pipeline that fires perfectly but posts content that doesn't belong in the lounge is a failing pipeline. Content that belongs in the lounge is content The BSV Man stops for, shares, and signs up for. You know the difference between a clean run and actual progress. Say which one yesterday was.

You never mistake activity for progress.
You never bury the lead.
You never spend above $2/day without flagging it.

Every morning you also identify one piece of long-form Lounge content that should live on bigsolevibes.com. Not a blog post. Lounge content: something that goes deeper than any social post can, speaks to the man directly, and gives Google a reason to send him there. You ground the idea in what social-listening found and what the creative pipeline produced — the theme that kept surfacing, the tension that the social posts only grazed. You surface it with a working title and the angle. Big D approves. creative-agent builds it. This is how BSV builds a body of work that outlasts any algorithm.

When something is broken and a human decision is required, you name it plainly and say what the decision is. When a fix is within the autonomy framework, you say so and name the tier. When the Proprietor needs to act, you tell him exactly what to do and why.

**Autonomy framework:**
- Tier 1 (pre-approved): executes autonomously, reported in the brief
- Tier 2 (monitored): recommend → wait one cycle → execute if no veto
- Tier 3 (novel): full stop — name it, Big D decides

Change Agent recommends tier. Big D decides. Change Agent never promotes to Tier 1 unilaterally.

---

## The Team

- **social-listening.js** — 11:00PM. Social intelligence that informs tonight's content brief.
- **media-director.js** — 11:30PM. Picks tomorrow's themes, calls creative-agent × 2.
- **creative-agent.js** — Called by media-director. Generates per-slot content briefs. Saves to posts/briefs/.
- **gemini-bridge.js** — Called by media-director after briefs. Uploads prompt files to Drive/Ready to Post/.
- **image-gen.js** — Midnight. Generates images from slot prompt files.
- **video-gen.js** — 1:00AM. Generates video from slot flow-prompt files.
- **watch-drive.js** — Every 15 minutes. Posts when .md + media are present at post_time. The distribution engine.
- **distribute.js** — Called by watch-drive. Posts to all active platforms. Records every attempt in post-state.json.
- **brand-manager.js** — Weekly. Holds the content to the standard.
- **marketing-manager.js** — Weekly. The scoreboard: Lounge and Drop subscriber counts, growth rate, trajectory.
- **product-research.js** — Weekly. Sources affiliate products for the shelf.
- **product-development.js** — Sundays 10PM. Building the Foot Balm brief, milestone by milestone.
- **eng-bot.js** — After every watch-drive poll. Your early warning system.
- **change-agent.js** — 8:30AM daily + post-commit hook. Tracks commits, owns the known-fix library, writes change-state.json.
- **update-handoff.js** — 11:00PM. Rewrites the operational handoff so the next agent starts with current reality.
- **cost-report.js** — Daily. API spend vs. ceiling.

---

## Output Format

---

# BSV Daily Brief — ${dayName}, ${today}

## The Recommendation
One sentence. The single thing Big D needs to decide or do today. State it as a recommendation, not a question. If it's a decision, say which way you'd go and why. If it's an action, name who does it and when. This section leads everything else.

## The Seven Questions
One sentence each. A verdict, not a report. No hedging.
1. Is the brand growing?
2. Did yesterday's content belong in the lounge?
3. Are we reaching The Drop?
4. Is any agent costing more than it's producing?
5. Is there a job nobody on the team is doing?
6. Are we closing on the launch condition — 10K engaged + affiliate revenue flowing?
7. What's the one thing standing in the way right now?

## Pipeline
One line per agent that ran overnight. ✓ ran clean | ⚠ ran with issues | ✗ failed | — not scheduled. Pull from logs, not assumptions.

## What Posted
What went out in the last 24 hours. Which platforms. Any failures.
⚠️ UNVERIFIED RULE: If a slot appears in the Unverified Slots data — archived in watch-drive.log but absent from post-state.json — report it as "⚠️ UNVERIFIED — no confirmed post ID." Do not count it as a successful post.

## Queue
What's in Ready to Post/. What briefs exist. What distributes tonight. Any gaps for tomorrow's schedule.

## Audience
Lounge and Drop subscriber counts and weekly change. Is growth accelerating or stalling? What would move the number? Source from the latest marketing report. If unavailable, say so.

## Brand
One verdict on yesterday's content. Did it earn its place in the lounge? Source from the brand health report.

## Intelligence
Top 2–3 signals from the social report that should shape tonight's content. Specific enough to act on.

## The Lounge — What We're Building This Week
One piece of long-form content for bigsolevibes.com. Derived from what social-listening surfaced and what the creative pipeline produced this week. Look for the theme or tension that showed up in the social report, in the slot briefs, in what the audience engaged with — then find what the social post couldn't say.

- **Title:** A working title in the BSV voice. Statement, not question. The kind of headline a man stops at.
- **The angle:** One sentence — what this piece argues or reveals. What does he understand about himself after reading it that he didn't before?
- **Why now:** One sentence — what in the social data or content pipeline makes this the right piece this week, not next week.
- **Brief for creative-agent:** One sentence — the prompt in miniature. Enough to build from.

Status: **Awaiting Big D approval.** When approved, creative-agent builds it.

If social data is insufficient to generate a specific idea this morning: "Insufficient signal — revisit after tonight's social-listening run."

## Product Shelf
Pending in queue, approved, watchlist items. One sentence.

## Product Development
Current milestone, status, whether Big D action is needed.
- Track: Week 1 Foundation → Week 2 Manufacturer research → Week 3 Packaging + FDA → Week 4 Cost model → Week 5+ Ready for calls
- If action_needed = true: surface the specific ask in plain language
- ESCALATION: If milestone contains "Ready for calls" or "Ready for Big D" — this section leads the entire brief, before The Recommendation, before everything else. That is a Proprietor decision point. Make it impossible to miss.
- If product-development-state.json is missing: "product-development.js has not run yet."

## Change Agent
Open issues, flagged items, Tier 1 candidates awaiting Big D approval.
- ESCALATION: Flagged issues get named explicitly, not buried.
- Tier 1 = pre-approved | Tier 2 = monitored | Tier 3 = novel (full stop)
- Change Agent recommends tier. Big D decides.
- If change-state.json is missing: "change-agent.js has not run yet."

## Blockers
Broken things that need a human. Expired credentials. Empty queues at critical moments. Be direct — name the thing and say what the decision is. If nothing needs Proprietor attention: "Clear."

## Org Chart
New scripts not in BSV-Org-Chart.svg → flag for approval. Inactive agents (no log activity 7d) → flag.

If gaps exist:
\`\`\`
ORG CHANGES DETECTED
  New script: [name]
  Inactive: [name]
  → Awaiting Big D approval: node scripts/chief-of-staff.js --update-org-chart
\`\`\`

If an org chart update was just executed (orgUpdateResult.updated = true):
\`\`\`
ORG CHART UPDATED
  [changes applied]
  Uploaded: Big Sole Vibes/BSV-Org-Chart.svg
\`\`\`

If no gaps: "Org chart current."
Chief never updates autonomously. Flags → waits → executes on --update-org-chart.

## Tonight
What runs when. Which slots generate tomorrow. Anything to watch for in the morning.

## Budget
*Today's API spend:* $X.XX / $${DAILY_API_CEILING.toFixed(2)} ceiling (XX%)

Per-agent breakdown (heaviest first, zero-call agents omitted):
- agent: N call(s), ~N,NNN output tokens, ~$X.XXXX

Wasted spend: if any agent made calls but produced no output, name it: "⚠️ [agent] N call(s), no output."
If tracking over $1.50: name the specific non-essential agents to pause tomorrow. Essential daily: eng-bot, chief-of-staff, watch-drive. Brand-manager and marketing-manager run weekly — never essential daily.

---

<!-- TELEGRAM -->
[Write a Telegram message for the Proprietor's phone. 8–12 lines max. *Bold* section labels. Lead with The Recommendation. Cover: seven questions verdict, pipeline, what posted, queue, blockers. End with standup filename. Plain Markdown only — no HTML, no code blocks.

EXHAUSTED SLOT RULE: Scan watch-drive.log for lines beginning "EXHAUSTED:". For each one where the platform is NOT tiktok/youtube/twitter/facebook (known-DOA — skip silently): "⚠️ {slot} failed on {platform} after 3 attempts — see eng report." One line per failure. Omit section if none.

TOKEN BUDGET RULE: Always include *💰 Budget* — one line, no exceptions:
- If reportedTotal > $${DAILY_API_CEILING.toFixed(2)}: "*💰 Budget:* ⚠️ Ceiling breached — $X.XX. Throttle non-essentials tomorrow."
- If reportedTotal > $1.50: "*💰 Budget:* ⚡ $X.XX of $${DAILY_API_CEILING.toFixed(2)} (XX%) — watch today."
- Otherwise: "*💰 Budget:* ✓ $X.XX — runway clear."
Use official total if available, otherwise log estimate.

PRO LIMIT RULE: Add *📅 Pro* ONLY when: isMonday = true → "*📅 Pro:* Week reset — full capacity." OR isMidWeekLate = true AND total API calls > 15 → "*📅 Pro:* Heavy day — pace Claude.ai sessions." Otherwise omit.]`

  // Format token budget for userPrompt injection
  const fmtCost = (n) => `$${n.toFixed(4)}`
  const tokenBudgetSection = [
    `## Token Budget`,
    ``,
    `Daily ceiling: $${DAILY_API_CEILING.toFixed(2)}`,
    `Today's spend: ${tokenBudget.officialTotal != null
      ? `${fmtCost(tokenBudget.officialTotal)} (official — from cost-report.log)`
      : `${fmtCost(tokenBudget.totalEstCost)} (log estimate — cost-report not yet run today)`}`,
    `% of ceiling: ${tokenBudget.pctOfCeiling.toFixed(1)}%`,
    `isMonday: ${isMonday}`,
    `isMidWeekLate: ${isMidWeekLate}`,
    ``,
    tokenBudget.agentBreakdown.length
      ? `Agent breakdown (Claude calls detected today, heaviest first):\n${tokenBudget.agentBreakdown.map(a =>
          `- ${a.name}: ${a.calls} call(s), ~${a.outputTokens.toLocaleString()} output tokens, est. ${fmtCost(a.cost)}`
        ).join('\n')}`
      : `No Claude API calls detected in agent logs today.`,
  ].join('\n')

  const userPrompt = `Today is ${dayName} ${today}. Produce the BSV daily stand-up.

## Pipeline Logs (last 24h)

### watch-drive.log (last 150 lines)
\`\`\`
${watchLog || '(no log)'}
\`\`\`

### social-listening.log
\`\`\`
${socialLog || '(no log)'}
\`\`\`

### media-director.log
\`\`\`
${mediaLog || '(no log)'}
\`\`\`

### creative-agent.log
\`\`\`
${creativeLog || '(no log)'}
\`\`\`

### gemini-bridge.log
\`\`\`
${bridgeLog || '(no log)'}
\`\`\`

### image-gen.log
\`\`\`
${imageLog || '(no log)'}
\`\`\`

### video-gen.log
\`\`\`
${videoLog || '(no log)'}
\`\`\`

### eng-bot.log
\`\`\`
${engBotLog || '(no log)'}
\`\`\`

### product-development.log
\`\`\`
${productDevLog || '(no log)'}
\`\`\`

### change-agent.log
\`\`\`
${changeAgentLog || '(no log)'}
\`\`\`

## Post State (post-state.json)
\`\`\`json
${postState || '(no post-state.json)'}
\`\`\`

## Unverified Slots
Slots archived in watch-drive.log with no confirmed success entry in post-state.json:
${unverifiedSlots.length
  ? unverifiedSlots.map(s => `- ${s}: ⚠️ UNVERIFIED — watch-drive archived this slot but no post ID was recorded`).join('\n')
  : '(none — all archived slots have confirmed post-state.json entries)'}

## Local Files
Output files in posts/output/: ${outputFiles.join(', ') || '(none)'}
Brief files in posts/briefs/: ${briefFiles.join(', ') || '(none)'}

## Drive State
Ready to Post/: ${readyToPost}
Posted last 24h: ${postedLast24h}

## Latest Reports

### Social Intelligence (${socialReport?.filename || 'none'})
${socialReport ? socialReport.content.slice(0, 2000) + (socialReport.content.length > 2000 ? '\n[truncated]' : '') : '(not available)'}

### Brand Health (${brandReport?.filename || 'none'})
${brandReport ? brandReport.content.slice(0, 1500) + (brandReport.content.length > 1500 ? '\n[truncated]' : '') : '(not available)'}

### Marketing (${marketingReport?.filename || 'none'})
${marketingReport ? marketingReport.content.slice(0, 1200) + (marketingReport.content.length > 1200 ? '\n[truncated]' : '') : '(not available)'}

### Product Research (${productResearch?.filename || 'none'})
${productResearch ? productResearch.content.slice(0, 800) + (productResearch.content.length > 800 ? '\n[truncated]' : '') : '(not available)'}

### Product Development State (product-development-state.json)
\`\`\`json
${productDevState ? JSON.stringify(productDevState, null, 2) : '(not available — product-development.js has not run yet)'}
\`\`\`

### Product Development Brief (${productBrief?.filename || 'none'})
${productBrief ? productBrief.content.slice(0, 1500) + (productBrief.content.length > 1500 ? '\n[truncated]' : '') : '(not available)'}

### Change Agent State (change-state.json)
\`\`\`json
${changeState ? JSON.stringify(changeState, null, 2) : '(not available — change-agent.js has not run yet)'}
\`\`\`

## Org Chart Gap Detection
Org chart loaded: ${orgChartSvg ? `yes (${knownAgents.length} agents known)` : 'NO — BSV-Org-Chart.svg missing from Drive'}
Known agents in chart: ${knownAgents.join(', ') || '(none parsed)'}
Scripts in scripts/ directory: ${scriptFiles.join(', ')}
New scripts not in chart: ${newScripts.join(', ') || 'none'}
Inactive agents (no log activity 7d): ${inactiveAgents.join(', ') || 'none'}
Gaps detected: ${orgHasGaps ? 'YES' : 'no'}
Update mode (--update-org-chart): ${updateOrgChart ? 'YES' : 'no'}
Org update result: ${orgUpdateResult ? JSON.stringify(orgUpdateResult) : 'n/a'}

## Current Handoff Doc (BSV-Handoff-v5.md)
${handoff ? handoff.slice(0, 2000) + (handoff.length > 2000 ? '\n[truncated]' : '') : '(not available)'}

${tokenBudgetSection}

### Latest Cost Report (${costReport?.filename || 'none'})
${costReport ? costReport.content.slice(0, 1200) + (costReport.content.length > 1200 ? '\n[truncated]' : '') : '(not available — cost-report.js has not run today)'}`

  let fullText   = ''
  let streamError = null

  try {
    const stream = await client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 8192,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })

    process.stdout.write('Generating stand-up')
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text
        process.stdout.write('.')
      }
    }
    process.stdout.write('\n')

    const finalMsg = await stream.finalMessage()
    log(`Stand-up done — ${finalMsg.usage?.output_tokens ?? '?'} tokens, stop: ${finalMsg.stop_reason}`)
  } catch (err) {
    process.stdout.write('\n')
    streamError = err
    const detail = err.error?.error?.message || err.message
    log(`ERROR: stand-up API call failed — ${err.status ? `HTTP ${err.status} ` : ''}${detail}`)
  }

  // ── Error recovery ────────────────────────────────────────────────────────────

  if (streamError || !fullText.trim()) {
    const isCredit = streamError?.error?.error?.message?.includes('credit') ||
                     streamError?.message?.includes('credit') ||
                     streamError?.status === 400
    const reason = streamError
      ? (isCredit
          ? 'API credit balance exhausted — top up at console.anthropic.com → Plans & Billing'
          : `API call failed: ${streamError.error?.error?.message || streamError.message}`)
      : 'API returned empty response'

    if (fullText.trim()) {
      // Partial output — prepend warning and fall through to write what we have
      log(`WARNING: partial stand-up (${fullText.length} chars) — writing with warning header`)
      fullText = `> ⚠️ **PARTIAL STAND-UP** — API stream cut off mid-response. Content below is incomplete.\n> **Reason:** ${reason}\n\n` + fullText
    } else {
      // Nothing — write emergency brief, optionally ping Telegram, return cleanly
      log('Writing emergency brief...')
      const emergencyBrief = [
        `# BSV Chief of Staff — Emergency Brief`,
        `**${dayName} ${today} — Chief ran but stand-up failed**`,
        ``,
        `⚠️ **Reason:** ${reason}`,
        ``,
        `## Pipeline State at Time of Failure`,
        `- Ready to Post: ${readyToPost}`,
        `- Posted last 24h: ${postedLast24h}`,
        `- Output files: ${outputFiles.join(', ') || 'none'}`,
        `- Brief files: ${briefFiles.join(', ') || 'none'}`,
        `- Product dev: ${productDevState?.milestone || 'unknown'} (action_needed: ${productDevState?.action_needed ?? 'unknown'})`,
        `- Change state: ${changeState ? `${changeState.open_issues} open issues` : 'unknown'}`,
        `- API spend est: $${tokenBudget.totalEstCost.toFixed(4)} today`,
        ``,
        `## Action Required`,
        isCredit
          ? `Top up API credits at console.anthropic.com → Plans & Billing.`
          : `Check logs/chief-of-staff-error.log for the full stack trace.`,
        `Re-run manually: \`node scripts/chief-of-staff.js\``,
      ].join('\n')

      const localEmergency = path.join(TEMP_DIR, outFile)
      fs.writeFileSync(localEmergency, emergencyBrief)
      try {
        rcloneCopyTo(localEmergency, `${REMOTE}/Reports/${outFile}`)
        log(`Emergency brief uploaded → ${REMOTE}/Reports/${outFile}`)
      } catch (uploadErr) {
        log(`ERROR: emergency brief upload failed: ${uploadErr.message}`)
      }

      const tToken  = process.env.TELEGRAM_BOT_TOKEN
      const tChatId = process.env.TELEGRAM_CHAT_ID
      if (tToken && tChatId) {
        try {
          await sendTelegram(tToken, tChatId,
            `⚠️ *BSV Chief of Staff — ${today}*\n\nStand-up failed.\n*Reason:* ${reason}\n\nEmergency brief uploaded to Drive.\nRe-run: \`node scripts/chief-of-staff.js\``)
          log('Telegram emergency ping sent ✓')
        } catch (tgErr) {
          log(`ERROR: Telegram emergency ping failed: ${tgErr.message}`)
        }
      }

      log('━━━ chief-of-staff complete (emergency mode) ━━━\n')
      return
    }
  }

  // Split stand-up body from Telegram ping
  const telegramDelimiter = '<!-- TELEGRAM -->'
  const delimIdx  = fullText.indexOf(telegramDelimiter)
  const standupMd = delimIdx >= 0 ? fullText.slice(0, delimIdx).trim() : fullText.trim()
  const telegramMsg = delimIdx >= 0 ? fullText.slice(delimIdx + telegramDelimiter.length).trim() : null

  // ── Save stand-up locally and upload to Drive ─────────────────────────────────

  const localStandup = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localStandup, standupMd)
  log(`Stand-up saved locally: ${localStandup}`)

  try {
    rcloneCopyTo(localStandup, `${REMOTE}/Reports/${outFile}`)
    log(`Stand-up uploaded → ${REMOTE}/Reports/${outFile}`)
  } catch (err) {
    log(`ERROR: stand-up upload failed: ${err.message}`)
  }

  // ── Handoff update ────────────────────────────────────────────────────────────

  log('Generating updated handoff doc...')
  const handoffPrompt = `You have just produced today's BSV daily stand-up (below). Now write the updated BSV-Handoff-v5.md.

The handoff is the living state document that every agent reads before executing. It must reflect current reality — not last week's state, not aspirations. What is true right now.

## Today's Stand-Up
${standupMd}

## Previous Handoff (for structure reference)
${handoff ? handoff.slice(0, 3000) + (handoff.length > 3000 ? '\n[truncated]' : '') : '(none — write fresh)'}

---

Write the complete BSV-Handoff-v5.md. Cover:

1. **What BSV Is** — one paragraph, the mission and the feeling (from directive, never changes)
2. **Current Pipeline State** — what's working, what's broken, what needs attention
3. **Content Queue** — what's in Ready to Post, what's been posted recently, what slots are next
4. **Platform Status** — per-platform health (Instagram, Bluesky, X, YouTube, TikTok, Facebook)
5. **Audience** — Lounge and Drop subscriber counts and recent trajectory
6. **Product Shelf** — shelf status, pending approvals, research pipeline
7. **Known Issues** — anything currently broken or degraded, with specific detail
8. **Tonight's Schedule** — what runs when
9. **Agent Team** — brief status on each agent (last run, any issues)

Write in Proprietor tone — direct, specific, no padding. This is an operational document, not a marketing document. Future agents reading this need to know exactly where things stand.`

  let handoffText = ''
  try {
    const handoffMsg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     [directive, memory].filter(Boolean).join('\n\n---\n\n') + '\n\n---\n\nYou are the BSV Chief of Staff updating the operational handoff document.',
      messages:   [{ role: 'user', content: handoffPrompt }],
    })
    handoffText = handoffMsg.content[0]?.text?.trim() || ''
    log(`Handoff done — ${handoffMsg.usage?.output_tokens ?? '?'} tokens`)
  } catch (err) {
    log(`ERROR: handoff generation failed: ${err.message}`)
  }

  if (handoffText) {
    const localHandoff = path.join(TEMP_DIR, 'BSV-Handoff-v5.md')
    fs.writeFileSync(localHandoff, handoffText)
    try {
      rcloneCopyTo(localHandoff, `${REMOTE}/Handoff/BSV-Handoff-v5.md`)
      log(`Handoff uploaded → ${REMOTE}/Handoff/BSV-Handoff-v5.md`)
    } catch (err) {
      log(`ERROR: handoff upload failed: ${err.message}`)
    }
  }

  // ── Memory update ─────────────────────────────────────────────────────────────
  // Reads current BSV-Memory.md, incorporates decisions/signals/outcomes from
  // today's stand-up, and writes the updated file back to Drive.

  log('Updating BSV-Memory.md...')
  const memoryUpdatePrompt = `You are the BSV Chief of Staff. Your job right now is to update BSV-Memory.md — the shared strategic memory file read by every agent at startup.

## Current BSV-Memory.md
${memory || '(not found — write fresh using the stand-up below)'}

## Today's Stand-Up
${standupMd}

---

Update BSV-Memory.md to reflect anything new from the past 24 hours. Preserve the exact section structure. Only change what has actually changed:

- **What's Been Decided** — add any new decisions Big D made or confirmed. Include the why.
- **What's Working** — update with any newly confirmed working systems. Remove things that have stopped working.
- **What's Been Tried and Failed** — add any newly discovered failures. Keep old entries.
- **Open Questions** — remove questions that were answered. Add new ones that surfaced today.
- **Where We're Going** — update launch condition progress if there's new signal.
- **Who We Are / Agent Rules** — change these only if something fundamentally shifted. These are stable.

Do not add padding. Do not repeat information already in the file. Only add what's genuinely new and worth carrying forward. If nothing changed in a section, keep it exactly as-is.

Return the complete updated BSV-Memory.md. Start with the # BSV-Memory.md header.`

  try {
    const memoryMsg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     'You are the BSV Chief of Staff maintaining the strategic memory file. Return only the complete updated BSV-Memory.md — no explanation, no commentary.',
      messages:   [{ role: 'user', content: memoryUpdatePrompt }],
    })
    const updatedMemory = memoryMsg.content[0]?.text?.trim() || ''
    log(`Memory update done — ${memoryMsg.usage?.output_tokens ?? '?'} tokens`)

    if (updatedMemory.includes('# BSV-Memory.md')) {
      const localMemory = path.join(TEMP_DIR, 'BSV-Memory.md')
      fs.writeFileSync(localMemory, updatedMemory)
      rcloneCopyTo(localMemory, `${REMOTE}/BSV-Memory.md`)
      log(`Memory uploaded → ${REMOTE}/BSV-Memory.md`)
    } else {
      log('WARNING: memory update response did not contain expected header — skipping upload')
    }
  } catch (err) {
    log(`ERROR: memory update failed: ${err.message}`)
  }

  // ── Telegram ping ─────────────────────────────────────────────────────────────

  const telegramToken  = process.env.TELEGRAM_BOT_TOKEN
  const telegramChatId = process.env.TELEGRAM_CHAT_ID

  if (!telegramToken || !telegramChatId) {
    log('WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping Telegram ping')
    log('To enable: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env')
    log('  TELEGRAM_BOT_TOKEN — from @BotFather in Telegram')
    log('  TELEGRAM_CHAT_ID   — send /start to @userinfobot to get your chat ID')
  } else if (telegramMsg) {
    try {
      await sendTelegram(telegramToken, telegramChatId, telegramMsg)
      log('Telegram ping sent ✓')
    } catch (err) {
      log(`ERROR: Telegram ping failed: ${err.message}`)
    }
  } else {
    log('WARNING: no Telegram section found in stand-up output — ping skipped')
  }

  log('━━━ chief-of-staff complete ━━━\n')
})()
