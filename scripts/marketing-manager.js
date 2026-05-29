require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'marketing-manager.log')
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-marketing-manager')
const REMOTE   = 'big sole vibes:Big Sole Vibes'
const KLAVIYO  = 'https://a.klaviyo.com/api'

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Klaviyo helpers ──────────────────────────────────────────────────────────

function klaviyoHeaders(apiKey) {
  return {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'revision':      '2023-12-15',
    'Content-Type':  'application/json',
  }
}

async function getListProfiles(apiKey, listId) {
  const profiles = []
  let url = `${KLAVIYO}/lists/${listId}/profiles/?fields[profile]=email,created,properties`

  while (url) {
    const res  = await fetch(url, { headers: klaviyoHeaders(apiKey) })
    const data = await res.json()
    if (!res.ok) throw new Error(`Klaviyo list profiles failed: ${JSON.stringify(data)}`)
    profiles.push(...(data.data || []))
    url = data.links?.next || null
  }
  return profiles
}

async function getListMeta(apiKey, listId) {
  const res  = await fetch(`${KLAVIYO}/lists/${listId}/`, { headers: klaviyoHeaders(apiKey) })
  const data = await res.json()
  if (!res.ok) throw new Error(`Klaviyo list meta failed: ${JSON.stringify(data)}`)
  return data.data?.attributes || {}
}

