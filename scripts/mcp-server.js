require('dotenv').config({ quiet: true })
const { McpServer }               = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport }    = require('@modelcontextprotocol/sdk/server/stdio.js')
const { execSync, spawnSync, spawn } = require('child_process')
const { z }                       = require('zod')
const path                        = require('path')
const fs                          = require('fs')

const ROOT      = process.env.BSV_ROOT || path.join(__dirname, '..')
const LOGS_DIR  = path.join(ROOT, 'logs')
const STATE_FILE = path.join(LOGS_DIR, 'watch-drive-state.json')

console.error(`[bsv-mcp] Starting — ROOT: ${ROOT}`)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
}

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim()
  } catch (e) {
    return e.stderr?.toString().trim() || e.message
  }
}

function tail(file, n) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    return lines.slice(-n).join('\n') || '(log file is empty)'
  } catch { return '(log file not found)' }
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'bsv-mcp', version: '1.0.0' })

// ── read_log ──────────────────────────────────────────────────────────────────
server.tool(
  'read_log',
  'Read the last N lines from a BSV agent log file (logs/[agent].log).',
  {
    agent: z.string().describe('Agent name — e.g. watch-drive, distribute, eng-bot, creative-agent, media-director, resize-post, brand-image, brand-video, image-gen, gemini-bridge'),
    lines: z.number().int().min(1).max(500).default(50).describe('Number of lines to return (default 50)'),
  },
  async ({ agent, lines }) => {
    const logFile = path.join(LOGS_DIR, `${agent}.log`)
    return { content: [{ type: 'text', text: tail(logFile, lines) }] }
  }
)

