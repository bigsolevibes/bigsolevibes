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
server.tool(
  'get_incident_status',
  'Get current pipeline incident status — blockers, warnings, and resolved issues from eng-bot.',
  {},
  async () => {
    try {
      const seenPath = path.join(LOGS_DIR, 'eng-seen.json')
      const seen     = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : {}
      const now      = Date.now()
      const blockers = []
      const warnings = []
      const resolved = []

      for (const [key, entry] of Object.entries(seen)) {
        const age = Math.round((now - new Date(entry.ts).getTime()) / 60000)
        const line = `  [${entry.level || 'warning'}] ${entry.agent}: ${entry.msg} (${age}m ago)`
        if (entry.resolved) resolved.push(line)
        else if (entry.level === 'blocker') blockers.push(line)
        else warnings.push(line)
      }

      const text = [
        `${blockers.length} blocker(s)  ${warnings.length} warning(s)  ${resolved.length} resolved`,
        ...blockers,
        ...warnings,
        ...(resolved.length ? ['', '  resolved:'] : []),
        ...resolved,
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
  'Deny a content slot — removes from approved-slots.json and clears pipeline state so it can be re-uploaded.',
  {
    slot:   z.string().describe('Slot name, e.g. fri-am, mon-pm'),
    reason: z.string().optional().describe('Optional reason for denial'),
  },
  async ({ slot, reason }) => {
    // Remove from approved-slots
    const filePath = path.join(LOGS_DIR, 'approved-slots.json')
    let existing = {}
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch {}
    delete existing[slot]
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))

    // Clear from pipeline state
    const state = readState()
    const cleared = !!state[slot]
    delete state[slot]
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
  'Stage files and commit to the current branch (preview/full-site) on the local machine. Clears any stale git lock files first so sandbox-written commits never leave orphaned locks. Optionally pushes after committing.',
  {
    files:   z.array(z.string()).describe('File paths to stage, relative to repo root (e.g. ["scripts/foo.js", "scripts/bar.js"]). Pass ["--all"] to stage all tracked changes.'),
    message: z.string().describe('Commit message'),
    push:    z.boolean().default(false).describe('Push to origin after committing (default false)'),
  },
  async ({ files, message, push }) => {
    const msgs = []

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

    // Optional push
    if (push) {
      const pushResult = sh('git push')
      msgs.push(`Push: ${pushResult.split('\n')[0]}`)
    }

    return { content: [{ type: 'text', text: msgs.join('\n') }] }
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
