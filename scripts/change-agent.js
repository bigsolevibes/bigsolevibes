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

const { execSync, spawnSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { sendTelegram } = require('./telegram')

const ROOT       = path.join(__dirname, '..')
const LOG_FILE   = path.join(ROOT, 'logs', 'change-agent.log')
const STATE_FILE = path.join(ROOT, 'logs', 'change-state.json')
const TEMP_DIR   = path.join(os.homedir(), 'tmp', 'bsv-change-agent')
const REMOTE     = 'big sole vibes:Big Sole Vibes'
const GH_REPO    = 'bigsolevibes/bigsolevibes'

const LABELS = ['approved', 'monitoring', 'stable', 'flagged', 'rolled-back']

// Syntax errors in these scripts warrant automatic rollback — pipeline cannot run without them.
const CRITICAL_SCRIPTS = new Set([
  'scripts/watch-drive.js',
  'scripts/distribute.js',
  'scripts/resize-post.js',
  'scripts/brand-image.js',
  'scripts/brand-video.js',
  'scripts/git-push-guard.js',
])

// Commits tagged [BSV-AUTO] came from eng-bot or change-agent autonomous fixes.
// Change-agent validates them but does NOT escalate or roll them back unless they
// crossed an autonomous authority boundary.
const BSV_AUTO_PREFIX = /^\[BSV-AUTO\]/i

// Commit message prefix for all autonomous fix commits made by this process.
const AUTO_COMMIT_PREFIX = '[BSV-AUTO]'

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

// ─── Early Warning: Syntax check + logging audit ──────────────────────────────

function checkSyntax(commits) {
  const failures = []
  for (const commit of commits) {
    for (const f of getCommitFiles(commit.hash).filter(f => f.startsWith('scripts/') && f.endsWith('.js'))) {
      const fullPath = path.join(ROOT, f)
      if (!fs.existsSync(fullPath)) continue
      try {
        const result = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' })
        if (result.status !== 0) {
          failures.push({
            file:    f,
            commit:  commit.hash.slice(0, 7),
            subject: commit.subject,
            error:   (result.stderr || '').trim().slice(0, 200),
          })
        }
      } catch {}
    }
  }
  return failures
}

function detectUnloggedScripts(commits) {
  const unlogged = []
  for (const commit of commits) {
    for (const f of getCommitFiles(commit.hash).filter(f => f.startsWith('scripts/') && f.endsWith('.js'))) {
      const fullPath = path.join(ROOT, f)
      if (!fs.existsSync(fullPath)) continue
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        if (!/appendFileSync|LOG_FILE|logs\//i.test(content)) {
          unlogged.push({ file: f, commit: commit.hash.slice(0, 7), subject: commit.subject })
        }
      } catch {}
    }
  }
  return unlogged
}

// ─── Post-commit hook installer ───────────────────────────────────────────────

function ensurePostCommitHook() {
  const hookPath    = path.join(ROOT, '.git', 'hooks', 'post-commit')
  const hookContent = `#!/bin/sh\nnode ${path.join(__dirname, 'change-agent.js')} --post-commit &\n`
  try {
    const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : ''
    if (!existing.includes('change-agent.js')) {
      fs.writeFileSync(hookPath, hookContent, { mode: 0o755 })
      log('Post-commit hook installed')
    }
  } catch (err) {
    log(`WARNING: could not install post-commit hook: ${err.message}`)
  }
}

// ─── Commit impact classification ─────────────────────────────────────────────