// ── get_incident_status ───────────────────────────────────────────────────────
// eng-bot.js's real loadSeen()/saveSeen() shape is a flat dedup map:
//   { baselineAt: ISOString|null, hashes: { [md5(source::platform::msg)]: ISOTimestampString } }
// It does NOT store per-entry {ts,agent,msg,level,resolved} fields — that was
// this tool's original (wrong) assumption, which produced the long-standing
// "undefined: undefined (NaNm ago)" output (open since 2026-06-07, fixed
// 2026-06-28). There's no human-readable message or level stored per hash, so
// this reports what the file actually contains — tracked failure-signature
// count, baseline time, and first-seen age — rather than fabricating fields
// that don't exist. For current human-readable failures, use read_log.
server.tool(
  'get_incident_status',
  'Get eng-bot\'s tracked failure-signature history (logs/eng-seen.json): count, baseline time, and first-seen age per hash. No per-incident agent/message/level/resolved detail is stored — use read_log for that.',
  {},
  async () => {
    try {
      const seenPath = path.join(LOGS_DIR, 'eng-seen.json')
      const raw       = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : {}
      const baselineAt = raw.baselineAt || null
      const hashes     = raw.hashes && typeof raw.hashes === 'object' ? raw.hashes : {}
      const now        = Date.now()

      const entries = Object.entries(hashes)
        .map(([hash, ts]) => {
          const seenAt = ts ? new Date(ts).getTime() : NaN
          const age    = !isNaN(seenAt) ? Math.round((now - seenAt) / 60000) : null
          return { hash, ts, age }
        })
        .sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity))

      const lines = entries.map(e =>
        `  ${e.hash.slice(0, 12)}…  first seen ${e.ts || 'unknown'}${e.age != null ? ` (${e.age}m ago)` : ''}`
      )

      const text = [
        `${entries.length} tracked failure signature(s) — baseline ${baselineAt || '(none set)'}`,
        'No per-incident agent/message/level is stored in eng-seen.json — use read_log on the relevant agent for current detail.',
        ...(entries.length ? ['', ...lines] : []),
      ].join('\n')

      return { content: [{ type: 'text', text: text || 'No incidents on record.' }] }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error reading incident state: ${err.message}` }] }
    }
  }
)

// ── get_agent_processes ───────────────────────────────────────────────────────
server.tool(
  'get_agent_processes',
  'List all running BSV agent processes (watch-drive, distribute, etc.).',
  {},
  async () => {
    const out = sh(`ps aux | grep -E 'scripts/(watch-drive|distribute|eng-bot|brand|resize|image-gen|gemini|creative|media-director|mcp-server)' | grep -v grep`)
    return { content: [{ type: 'text', text: out || '(no BSV processes running)' }] }
  }
)

// ── get_git_status ────────────────────────────────────────────────────────────
server.tool(
  'get_git_status',
  'Get git status and recent commits for the BSV repo.',
  {},
  async () => {
    const status  = sh('git status --short')
    const log     = sh('git log -8 --oneline')
    const branch  = sh('git branch --show-current')
    const text    = `=== git status ===\nBranch: ${branch}\n${status || '(clean)'}\n\n=== recent commits ===\n${log}`
    return { content: [{ type: 'text', text: text }] }
  }
)

// ── get_pipeline_state ────────────────────────────────────────────────────────
server.tool(
  'get_pipeline_state',
  'Get the current pipeline state for all slots (from watch-drive-state.json).',
  {},
  async () => {
    const state = readState()
    const lines = []
    for (const [slot, data] of Object.entries(state)) {
      if (slot.startsWith('_')) continue
      const parts = Object.entries(data)
        .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('  ')
      lines.push(`${slot}: ${parts}`)
    }
    return { content: [{ type: 'text', text: lines.join('\n') || '(pipeline state empty)' }] }
  }
)

// ── get_changes ───────────────────────────────────────────────────────────────
server.tool(
  'get_changes',
  'Get recent git commits. Use status="all" for last 20, or filter by keyword.',
  {
    status: z.string().default('all').describe('"all" for recent 20 commits, or a keyword to grep for'),
  },
  async ({ status }) => {
    const cmd = status === 'all'
      ? 'git log -20 --oneline'
      : `git log -20 --oneline --grep="${status}"`
    const out = sh(cmd)
    return { content: [{ type: 'text', text: out || '(no matching commits)' }] }
  }
)

// ── revert_change ─────────────────────────────────────────────────────────────
server.tool(
  'revert_change',
  'Revert a specific commit. Big D must APPROVE reply.',
  {
    id:     z.string().describe('Change ID (7-char commit hash) from get_changes'),
    reason: z.string().describe('Why this change should be reverted'),
  },
  async ({ id, reason }) => {
    const log    = sh(`git log --oneline -1 ${id}`)
    const result = sh(`git revert ${id} --no-edit`)
    return { content: [{ type: 'text', text: `Reverted: ${log}\nReason: ${reason}\n\n${result}` }] }
  }
)

// ── clear_stale_slot ─────────────────────────────────────────────────────────
server.tool(
  'clear_stale_slot',
  'Remove a stuck/stale slot from the pipeline state so it can be reprocessed.',
  {
    slot: z.string().describe('Slot name, e.g. wed-am, mon-pm-flow'),
  },
  async ({ slot }) => {
    const state = readState()
    if (!state[slot]) return { content: [{ type: 'text', text: `Slot "${slot}" not found in pipeline state.` }] }
    const snapshot = JSON.stringify(state[slot])
    delete state[slot]
    writeState(state)
    return { content: [{ type: 'text', text: `Cleared slot "${slot}".\nWas: ${snapshot}` }] }
  }
)

// ── get_cost_state ───────────────────────────────────────────────────────────
server.tool(
  'get_cost_state',
  'Get current AI cost tracking state (daily spend, model breakdown).',
  {},
  async () => {
    const costPath = path.join(LOGS_DIR, 'cost-state.json')
    if (!fs.existsSync(costPath)) {
      const costLog = tail(path.join(LOGS_DIR, 'cost-report.log'), 30)
      return { content: [{ type: 'text', text: costLog } ] }
    }
    try {
      const cost = JSON.parse(fs.readFileSync(costPath, 'utf8'))
      return { content: [{ type: 'text', text: JSON.stringify(cost, null, 2) }] }
    } catch {
      return { content: [{ type: 'text', text: 'cost-state.json unreadable' }] }
    }
  }
)

// ── record_credit_topup ──────────────────────────────────────────────────────
// Added 2026-07-16: Big D flagged manually editing ANTHROPIC_CREDIT_BALANCE /
// ANTHROPIC_CREDIT_TOPUP_DATE in .env every time he adds Anthropic credit as
// too much friction. There's still no live balance API (confirmed again
// 2026-07-15 — Console billing page is the only real-time source), so
// cost-report.js still needs a topup snapshot to subtract spend from. The fix
// is just moving that snapshot out of .env: it's not a credential, so it can
// live in a plain gitignored JSON file that Claude writes directly whenever
// Big D reports a new balance in chat. cost-report.js reads this file first,
// falling back to the legacy .env vars if it's ever missing.
server.tool(
  'record_credit_topup',
  "Record Big D's current Anthropic API credit balance so cost-report.js can track spend-down without him editing .env. Call this whenever Big D tells you a new balance (e.g. after a top-up). Writes to logs/credit-topup.json.",
  {
    amount: z.number().min(0).describe('Current credit balance in dollars, e.g. 50 for $50.00'),
    date:   z.string().optional().describe('Date this balance is accurate as of, YYYY-MM-DD. Defaults to today.'),
  },
  async ({ amount, date }) => {
    const topupDate = date || new Date().toISOString().slice(0, 10)
    const filePath = path.join(LOGS_DIR, 'credit-topup.json')
    const record = { amount, date: topupDate, recorded_at: new Date().toISOString() }
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2))
    return {
      content: [{
        type: 'text',
        text: `✓ Recorded: $${amount.toFixed(2)} balance as of ${topupDate}\nlogs/credit-topup.json updated — cost-report.js will use this on its next run (no .env edit needed).`,
      }],
    }
  }
)

// ── get_launchd_status ───────────────────────────────────────────────────────
server.tool(
  'get_launchd_status',
  'Get launchd service status for all BSV launchd agents.',
  {},
  async () => {
    const list = sh('launchctl list | grep -i bsv')
    return { content: [{ type: 'text', text: list || '(no BSV launchd agents found)' }] }
  }
)

// ── run_diagnostic ───────────────────────────────────────────────────────────
server.tool(
  'run_diagnostic',
  'Run a BSV script in diagnostic/dry-run mode and return its output.',
  {
    script: z.string().describe('Script name without path, e.g. eng-bot, watch-drive, distribute'),
  },
  async ({ script }) => {
    const scriptPath = path.join(ROOT, 'scripts', `${script.replace(/\.js$/, '')}.js`)
    if (!fs.existsSync(scriptPath)) {
      return { content: [{ type: 'text', text: `Script not found: ${scriptPath}` }] }
    }
    // sync-shop handles its own git push — don't add --dry-run
    const LIVE_SCRIPTS = new Set(['sync-shop'])
    const isLive = LIVE_SCRIPTS.has(script.replace(/\.js$/, ''))
    const args = isLive ? [scriptPath] : [scriptPath, '--dry-run']
    console.error(`[bsv-mcp] run_diagnostic: ${script} isLive=${isLive} args=${JSON.stringify(args)}`)
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 60000,
    })
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    return { content: [{ type: 'text', text: `[isLive=${isLive}]\n` + (out || '(no output)') }] }
  }
)

// ── apply_code_fix ───────────────────────────────────────────────────────────
server.tool(
  'apply_code_fix',
  'Queue a code fix for Claude Code to apply. Writes the request to logs/pending-fix.json — pick it up in the next Code session.',
  {
    description: z.string().describe('Detailed description of what to change and why'),
    script:      z.string().describe('File path relative to repo root, e.g. scripts/watch-drive.js'),
  },
  async ({ description, script }) => {
    const pending = {
      description,
      script,
      queued: new Date().toISOString(),
      status: 'pending',
    }
    const fixPath = path.join(LOGS_DIR, 'pending-fix.json')
    fs.writeFileSync(fixPath, JSON.stringify(pending, null, 2))
    return {
      content: [{
        type: 'text',
        text: `Fix queued → ${fixPath}\n\nFile: ${script}\nDescription: ${description}\n\nOpen Claude Code and run: cat logs/pending-fix.json — Code will apply it.`,
      }],
    }
  }
)

// ── approve_slot ─────────────────────────────────────────────────────────────
server.tool(
  'approve_slot',
  'Approve a content slot for distribution. Writes to logs/approved-slots.json so watch-drive will release it.',
  {
    slot: z.string().describe('Slot name, e.g. fri-am, mon-pm'),
  },
  async ({ slot }) => {
    const filePath = path.join(LOGS_DIR, 'approved-slots.json')
    let existing = {}
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch {}
    existing[slot] = true
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))
    return { content: [{ type: 'text', text: `✓ Approved: ${slot}\nwatch-drive will release it on next poll (≤15 min).` }] }
  }
)

// ── deny_slot ─────────────────────────────────────────────────────────────────
server.tool(
  'deny_slot',
  'Deny a content slot — removes from approved-slots.json, clears its files from Drive "Ready to Post/", and clears pipeline state.',
  {
    slot:   z.string().describe('Slot name, e.g. fri-am, mon-pm'),
    reason: z.string().optional().describe('Optional reason for denial'),
  },
  async ({ slot, reason }) => {
    // Fixed 2026-07-13 (see BSV-BigC-Audit-Log.md): denial used to only clear
    // local pipeline state — it never touched the actual files in Drive's
    // "Ready to Post/" folder. Since the source files never went away,
    // watch-drive's next poll (every ~15 min) just found them again and
    // re-queued the same denied content as if it were new — a denial never
    // actually stuck. Big D: "if its denied then it should be cleared."
    // Mirrors the clear_drive_slot tool's Drive-clearing step, folded into
    // deny itself so it's automatic rather than a separate manual action.
    const DRIVE_REMOTE = 'big sole vibes:Big Sole Vibes/Ready to Post'
    try {
      execSync(
        `rclone delete "${DRIVE_REMOTE}" --include "${slot}.*" --include "${slot}-flow.*" --include "${slot}-*prompt*"`,
        { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
      )
    } catch (err) {
      console.error(`[deny_slot] Drive clear warning: ${err.stderr?.toString().trim() || err.message}`)
    }

    // Remove from approved-slots
    const filePath = path.join(LOGS_DIR, 'approved-slots.json')
    let existing = {}
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch {}
    delete existing[slot]
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))

    // Clear from pipeline state (both the slot and its -flow variant)
    const state = readState()
    const cleared = !!state[slot]
    delete state[slot]
    delete state[`${slot}-flow`]
    writeState(state)

    // ── Capture brief for denial learning ─────────────────────────────────────
    // Read the brief that was denied so agents learn from it.
    // Writes to logs/denial-log.json (read by brand-manager + creative-agent).
    try {
      const briefPath = path.join(ROOT, 'posts', 'briefs', `${slot}-brief.txt`)
      const briefText = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : null

      const extract = (label, text) => {
        if (!text) return null
        const m = text.match(new RegExp(`${label}:\\s*([^\\n]+(?:\\n(?![A-Z_]+:)[^\\n]+)*)`, 'i'))
        return m ? m[1].trim().slice(0, 300) : null
      }

      const entry = {
        date:        new Date().toISOString().slice(0, 10),
        timestamp:   new Date().toISOString(),
        slot,
        reason:      reason || null,
        voice:       extract('VOICE', briefText),
        theme:       extract('THEME', briefText),
        instagram:   extract('INSTAGRAM', briefText),
        imageBrief:  extract('IMAGE BRIEF', briefText),
        hasBrief:    !!briefText,
      }

      const DENIAL_LOG = path.join(LOGS_DIR, 'denial-log.json')
      let log = []
      try { log = JSON.parse(fs.readFileSync(DENIAL_LOG, 'utf8')) } catch {}
      log.unshift(entry) // newest first
      if (log.length > 100) log = log.slice(0, 100) // cap at 100 entries
      fs.writeFileSync(DENIAL_LOG, JSON.stringify(log, null, 2))

      // Also push a summary into creative-directives.json so it's visible immediately
      const DIRECTIVES_FILE = path.join(LOGS_DIR, 'creative-directives.json')
      let directives = {}
      try { directives = JSON.parse(fs.readFileSync(DIRECTIVES_FILE, 'utf8')) } catch {}
      if (!directives.denials) directives.denials = []
      directives.denials.unshift({
        date: entry.date, slot, reason: reason || null,
        instagram: entry.instagram?.slice(0, 150),
        imageBrief: entry.imageBrief?.slice(0, 150),
      })
      if (directives.denials.length > 20) directives.denials = directives.denials.slice(0, 20)
      directives.denials_updatedAt = new Date().toISOString()
      fs.writeFileSync(DIRECTIVES_FILE, JSON.stringify(directives, null, 2))
    } catch (err) {
      console.error(`[deny_slot] denial logging failed: ${err.message}`)
    }

    const msg = [`✗ Denied: ${slot}`]
    if (reason) msg.push(`Reason: ${reason}`)
    msg.push(cleared ? 'Cleared from pipeline state — re-upload to Drive to reprocess.' : 'Not found in pipeline state.')
    msg.push('Brief captured in denial-log.json — agents will learn from this.')
    return { content: [{ type: 'text', text: msg.join('\n') }] }
  }
)

// ── get_slot_image ────────────────────────────────────────────────────────────
server.tool(
  'get_slot_image',
  'Get the Instagram preview image for a slot as a base64 data URI (resized to ~400px for fast display).',
  {
    slot: z.string().describe('Slot name, e.g. fri-am, mon-pm'),
  },
  async ({ slot }) => {
    const candidates = [
      path.join(ROOT, 'public', 'posts', 'output', `${slot}-instagram.png`),
      path.join(ROOT, 'posts', 'output', `${slot}-instagram.png`),
      path.join(ROOT, 'public', 'posts', 'output', `${slot}-bluesky.jpg`),
    ]
    const src = candidates.find(p => fs.existsSync(p))
    if (!src) {
      return { content: [{ type: 'text', text: `NO_IMAGE` }] }
    }

    // Resize to 400px wide using sips (macOS built-in) for fast transfer
    const tmpOut = path.join(require('os').tmpdir(), `bsv-preview-${slot}.jpg`)
    try {
      execSync(`sips -s format jpeg -s formatOptions 75 --resampleWidth 400 "${src}" --out "${tmpOut}"`, {
        stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
      })
      const data = fs.readFileSync(tmpOut)
      fs.unlinkSync(tmpOut)
      return { content: [{ type: 'text', text: `data:image/jpeg;base64,${data.toString('base64')}` }] }
    } catch {
      // sips failed — fall back to raw base64 of bluesky jpg if available
      const jpg = candidates[2]
      if (fs.existsSync(jpg)) {
        const data = fs.readFileSync(jpg)
        return { content: [{ type: 'text', text: `data:image/jpeg;base64,${data.toString('base64')}` }] }
      }
      return { content: [{ type: 'text', text: `NO_IMAGE` }] }
    }
  }
)

// ── get_slot_brief ────────────────────────────────────────────────────────────
server.tool(
  'get_slot_brief',
  'Get the caption/brief content for a slot. Reads from posts/briefs/{slot}-brief.txt or ~/tmp/bsv-ready/{slot}.md.',
  {
    slot: z.string().describe('Slot name, e.g. fri-am, mon-pm'),
  },
  async ({ slot }) => {
    const briefPath  = path.join(ROOT, 'posts', 'briefs', `${slot}-brief.txt`)
    const captionPath = path.join(process.env.HOME || '', 'tmp', 'bsv-ready', `${slot}.md`)

    if (fs.existsSync(briefPath)) {
      const text = fs.readFileSync(briefPath, 'utf8')
      return { content: [{ type: 'text', text: text }] }
    }
    if (fs.existsSync(captionPath)) {
      const text = fs.readFileSync(captionPath, 'utf8')
      return { content: [{ type: 'text', text: text }] }
    }
    return { content: [{ type: 'text', text: `No brief found for slot "${slot}".` }] }
  }
)

// ── clear_drive_slot ──────────────────────────────────────────────────────────
server.tool(
  'clear_drive_slot',
  'Remove a slot\'s files from Drive "Ready to Post/" so watch-drive stops re-queuing old content. Also clears the slot and its -flow variant from pipeline state.',
  {
    slot: z.string().describe('Slot name, e.g. fri-am, wed-pm'),
  },
  async ({ slot }) => {
    const REMOTE = 'big sole vibes:Big Sole Vibes/Ready to Post'
    const msgs = []

    // Clear Drive files matching slot* and slot-flow*
    try {
      execSync(
        `rclone delete "${REMOTE}" --include "${slot}.*" --include "${slot}-flow.*" --include "${slot}-*prompt*"`,
        { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
      )
      msgs.push(`Drive: cleared "${slot}*" from Ready to Post/`)
    } catch (e) {
      msgs.push(`Drive warning: ${e.stderr?.toString().trim() || e.message}`)
    }

    // Clear from pipeline state
    const state = readState()
    const cleared = []
    for (const key of [slot, `${slot}-flow`]) {
      if (state[key]) { delete state[key]; cleared.push(key) }
    }
    if (cleared.length) {
      writeState(state)
      msgs.push(`Pipeline: cleared ${cleared.join(', ')}`)
    } else {
      msgs.push('Pipeline: slot not in state (already clear)')
    }

    return { content: [{ type: 'text', text: msgs.join('\n') }] }
  }
)

// ── run_media_director ────────────────────────────────────────────────────────
server.tool(
  'run_media_director',
  'Regenerate content briefs and images for a given day using the shelf product rotation. Fires media-director.js --day {day} and returns immediately — check pipeline state in ~2 minutes.',
  {
    day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).describe('Day to regenerate, e.g. wed'),
  },
  async ({ day }) => {
    const script = path.join(ROOT, 'scripts', 'media-director.js')
    const child = spawn(process.execPath, [script, '--day', day], {
      cwd: ROOT,
      env: { ...process.env },
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return {
      content: [{
        type: 'text',
        text: `✓ media-director started for ${day}.\nBriefs + images generating now — takes ~2 minutes.\nRefresh the dashboard to see new slots appear.`,
      }],
    }
  }
)

// ── run_video_gen ─────────────────────────────────────────────────────────────
server.tool(
  'run_video_gen',
  "Generates real Veo videos from any *-flow-prompt.txt files currently sitting in Drive's Ready to Post folder. This spends real money (Veo 3.1 Fast ≈ $0.15/sec of generated clip) — check get_cost_state for current balance before running if cost matters. Output is staged to Drive's Video Review folder and is NEVER auto-posted; a Telegram alert fires asking Big D to reply approve/deny. Fires video-gen.js in the background and returns immediately — check progress with read_log (agent: 'video-gen') after a minute or two, since each clip takes roughly 1-3 minutes to render.",
  {},
  async () => {
    const script = path.join(ROOT, 'scripts', 'video-gen.js')
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env },
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return {
      content: [{
        type: 'text',
        text: `✓ video-gen started — generating real Veo video(s) now (~1-3 min per clip).\nOutput lands in Drive's Video Review folder, gated behind Big D's approval — never auto-posted.\nCheck back shortly with read_log agent="video-gen".`,
      }],
    }
  }
)

// ── run_edition_agent ─────────────────────────────────────────────────────────
server.tool(
  'run_edition_agent',
  'Generate a new monthly BSV edition (J. Peterman-style story + product vignettes). Uploads draft to Drive for review. Use approve_edition to publish once Big D approves.',
  {
    dry_run: z.boolean().default(false).describe('Preview output without saving to Drive or state files'),
    force:   z.boolean().default(false).describe('Re-run even if an edition was generated in the last 30 days'),
    products: z.string().optional().describe('Comma-separated product names to feature (overrides automatic selection)'),
  },
  async ({ dry_run, force, products }) => {
    const script = path.join(ROOT, 'scripts', 'edition-agent.js')
    const args   = [script]
    if (dry_run)  args.push('--dry-run')
    if (force)    args.push('--force')
    if (products) args.push('--products', products)

    const child = spawn(process.execPath, args, {
      cwd:      ROOT,
      env:      { ...process.env },
      detached: true,
      stdio:    'ignore',
    })
    child.unref()

    const mode = dry_run ? 'dry-run (no files saved)' : 'full run — uploading draft to Drive'
    return {
      content: [{
        type: 'text',
        text: `✓ edition-agent started (${mode}).\nGenerating story + vignettes via Claude — takes ~60–90 seconds.\nCheck logs/edition-agent.log for progress.\nDraft will appear in Drive › Big Sole Vibes › Editions when done.`,
      }],
    }
  }
)

// ── approve_edition ───────────────────────────────────────────────────────────
server.tool(
  'approve_edition',
  'Approve the current edition draft and publish it to The Lounge. Pushes public/the-lounge/edition-N-MONTH.html to preview/full-site and saves the Lounge URL so social posts CTA to the story.',
  {},
  async () => {
    const stateFile = path.join(ROOT, 'logs', 'edition-state.json')
    let state
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    } catch {
      return { content: [{ type: 'text', text: '✗ No edition state found. Run run_edition_agent first.' }] }
    }

    if (!state.editionNumber) {
      return { content: [{ type: 'text', text: '✗ Edition state exists but has no editionNumber — re-run edition-agent.' }] }
    }

    if (state.approved) {
      return {
        content: [{
          type: 'text',
          text: `Edition #${state.editionNumber} (${state.monthYear}) is already approved.\nLounge URL: ${state.loungeUrl || '(not yet published)'}`,
        }],
      }
    }

    const script = path.join(ROOT, 'scripts', 'edition-agent.js')
    const child  = spawn(process.execPath, [script, '--approve'], {
      cwd:      ROOT,
      env:      { ...process.env },
      detached: true,
      stdio:    'ignore',
    })
    child.unref()

    return {
      content: [{
        type: 'text',
        text: `✓ Approving Edition #${state.editionNumber} (${state.monthYear || ''}).\nPublishing to The Lounge now — takes ~15 seconds.\nCheck logs/edition-agent.log to confirm the push.\nOnce done, social vignettes will CTA to the edition story page.`,
      }],
    }
  }
)

