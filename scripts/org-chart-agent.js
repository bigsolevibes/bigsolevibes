// org-chart-agent.js — rebuilds public/org-chart.html from org-chart-state.json
// Owned by and spawned by chief-of-staff.js after every health check.
// Never run independently — chief calls this.

require('dotenv').config({ quiet: true })
const fs   = require('fs')
const path = require('path')

const ROOT            = path.join(__dirname, '..')
const STATE_PATH      = path.join(ROOT, 'logs', 'org-chart-state.json')
const COST_STATE_PATH = path.join(ROOT, 'logs', 'cost-state.json')
const OUT_PATH        = path.join(ROOT, 'public', 'org-chart.html')
const LOG_FILE        = path.join(ROOT, 'logs', 'org-chart-agent.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

const AMBER = '#C17D2E'
const NAVY  = '#0D1B2A'
const CREAM = '#F5ECD7'
const MUTED = '#4A6380'

const STATUS_COLOR = {
  ok:      '#22C55E',
  warning: '#F59E0B',
  error:   '#EF4444',
  unknown: '#6B7280',
}

const STATUS_LABEL = {
  ok:      'OK',
  warning: 'WARN',
  error:   'ERROR',
  unknown: 'UNKNOWN',
}

// Agent hierarchy — defines visual grouping in the chart
const HIERARCHY = [
  {
    tier: 'COMMAND',
    agents: ['chief-of-staff', 'strategist'],
  },
  {
    tier: 'CORE PIPELINE',
    agents: ['watch-drive', 'media-director', 'creative-agent', 'distribute', 'eng-bot', 'change-agent'],
  },
  {
    tier: 'CONTENT & PUBLISHING',
    agents: ['blog-agent', 'update-handoff', 'sync-shop', 'promote-sole-report', 'reddit-agent', 'sole-report-agent'],
  },
  {
    tier: 'INTELLIGENCE',
    agents: ['social-listening', 'marketing-manager', 'brand-manager', 'product-research', 'product-development', 'accounting-agent'],
  },
  {
    tier: 'INFRASTRUCTURE',
    agents: ['drive-sync', 'gemini-bridge', 'image-gen', 'video-gen', 'cost-report'],
  },
]

function buildAgentCard(name, data) {
  const status = data?.status || 'unknown'
  const color  = STATUS_COLOR[status]
  const label  = STATUS_LABEL[status]
  const msg    = data?.msg ? `<div class="agent-msg">${data.msg}</div>` : ''
  const badge  = data?.essential ? '<span class="badge essential">ESSENTIAL</span>' : data?.weekly ? '<span class="badge weekly">WEEKLY</span>' : ''

  return `
    <div class="agent-card status-${status}">
      <div class="agent-header">
        <div class="status-dot" style="background:${color}"></div>
        <span class="agent-name">${name}</span>
        <span class="status-label" style="color:${color}">${label}</span>
      </div>
      ${badge}
      ${msg}
    </div>`
}

function buildCostPanel(cost) {
  if (!cost) return ''

  const balance    = cost.balance
  const burn       = cost.avg_daily_burn
  const runway     = cost.runway_hours
  const todayCost  = cost.today_cost
  const costDate   = cost.date || ''

  // Balance color
  const balColor = balance === null ? '#6B7280'
    : balance < 5   ? '#EF4444'
    : balance < 15  ? '#F59E0B'
    : '#22C55E'

  const balStr = balance !== null ? `$${balance.toFixed(2)}` : '—'

  const burnStr = (burn > 0) ? `$${burn.toFixed(4)}/day` : '$0.0000/day'

  let runwayStr = '—'
  let runwayColor = '#6B7280'
  if (runway !== null) {
    const days = runway / 24
    runwayStr = days >= 2 ? `${days.toFixed(1)} days` : `${runway.toFixed(0)}h`
    runwayColor = runway < 24 ? '#EF4444' : runway < 48 ? '#F59E0B' : '#22C55E'
  }

  const todayStr = todayCost > 0 ? `$${todayCost.toFixed(4)}` : '$0.0000'

  const staleWarning = costDate && costDate < new Date().toISOString().slice(0, 10)
    ? `<div style="font-size:0.6rem;color:#F59E0B;margin-top:0.5rem;text-align:center;letter-spacing:0.05em;">⚠ cost data from ${costDate} — run cost-report.js to refresh</div>`
    : ''

  return `
  <div class="cost-panel">
    <div class="cost-label">API SPEND</div>
    <div class="cost-items">
      <div class="cost-item">
        <div class="cost-val" style="color:${balColor}">${balStr}</div>
        <div class="cost-lbl">BALANCE</div>
      </div>
      <div class="cost-item">
        <div class="cost-val">${burnStr}</div>
        <div class="cost-lbl">AVG BURN</div>
      </div>
      <div class="cost-item">
        <div class="cost-val" style="color:${runwayColor}">${runwayStr}</div>
        <div class="cost-lbl">RUNWAY</div>
      </div>
      <div class="cost-item">
        <div class="cost-val">${todayStr}</div>
        <div class="cost-lbl">TODAY</div>
      </div>
    </div>
    ${staleWarning}
  </div>`
}

function buildHTML(state, costState) {
  const updatedAt = new Date(state.lastUpdated).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  })

  const totalAgents  = Object.keys(state.agents).length
  const okCount      = Object.values(state.agents).filter(a => a.status === 'ok').length
  const warnCount    = Object.values(state.agents).filter(a => a.status === 'warning').length
  const errorCount   = Object.values(state.agents).filter(a => a.status === 'error').length

  const tiers = HIERARCHY.map(tier => {
    const cards = tier.agents.map(name => buildAgentCard(name, state.agents[name])).join('')
    return `
      <div class="tier">
        <div class="tier-label">${tier.tier}</div>
        <div class="tier-agents">${cards}</div>
      </div>`
  }).join('')

  // Any agents in state not in hierarchy — show as unlisted
  const listedAgents = new Set(HIERARCHY.flatMap(t => t.agents))
  const unlistedAgents = Object.keys(state.agents).filter(n => !listedAgents.has(n))
  const unlistedSection = unlistedAgents.length ? `
    <div class="tier">
      <div class="tier-label">UNLISTED</div>
      <div class="tier-agents">${unlistedAgents.map(n => buildAgentCard(n, state.agents[n])).join('')}</div>
    </div>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BSV Operations — Agent Org Chart</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: ${NAVY}; color: ${CREAM}; font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; }

    .nav { position: sticky; top: 0; z-index: 100; background: rgba(13,27,42,0.95); backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(193,125,46,0.2); padding: 0 2rem; display: flex; align-items: center;
      justify-content: space-between; height: 56px; }
    .nav-brand { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.15em; color: ${AMBER}; text-decoration: none; }
    .nav-links { display: flex; gap: 2rem; list-style: none; }
    .nav-links a { font-size: 0.75rem; letter-spacing: 0.08em; color: ${MUTED}; text-decoration: none; }
    .nav-links a:hover { color: ${CREAM}; }

    .page-header { padding: 3rem 2rem 1.5rem; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .page-header h1 { font-size: 0.7rem; letter-spacing: 0.2em; color: ${AMBER}; text-transform: uppercase; margin-bottom: 0.5rem; }
    .page-header p { font-size: 0.75rem; color: ${MUTED}; letter-spacing: 0.05em; }

    .summary { display: flex; justify-content: center; gap: 2rem; padding: 1.5rem 2rem;
      border-bottom: 1px solid rgba(255,255,255,0.05); }
    .summary-item { text-align: center; }
    .summary-num { font-size: 1.5rem; font-weight: 700; }
    .summary-lbl { font-size: 0.65rem; letter-spacing: 0.1em; color: ${MUTED}; margin-top: 0.2rem; }
    .ok-num { color: #22C55E; }
    .warn-num { color: #F59E0B; }
    .error-num { color: #EF4444; }

    .chart { padding: 2rem; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }

    .tier-label { font-size: 0.65rem; letter-spacing: 0.15em; color: ${AMBER}; margin-bottom: 0.75rem;
      padding-bottom: 0.4rem; border-bottom: 1px solid rgba(193,125,46,0.2); }
    .tier-agents { display: flex; flex-wrap: wrap; gap: 0.75rem; }

    .agent-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px; padding: 0.75rem 1rem; min-width: 180px; flex: 0 0 auto; }
    .agent-card.status-error { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.05); }
    .agent-card.status-warning { border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.05); }
    .agent-card.status-ok { border-color: rgba(34,197,94,0.2); }

    .agent-header { display: flex; align-items: center; gap: 0.5rem; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .agent-name { font-size: 0.75rem; font-weight: 600; flex: 1; }
    .status-label { font-size: 0.6rem; letter-spacing: 0.08em; font-weight: 700; }

    .badge { display: inline-block; font-size: 0.55rem; letter-spacing: 0.08em; padding: 0.15rem 0.4rem;
      border-radius: 3px; margin-top: 0.4rem; }
    .badge.essential { background: rgba(193,125,46,0.15); color: ${AMBER}; }
    .badge.weekly { background: rgba(99,102,241,0.15); color: #818CF8; }

    .agent-msg { font-size: 0.65rem; color: #F59E0B; margin-top: 0.4rem; line-height: 1.4; }

    .cost-panel { padding: 1rem 2rem; border-bottom: 1px solid rgba(255,255,255,0.05);
      display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
    .cost-label { font-size: 0.6rem; letter-spacing: 0.2em; color: ${AMBER}; }
    .cost-items { display: flex; gap: 3rem; }
    .cost-item { text-align: center; }
    .cost-val { font-size: 1.1rem; font-weight: 700; color: ${CREAM}; }
    .cost-lbl { font-size: 0.6rem; letter-spacing: 0.1em; color: ${MUTED}; margin-top: 0.2rem; }

    .page-footer { padding: 2rem; text-align: center; border-top: 1px solid rgba(255,255,255,0.05);
      font-size: 0.7rem; color: #374151; letter-spacing: 0.05em; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">BIG SOLE VIBES</a>
    <ul class="nav-links">
      <li><a href="/">Home</a></li>
      <li><a href="/sole-report/index.html">The Sole Report</a></li>
      <li><a href="/shop">The Locker Room</a></li>
    </ul>
  </nav>

  <div class="page-header">
    <h1>Operations — Agent Org Chart</h1>
    <p>Last updated by chief-of-staff — ${updatedAt} CDT</p>
  </div>

  <div class="summary">
    <div class="summary-item"><div class="summary-num">${totalAgents}</div><div class="summary-lbl">TOTAL AGENTS</div></div>
    <div class="summary-item"><div class="summary-num ok-num">${okCount}</div><div class="summary-lbl">OK</div></div>
    <div class="summary-item"><div class="summary-num warn-num">${warnCount}</div><div class="summary-lbl">WARNING</div></div>
    <div class="summary-item"><div class="summary-num error-num">${errorCount}</div><div class="summary-lbl">ERROR</div></div>
  </div>

  ${buildCostPanel(costState)}

  <div class="chart">
    ${tiers}
    ${unlistedSection}
  </div>

  <div class="page-footer">OWNED BY CHIEF-OF-STAFF · REGENERATED EVERY MORNING AT 9:30AM CDT</div>
</body>
</html>`
}

function run() {
  log('org-chart-agent starting')

  if (!fs.existsSync(STATE_PATH)) {
    log('ERROR: org-chart-state.json not found — chief must run first')
    process.exit(1)
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))

  let costState = null
  try {
    if (fs.existsSync(COST_STATE_PATH)) {
      costState = JSON.parse(fs.readFileSync(COST_STATE_PATH, 'utf8'))
      log(`Cost state loaded — balance: ${costState.balance !== null ? '$' + costState.balance : 'unknown'}, runway: ${costState.runway_hours !== null ? costState.runway_hours?.toFixed(1) + 'h' : 'unknown'}`)
    } else {
      log('cost-state.json not found — cost panel will be hidden')
    }
  } catch (err) {
    log(`WARN: cost-state.json parse error: ${err.message} — cost panel will be hidden`)
  }

  const html = buildHTML(state, costState)
  fs.writeFileSync(OUT_PATH, html)

  const agentCount = Object.keys(state.agents).length
  log(`org-chart.html rebuilt — ${agentCount} agents, updated ${state.lastUpdated}`)
}

run()
