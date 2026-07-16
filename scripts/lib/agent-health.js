// scripts/lib/agent-health.js — shared agent roster + health-check logic.
//
// Extracted 2026-07-16 from chief-of-staff.js so the same roster/logic has a
// single source of truth for two different callers with two different
// cadences:
//   1. chief-of-staff.js — the full once-daily morning run (revenue, posts,
//      standup, Claude API diagnosis, etc.)
//   2. health-check.js — a new lightweight, no-API-call runner (see that file)
//      that re-checks agent health every few minutes so the dashboard's
//      Blockers panel and public/org-chart.html stop showing an ~8h-stale
//      snapshot. Big D: "i cant be looking at 8 hour old data...whats the
//      point,,,its a dashboard, not a report."
//
// Both callers write the same logs/org-chart-state.json shape — chief still
// does its own write as part of the full report (harmless redundancy, keeps
// the morning report self-contained), health-check.js does the frequent one.
// Domain ownership: this file owns the roster + the "is agent X healthy"
// logic. Nothing else should hardcode a competing copy of either.

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')

const AGENT_ROSTER = [
  // ── Core pipeline — continuous, expected every 2h ─────────────────────────
  { name: 'watch-drive',       essential: true,  weekly: false, daily: false },
  { name: 'eng-bot',           essential: true,  weekly: false, daily: false },
  { name: 'change-agent',      essential: true,  weekly: false, daily: false },
  // ── Daily agents — run once per night via launchd, stale window = 25h ─────
  { name: 'media-director',    essential: true,  weekly: false, daily: true  },
  { name: 'creative-agent',    essential: true,  weekly: false, daily: true  },
  { name: 'distribute',        essential: true,  weekly: false, daily: true  },
  { name: 'update-handoff',    essential: true,  weekly: false, daily: true  },
  // ── Supporting — genuinely continuous (drive-sync runs on watch-drive's
  // ~15min poll cadence) — expected every 2h ───────────────────────────────
  { name: 'drive-sync',        essential: false, weekly: false },
  // Fixed 2026-07-16 (see BSV-BigC-Audit-Log.md): these three were misclassified
  // as "continuous, expected every 2h" alongside drive-sync, but none of them
  // actually run on a 2-hourly cadence — org-chart-agent is spawned exactly
  // once by chief-of-staff.js's own once-per-morning run; gemini-bridge is
  // spawned once by media-director.js's nightly run ('--day' arg); image-gen
  // is spawned once by gemini-bridge right after it finishes. All three
  // finish their one run for the day by mid-morning and then correctly have
  // nothing to do — but the 120min default staleness window flagged all
  // three as "stale" every single afternoon regardless. Reclassified as
  // daily (25h window) to match their real once-a-day cadence.
  { name: 'org-chart-agent',   essential: false, weekly: false, daily: true },
  { name: 'gemini-bridge',     essential: false, weekly: false, daily: true },
  { name: 'image-gen',         essential: false, weekly: false, daily: true },
  // paused 2026-07-13 per Big D: video is intentionally on hold, not resumed
  // yet — this stopped video-gen's staleness from being flagged as a warning
  // every day for something that isn't actually broken, just not started.
  // Remove `paused: true` (or delete this comment) once video work resumes.
  { name: 'video-gen',         essential: false, weekly: false, paused: true },
  // Fixed 2026-07-16: confirmed via config/com.bsv.cost-report.plist —
  // StartCalendarInterval Hour=23 Minute=0, i.e. once daily at 11pm, not
  // every 2h. Reclassified to daily (25h window).
  { name: 'cost-report',       essential: false, weekly: false, daily: true },
  // Fixed 2026-07-16: confirmed via config/com.bsv.accounting-agent.plist —
  // StartCalendarInterval Hour=9 Minute=0, once daily, same misclassification
  // as cost-report above. Reclassified to daily (25h window).
  { name: 'accounting-agent',  essential: false, weekly: false, daily: true },
  { name: 'reddit-agent',      essential: false, weekly: false },
  // ── Weekly agents — expected once per week ────────────────────────────────
  { name: 'strategist',        essential: false, weekly: true  },
  { name: 'brand-manager',     essential: false, weekly: true  },
  // paused 2026-07-15 per Big D: no email list to report on yet ("we dont have
  // any users") — Klaviyo creds are valid and the script works, it's just not
  // useful pre-audience. Revisit once Lounge/Drop signups exist to analyze.
  { name: 'marketing-manager', essential: false, weekly: true,  paused: true },
  { name: 'social-listening',  essential: false, weekly: true  },
  { name: 'product-research',  essential: false, weekly: true  },
  // paused 2026-07-15 per Big D: product dev intentionally on hold — last real
  // output was 2026-05-24 (logs/product-development-state.json), nothing since.
  { name: 'product-development',essential: false, weekly: true, paused: true },
  { name: 'blog-agent',        essential: false, weekly: true  },
  { name: 'sole-report-agent', essential: false, weekly: true  },
  // Added 2026-07-01 — both had rotating logs and were being called "Healthy" in the
  // standup with zero backing check (see BSV-BigC-Audit-Log.md same date). affiliate-scout
  // is a real committed script (scripts/affiliate-scout.js) — weekly audit cadence.
  // cj-research.js was written 2026-07-16 (see BSV-BigC-Audit-Log.md same date) —
  // until then the launchd job existed but the script never did, so every run
  // failed at "Cannot find module" before it could try anything CJ-related.
  { name: 'affiliate-scout',   essential: false, weekly: true  },
  { name: 'cj-research',       essential: false, weekly: true  },
  // Added 2026-07-16: real, committed, actively-running scripts that
  // findUntrackedAgents() was catching every day (see BSV-BigC-Audit-Log.md
  // same date) — genuine roster gaps, not sprawl. edition-agent.js runs
  // monthly (com.bsv.edition-agent launchd job); newsletter-agent.js backs
  // both com.bsv.newsletter-drop and com.bsv.newsletter-lounge; telegram-webhook
  // is the inbound approve/deny listener whose past outages (see BSV-BigC-
  // Audit-Log.md, "Telegram webhook down" incidents) went undetected precisely
  // because it had no roster entry / staleness check of its own.
  { name: 'edition-agent',     essential: false, weekly: true  },
  { name: 'newsletter-agent',  essential: false, weekly: true  },
  { name: 'telegram-webhook',  essential: true,  weekly: false, daily: false },
]