// ── install_edition_schedule ──────────────────────────────────────────────────
server.tool(
  'install_edition_schedule',
  'One-time setup: install the launchd plist so edition-agent runs automatically on the 1st of each month at 6am. Safe to call multiple times.',
  {},
  async () => {
    const plist  = path.join(ROOT, 'config', 'com.bsv.edition-agent.plist')
    const dest   = path.join(process.env.HOME, 'Library', 'LaunchAgents', 'com.bsv.edition-agent.plist')

    if (!fs.existsSync(plist)) {
      return { content: [{ type: 'text', text: `✗ Plist not found at ${plist} — make sure config/com.bsv.edition-agent.plist exists.` }] }
    }

    try {
      fs.copyFileSync(plist, dest)
    } catch (e) {
      return { content: [{ type: 'text', text: `✗ Copy failed: ${e.message}` }] }
    }

    // Unload first (silently) in case it was already loaded, then reload
    sh(`launchctl unload "${dest}" 2>/dev/null || true`)
    const loadResult = sh(`launchctl load "${dest}"`)

    const status = sh(`launchctl list | grep com.bsv.edition-agent`)

    return {
      content: [{
        type: 'text',
        text: [
          `✓ Edition schedule installed.`,
          `Plist: ${dest}`,
          `Runs: 1st of each month at 6:00 AM`,
          loadResult ? `launchctl: ${loadResult}` : null,
          status ? `Status: ${status}` : null,
        ].filter(Boolean).join('\n'),
      }],
    }
  }
)