// Returns 'big-d' | 'chief' | 'autonomous'
// big-d      — website, affiliate link logic; Chief surfaces to Big D
// chief      — posting pipeline, content generation, schedule; Chief decides
// autonomous — utilities, logging, config, plists — change-agent monitors only
function classifyCommitImpact(files) {
  // Big D: site pages
  const siteFiles = files.filter(f =>
    f.startsWith('app/') ||
    (f.startsWith('public/') && !f.startsWith('public/posts/') && !f.startsWith('public/brand/'))
  )
  if (siteFiles.length) return 'big-d'

  // Big D: affiliate or tracking logic
  if (files.some(f => /affiliate|tracking|cj-research|product-research/i.test(f))) return 'big-d'

  // Chief: touches how/what/when content is posted or generated
  const chiefTriggers = new Set([
    'scripts/distribute.js',
    'scripts/watch-drive.js',
    'scripts/sync-shop.js',
    'scripts/media-director.js',
    'scripts/image-gen.js',
    'scripts/video-gen.js',
    'scripts/creative-agent.js',
    'scripts/gemini-bridge.js',
  ])
  if (files.some(f => chiefTriggers.has(f))) return 'chief'

  // Chief: plist changes = schedule changes
  if (files.some(f => f.startsWith('config/') && f.endsWith('.plist'))) return 'chief'

  return 'autonomous'
}

// ─── Chief escalation ─────────────────────────────────────────────────────────

async function escalateToChief(message) {
  try {
    const r = await sendTelegram(message)
    if (r?.message_id) log(`Chief escalation delivered — message_id: ${r.message_id}`)
    else log('WARNING: Chief escalation — no Telegram confirmation')
  } catch (err) {
    log(`WARNING: Chief escalation Telegram failed: ${err.message}`)
  }
}

// ─── Rollback authority ───────────────────────────────────────────────────────

async function writePostMortem(commit, reason, rollbackHash) {
  const today     = new Date().toISOString().slice(0, 10)
  const shortHash = commit.hash.slice(0, 7)
  const content   = [
    `## Post-Mortem — ${today}`,
    ``,
    `**What broke:** ${reason}`,
    `**Commit reverted:** \`${shortHash}\` — ${commit.subject}`,
    `**Author:** ${commit.author || 'unknown'}`,
    `**Rollback commit:** \`${rollbackHash || 'failed'}\``,
    `**Detected by:** change-agent.js (post-commit hook)`,
    `**Action:** Automatic rollback — pipeline preserved`,
    `**Fix required:** ${reason} — must be fixed before re-landing this change`,
    ``,
    `---`,
    ``,
  ].join('\n')

  const memoryDir  = path.join(os.homedir(), 'tmp', 'bsv-memory')
  const memoryFile = path.join(memoryDir, 'BSV-Memory.md')
  try {
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.appendFileSync(memoryFile, content)
    log(`Post-mortem appended to BSV-Memory.md`)
    execSync(`rclone copyto "${memoryFile}" "${REMOTE}/BSV-Memory.md"`, { stdio: 'pipe' })
    log(`Post-mortem uploaded to Drive`)
  } catch (err) {
    log(`WARNING: post-mortem write/upload failed: ${err.message}`)
  }
}

async function executeRollback(commit, reason) {
  const shortHash = commit.hash.slice(0, 7)
  log(`ROLLBACK: reverting ${shortHash} — reason: ${reason}`)

  try {
    execSync(`git revert --no-edit ${commit.hash}`, { cwd: ROOT, stdio: 'pipe' })
    const rollbackHash = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 7)
    log(`ROLLBACK: revert commit created — ${rollbackHash}`)

    execSync('git push origin HEAD:preview/full-site', { cwd: ROOT, stdio: 'pipe' })
    log(`ROLLBACK: pushed to preview/full-site`)

    await writePostMortem(commit, reason, rollbackHash)

    const chiefMsg = [
      `⚠️ *BSV — Chief: Change-agent rolled back a commit*`,
      ``,
      `*Reverted:* \`${shortHash}\` — ${commit.subject.slice(0, 80)}`,
      `*Reason:* ${reason}`,
      `*Rollback commit:* \`${rollbackHash}\``,
      ``,
      `Pipeline restored. Post-mortem written to BSV-Memory.md on Drive.`,
      ``,
      `*Notify Big D:* "Change-agent rolled back [${shortHash}] — reason: ${reason}. Pipeline restored."`,
    ].join('\n')
    await escalateToChief(chiefMsg)
    log(`ROLLBACK: Chief notified`)

    return rollbackHash
  } catch (err) {
    log(`ROLLBACK ERROR: failed to revert ${shortHash}: ${err.message}`)
    await escalateToChief([
      `🚨 *BSV — ROLLBACK FAILED: Manual intervention required*`,
      ``,
      `*Failed to revert:* \`${shortHash}\` — ${commit.subject.slice(0, 80)}`,
      `*Reason for rollback:* ${reason}`,
      `*Error:* ${err.message.slice(0, 200)}`,
      ``,
      `*Manual rollback:*`,
      '```',
      `git revert ${commit.hash}`,
      `git push origin HEAD:preview/full-site`,
      '```',
    ].join('\n'))
    return null
  }
}

