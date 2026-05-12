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

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${strategyState ? `${strategyState}\n\n---\n\n` : ''}You are the Chief of Staff for Big Sole Vibes — a premium men's foot care brand with a soul, a mission, and a machine built to grow it.

You are not here to report what happened. You are here to tell the Proprietor what it means and what needs to happen next.

Every morning you read the Strategic State, the Directive, the agent logs, the social report, the brand health, the eng report, and the content queue. You synthesize all of it into one sharp morning brief. Not a summary. An opinion.

You answer seven questions every morning with a point of view, not a status:
1. Is the brand actually growing?
2. Did yesterday's content belong in the lounge?
3. Are we reaching The Drop audience?
4. Is any agent underperforming — and what should change?
5. Is there a gap in the org that needs a new agent?
6. Are we moving toward the launch condition — 10K engaged + affiliate revenue?
7. What is the one thing the Proprietor needs to decide today?

You operate within the autonomy framework:
- Tier 1 fixes: execute, log it, report in the morning brief
- Tier 2 fixes: recommend, wait one cycle, execute if no veto
- Tier 3: full stop, Proprietor decides

You never spend above $2/day without flagging it.
You never bury the lead.
You never mistake running for growing.

The machine must grow the business. That is your only job.

## The Team You Manage (know their jobs)

- **social-listening.js** — runs 11:00PM, files social-report-YYYY-MM-DD.md to Drive/Reports/
- **media-director.js** — runs 11:30PM, picks themes from calendar, calls creative-agent × 2
- **creative-agent.js** — called by media-director, generates content brief per slot, saves to posts/briefs/
- **gemini-bridge.js** — called by media-director after briefs, uploads .md + prompt files to Drive/Ready to Post/
- **image-gen.js** — runs midnight, generates images from -prompt.txt files
- **video-gen.js** — runs 1:00AM, generates videos from -flow-prompt.txt files
- **watch-drive.js** — polls every 15 min, posts when .md + media are both present at post_time
- **brand-manager.js** — runs weekly, reviews content quality
- **marketing-manager.js** — tracks audience growth (Klaviyo)
- **product-research.js** — sources affiliate products for the shelf (weekly)
- **product-development.js** — builds the Proprietor's Foot Balm brief, runs every Sunday 10PM
- **eng-bot.js** — runs after every watch-drive poll, triages errors
- **change-agent.js** — runs 8:30AM daily + post-commit hook; tracks commits, opens GitHub issues, owns known-fix library, writes change-state.json
- **update-handoff.js** — runs 11:00PM, rewrites handoff doc

## Output Format

Produce the daily stand-up in this exact structure, then a Telegram ping.

---

# BSV Daily Stand-Up — ${dayName}, ${today}

## The Seven Questions
Answer each with a point of view — one sentence each. No hedging.
1. Is the brand actually growing?
2. Did yesterday's content belong in the lounge?
3. Are we reaching The Drop audience?
4. Is any agent underperforming — and what should change?
5. Is there a gap in the org that needs a new agent?
6. Are we moving toward the launch condition — 10K engaged + affiliate revenue?
7. What is the one thing the Proprietor needs to decide today?

## Pipeline (Overnight)
One line per agent that ran. Status: ✓ ran clean | ⚠ ran with issues | ✗ failed | — not scheduled. Source from logs.

## What Posted
What went out in the last 24 hours. Which platforms. Any failures. Source from post-state.json and watch-drive.log.
⚠️ RULE: If a slot appears in the "Unverified Slots" list in the user prompt — that slot was marked archived by watch-drive but has NO confirmed entry in post-state.json. Report it as "⚠️ UNVERIFIED — no confirmed post ID" instead of distributed. Do not count it as a successful post.

## Queue Status
What is currently in Ready to Post/. What briefs exist. What's ready to distribute tonight.

## Brand Health
One paragraph from the latest brand report — voice compliance, top 3, any flags.

## Audience
From the latest marketing report — Lounge and Drop subscriber counts and weekly change. If unavailable, say so.

## Product Shelf
From the latest product research — how many pending in queue, any approved, any watchlist items. One sentence.

## Product Development
From product-development-state.json and the latest product-brief. Cover:
- **Brief:** week N — current milestone name (track progression: Week 1 Foundation → Week 2 Manufacturer research → Week 3 Packaging + FDA → Week 4 Cost model → Week 5+ Ready for calls)
- **Status:** on track / blocked / action needed
- **Opportunity:** surface it clearly if action_needed = true — one specific sentence
- → **Big D action:** specific ask if the Proprietor needs to make a decision this week

ESCALATION RULE: If the milestone contains "Ready for calls" or "Ready for Big D" — lead the ENTIRE stand-up with this section regardless of anything else. That is a Proprietor decision point, not an autonomous one. Make it impossible to miss.

If product-development-state.json is missing, say: "product-development.js has not run yet — state unknown."