// ── add_product_to_queue ──────────────────────────────────────────────────────
server.tool(
  'add_product_to_queue',
  'Big D quick-add: submit a product you discovered yourself. Runs a full Track 2 evaluation (web search + scoring) and writes approved picks to the product sheet as "Big D Pick". Use for products found organically — no terminal required.',
  {
    product_name: z.string().describe('Full product name and brand, e.g. "Gehwol Fusskraft Blue" or "Dr. Bronner\'s Hemp Tea Tree Soap"'),
    asin: z.string().optional().describe('Amazon ASIN if you have it — e.g. B0012ABCDE. Leave blank and research will find it.'),
    signal: z.string().optional().describe('Why you think it belongs — e.g. "saw it at the barber", "wife uses it, works great", "spotted on GMA". Helps the curator score crossover proof.'),
    dry_run: z.boolean().default(false).describe('Preview evaluation without writing to sheet'),
  },
  async ({ product_name, asin, signal, dry_run }) => {
    const script = path.join(ROOT, 'scripts', 'product-research.js')
    const args   = [script, '--track2', '--product', product_name]

    if (asin)    args.push('--asin', asin)
    if (signal)  args.push('--signal', `Big D Pick: ${signal}`)
    if (dry_run) args.push('--dry-run')

    // If no ASIN supplied, use a placeholder — research will search for it
    if (!asin) args.push('--asin', 'LOOKUP')

    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env },
      detached: true,
      stdio: 'ignore',
    })
    child.unref()

    const mode = dry_run ? 'dry-run preview' : 'full evaluation + sheet write'
    return {
      content: [{
        type: 'text',
        text: `✓ "${product_name}" submitted for evaluation (${mode}).\n${asin ? `ASIN: ${asin}` : 'ASIN: research will look it up'}\n${signal ? `Signal: ${signal}` : ''}\n\nCheck logs/product-research.log in ~60 seconds for results.`,
      }],
    }
  }
)