// ─── BSV-AUTO commit validation ────────────────────────────────────────────────

// Autonomous authority boundaries: these file patterns are safe for auto-commits.
// If a [BSV-AUTO] commit touches anything outside this list, flag it.
const AUTO_SAFE_PATTERNS = [
  /^config\/com\.bsv\.[^/]+\.plist$/,     // plist installs
  /^logs\//,                               // log files
  /^scripts\/log-rotate\.js$/,             // log rotation
]

function validateAutoCommit(commit, files) {
  const violations = files.filter(f => !AUTO_SAFE_PATTERNS.some(p => p.test(f)))
  if (!violations.length) {
    log(`[BSV-AUTO] ${commit.hash.slice(0, 7)}: validated — within autonomous authority (${files.length} file(s))`)
    return true
  }
  log(`[BSV-AUTO] ${commit.hash.slice(0, 7)}: BOUNDARY VIOLATION — touched non-autonomous files: ${violations.join(', ')}`)
  escalateToChief([
    `🚨 *BSV — Chief: [BSV-AUTO] Boundary Violation*`,
    ``,
    `An autonomous commit touched files outside its authority.`,
    `*Commit:* \`${commit.hash.slice(0, 7)}\` — ${commit.subject.slice(0, 80)}`,
    `*Unauthorized files:* ${violations.join(', ')}`,
    ``,
    `Review and roll back if the change was not intentional.`,
  ].join('\n'))
  return false
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  const postCommit = process.argv.includes('--post-commit')
  log(`━━━ change-agent start${postCommit ? ' [post-commit]' : ' [daily]'} ━━━`)

  log('Loading directive...')
  const directive = loadDriveFile(`${REMOTE}/BSV-Directive.md`)
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)
  log('Loading memory...')
  const memory = loadDriveFile(`${REMOTE}/BSV-Memory.md`)
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  // ── Always: ensure post-commit hook is installed ──────────────────────────────
  ensurePostCommitHook()

  const today = new Date().toISOString().slice(0, 10)
  const state = loadState()

  // ── GitHub labels ────────────────────────────────────────────────────────────

  if (!postCommit) {
    log('Ensuring GitHub labels...')
    ensureLabels()
  }

  // ── Rogue main-push detection ─────────────────────────────────────────────────
  // Any commit reachable from origin/main but NOT from origin/preview/full-site
  // means something pushed directly to main without Big D's approval. Flag Tier 1.

  log('Checking for rogue pushes to origin/main...')
  const rogueMainPushes = (() => {
    try {
      execSync('git fetch origin main preview/full-site --quiet', { cwd: ROOT, stdio: 'pipe' })
      // spawnSync avoids shell interpretation of | in the --format string
      const result = spawnSync('git', [
        'log', 'origin/main', '--not', 'origin/preview/full-site',
        '--format=%H\t%s\t%aN', '--',
      ], { cwd: ROOT, encoding: 'utf8' })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(result.stderr || 'git log failed')
      const raw = (result.stdout || '').trim()
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map(line => {
        const [hash, subject, author] = line.split('\t')
        return { hash: (hash || '').trim(), subject: (subject || '').trim(), author: (author || '').trim() }
      }).filter(c => c.hash.length === 40)
    } catch (err) {
      const { sendTelegramAlert } = require('./git-push-guard')
      const msg = `⚠️ *BSV — change-agent failure*\n\nRogue main-push check threw an error and could not run.\n\nError: ${err.message.slice(0, 200)}\n\nInvestigate immediately.`
      sendTelegramAlert(msg)
      log(`ERROR: rogue main push check failed: ${err.message}`)
      return []
    }
  })()

  if (rogueMainPushes.length) {
    log(`TIER 1 ALERT: ${rogueMainPushes.length} commit(s) found on origin/main not in origin/preview/full-site`)
    const { sendTelegramAlert } = require('./git-push-guard')
    for (const c of rogueMainPushes) {
      const shortHash = c.hash.slice(0, 7)
      if (state.tracked_issues?.[`main-rogue-${shortHash}`]) {
        log(`  ${shortHash} already tracked — skipping`)
        continue
      }
      log(`  ROGUE: ${shortHash} "${c.subject}" by ${c.author}`)
      const issueTitle = `[flagged] ROGUE MAIN PUSH — ${c.subject.slice(0, 60)}`
      const issueBody  = [
        `## TIER 1 — Direct Push to main Detected`,
        `A commit landed on \`origin/main\` that is NOT in \`origin/preview/full-site\`.`,
        `This means something bypassed the pipeline branch discipline.`,
        ``,
        `**Commit:** [\`${shortHash}\`](https://github.com/${GH_REPO}/commit/${c.hash})`,
        `**Subject:** ${c.subject}`,
        `**Author:** ${c.author}`,
        ``,
        `## Action Required`,
        `Big D must review this commit and determine whether it was an intentional promotion or a pipeline misconfiguration.`,
        ``,
        `If unintentional, revert with:`,
        `\`\`\``,
        `git revert ${c.hash}`,
        `git push origin HEAD:main`,
        `\`\`\``,
      ].join('\n')
      const issueNum = openIssue(issueTitle, issueBody, 'flagged')
      if (issueNum) {
        state.tracked_issues = state.tracked_issues || {}
        state.tracked_issues[`main-rogue-${shortHash}`] = issueNum
        log(`  #${issueNum} opened (Tier 1 flagged)`)
      }
      sendTelegramAlert(
        `🚨 *BSV — Tier 1 Alert*\n\nRogue push to \`main\` detected.\n\n` +
        `Commit: \`${shortHash}\`\nSubject: ${c.subject}\nAuthor: ${c.author}\n\n` +
        `GitHub Issue #${issueNum || '?'} opened. Review immediately.`
      )
    }
  } else {
    log('origin/main is clean — no unexpected commits')
  }

  // ── Get new commits ───────────────────────────────────────────────────────────

  log(`Scanning commits since: ${state.last_commit_hash ? state.last_commit_hash.slice(0, 7) : '7 days ago'}`)
  const newCommits = getNewCommits(state.last_commit_hash)
  log(`New commits: ${newCommits.length}`)

  // ── Early Warning: Syntax + logging checks + rollback for critical scripts ────
  if (newCommits.length) {
    // Filter out [BSV-AUTO] commits before syntax/logging checks — those are validated separately
    const nonAutoCommits = newCommits.filter(c => !BSV_AUTO_PREFIX.test(c.subject))

    const syntaxFailures = checkSyntax(nonAutoCommits.slice(0, 10))

    // Split: critical scripts warrant auto-rollback; others get an alert only
    const criticalFailures    = syntaxFailures.filter(f => CRITICAL_SCRIPTS.has(f.file))
    const nonCriticalFailures = syntaxFailures.filter(f => !CRITICAL_SCRIPTS.has(f.file))

    // Rollback any commit with a syntax error in a critical pipeline script
    for (const f of criticalFailures) {
      log(`CRITICAL SYNTAX ERROR: ${f.file} (${f.commit}) — initiating rollback`)
      const badCommit = nonAutoCommits.find(c => c.hash.startsWith(f.commit) || c.hash.slice(0, 7) === f.commit)
      if (badCommit) {
        await executeRollback(badCommit, `Syntax error in critical pipeline script ${f.file}: ${f.error.slice(0, 100)}`)
      } else {
        await escalateToChief([
          `🚨 *BSV — CRITICAL: Syntax error in pipeline script — could not rollback*`,
          ``,
          `*File:* \`${f.file}\``,
          `*Commit:* \`${f.commit}\` — ${f.subject.slice(0, 80)}`,
          `*Error:* \`${f.error.slice(0, 150)}\``,
          ``,
          `Could not locate commit to revert. Manual fix required immediately.`,
        ].join('\n'))
      }
    }

    // Alert (no rollback) for syntax errors in non-critical scripts
    for (const f of nonCriticalFailures) {
      log(`EARLY WARNING: syntax error in ${f.file} (${f.commit}) — ${f.error.slice(0, 80)}`)
      await escalateToChief([
        `⚠️ *BSV — Chief: Syntax Error in Commit \`${f.commit}\`*`,
        ``,
        `*File:* \`${f.file}\``,
        `*Commit:* ${f.subject.slice(0, 80)}`,
        ``,
        `*Error:*`,
        '```',
        f.error,
        '```',
        ``,
        `Non-critical script — pipeline not auto-rolled-back. Fix before next run.`,
      ].join('\n'))
    }

    const unlogged = detectUnloggedScripts(nonAutoCommits.slice(0, 10))
    for (const u of unlogged) {
      log(`EARLY WARNING: ${u.file} has no logging — added in ${u.commit}`)
      await escalateToChief(
        `⚠️ *BSV — Chief: New Script Without Logging*\n\n` +
        `\`${u.file}\` was added in commit \`${u.commit}\` with no \`LOG_FILE\` or \`appendFileSync\` to logs/.\n\n` +
        `Eng-bot cannot monitor it. Add logging before this script goes live.`
      )
    }

    // ── [BSV-AUTO] validation ─────────────────────────────────────────────────
    const autoCommits = newCommits.filter(c => BSV_AUTO_PREFIX.test(c.subject))
    for (const commit of autoCommits) {
      const files = getCommitFiles(commit.hash)
      validateAutoCommit(commit, files)
    }
  }

  const changeRecords = []

  for (const commit of newCommits) {
    if (state.tracked_issues?.[commit.hash]) {
      log(`  ${commit.hash.slice(0, 7)} already tracked — skipping`)
      continue
    }

    // [BSV-AUTO] commits: validated above — log in state and stand down
    if (BSV_AUTO_PREFIX.test(commit.subject)) {
      log(`  ${commit.hash.slice(0, 7)} [BSV-AUTO] — validated, logged, standing down`)
      state.tracked_issues = state.tracked_issues || {}
      state.tracked_issues[commit.hash] = 'bsv-auto'
      continue
    }

    // Skip routine automated pipeline commits — post output, chores, pipeline noise
    const SKIP_PREFIXES = /^(auto:|chore:|Auto:|Chore:)/
    if (SKIP_PREFIXES.test(commit.subject)) {
      log(`  ${commit.hash.slice(0, 7)} skipped (automated commit): ${commit.subject.slice(0, 60)}`)
      state.tracked_issues = state.tracked_issues || {}
      state.tracked_issues[commit.hash] = 'skipped'
      continue
    }

    const files          = getCommitFiles(commit.hash)
    const changedScripts = files.filter(f => f.startsWith('scripts/') && f.endsWith('.js'))
    const changedPlists  = files.filter(f => f.startsWith('config/') && f.endsWith('.plist'))
    const changedApp     = files.filter(f => f.startsWith('app/') || f.startsWith('public/'))

    const impactParts = []
    if (changedScripts.length) impactParts.push(`Agents: ${changedScripts.map(f => path.basename(f)).join(', ')}`)
    if (changedPlists.length)  impactParts.push(`Schedule: ${changedPlists.map(f => path.basename(f)).join(', ')}`)
    if (changedApp.length)     impactParts.push(`Site: ${changedApp.length} file(s)`)
    const impact = impactParts.join(' | ') || 'General — monitoring'

    // Classify commit impact and escalate accordingly
    const tier = classifyCommitImpact(files)
    const filesList = files.slice(0, 12).join(', ') + (files.length > 12 ? `… +${files.length - 12}` : '')

    if (tier === 'big-d') {
      log(`  ${commit.hash.slice(0, 7)}: Big D tier — site or affiliate files touched`)
      await escalateToChief([
        `🚨 *BSV — Chief → Big D: Commit Requires Review*`,
        ``,
        `*Commit:* \`${commit.hash.slice(0, 7)}\` — ${commit.subject.slice(0, 80)}`,
        `*Author:* ${commit.author}`,
        `*Impact:* ${impact}`,
        ``,
        `This touches the website or affiliate logic. Big D must review.`,
        `*Rollback if needed:*`,
        '```',
        `git revert ${commit.hash}`,
        '```',
      ].join('\n'))
    } else if (tier === 'chief') {
      log(`  ${commit.hash.slice(0, 7)}: Chief tier — posting pipeline or schedule changed`)
      await escalateToChief([
        `⚠️ *BSV — Chief: Commit Changes Pipeline Behavior*`,
        ``,
        `*Commit:* \`${commit.hash.slice(0, 7)}\` — ${commit.subject.slice(0, 80)}`,
        `*Author:* ${commit.author}`,
        `*Impact:* ${impact}`,
        ``,
        `This affects what posts, when, or how. Review before next post cycle.`,
        `*Rollback if needed:*`,
        '```',
        `git revert ${commit.hash}`,
        '```',
      ].join('\n'))
    } else {
      log(`  ${commit.hash.slice(0, 7)}: autonomous tier — monitoring only`)
    }

    changeRecords.push(buildChangeRecord({
      what:           commit.subject,
      date:           commit.date,
      commit:         commit.hash,
      files:          filesList,
      impact,
      rollback:       `git revert ${commit.hash}`,
      recommendation: tier === 'autonomous' ? 'monitor' : `escalated to ${tier === 'big-d' ? 'Big D' : 'Chief'}`,
      status:         'monitoring',
    }))

    // Open GitHub issue (all human commits get tracked regardless of tier)
    const issueTitle = `[monitoring] ${commit.subject.slice(0, 80)}`
    const issueBody  = [
      `## Change\n${commit.subject}`,
      `**Commit:** [\`${commit.hash.slice(0, 7)}\`](https://github.com/${GH_REPO}/commit/${commit.hash})`,
      `**Date:** ${commit.date}`,
      `**Author:** ${commit.author}`,
      `**Tier:** ${tier}`,
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

    const keywords = issue.title.replace('[monitoring] ', '').split(/\s+/).slice(0, 5)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean)
      .join('|')
    const hasErrors = keywords ? recentErrors.some(e => new RegExp(keywords, 'i').test(e)) : false
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

  const knownFixes = postCommit ? [] : loadKnownFixes()

  if (postCommit) {
    log('Post-commit run — skipping known-fix library update (runs at 8:30AM)')
  } else {
  log('Updating known-fix library from eng-bot log...')
  const engErrors  = parseEngBotErrors(engBotLog)
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
  } // end !postCommit block

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
    last_heartbeat:   new Date().toISOString(),
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