// Scripts with their own log file that are intentionally NOT tracked as recurring
// agents — one-off/manual/utility scripts, not part of the scheduled pipeline.
// findUntrackedAgents() below uses this to avoid false-flagging them as sprawl.
const KNOWN_NON_AGENT_LOGS = new Set([
  'run-now', 'seed-products', 'regen-4', 'generate-all-scenes', 'generate-locker-image',
  'promote-sole-report', 'log-rotate', 'dashboard', 'telegram-inbox', 'brand-image',
  'backup-scripts', 'learn', 'sync-shop', 'resize-post',
  'product-research-launchd', 'edition-agent-launchd', 'fetch-reddit',
  'chief-of-staff', 'health-check', // the monitors themselves — not sprawl
])

// `log` is an optional callback (msg: string) => void — callers can wire this
// to their own log file. Defaults to a no-op so this stays safe to call from
// anywhere without forcing a particular logging setup.
function checkAgentHealth(log = () => {}) {
  const now    = Date.now()
  const issues = []
  const ok     = []
  const paused = []

  for (const agent of AGENT_ROSTER) {
    // Paused agents (e.g. video-gen, on hold per Big D 2026-07-13) are
    // intentionally not running — skip the staleness/error check entirely so
    // a deliberate pause doesn't get reported as a broken agent every day.
    if (agent.paused) {
      paused.push({ name: agent.name, msg: 'Paused — not resumed yet' })
      continue
    }

    const logPath = path.join(ROOT, 'logs', `${agent.name}.log`)

    if (!fs.existsSync(logPath)) {
      issues.push({ name: agent.name, severity: agent.essential ? 'error' : 'warning', msg: 'never run — log missing', fix: `node scripts/${agent.name}.js` })
      continue
    }

    const ageMins  = (now - fs.statSync(logPath).mtimeMs) / 60000
    const staleMins = agent.weekly ? 7 * 24 * 60 : agent.daily ? 25 * 60 : 120
    const isStale  = ageMins > staleMins

    // Read last 60 lines for errors and output signal
    let lastLines = []
    let errors    = []
    try {
      const content = fs.readFileSync(logPath, 'utf8')
      lastLines = content.trim().split('\n').slice(-60)
      errors    = lastLines.filter(l => /^\[[^\]]+\]\s*(ERROR|CRASH|FATAL)/i.test(l))
    } catch {}

    if (isStale) {
      issues.push({ name: agent.name, severity: 'warning', msg: `stale — ${Math.round(ageMins / 60)}h since last activity`, fix: `node scripts/${agent.name}.js` })
    } else if (errors.length) {
      const msg = errors[errors.length - 1].replace(/^\[[^\]]+\]\s*/, '').slice(0, 140)
      issues.push({ name: agent.name, severity: 'error', msg, fix: `node scripts/${agent.name}.js` })
    } else {
      ok.push(agent.name)
    }
  }

  // change-agent heartbeat check (separate from log error — it can log clean but go silent)
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(ROOT, 'logs', 'change-state.json'), 'utf8'))
    const heartbeat  = cs.last_heartbeat ? new Date(cs.last_heartbeat) : null
    const hoursSince = heartbeat ? (now - heartbeat.getTime()) / 3600000 : Infinity
    if (hoursSince > 25 && !issues.find(i => i.name === 'change-agent')) {
      issues.push({ name: 'change-agent', severity: 'warning', msg: `heartbeat ${Math.round(hoursSince)}h ago — change monitoring stale`, fix: 'node scripts/change-agent.js' })
      ok.splice(ok.indexOf('change-agent'), 1)
    }
  } catch {}

  log(`Agent health: ${ok.length} OK, ${issues.length} issue(s)`)
  for (const i of issues) log(`  [${i.severity}] ${i.name}: ${i.msg}`)
  return { ok, issues, paused }
}