// ── run_sync_shop ─────────────────────────────────────────────────────────────
server.tool(
  'run_sync_shop',
  'Rebuild public/shop/index.html from the Google Sheet and push to preview/full-site. Returns immediately — the push takes ~10 seconds.',
  {},
  async () => {
    const script = path.join(ROOT, 'scripts', 'sync-shop.js')
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      env: { ...process.env },
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return {
      content: [{
        type: 'text',
        text: '✓ sync-shop launched. Check logs/sync-shop.log in ~15 seconds to confirm the push.',
      }],
    }
  }
)

// ── commit_changes ────────────────────────────────────────────────────────────
server.tool(
  'commit_changes',
  'Stage files and commit to the current branch (preview/full-site) on the local machine. Clears any stale git lock files first so sandbox-written commits never leave orphaned locks. Optionally pushes after committing. Use force_push to rewrite history on preview/full-site (never use on main).',
  {
    files:       z.array(z.string()).describe('File paths to stage, relative to repo root (e.g. ["scripts/foo.js", "scripts/bar.js"]). Pass ["--all"] to stage all tracked changes.'),
    message:     z.string().describe('Commit message'),
    push:        z.boolean().default(false).describe('Push to origin after committing (default false)'),
    force_push:  z.boolean().default(false).describe('Force-push with --force-with-lease after committing. Safe on preview/full-site — NEVER use on main.'),
  },
  async ({ files, message, push, force_push }) => {
    const msgs = []

    // Guard: refuse force-push on main
    const branch = sh('git rev-parse --abbrev-ref HEAD').trim()
    if (force_push && branch === 'main') {
      return { content: [{ type: 'text', text: '❌ force_push is blocked on main. Promote to main manually.' }] }
    }

    // Clear stale lock files left by sandbox git processes
    for (const lock of ['HEAD.lock', 'index.lock']) {
      const p = path.join(ROOT, '.git', lock)
      if (fs.existsSync(p)) {
        try { fs.rmSync(p); msgs.push(`Cleared stale ${lock}`) } catch (e) { msgs.push(`Warning: could not clear ${lock}: ${e.message}`) }
      }
    }

    // Stage
    if (files.length === 1 && files[0] === '--all') {
      sh('git add -u')
      msgs.push('Staged: all tracked changes')
    } else {
      const quoted = files.map(f => `"${f}"`).join(' ')
      sh(`git add ${quoted}`)
      msgs.push(`Staged: ${files.join(', ')}`)
    }

    // Commit — use spawnSync so exit code is reliable independent of stderr content
    const commitResult = spawnSync('git', ['commit', '-m', message], {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (commitResult.status !== 0) {
      const err = (commitResult.stderr || commitResult.stdout || '').trim()
      return { content: [{ type: 'text', text: `❌ Commit failed:\n${err}\n\n${msgs.join('\n')}` }] }
    }
    msgs.push(`Committed: ${(commitResult.stdout || '').split('\n')[0].trim()}`)

    // Push (normal or force)
    if (force_push) {
      const pushResult = sh(`git push --force-with-lease origin ${branch}`)
      msgs.push(`Force-pushed (--force-with-lease): ${pushResult.trim() || 'ok'}`)
    } else if (push) {
      const pushResult = sh('git push')
      msgs.push(`Push: ${pushResult.split('\n')[0]}`)
    }

    return { content: [{ type: 'text', text: msgs.join('\n') }] }
  }
)

// ── drop_last_commit ─────────────────────────────────────────────────────────
// Drops the most recent commit from preview/full-site and force-pushes.
// Use to remove no-op or accidental commits that are already on origin.
// Blocked on main — always.
server.tool(
  'drop_last_commit',
  'Drop the most recent commit from preview/full-site with git reset --soft HEAD~1 then force-push. Use to clean up no-op or accidental commits already pushed to origin. Blocked on main.',
  {
    confirm: z.literal('yes').describe('Must be "yes" to proceed — prevents accidental calls'),
  },
  async ({ confirm }) => {
    if (confirm !== 'yes') return { content: [{ type: 'text', text: '❌ confirm must be "yes".' }] }

    const branch = sh('git rev-parse --abbrev-ref HEAD').trim()
    if (branch === 'main') return { content: [{ type: 'text', text: '❌ Blocked on main. Never.' }] }

    const before = sh('git log --oneline -2').trim()
    sh('git reset --soft HEAD~1')
    const result = sh(`git push --force-with-lease origin ${branch}`)
    const after  = sh('git log --oneline -1').trim()

    return {
      content: [{
        type: 'text',
        text: [
          `✓ Dropped last commit and force-pushed to ${branch}`,
          `Before:\n${before}`,
          `After HEAD: ${after}`,
          result.trim() ? `Push output: ${result.trim()}` : null,
        ].filter(Boolean).join('\n'),
      }],
    }
  }
)

// ── push_to_main ───────────────────────────────────────────────────────────────
// Promotes preview/full-site to main, triggering the live Cloudflare Pages
// production deploy at bigsolevibes.com. CLAUDE.md reserves this action for
// Big D — this tool exists so he can direct it through conversation instead
// of running `node scripts/push-to-main.js` by hand every time, but the gate
// is the same: only call this when Big D has explicitly said, in the current
// conversation, to push/promote to main right now. Never call this
// proactively, speculatively, or as part of any pipeline/automation script.
//
// Never force — this pushes origin/preview/full-site straight onto
// refs/heads/main as a normal (non-force) ref update. No --force flag exists
// on this tool, intentionally: git itself refuses the update if main has
// diverged from preview/full-site, so nothing is ever overwritten.
server.tool(
  'push_to_main',
  'Promote preview/full-site to main, triggering the live Cloudflare Pages production deploy. ONLY call when Big D has explicitly told you, in the current conversation, to push/promote to main right now — never proactively or automatically. Never force-pushes; git rejects the update if main has diverged from preview/full-site, so nothing is ever overwritten.',
  {
    confirm: z.literal('yes').describe('Must be "yes" — set this only because Big D explicitly said, in this conversation, to push to main now. Not speculative.'),
  },
  async ({ confirm }) => {
    if (confirm !== 'yes') return { content: [{ type: 'text', text: '❌ confirm must be "yes".' }] }

    sh('git fetch origin main preview/full-site')

    const beforeMain = sh('git rev-parse origin/main').trim()
    const previewTip = sh('git rev-parse origin/preview/full-site').trim()

    if (beforeMain === previewTip) {
      return { content: [{ type: 'text', text: `ℹ️ main is already up to date with preview/full-site (${beforeMain.slice(0, 8)}). Nothing to push.` }] }
    }

    const isFastForward = spawnSync('git', ['merge-base', '--is-ancestor', beforeMain, previewTip], { cwd: ROOT }).status === 0
    if (!isFastForward) {
      return {
        content: [{
          type: 'text',
          text: `❌ Refusing: main (${beforeMain.slice(0, 8)}) is not an ancestor of preview/full-site (${previewTip.slice(0, 8)}) — main has commits that aren't on preview/full-site. This would require a force-push, which this tool will never do. Needs manual review.`,
        }],
      }
    }

    const result = sh('git push origin origin/preview/full-site:refs/heads/main')
    const afterMain = sh('git rev-parse origin/main').trim()

    return {
      content: [{
        type: 'text',
        text: [
          `✓ main updated — Cloudflare production deploy triggered`,
          `Before: ${beforeMain.slice(0, 8)}`,
          `After:  ${afterMain.slice(0, 8)}`,
          result.trim() ? `Push output: ${result.trim()}` : null,
        ].filter(Boolean).join('\n'),
      }],
    }
  }
)

// ── tiktok_token_exchange ───────────────────────────────────────────────────────
// Runs the TikTok OAuth code-exchange step on Big D's real machine so he
// doesn't have to open Terminal and fight shell quoting — TikTok codes
// contain `!` and `*`, which zsh mangles even inside double quotes. The code
// is passed as a real argv element via spawnSync (never built into a shell
// string), so no quoting/escaping issue can occur regardless of what
// characters the code contains. Runs the same script Big D would run by
// hand: scripts/tiktok-auth.js --code <code>.
server.tool(
  'tiktok_token_exchange',
  "Exchange a TikTok OAuth authorization code for tokens by running scripts/tiktok-auth.js on Big D's machine, so he doesn't have to paste shell commands himself. Codes are single-use and expire fast — call this immediately once Big D shares the code from the callback page.",
  {
    code: z.string().min(1).describe('The raw authorization code from the TikTok callback page — paste exactly as shown, no quoting needed.'),
  },
  async ({ code }) => {
    const result = spawnSync('node', ['scripts/tiktok-auth.js', '--code', code], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
    })
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    if (result.status !== 0) {
      return { content: [{ type: 'text', text: `❌ Exchange failed:\n${out || '(no output)'}` }] }
    }
    return { content: [{ type: 'text', text: `✓ Exchange succeeded:\n${out}` }] }
  }
)

// ── youtube_token_check ───────────────────────────────────────────────────────
// Read-only diagnostic: tests the existing YOUTUBE_REFRESH_TOKEN with a live
// refresh grant against Google's OAuth endpoint. Reports only boolean
// validity + scope/expiry — never echoes back the token, client secret, or
// access token. Runs on Big D's real machine, which has network access to
// oauth2.googleapis.com (the sandbox does not — DNS fails there).
server.tool(
  'youtube_token_check',
  "Tests whether the YOUTUBE_REFRESH_TOKEN in .env still works, without ever printing the token value. Use this BEFORE running youtube_reauth — if the existing token is still valid, no re-auth flow (browser consent, new credentials) is needed at all.",
  {},
  async () => {
    const clientId     = process.env.YOUTUBE_CLIENT_ID
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN

    if (!clientId || !clientSecret || !refreshToken) {
      return { content: [{ type: 'text', text: '❌ One or more of YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN is missing from .env.' }] }
    }

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      })
      const data = await res.json()

      if (!res.ok || !data.access_token) {
        return {
          content: [{
            type: 'text',
            text: `❌ Refresh token is NOT valid — re-auth needed.\nHTTP ${res.status} · ${data.error || 'unknown error'}: ${data.error_description || '(no description)'}`,
          }],
        }
      }

      return {
        content: [{
          type: 'text',
          text: `✓ Refresh token is still valid — no re-auth needed.\nscope: ${data.scope || '(not returned)'}\nnew access_token expires_in: ${data.expires_in}s`,
        }],
      }
    } catch (e) {
      return { content: [{ type: 'text', text: `❌ Network error reaching Google's OAuth endpoint: ${e.message}` }] }
    }
  }
)