function summariseGrowth(profiles) {
  const now     = new Date()
  const cutoffs = {
    last7:  new Date(now - 7  * 86400000).toISOString(),
    last14: new Date(now - 14 * 86400000).toISOString(),
    last30: new Date(now - 30 * 86400000).toISOString(),
  }
  const count = (since) => profiles.filter(p => (p.attributes?.created || '') >= since).length
  return {
    total:  profiles.length,
    last7:  count(cutoffs.last7),
    last14: count(cutoffs.last14),
    last30: count(cutoffs.last30),
  }
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

function loadDirective() {
  try {
    execSync(`rclone copy "${REMOTE}/BSV-Directive.md" "${TEMP_DIR}/"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    const p = path.join(TEMP_DIR, 'BSV-Directive.md')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

async function loadMemory() {
  const { loadMemoryById } = require('./lib/memory')
  return loadMemoryById()
}

function getPostedThisWeek() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  try {
    const dirs = execSync(`rclone lsd "${REMOTE}/Posted/"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const lines = []
    for (const line of dirs.split('\n')) {
      const folder = line.trim().split(/\s+/).pop()
      if (!folder || folder < cutoffStr) continue
      try {
        const files = execSync(`rclone ls "${REMOTE}/Posted/${folder}"`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        lines.push(`${folder}: ${files.split('\n').map(f => f.trim().split(/\s+/).slice(1).join(' ')).filter(Boolean).join(', ')}`)
      } catch {}
    }
    return lines.join('\n') || '(nothing posted this week)'
  } catch { return '(rclone unavailable)' }
}

function loadLatestBrandHealth() {
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
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

function getPreviousReport() {
  try {
    const files = execSync(`rclone ls "${REMOTE}/Reports"`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n')
      .map(l => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(f => f.match(/^marketing-\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
    if (!files.length) return null
    const latest = files[files.length - 1]
    fs.mkdirSync(TEMP_DIR, { recursive: true })
    execSync(`rclone copy "${REMOTE}/Reports/${latest}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const p = path.join(TEMP_DIR, latest)
    return fs.existsSync(p) ? { filename: latest, content: fs.readFileSync(p, 'utf8') } : null
  } catch { return null }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ marketing-manager start ━━━')

  const apiKey      = process.env.ANTHROPIC_API_KEY
  const klaviyoKey  = process.env.KLAVIYO_API_KEY
  const loungeListId = process.env.KLAVIYO_LOUNGE_LIST_ID
  const dropListId   = process.env.KLAVIYO_DROP_LIST_ID

  if (!apiKey)     { log('ERROR: ANTHROPIC_API_KEY not set');    process.exit(1) }
  if (!klaviyoKey) { log('ERROR: KLAVIYO_API_KEY not set');      process.exit(1) }

  const today   = new Date().toISOString().slice(0, 10)
  const outFile = `marketing-${today}.md`

  // ── Klaviyo data ─────────────────────────────────────────────────────────
  let loungeData = null
  let dropData   = null

  if (loungeListId) {
    log(`Fetching Lounge list (${loungeListId})...`)
    try {
      const [meta, profiles] = await Promise.all([
        getListMeta(klaviyoKey, loungeListId),
        getListProfiles(klaviyoKey, loungeListId),
      ])
      loungeData = { meta, profiles, growth: summariseGrowth(profiles) }
      log(`Lounge: ${loungeData.growth.total} total, +${loungeData.growth.last7} this week`)
    } catch (err) { log(`Lounge fetch error: ${err.message}`) }
  } else {
    log('KLAVIYO_LOUNGE_LIST_ID not set — skipping Lounge list')
  }

  if (dropListId) {
    log(`Fetching Drop list (${dropListId})...`)
    try {
      const [meta, profiles] = await Promise.all([
        getListMeta(klaviyoKey, dropListId),
        getListProfiles(klaviyoKey, dropListId),
      ])
      dropData = { meta, profiles, growth: summariseGrowth(profiles) }
      log(`Drop: ${dropData.growth.total} total, +${dropData.growth.last7} this week`)
    } catch (err) { log(`Drop fetch error: ${err.message}`) }
  } else {
    log('KLAVIYO_DROP_LIST_ID not set — skipping Drop list')
  }

  log('Loading directive...')
  const directive      = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)

  log('Loading memory...')
  const memory         = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const postedThisWeek = getPostedThisWeek()
  const previous       = getPreviousReport()
  log(`Previous report: ${previous ? previous.filename : 'none'}`)

  const brandHealth = loadLatestBrandHealth()
  log(`Brand health: ${brandHealth ? brandHealth.filename : 'none'}`)

  // ── Claude analysis ───────────────────────────────────────────────────────
  const systemPrompt = `${directive ? `${directive}\n\n---\n\n` : ''}${memory ? `${memory}\n\n---\n\n` : ''}You are the Marketing Manager for Big Sole Vibes (BSV). Your analysis and recommendations must serve the Proprietor's Directive above — building the audience that will fill the lounge.

BSV has two distinct audience segments:
- **The Lounge** — men 35–55, premium/bourbon register, signup at bigsolevibes.com/lounge
- **The Drop** — men 18–34, sneaker/streetwear culture, signup at bigsolevibes.com/drop

Your job: produce a clear, data-driven weekly marketing report. Track subscriber growth by segment, identify what content is driving signups, give specific recommendations for improving list growth. You are accountable to numbers, not vibes. Growth that doesn't serve the standard described in the directive is noise.

When a ## Growth Metrics section appears in the Brand Health Report context below, treat those numbers as ground truth for current audience size. Reference them explicitly when sizing opportunity, benchmarking growth rate, and forecasting.`

  const userPrompt = `Produce the BSV Weekly Marketing Report for ${today}.

${brandHealth ? `## Brand Health Report (${brandHealth.filename}) — growth metrics and content quality\n${brandHealth.content.slice(0, 3000)}${brandHealth.content.length > 3000 ? '\n[truncated]' : ''}\n` : ''}
## Klaviyo Data

### The Lounge Segment
${loungeData ? `- Total subscribers: ${loungeData.growth.total}
- New this week (7d): ${loungeData.growth.last7}
- New this fortnight (14d): ${loungeData.growth.last14}
- New this month (30d): ${loungeData.growth.last30}` : '(list not configured — KLAVIYO_LOUNGE_LIST_ID missing)'}

### The Drop Segment
${dropData ? `- Total subscribers: ${dropData.growth.total}
- New this week (7d): ${dropData.growth.last7}
- New this fortnight (14d): ${dropData.growth.last14}
- New this month (30d): ${dropData.growth.last30}` : '(list not configured — KLAVIYO_DROP_LIST_ID missing)'}

## Content Posted This Week
${postedThisWeek}

${previous ? `## Previous Report (${previous.filename}) — for trend comparison\n${previous.content.slice(0, 2000)}${previous.content.length > 2000 ? '\n[truncated]' : ''}` : ''}

---

# BSV Weekly Marketing Report — ${today}

## Segment Growth Summary
Total subscribers, week-over-week change for Lounge and Drop. Which segment is growing faster? What's the ratio?

## Growth Trend
Compare this week vs. previous weeks (use previous report data where available). Is growth accelerating or decelerating in each segment?

## Content → Signup Correlation
Based on what was posted this week, which content types or themes appear to be driving signups? Which segment does each piece target? Where are the gaps?

## Lounge Segment Health
Specific analysis: who is this audience? What's working? What's missing?

## Drop Segment Health
Specific analysis: who is this audience? What's working? What's missing?

## Underperforming Segment
Which segment is growing slower? One specific, actionable reason why — and one specific fix.

## Top 3 Growth Levers
Concrete actions to drive signup volume over the next 7 days. Specific enough to execute immediately.

## 30-Day Forecast
If current trends hold, where will each segment land in 30 days? What would need to change to 2× that number?`

  log('Calling Claude API...')
  const client = new Anthropic({ apiKey })
  let fullText = ''

  const stream = await client.messages.stream({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 6000,
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

  const final = await stream.finalMessage()
  log(`Done — ${final.usage?.output_tokens ?? '?'} tokens, stop: ${final.stop_reason}`)

  if (!fullText.trim()) { log('ERROR: empty response'); process.exit(1) }

  const localPath = path.join(TEMP_DIR, outFile)
  fs.writeFileSync(localPath, fullText)

  try {
    execSync(`rclone copyto "${localPath}" "${REMOTE}/Reports/${outFile}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    log(`Uploaded → ${REMOTE}/Reports/${outFile}`)
  } catch (err) {
    log(`ERROR: upload failed: ${err.stderr?.toString().trim() || err.message}`)
    process.exit(1)
  }

  log('━━━ marketing-manager complete ━━━\n')
})()