// Scans logs/ for log files not accounted for by AGENT_ROSTER or
// KNOWN_NON_AGENT_LOGS — surfaces real roster gaps without false-flagging
// -error.log siblings or one-off utility scripts as new agents.
function findUntrackedAgents() {
  const rosterNames = new Set(AGENT_ROSTER.map(a => a.name))
  const now = Date.now()
  const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  let files = []
  try { files = fs.readdirSync(path.join(ROOT, 'logs')) } catch { return [] }

  const untracked = []
  for (const f of files) {
    const m = f.match(/^([a-z0-9-]+?)(?:-error)?\.log$/i)
    if (!m) continue // skip .log.1/.log.2 rotations, non-log files
    const name = m[1]
    if (rosterNames.has(name) || KNOWN_NON_AGENT_LOGS.has(name)) continue
    let mtime
    try { mtime = fs.statSync(path.join(ROOT, 'logs', f)).mtimeMs } catch { continue }
    if (now - mtime <= ACTIVE_WINDOW_MS) {
      untracked.push({ name, lastActivityHoursAgo: Math.round((now - mtime) / 3600000) })
    }
  }
  return untracked
}

// Builds the exact logs/org-chart-state.json shape both chief-of-staff.js and
// health-check.js write — factored out so the two callers can't drift.
function buildOrgState(healthResult) {
  const orgState = { lastUpdated: new Date().toISOString(), agents: {} }
  for (const agent of AGENT_ROSTER) {
    if (agent.paused) {
      orgState.agents[agent.name] = {
        essential: agent.essential,
        weekly:    agent.weekly,
        status:    'paused',
        msg:       'Paused — not resumed yet',
        fix:       null,
      }
      continue
    }
    const issue = healthResult.issues.find(i => i.name === agent.name)
    const isOk  = healthResult.ok.includes(agent.name)
    orgState.agents[agent.name] = {
      essential: agent.essential,
      weekly:    agent.weekly,
      status:    issue ? (issue.severity === 'error' ? 'error' : 'warning') : isOk ? 'ok' : 'unknown',
      msg:       issue ? issue.msg : null,
      fix:       issue ? issue.fix : null,
    }
  }
  return orgState
}

module.exports = { AGENT_ROSTER, KNOWN_NON_AGENT_LOGS, checkAgentHealth, findUntrackedAgents, buildOrgState }