// ── youtube_reauth ─────────────────────────────────────────────────────────────
// Runs the full YouTube OAuth flow on Big D's real machine. Unlike TikTok,
// Google supports a localhost redirect, so scripts/youtube-auth.js opens the
// browser AND auto-catches the callback itself — Big D only has to click
// "Allow" once, no code to copy/paste. The script prints the resulting
// YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN to stdout;
// rather than relay those secret values back through this tool's response
// (which would put them in chat), this tool captures them and writes them to
// a local-only gitignored file for Big D to copy into .env himself, since
// .env must never be written by Claude. Blocks (synchronously) for up to 3
// minutes while waiting for the browser-consent click.
server.tool(
  'youtube_reauth',
  "Runs the YouTube OAuth re-auth flow on Big D's machine — opens his browser for Google consent automatically and catches the callback locally, no code paste needed. Tell Big D to watch for the browser tab and click Allow; this call blocks until that happens (up to 3 min) or times out. New credentials are written to a local file, never printed back through chat.",
  {},
  async () => {
    const script = path.join(ROOT, 'scripts', 'youtube-auth.js')
    const result = spawnSync(process.execPath, [script], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000,
    })
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.status !== 0) {
      const safeOut = out.replace(/YOUTUBE_(CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN)\s*=.*/g, 'YOUTUBE_$1=<redacted>')
      return { content: [{ type: 'text', text: `❌ Re-auth failed or timed out before Big D approved:\n${safeOut.slice(-1500)}` }] }
    }

    const credLines = out.split('\n').filter(l => /YOUTUBE_(CLIENT_ID|CLIENT_SECRET|REFRESH_TOKEN)\s*=/.test(l))
    if (credLines.length === 0) {
      return { content: [{ type: 'text', text: `⚠ Flow exited cleanly but no credential lines were found in its output — check it manually.` }] }
    }

    const outFile = path.join(ROOT, 'config', '.youtube-new-credentials.txt')
    fs.writeFileSync(outFile, credLines.join('\n') + '\n', { mode: 0o600 })

    return {
      content: [{
        type: 'text',
        text: `✓ YouTube re-authorized.\nNew credentials written to config/.youtube-new-credentials.txt (gitignored, not shown here).\nOpen that file yourself, copy the 3 values into .env, then delete the file.`,
      }],
    }
  }
)

