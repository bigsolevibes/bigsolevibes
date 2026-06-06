require('dotenv').config()
const { McpServer }               = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport }    = require('@modelcontextprotocol/sdk/server/stdio.js')
const { execSync, spawnSync }     = require('child_process')
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
    const result = spawnSync(process.execPath, [scriptPath, '--dry-run'], {
      cwd: ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 30000,
    })
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    return { content: [{ type: 'text', text: out || '(no output)' }] }
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

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
server.connect(transport).catch(err => {
  console.error('[bsv-mcp] Fatal:', err)
  process.exit(1)
})
