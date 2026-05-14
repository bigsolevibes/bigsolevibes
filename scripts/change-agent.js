require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// change-agent.js — BSV change tracker, known-fix library, GitHub Issues owner
//
// Runs daily at 8:30AM via launchd (summary + monitoring update).
// Optionally runs after every git commit via post-commit hook:
//
//   Setup (run once in terminal):
//   printf '#!/bin/sh\nnode /Users/davidgeer/claude/bigsolevibes-web/scripts/change-agent.js --post-commit\n' \
//     > /Users/davidgeer/claude/bigsolevibes-web/.git/hooks/post-commit
//   chmod +x /Users/davidgeer/claude/bigsolevibes-web/.git/hooks/post-commit
//
// GitHub Issues: uses gh CLI (already authenticated at bigsolevibes/bigsolevibes)
// ─────────────────────────────────────────────────────────────────────────────

const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT       = path.join(__dirname, '..')
const LOG_FILE   = path.join(ROOT, 'logs', 'change-agent.log')
const STATE_FILE = path.join(ROOT, 'logs', 'change-state.json')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-change-agent')
const REMOTE     = 'big sole vibes:Big Sole Vibes'
const GH_REPO    = 'bigsolevibes/bigsolevibes'

const LABELS = ['approved', 'monitoring', 'stable', 'flagged', 'rolled-back']

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── State ────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {}
  return {
    last_run:         null,
    last_commit_hash: null,
    open_issues:      0,
    monitoring:       [],
    flagged:          [],
    stable_this_week: [],
    known_fixes:      0,
    tier1_candidates: [],
    action_needed:    false,
    tracked_issues:   {},
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDriveFile(remotePath) {
  try {
    execSync(`rclone copy "${remotePath}" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const local = path.join(TEMP_DIR, path.basename(remotePath))
    return fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null
  } catch { return null }
}

function rcloneUpload(localPath, remotePath) {
  execSync(`rclone copyto "${localPath}" "${remotePath}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function getNewCommits(sinceHash) {
  try {
    const range = sinceHash ? `${sinceHash}..HEAD` : '--since="7 days ago"'
    const out = execSync(
      `git log ${range} --format="%H|%s|%ai|%an" --no-merges`,
      { cwd: ROOT, encoding: 'utf8' },
    ).trim()
    if (!out) return []
    return out.split('\n').map(line => {
      const [hash, subject, date, author] = line.split('|')
      return { hash: hash?.trim(), subject: subject?.trim(), date: date?.slice(0, 10), author: author?.trim() }
    }).filter(c => c.hash && c.hash.length === 40)
  } catch { return [] }
}

function getCommitFiles(hash) {
  try {
    return execSync(`git show --name-only --format="" ${hash}`, {
      cwd: ROOT, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean)
  } catch { return [] }
}

// ─── GitHub Issues ────────────────────────────────────────────────────────────

function ensureLabels() {
  const colors = {
    approved:      '0075ca',
    monitoring:    'e4e669',
    stable:        '0e8a16',
    flagged:       'd93f0b',
    'rolled-back': 'b60205',
  }
  for (const label of LABELS) {
    try {
      execSync(
        `gh label create "${label}" --repo ${GH_REPO} --color "${colors[label] || 'ededed'}" --force`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      )
    } catch {}
  }
}

function openIssue(title, body, label) {
  const bodyFile = path.join(TEMP_DIR, 'issue-body.md')
  fs.writeFileSync(bodyFile, body)
  const cmd = `gh issue create --repo ${GH_REPO} --title ${JSON.stringify(title)} --body-file "${bodyFile}" --label "${label}"`

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
      const m = out.match(/\/issues\/(\d+)/)
      return m ? parseInt(m[1]) : null
    } catch (err) {
      const firstLine = err.message?.split('\n')[0] || ''
      if (attempt === 1 && /422|429|rate.limit|secondary/i.test(firstLine)) {
        log(`  rate-limited — retrying in 5s (${title.slice(0, 60)}…)`)
        execSync('sleep 5')
      } else {
        log(`WARNING: gh issue create failed: ${firstLine}`)
        return null
      }
    }
  }
  return null
}

function updateIssueLabel(num, addLabel, removeLabel) {
  try {
    if (removeLabel) execSync(
      `gh issue edit ${num} --repo ${GH_REPO} --remove-label "${removeLabel}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    execSync(
      `gh issue edit ${num} --repo ${GH_REPO} --add-label "${addLabel}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
  } catch (err) {
    log(`WARNING: gh issue edit #${num} failed: ${err.message?.split('\n')[0]}`)
  }
}

function addIssueComment(num, comment) {
  try {
    const bodyFile = path.join(TEMP_DIR, 'comment-body.md')
    fs.writeFileSync(bodyFile, comment)
    execSync(
      `gh issue comment ${num} --repo ${GH_REPO} --body-file "${bodyFile}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
  } catch {}
}

function closeIssue(num, comment) {
  if (comment) addIssueComment(num, comment)
  try {
    execSync(`gh issue close ${num} --repo ${GH_REPO}`, { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    log(`WARNING: gh issue close #${num} failed: ${err.message?.split('\n')[0]}`)
  }
}

function listOpenIssues(label) {
  try {
    const out = execSync(
      `gh issue list --repo ${GH_REPO} --label "${label}" --json number,title,createdAt --limit 50`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    return out ? JSON.parse(out) : []
  } catch { return [] }
}

// ─── Eng-bot log parser ───────────────────────────────────────────────────────

function parseEngBotErrors(logContent) {
  if (!logContent) return []
  const seen = new Map()

  for (const line of logContent.split('\n')) {
    const m = line.match(/\[([\dT:.Z-]+)\].*(?:ERROR|error|fail)[^a-z].*?([\w-]+\.js)/i)
    if (!m) continue
    const key = `${m[2]}:${line.slice(50, 120)}`
    if (!seen.has(key)) seen.set(key, { timestamp: m[1], script: m[2], context: line.slice(0, 200) })
  }
  return [...seen.values()]
}

// ─── Known-fix library ────────────────────────────────────────────────────────

const KNOWN_FIXES_REMOTE = `${REMOTE}/Reports/known-fixes.md`

function loadKnownFixes() {
  const content = loadDriveFile(KNOWN_FIXES_REMOTE)
  if (!content) return []
  const fixes = []
  for (const entry of content.split(/\n(?=ERROR:)/m)) {
    if (!entry.trim() || entry.startsWith('#')) continue
    const fix = {}
    for (const line of entry.split('\n')) {
      const m = line.match(/^([\w\s]+?):\s*(.+)$/)
      if (m) fix[m[1].trim().toLowerCase().replace(/\s+/g, '_')] = m[2].trim()
    }
    if (fix.error) fixes.push(fix)
  }
  return fixes
}

function serializeKnownFixes(fixes) {
  const today = new Date().toISOString().slice(0, 10)
  if (!fixes.length) return `# BSV Known Fix Library\n_Updated: ${today}_\n\n*(no entries yet)*\n`
  const header = `# BSV Known Fix Library\n_Updated: ${today}_\n\n`
  return header + fixes.map(f => [
    `ERROR: ${f.error || ''}`,
    `FIRST SEEN: ${f.first_seen || ''}`,
    `TIMES SEEN: ${f.times_seen || '1'}`,
    `FIX APPLIED: ${f.fix_applied || ''}`,
    `SUCCESS RATE: ${f.success_rate || '1/1'}`,
    `ROLLBACK RISK: ${f.rollback_risk || 'unknown'}`,
    `AUTONOMOUS SAFE: ${f.autonomous_safe || 'not yet — need 3+ successful fixes'}`,
    `NEXT REVIEW: ${f.next_review || 'after 2 more occurrences'}`,
    `TIER: ${f.tier || '3 — Novel'}`,
  ].join('\n')).join('\n\n---\n\n') + '\n'
}

// ─── Change record builder ────────────────────────────────────────────────────

function buildChangeRecord({ what, date, commit, files, impact, rollback, recommendation, status }) {
  return [
    `CHANGE: ${what}`,
    `DATE: ${date}`,
    commit ? `COMMIT: ${commit}` : null,
    `APPROVED BY: Big D`,
    `WHY: See commit message`,
    `WHAT CHANGED: ${files}`,
    `IMPACT: ${impact}`,
    `ROLLBACK: ${rollback}`,
    `RECOMMENDATION: ${recommendation}`,
    `STATUS: ${status}`,
  ].filter(Boolean).join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  const postCommit = process.argv.includes('--post-commit')
  log(`━━━ change-agent start${postCommit ? ' [post-commit]' : ' [daily]'} ━━━`)

  const today = new Date().toISOString().slice(0, 10)
  const state = loadState()

  // ── GitHub labels ────────────────────────────────────────────────────────────

  log('Ensuring GitHub labels...')
  ensureLabels()

  // ── Get new commits ───────────────────────────────────────────────────────────

  log(`Scanning commits since: ${state.last_commit_hash ? state.last_commit_hash.slice(0, 7) : '7 days ago'}`)
  const newCommits = getNewCommits(state.last_commit_hash)
  log(`New commits: ${newCommits.length}`)

  const changeRecords = []

  for (const commit of newCommits) {
    if (state.tracked_issues?.[commit.hash]) {
      log(`  ${commit.hash.slice(0, 7)} already tracked — skipping`)
      continue
    }

    // Skip routine automated commits — track them in state so they're never revisited,
    // but don't open an issue (post output, chores, and other pipeline noise).
    const SKIP_PREFIXES = /^(auto:|chore:|Auto:|Chore:)/
    if (SKIP_PREFIXES.test(commit.subject)) {
      log(`  ${commit.hash.slice(0, 7)} skipped (automated commit): ${commit.subject.slice(0, 60)}`)
      state.tracked_issues = state.tracked_issues || {}
      state.tracked_issues[commit.hash] = 'skipped'
      continue
    }

    const files          = getCommitFiles(commit.hash)
    const changedScripts = files.filter(f => f.startsWith('scripts/') && f.endsWith('.js'))
    const changedPlists  = files.filter(f => f.startsWith('launchd/'))
    const changedApp     = files.filter(f => f.startsWith('app/') || f.startsWith('public/'))

    const impactParts = []
    if (changedScripts.length) impactParts.push(`Agents: ${changedScripts.map(f => path.basename(f)).join(', ')}`)
    if (changedPlists.length)  impactParts.push(`Schedule: ${changedPlists.map(f => path.basename(f)).join(', ')}`)
    if (changedApp.length)     impactParts.push(`Site: ${changedApp.length} file(s)`)
    const impact = impactParts.join(' | ') || 'General — monitoring'

    const filesList = files.slice(0, 12).join(', ') + (files.length > 12 ? `… +${files.length - 12}` : '')

    changeRecords.push(buildChangeRecord({
      what:           commit.subject,
      date:           commit.date,
      commit:         commit.hash,
      files:          filesList,
      impact,
      rollback:       `git revert ${commit.hash}`,
      recommendation: 'monitor',
      status:         'monitoring',
    }))

    // Open GitHub issue
    const issueTitle = `[monitoring] ${commit.subject.slice(0, 80)}`
    const issueBody  = [
      `## Change\n${commit.subject}`,
      `**Commit:** [\`${commit.hash.slice(0, 7)}\`](https://github.com/${GH_REPO}/commit/${commit.hash})`,
      `**Date:** ${commit.date}`,
      `**Author:** ${commit.author}`,
      `**Files changed:**\n${files.slice(0, 15).map(f => `- \`${f}\``).join('\n')}${files.length > 15 ? `\n- _(+${files.length - 15} more)_` : ''}`,
      `## Impact\n${impact}`,
      `## Rollback\n\`\`\`\ngit revert ${commit.hash}\n\`\`\``,
      `## Status\nMonitoring — watching next 2–3 daily run cycles for regressions.`,
    ].join('\n\n')

    const issueNum = openIssue(issueTitle, issueBody, 'monitoring')
    if (issueNum) {
      state.tracked_issues = state.tracked_issues || {}
      state.tracked_issues[commit.hash] = issueNum
      log(`  #${issueNum} opened for ${commit.hash.slice(0, 7)}: ${commit.subject.slice(0, 60)}`)
    }
  }

  // ── Promote monitoring → stable (3+ days old, no eng-bot errors) ─────────────

  const engBotLog = (() => {
    try {
      const p = path.join(ROOT, 'logs', 'eng-bot.log')
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    } catch { return '' }
  })()

  const recentErrors = engBotLog.split('\n').filter(l => {
    if (!l.match(/ERROR|error|fail/i)) return false
    const ts = l.match(/\[([\dT:.Z-]+)\]/)
    return ts ? new Date(ts[1]) > new Date(Date.now() - 3 * 86400000) : false
  })

  const monitoringIssues = listOpenIssues('monitoring')
  const stableThisRun    = []

  for (const issue of monitoringIssues) {
    const ageDays = (Date.now() - new Date(issue.createdAt).getTime()) / 86400000
    if (ageDays < 3) continue

    const keywords = issue.title.replace('[monitoring] ', '').split(/\s+/).slice(0, 5).join('|')
    const hasErrors = recentErrors.some(e => new RegExp(keywords, 'i').test(e))
    if (hasErrors) continue

    updateIssueLabel(issue.number, 'stable', 'monitoring')
    closeIssue(
      issue.number,
      `Confirmed stable — no related errors in eng-bot over ${Math.round(ageDays)} days. Closing.`,
    )
    stableThisRun.push(issue.title.replace('[monitoring] ', '').slice(0, 60))
    log(`  Issue #${issue.number} → stable (closed)`)
  }

  // ── Eng-bot → known-fix library ───────────────────────────────────────────────

  log('Updating known-fix library from eng-bot log...')
  const engErrors  = parseEngBotErrors(engBotLog)
  const knownFixes = loadKnownFixes()
  let   fixesChanged = false

  for (const err of engErrors) {
    const existing = knownFixes.find(f =>
      f.error?.toLowerCase().includes(err.script.toLowerCase())
    )
    if (existing) {
      const seen = parseInt(existing.times_seen || '1') + 1
      existing.times_seen = String(seen)
      if (seen >= 3 && (existing.rollback_risk === 'low' || existing.rollback_risk === 'unknown')) {
        existing.autonomous_safe = 'candidate — awaiting Big D tier approval'
        existing.tier = '2 — Monitored'
        log(`  Tier candidate: ${existing.error?.slice(0, 60)}`)
      }
      fixesChanged = true
    } else {
      knownFixes.push({
        error:           `${err.script} — ${err.context.slice(30, 80)}`,
        first_seen:      err.timestamp?.slice(0, 10) || today,
        times_seen:      '1',
        fix_applied:     'triage via eng-bot Claude — see eng-bot.log',
        success_rate:    '1/1',
        rollback_risk:   'unknown',
        autonomous_safe: 'not yet — need 3+ successful fixes',
        next_review:     'after 2 more occurrences',
        tier:            '3 — Novel',
      })
      fixesChanged = true
      log(`  New fix entry: ${err.script}`)
    }
  }

  if (fixesChanged) {
    const localFixes = path.join(TEMP_DIR, 'known-fixes.md')
    fs.writeFileSync(localFixes, serializeKnownFixes(knownFixes))
    try {
      rcloneUpload(localFixes, `${REMOTE}/Reports/known-fixes.md`)
      log(`known-fixes.md uploaded (${knownFixes.length} entries)`)
    } catch (err) {
      log(`WARNING: known-fixes.md upload failed: ${err.message}`)
    }
  } else {
    log(`known-fixes.md: no new entries (${knownFixes.length} existing)`)
  }

  // ── Write change report ───────────────────────────────────────────────────────

  if (changeRecords.length) {
    const reportFile    = `change-report-${today}.md`
    const reportContent = [
      `# BSV Change Report — ${today}`,
      `_${changeRecords.length} change(s) — generated by change-agent.js_`,
      '',
      ...changeRecords.map((r, i) => `## Change ${i + 1}\n\n${r}`),
    ].join('\n\n')

    const localReport = path.join(TEMP_DIR, reportFile)
    fs.writeFileSync(localReport, reportContent)
    try {
      rcloneUpload(localReport, `${REMOTE}/Reports/${reportFile}`)
      log(`Change report uploaded → Reports/${reportFile}`)
    } catch (err) {
      log(`WARNING: change report upload failed: ${err.message}`)
    }
  }

  // ── Write change-state.json ───────────────────────────────────────────────────

  const openMonitoring  = listOpenIssues('monitoring')
  const openFlagged     = listOpenIssues('flagged')
  const tier1Candidates = knownFixes.filter(f => f.autonomous_safe?.includes('candidate'))

  const nextState = {
    last_run:         today,
    last_commit_hash: newCommits.length ? newCommits[0].hash : state.last_commit_hash,
    open_issues:      openMonitoring.length + openFlagged.length,
    monitoring:       openMonitoring.map(i => i.title.replace('[monitoring] ', '').slice(0, 50)),
    flagged:          openFlagged.map(i => i.title.slice(0, 50)),
    stable_this_week: stableThisRun,
    known_fixes:      knownFixes.length,
    tier1_candidates: tier1Candidates.map(f => f.error?.slice(0, 50)),
    action_needed:    openFlagged.length > 0 || tier1Candidates.length > 0,
    tracked_issues:   state.tracked_issues || {},
  }

  saveState(nextState)

  log(`State written → ${STATE_FILE}`)
  log(`  Open: ${nextState.open_issues} (${openMonitoring.length} monitoring, ${openFlagged.length} flagged)`)
  log(`  Stable this run: ${stableThisRun.length}`)
  log(`  Known fixes: ${nextState.known_fixes}`)
  log(`  Tier 1 candidates: ${nextState.tier1_candidates.length}`)
  log(`  Action needed: ${nextState.action_needed}`)

  log('━━━ change-agent complete ━━━\n')
})()