// ── run_product_research ──────────────────────────────────────────────────────
server.tool(
  'run_product_research',
  'Run a full product research cycle — web searches, scoring, writes approved picks to the Google Sheet. Takes 3–5 minutes. Returns immediately; check logs/product-research.log for progress.',
  {
    skip_research: z.boolean().default(false).describe('Skip web search phase and re-score existing candidates only'),
    dry_run:       z.boolean().default(false).describe('Preview picks without writing to the sheet'),
  },
  async ({ skip_research, dry_run }) => {
    const script = path.join(ROOT, 'scripts', 'product-research.js')
    const args   = [script]
    if (skip_research) args.push('--skip-research')
    if (dry_run)       args.push('--dry-run')

    const child = spawn(process.execPath, args, {
      cwd:      ROOT,
      env:      { ...process.env },
      detached: true,
      stdio:    'ignore',
    })
    child.unref()

    const mode = dry_run ? 'dry-run (no sheet write)' : 'full run — writing to product sheet'
    return {
      content: [{
        type: 'text',
        text: `✓ product-research started (${mode}).\nSearching web + scoring products now — takes 3–5 minutes.\nCheck logs/product-research.log for progress.\nApproved picks will appear in the Google Sheet product queue when done.`,
      }],
    }
  }
)

// ── reject_pending_products ────────────────────────────────────────────────────
// Added 2026-07-10 per Big D: the product queue's Pending backlog had grown
// into a long list that mostly wasn't meeting the shelf standard. Mirrors the
// existing --clear-approved pattern in product-research.js/sheets-client.js —
// flips every Pending row to Rejected, no new write. Runs in the foreground
// (not detached) since it's a quick single Sheets batchUpdate, not a research
// cycle.
server.tool(
  'reject_pending_products',
  "Reject every product currently in 'Pending' status on the product queue sheet (sets Status to Rejected). Use to clear a stale/oversized backlog. Does not touch Approved or Archived rows.",
  {},
  async () => {
    const script = path.join(ROOT, 'scripts', 'product-research.js')
    const result = spawnSync(process.execPath, [script, '--reject-pending'], {
      cwd: ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 60000,
    })
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    return { content: [{ type: 'text', text: out || '(no output)' }] }
  }
)

