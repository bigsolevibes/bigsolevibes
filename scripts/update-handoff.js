require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT        = path.join(__dirname, '..')
const LOG_FILE    = path.join(ROOT, 'logs', 'update-handoff.log')
const TEMP_DIR    = path.join(os.homedir(), 'tmp', 'bsv-handoff')
const REMOTE_HANDOFF = 'big sole vibes:Big Sole Vibes/Handoff'
const REMOTE      = 'big sole vibes:Big Sole Vibes'

const today = new Date()
const dateStamp = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
const HANDOFF_FILE = `BSV-Handoff-${dateStamp}.md`

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Drive context loaders ────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

function loadMemory() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Memory.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Memory.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

// ─── Project state collectors ─────────────────────────────────────────────────

function getEnvKeyNames() {
  try {
    const content = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    return content
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split('=')[0].trim())
      .filter(Boolean)
  } catch { return [] }
}

async function checkMetaTokenExpiry() {
  try {
    const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    const get = key => { const m = envContent.match(new RegExp(`^${key}=(.+)$`, 'm')); return m ? m[1].trim() : null }
    const token    = get('META_ACCESS_TOKEN')
    const appId    = get('META_APP_ID')
    const appSecret = get('META_APP_SECRET')
    if (!token || !appId || !appSecret) return null

    const appToken = `${appId}|${appSecret}`
    const res = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${encodeURIComponent(appToken)}`)
    const data = await res.json()
    if (!res.ok || data.error) return null

    const expiresAt = data.data?.expires_at
    if (!expiresAt || expiresAt === 0) return { neverExpires: true }

    const expiresMs = expiresAt * 1000
    const daysLeft = Math.floor((expiresMs - Date.now()) / (1000 * 60 * 60 * 24))
    return { daysLeft, expiresAt: new Date(expiresMs).toISOString() }
  } catch { return null }
}

function getRecentLogs(n = 30) {
  try {
    const content = fs.readFileSync(path.join(ROOT, 'logs', 'watch-drive.log'), 'utf8')
    const lines = content.trim().split('\n')
    // Cap each line to 200 chars to guard against log flooding artifacts
    return lines.slice(-n).map(l => l.slice(0, 200)).join('\n')
  } catch { return '(no log file found)' }
}

function getPipelineState() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'logs', 'watch-drive-state.json'), 'utf8')
    return JSON.parse(raw)
  } catch { return { distributed: [] } }
}

function getOutputFiles() {
  try {
    return fs.readdirSync(path.join(ROOT, 'posts', 'output'))
      .filter(f => !f.startsWith('.'))
      .sort()
  } catch { return [] }
}

function getContentFiles() {
  try {
    const dir = path.join(ROOT, 'content')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort()
  } catch { return [] }
}

function getGitLog() {
  try {
    return execSync('git log --oneline -10', { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch { return '(git log unavailable)' }
}

function getDriveStructure() {
  try {
    return execSync('rclone lsd "big sole vibes:Big Sole Vibes"', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim()
  } catch { return '(rclone unavailable)' }
}

function getLatestBrandHealth() {
  const REMOTE = 'big sole vibes:Big Sole Vibes'
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^brand-health-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, latest)
    if (!fs.existsSync(p)) return null
    // Extract only the ## Growth Metrics section (first ~25 lines)
    const content = fs.readFileSync(p, 'utf8')
    const metricsStart = content.indexOf('## Growth Metrics')
    if (metricsStart === -1) return { filename: latest, metrics: null }
    const metricsEnd = content.indexOf('\n## ', metricsStart + 1)
    const metrics = metricsEnd !== -1
      ? content.slice(metricsStart, metricsEnd).trim()
      : content.slice(metricsStart, metricsStart + 600).trim()
    return { filename: latest, metrics }
  } catch { return null }
}

function getHandoffFindings() {
  try {
    const p = path.join(ROOT, 'logs', 'handoff-findings.md')
    if (!fs.existsSync(p)) return null
    const content = fs.readFileSync(p, 'utf8').trim()
    return content || null
  } catch { return null }
}

function clearHandoffFindings() {
  try {
    const p = path.join(ROOT, 'logs', 'handoff-findings.md')
    if (fs.existsSync(p)) fs.writeFileSync(p, '')
  } catch {}
}

function getExistingHandoff() {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    // Find the most recent dated handoff on Drive
    const listing = execSync(`rclone ls "${REMOTE_HANDOFF}"`, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] })
    const files = listing.trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => /^BSV-Handoff-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    execSync(`rclone copy "${REMOTE_HANDOFF}/${latest}" "${TEMP_DIR}/"`, { stdio: ['pipe','pipe','pipe'] })
    const localPath = path.join(TEMP_DIR, latest)
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf8')
  } catch {}
  return null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ update-handoff start ━━━')

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)
  log('Loading memory...')
  const memory = loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log('ERROR: ANTHROPIC_API_KEY not set in .env')
    process.exit(1)
  }

  // Collect state
  log('Collecting project state...')
  const envKeys         = getEnvKeyNames()
  const recentLogs      = getRecentLogs(30)
  const pipelineState   = getPipelineState()
  const outputFiles     = getOutputFiles()
  const contentFiles    = getContentFiles()
  const gitLog          = getGitLog()
  const driveStructure  = getDriveStructure()
  const existingHandoff = getExistingHandoff()
  const tokenExpiry     = await checkMetaTokenExpiry()
  const brandHealth     = getLatestBrandHealth()
  const handoffFindings = getHandoffFindings()
  const now = new Date().toISOString()

  log(`Env keys: ${envKeys.join(', ')}`)
  log(`Output files: ${outputFiles.length}`)
  log(`Distributed posts: ${pipelineState.distributed?.length ?? 0}`)
  log(`Brand health: ${brandHealth ? brandHealth.filename : 'none'}`)
  if (tokenExpiry?.daysLeft !== undefined) {
    const msg = tokenExpiry.daysLeft <= 7
      ? `⚠ META_ACCESS_TOKEN expires in ${tokenExpiry.daysLeft} day(s) — regenerate now`
      : `META_ACCESS_TOKEN expires in ${tokenExpiry.daysLeft} day(s) (${tokenExpiry.expiresAt})`
    log(msg)
  }

  // Build context for Claude
  const tokenExpiryLine = tokenExpiry?.neverExpires
    ? 'META_ACCESS_TOKEN: does not expire (long-lived token with no expiry)'
    : tokenExpiry?.daysLeft !== undefined
      ? `META_ACCESS_TOKEN: expires in ${tokenExpiry.daysLeft} day(s) on ${tokenExpiry.expiresAt}${tokenExpiry.daysLeft <= 7 ? ' ⚠ EXPIRING SOON — regenerate immediately' : ''}`
      : 'META_ACCESS_TOKEN: expiry unknown (could not reach debug_token API)'

  const projectContext = `
## Current Date/Time
${now}

## Meta Access Token Status
${tokenExpiryLine}

## Configured Environment Variables (key names only)
${envKeys.join('\n')}

## Recent Pipeline Activity (last 30 log lines)
\`\`\`
${recentLogs}
\`\`\`

## Pipeline State (watch-drive-state.json)
\`\`\`json
${JSON.stringify(pipelineState, null, 2)}
\`\`\`

## posts/output/ contents
${outputFiles.map(f => `- ${f}`).join('\n') || '(empty)'}

## content/ files
${contentFiles.map(f => `- ${f}`).join('\n') || '(empty)'}

## Google Drive folder structure
\`\`\`
${driveStructure}
\`\`\`

## Git log (last 10 commits)
\`\`\`
${gitLog}
\`\`\`

## Available scripts
${fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).sort().map(s => `- scripts/${s}`).join('\n')}

${brandHealth?.metrics ? `## Audience — Current Follower Counts (from ${brandHealth.filename})\n${brandHealth.metrics}\n` : ''}
${handoffFindings ? `## Pipeline Alerts (from logs/handoff-findings.md)\n${handoffFindings}\n` : ''}
## Phase 2 — BSV Own Product Line (fixed strategy, always include)
- **First product:** Proprietor's Foot Balm — private label, custom formulation
- **Packaging:** Midnight #0D1B2A and Bourbon #C17D2E colorway
- **Positioning:** "Nothing goes on this shelf that hasn't earned its place. This earned it."
- **Revenue path:** Amazon Associates → Impact.com/Manscaped affiliate deals → private label balm → full BSV product line
- **Launch condition:** When audience is proven and affiliate revenue is flowing
- **Research needed:** Private label foot cream manufacturers, MOQ, packaging costs
- **Drive folder:** Big Sole Vibes/Product Development/ — manufacturer research, formulation notes, packaging concepts
`.trim()

  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are maintaining a living handoff document for the Big Sole Vibes (BSV) content production system.
BSV is a premium men's foot care brand. The system automates social content creation, branding, and distribution.

Your job is to produce a complete, current, developer-ready handoff document in Markdown.
The document should allow any developer or collaborator to immediately understand:
- What the system does and how it works end-to-end
- Current status of the pipeline (what's been posted, what's in progress)
- What credentials are configured (by name only, never values)
- How to use each script
- The Google Drive folder structure and its purpose
- Any known issues or next steps worth flagging

The document MUST always include a "Phase 2 — Product Strategy" section covering:
- Proprietor's Foot Balm (private label, custom formulation)
- Midnight/Bourbon packaging colorway (#0D1B2A / #C17D2E)
- Revenue path: Amazon Associates → Manscaped affiliate → private label → full product line
- Launch condition: audience proven, affiliate revenue flowing
- Research backlog: private label manufacturers, MOQ, packaging costs
- Drive folder: Big Sole Vibes/Product Development/
Keep this section stable and authoritative across every nightly rewrite — update only if new product information appears in the project context.

Write the document as a professional, dense technical reference — not a tutorial.
Use clear Markdown headers, code blocks for commands, and tables where appropriate.
Update any dates, file lists, or status sections based on the current state provided.
Do not invent or fabricate information not present in the context.`

  const userPrompt = existingHandoff
    ? `Here is the existing handoff document to update:\n\n${existingHandoff}\n\n---\n\nHere is the current project state as of ${now}. Update the handoff document to reflect this state accurately. Preserve any sections that are still current; update or replace sections that have changed.\n\n${projectContext}`
    : `Generate a comprehensive handoff document for the Big Sole Vibes content production system based on the current project state:\n\n${projectContext}`

  // Call Claude API with streaming
  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })

  let fullText = ''

  try {
    const stream = await client.messages.stream({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 16384,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })

    process.stdout.write('Generating')
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text
        process.stdout.write('.')
      }
    }
    process.stdout.write('\n')

    const finalMsg = await stream.finalMessage()
    log(`Done — ${finalMsg.usage?.output_tokens ?? '?'} output tokens, stop_reason: ${finalMsg.stop_reason}`)
    if (finalMsg.stop_reason === 'max_tokens') {
      log('WARNING: response was truncated at max_tokens — using partial output')
    }
  } catch (err) {
    log(`ERROR: Claude API call failed: ${err.message}`)
    process.exit(1)
  }

  if (!fullText.trim()) {
    log('ERROR: Claude returned empty response')
    process.exit(1)
  }

  // Save locally
  const localOutput = path.join(TEMP_DIR, HANDOFF_FILE)
  fs.writeFileSync(localOutput, fullText)
  log(`Saved locally: ${localOutput} (${fullText.length} chars)`)

  // Upload to Google Drive (overwrites previous version)
  try {
    execSync(`rclone copyto "${localOutput}" "${REMOTE_HANDOFF}/${HANDOFF_FILE}"`, { stdio: ['pipe','pipe','pipe'] })
    log(`Uploaded → ${REMOTE_HANDOFF}/${HANDOFF_FILE}`)
    if (handoffFindings) {
      clearHandoffFindings()
      log('Cleared logs/handoff-findings.md after successful upload')
    }
  } catch (err) {
    log(`ERROR: rclone upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  log('━━━ update-handoff complete ━━━\n')
})()