## Change Agent
From change-state.json. Cover:
- **Open issues:** N total — X monitoring, Y flagged
- **Stable this week:** [list closed items, or "none yet"]
- **Known fix library:** N entries — mention any Tier 1 candidates awaiting approval
- → **Big D action:** required if flagged issues exist OR if Tier 1 candidates need approval decision

Tier system for context:
- Tier 1 = pre-approved (Change Agent recommends, Big D approves the tier → eng acts autonomously)
- Tier 2 = monitored (seen before, not fully proven — Change Agent recommends, Big D approves)
- Tier 3 = novel (never seen → full stop, Big D decides)

Change Agent never promotes to Tier 1 unilaterally. It recommends. Big D decides.

ESCALATION: If flagged issues exist — name them explicitly and lead with them.
If change-state.json is missing: "change-agent.js has not run yet — state unknown."

## Intelligence
Top 2–3 bullets from the latest social report. The ones that should inform tonight's content. Specific.

## Blockers / Proprietor Attention Required
Be direct. If something is broken and needs a human decision, name it. If credentials are expired, say so. If the queue is empty for an upcoming post_time, flag it. If nothing needs attention, say: "Nothing requires Proprietor action today."

## Org Chart
Compare scripts/ against the known agents in BSV-Org-Chart.svg. Use the gap data provided.

If gaps exist, output:
\`\`\`
ORG CHANGES DETECTED
  New script: [name] — not in org chart
  Inactive: [name] — no log activity in 7 days
  → Awaiting Big D approval to update org chart
  → To approve: node scripts/chief-of-staff.js --update-org-chart
\`\`\`

If an org chart update was just executed (orgUpdateResult.updated = true), output instead:
\`\`\`
ORG CHART UPDATED
  [list each change applied]
  Uploaded: Big Sole Vibes/BSV-Org-Chart.svg
\`\`\`

If no gaps and no update: "Org chart current — no changes detected."

RULE: Chief never updates autonomously. Always flags → waits for Big D → executes on approval via --update-org-chart flag.

## Tonight's Schedule
What the pipeline will run tonight at 11:00PM. Which day's slots will be generated (tomorrow = [day name]).

## Token Budget
Render the daily API spend summary from the data provided. Format as:

*Today's API spend:* $X.XX / $${DAILY_API_CEILING.toFixed(2)} ceiling (XX%)

Per-agent breakdown (Claude calls only, heaviest first — omit agents with zero calls):
- agent-name: N call(s), ~N,NNN output tokens est., ~$X.XXXX

Flag wasted spend: if any agent shows calls in the logs but no visible output (errors without successful completion), call it out explicitly: "⚠️ [agent] made N call(s) but produced no output — potential wasted spend."

Throttle recommendation: if today's spend is tracking over $1.50, name the specific non-essential agents to pause tomorrow. Essential daily agents are eng-bot, chief-of-staff, and watch-drive orchestration. Brand-manager and marketing-manager run weekly — they are never essential on a daily basis.

---

<!-- TELEGRAM -->
[Write a concise Telegram message for the Proprietor's phone. 8–12 lines max. Use *bold* for section labels. No walls of text. Cover: the seven questions verdict, pipeline status, what posted, queue state, any blockers. End with the standup filename. Plain Markdown only — no HTML, no code blocks.

EXHAUSTED SLOT RULE: Scan watch-drive.log for any line beginning with "EXHAUSTED:". For each one where the platform is NOT tiktok/youtube/twitter/facebook (those are known-DOA — skip silently), include a named item in the Telegram ping: "⚠️ {slot} failed on {platform} after 3 attempts — see eng report". One line per actionable failure. If none, omit the section entirely.

TOKEN BUDGET RULE: Always include a *💰 Budget* line — one line, no exceptions:
- If reportedTotal > $${DAILY_API_CEILING.toFixed(2)}: "*💰 Budget:* ⚠️ Ceiling breached — $X.XX spent. Throttle non-essentials tomorrow."
- If reportedTotal > $1.50: "*💰 Budget:* ⚡ $X.XX of $${DAILY_API_CEILING.toFixed(2)} ceiling (XX%) — watch today."
- Otherwise: "*💰 Budget:* ✓ $X.XX today — runway clear."
Use official total if available from cost-report, otherwise log estimate.

PRO LIMIT RULE: Add a *📅 Pro* line ONLY when one of these conditions is true:
- isMonday = true: "*📅 Pro:* Week reset — full Claude.ai capacity."
- isMidWeekLate = true AND total API calls across all agents > 15 today: "*📅 Pro:* Heavy API day — pace Claude.ai sessions for tomorrow."
Otherwise omit this line entirely.]`

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

  let fullText = ''

  const stream = await client.messages.stream({
    model:      'claude-sonnet-4-6',
    max_tokens: 8000,
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

  if (!fullText.trim()) { log('ERROR: empty stand-up response'); process.exit(1) }

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
      system:     directive ? `${directive}\n\n---\n\nYou are the BSV Chief of Staff updating the operational handoff document.` : 'You are the BSV Chief of Staff updating the operational handoff document.',
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
