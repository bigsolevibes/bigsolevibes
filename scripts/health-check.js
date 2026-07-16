// health-check.js — refreshes logs/org-chart-state.json (and public/org-chart.html)
// every few minutes so the dashboard's Blockers panel reflects real agent
// status, not an ~8h-old snapshot.
//
// Added 2026-07-16 per Big D: "we need to make the dashboard live...i cant be
// looking at 8 hour old data..whats the point,,,its a dashboard, but a report
// thats old." Root cause: logs/org-chart-state.json (what the Next.js
// dashboard's StateAdapter.getAgents() reads, and what public/org-chart.html
// is rendered from) only got rewritten once a day, as a side effect of
// chief-of-staff.js's single once-per-morning run. Everything in between was
// invisible until the next morning.
//
// This is deliberately the smallest possible slice: local log-file scanning
// only, zero API calls, same checkAgentHealth()/AGENT_ROSTER logic as
// chief-of-staff.js (shared via ./lib/agent-health.js so the two can't drift
// apart) — safe and cheap enough to run every few minutes via its own
// launchd job (see config/com.bsv.health-check.plist, installed via the
// install_health_check_schedule MCP tool). chief-of-staff.js's own once-daily
// write of the same file is left in place — harmless redundancy that keeps
// the morning report self-contained.
//
// Usage: node scripts/health-check.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true })
const fs   = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { checkAgentHealth, buildOrgState } = require('./lib/agent-health')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'health-check.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  fs.appendFileSync(LOG_FILE, line + '\n')
}

function run() {
  const result   = checkAgentHealth(log)
  const orgState = buildOrgState(result)

  fs.writeFileSync(path.join(ROOT, 'logs', 'org-chart-state.json'), JSON.stringify(orgState, null, 2))
  log(`org-chart-state.json refreshed — ${result.ok.length} ok, ${result.issues.length} issue(s), ${result.paused.length} paused`)

  // Rebuild the static org-chart.html too, so both surfaces stay in sync.
  const r = spawnSync(process.execPath, [path.join(__dirname, 'org-chart-agent.js')], {
    cwd: ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 30000,
  })
  if (r.status !== 0) log(`WARNING: org-chart-agent.js exited ${r.status} — ${(r.stderr || '').slice(0, 300)}`)
}

run()