// ── install_product_research_schedule ─────────────────────────────────────────
server.tool(
  'install_product_research_schedule',
  'One-time setup: install the launchd plist so product-research runs automatically every Saturday at 11pm. Safe to call multiple times.',
  {},
  async () => {
    const plist = path.join(ROOT, 'config', 'com.bsv.product-research.plist')
    const dest  = path.join(process.env.HOME, 'Library', 'LaunchAgents', 'com.bsv.product-research.plist')

    if (!fs.existsSync(plist)) {
      return { content: [{ type: 'text', text: `✗ Plist not found at ${plist} — make sure config/com.bsv.product-research.plist exists.` }] }
    }

    try { fs.copyFileSync(plist, dest) } catch (e) {
      return { content: [{ type: 'text', text: `✗ Copy failed: ${e.message}` }] }
    }

    sh(`launchctl unload "${dest}" 2>/dev/null || true`)
    const loadResult = sh(`launchctl load "${dest}"`)
    const status     = sh(`launchctl list | grep com.bsv.product-research`)

    return {
      content: [{
        type: 'text',
        text: [
          `✓ Product research schedule installed.`,
          `Plist: ${dest}`,
          `Runs: Every Saturday at 11:00 PM`,
          loadResult ? `launchctl: ${loadResult}` : null,
          status     ? `Status: ${status}` : null,
        ].filter(Boolean).join('\n'),
      }],
    }
  }
)

// ── install_health_check_schedule ──────────────────────────────────────────────
// Added 2026-07-16 per Big D: "we need to make the dashboard live...i cant be
// looking at 8 hour old data." Installs health-check.js (local log scanning
// only, no API calls) on a 5-minute interval so logs/org-chart-state.json —
// what the dashboard's Blockers panel and public/org-chart.html both read —
// stops being an artifact of chief-of-staff.js's single once-a-day run.
server.tool(
  'install_health_check_schedule',
  'One-time setup: install the launchd plist so health-check.js refreshes agent status (org-chart-state.json + org-chart.html) every 5 minutes, instead of only once a day via chief-of-staff. Safe to call multiple times.',
  {},
  async () => {
    const plist = path.join(ROOT, 'config', 'com.bsv.health-check.plist')
    const dest  = path.join(process.env.HOME, 'Library', 'LaunchAgents', 'com.bsv.health-check.plist')

    if (!fs.existsSync(plist)) {
      return { content: [{ type: 'text', text: `✗ Plist not found at ${plist} — make sure config/com.bsv.health-check.plist exists.` }] }
    }

    try { fs.copyFileSync(plist, dest) } catch (e) {
      return { content: [{ type: 'text', text: `✗ Copy failed: ${e.message}` }] }
    }

    sh(`launchctl unload "${dest}" 2>/dev/null || true`)
    const loadResult = sh(`launchctl load "${dest}"`)
    const status     = sh(`launchctl list | grep com.bsv.health-check`)

    return {
      content: [{
        type: 'text',
        text: [
          `✓ Health-check schedule installed.`,
          `Plist: ${dest}`,
          `Runs: every 5 minutes (RunAtLoad — first refresh happens immediately)`,
          loadResult ? `launchctl: ${loadResult}` : null,
          status     ? `Status: ${status}` : null,
        ].filter(Boolean).join('\n'),
      }],
    }
  }
)

// ── get_research_summary ──────────────────────────────────────────────────────
server.tool(
  'get_research_summary',
  'Get the latest product research summary for standup. Reads logs/product-research-state.json — written automatically at end of each product-research run.',
  {},
  async () => {
    const stateFile = path.join(ROOT, 'logs', 'product-research-state.json')
    if (!fs.existsSync(stateFile)) {
      return { content: [{ type: 'text', text: '⚠ No research state found. Run product-research first (run_product_research tool or wait for Saturday night schedule).' }] }
    }

    let state
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    } catch (e) {
      return { content: [{ type: 'text', text: `✗ Could not read state file: ${e.message}` }] }
    }

    const lines = [
      `**Product Research** — Last run: ${state.last_run}`,
      `New picks queued: ${state.new_picks}`,
    ]

    if (state.picks?.length) {
      lines.push('\nPicks added this cycle:')
      state.picks.forEach(p => lines.push(`  • ${p.name} (${p.asin}) — ${p.category}, ${p.score}, ${p.price}`))
    } else {
      lines.push('\nNo new picks this cycle.')
    }

    if (state.shelf_gaps_raw) {
      lines.push('\nShelf gaps:')
      lines.push(state.shelf_gaps_raw.split('\n').slice(0, 6).join('\n'))
    }

    if (state.held_back_raw) {
      lines.push('\nHeld back (near-misses for next cycle):')
      lines.push(state.held_back_raw.split('\n').slice(0, 6).join('\n'))
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
)

// ─── Auto-restart on file change ─────────────────────────────────────────────
// When mcp-server.js is saved, exit cleanly so the MCP host relaunches with
// the updated tool list. No manual restart needed after adding new tools.
{
  let restartTimer
  fs.watch(__filename, () => {
    clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      console.error('[bsv-mcp] File changed — exiting for host restart…')
      process.exit(0)
    }, 500)
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
server.connect(transport).catch(err => {
  console.error('[bsv-mcp] Fatal:', err)
  process.exit(1)
})
