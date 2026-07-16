require('dotenv').config()
const { execSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ROOT     = path.join(__dirname, '..')
const LOG_FILE = path.join(ROOT, 'logs', 'cost-report.log')
const REMOTE   = 'big sole vibes:Big Sole Vibes'
const TEMP_DIR = path.join(os.homedir(), 'tmp', 'bsv-cost-report')

// ─── Pricing (update when rates change) ──────────────────────────────────────
// claude-sonnet-4-x  https://www.anthropic.com/pricing
const CLAUDE_INPUT_PER_M  = 3.00   // $ per 1M input tokens
const CLAUDE_OUTPUT_PER_M = 15.00  // $ per 1M output tokens
// imagen-4.0-fast-generate-001  https://ai.google.dev/pricing
const IMAGEN_PER_IMAGE    = 0.020  // $ per image
// veo-3.1-fast-generate-preview  https://ai.google.dev/pricing
const VEO_PER_SECOND      = 0.35   // $ per second of generated video
const VEO_CLIP_SECONDS    = 7      // default clip length

const MONTHLY_BUDGET      = 10.00
const COST_STATE_FILE     = path.join(ROOT, 'logs', 'cost-state.json')
const RUNWAY_WARN_HOURS   = 48
const RUNWAY_URGENT_HOURS = 24
const LOW_BALANCE_THRESHOLD = 5.00

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}

function todayWindow() {
  const start = dayStart(new Date())
  const end   = new Date(start.getTime() + 86400_000)
  return { start, end }
}

function weekWindow() {
  const now = new Date()
  const day = now.getDay() // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = dayStart(new Date(now))
  start.setDate(start.getDate() + mondayOffset)
  return { start, end: new Date() }
}

function monthWindow() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { start, end: new Date() }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function fmt(n) {
  return `$${n.toFixed(4)}`
}

// ─── Log parsing ──────────────────────────────────────────────────────────────

function readLog(name) {
  const p = path.join(ROOT, 'logs', name)
  try { return fs.readFileSync(p, 'utf8') }
  catch { return '' }
}

// Returns entries from a log file within [start, end)
function entriesInWindow(logContent, start, end) {
  return logContent.split('\n').filter(line => {
    const m = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/)
    if (!m) return false
    const t = new Date(m[1])
    return t >= start && t < end
  })
}

function countImageUploads(logContent, start, end) {
  return entriesInWindow(logContent, start, end)
    .filter(l => l.includes('✓ uploaded') && l.match(/-image\.(png|jpg|jpeg|webp)/i))
    .length
}

function countVideoUploads(logContent, start, end) {
  return entriesInWindow(logContent, start, end)
    .filter(l => l.includes('✓ uploaded') && l.match(/\.mp4/i))
    .length
}

// Returns { calls, outputTokens } from media-director log
function parseClaudeLogs(logContent, start, end) {
  const lines = entriesInWindow(logContent, start, end)
  let calls = 0
  let outputTokens = 0
  for (const line of lines) {
    const m = line.match(/Done — (\d+) output tokens/)
    if (m) { calls++; outputTokens += parseInt(m[1], 10) }
  }
  return { calls, outputTokens }
}

// ─── Anthropic Usage API ──────────────────────────────────────────────────────

async function fetchAnthropicUsage(startDate, endDate) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  // startDate / endDate as YYYY-MM-DD strings
  const url = `https://api.anthropic.com/v1/usage?start_date=${startDate}&end_date=${endDate}`
  try {
    const res = await fetch(url, {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!res.ok) {
      log(`  Anthropic Usage API: ${res.status} — falling back to log parsing`)
      return null
    }
    const data = await res.json()
    // Response shape: { data: [{ model, input_tokens, output_tokens, ... }] }
    let inputTokens = 0, outputTokens = 0, calls = 0
    for (const entry of (data.data ?? [])) {
      inputTokens  += entry.input_tokens  ?? 0
      outputTokens += entry.output_tokens ?? 0
      calls        += entry.request_count ?? 0
    }
    return { inputTokens, outputTokens, calls, source: 'Anthropic API' }
  } catch (err) {
    log(`  Anthropic Usage API error: ${err.message} — falling back to log parsing`)
    return null
  }
}

// Fetch per-day Claude costs for the last N completed days (not today).
// Prefers the real Cost Report API (Admin key); falls back to the
// (non-functional, always-404) Usage API attempt for safety, same as before.
async function fetchBurnHistory(days) {
  const results = []
  for (let i = days; i >= 1; i--) {
    const d    = new Date(); d.setDate(d.getDate() - i)
    const next = new Date(d); next.setDate(next.getDate() + 1)
    const dateStr = isoDate(d)
    const realCost = await fetchCostReportTotal(dateStr, isoDate(next))
    if (realCost !== null) {
      results.push({ date: dateStr, cost: realCost })
      continue
    }
    const usage = await fetchAnthropicUsage(dateStr, isoDate(next))
    if (usage) {
      results.push({ date: dateStr, cost: claudeCost(usage.inputTokens, usage.outputTokens) })
    }
  }
  return results
}

// ─── Real Cost Report API (Admin key required) ────────────────────────────────
// Added 2026-06-28: /v1/usage and /v1/billing/credit_balance (above/below) are
// not real Anthropic endpoints — they 404 every time, which is why no cost
// alert had ever fired despite running out of credits twice. The only real
// programmatic cost source is /v1/organizations/cost_report, and it requires
// an Admin API key (ANTHROPIC_ADMIN_API_KEY), not the regular workspace key.
// There is still no live "remaining balance" endpoint at all — Anthropic's
// docs confirm balance is Console-UI-only — so balance below is *computed*
// (topup amount − real spend since topup), not fetched directly.

// Returns total $ spend for [startDate, endDate) as a plain number, or null
// if the Admin key is missing, the call fails, or the response shape can't
// be parsed. Never returns 0 on failure — failure must look like failure,
// not like "nothing was spent," so it can't quietly defeat the alert logic
// the way the old fake endpoints did.
async function fetchCostReportTotal(startDate, endDate) {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY
  if (!adminKey) return null
  const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${startDate}T00:00:00Z&ending_at=${endDate}T00:00:00Z&group_by[]=description`
  let raw = ''
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
    })
    raw = await res.text()
    if (!res.ok) {
      log(`  Cost Report API: ${res.status} — ${raw.slice(0, 200)}`)
      return null
    }
  } catch (err) {
    log(`  Cost Report API error: ${err.message}`)
    return null
  }
  let data
  try { data = JSON.parse(raw) } catch {
    log(`  Cost Report API: non-JSON response — ${raw.slice(0, 200)}`)
    return null
  }
  const total = sumCostReportTotal(data)
  if (total === null) {
    log(`  Cost Report API: response shape not recognized — logging raw for inspection: ${raw.slice(0, 800)}`)
    return null
  }
  return total
}

// Defensive parser for the Cost Report response. VERIFIED LIVE 2026-06-28
// against a real Admin-key response: {"data":[{"starting_at":"...",
// "ending_at":"...","results":[]}],"has_more":false,"next_page":null} — the
// data[].results[] shape guessed below was correct. results[] being EMPTY is
// a normal, valid response (zero spend that bucket) — earlier versions of
// this function treated "found no items" as "shape not recognized" and
// returned null for a legitimate $0, which broke per-day burn history every
// time a day had no spend. Now tracks shape-recognition separately from the
// running total: a well-formed (even empty) bucket counts as recognized;
// null is reserved for truly unparseable input. Inner item field name
// (item.amount, assumed lowest-units/cents per the docs) is still unverified
// against a non-empty results[] — re-check if/when a day shows real line items.
function sumCostReportTotal(data) {
  const buckets = Array.isArray(data?.data) ? data.data
                : Array.isArray(data?.results) ? data.results
                : null
  if (!buckets) return null
  let totalCents = 0
  let shapeRecognized = buckets.length === 0 // empty top-level array is itself valid ($0)
  for (const bucket of buckets) {
    const items = Array.isArray(bucket?.results) ? bucket.results
                : Array.isArray(bucket?.items)   ? bucket.items
                : Array.isArray(bucket)          ? bucket
                : null
    if (items) {
      shapeRecognized = true // a real bucket, even if empty (= $0 for that period)
      for (const item of items) {
        const amt = item?.amount ?? item?.cost ?? item?.value
        const n = parseFloat(amt)
        if (!isNaN(n)) totalCents += n
      }
    } else if (bucket?.amount !== undefined) {
      shapeRecognized = true
      const n = parseFloat(bucket.amount)
      if (!isNaN(n)) totalCents += n
    }
  }
  if (!shapeRecognized) return null
  return totalCents / 100 // lowest units (cents) → dollars
}

// Computed balance: there is no live "remaining credit" API at all (confirmed
// against current Anthropic docs 2026-06-28, re-confirmed 2026-07-15 — Console
// billing page is the only real-time source). Best available approximation:
// Big D reports the balance at his last topup and the date of that topup; we
// subtract real spend since then via the Cost Report API.
//
// Source of the topup amount/date, in priority order:
//   1. logs/credit-topup.json — written by the `record_credit_topup` MCP tool
//      (Big D just tells Claude the new balance in chat, no file editing).
//      Added 2026-07-16 after Big D flagged manually editing .env every
//      topup as too much friction — this value isn't a credential, so it
//      doesn't need to live in .env or fall under the "never write .env" rule.
//   2. ANTHROPIC_CREDIT_BALANCE / ANTHROPIC_CREDIT_TOPUP_DATE in .env — legacy
//      fallback, kept working in case the JSON file is ever missing/corrupt.
// Whichever source wins is logged explicitly so a degraded number can't
// masquerade as a real one.
function readTopupState() {
  const jsonPath = path.join(ROOT, 'logs', 'credit-topup.json')
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const amount = parseFloat(raw.amount)
    if (!isNaN(amount) && amount >= 0 && raw.date) {
      return { amount, date: raw.date, source: 'logs/credit-topup.json' }
    }
  } catch {}
  const amount = parseFloat(process.env.ANTHROPIC_CREDIT_BALANCE)
  const date    = process.env.ANTHROPIC_CREDIT_TOPUP_DATE
  if (!isNaN(amount) && amount >= 0) return { amount, date, source: '.env (legacy)' }
  return null
}

async function fetchAnthropicBalance() {
  const topupState = readTopupState()
  if (!topupState) return null
  const { amount: topupAmount, date: topupDate, source } = topupState
  if (isNaN(topupAmount) || topupAmount < 0) return null

  if (!topupDate) {
    log(`Credit balance: $${topupAmount.toFixed(2)} (static snapshot from ${source} — no topup date set, not decremented for spend since topup)`)
    return topupAmount
  }

  // End bound must be a date that has already fully elapsed — confirmed live
  // 2026-06-28 that the API 400s ("ending date must be after starting date")
  // when ending_at is in the future, which tomorrow's date always is partway
  // through today. Using today's date (not tomorrow) mirrors the same
  // already-working pattern Week/Month use below; it means spend-since-topup
  // lags by up to ~1 day (excludes today specifically), same documented
  // tradeoff as those windows — safe and proven over guessing at sub-day
  // timestamp granularity the API hasn't been confirmed to accept.
  //
  // Edge case confirmed live 2026-06-28: if topupDate IS today, start===end
  // and the API 400s again ("ending_at must be after starting_at") — same
  // root cause, different wording, triggered by equality rather than a
  // future date. No completed day exists yet to query, so treat it like the
  // "Today" window: skip the call, assume $0 spend so far (true at the
  // instant of topup), and let tomorrow's run pick up real spend once today
  // has actually elapsed.
  if (topupDate >= isoDate(new Date())) {
    log(`Credit balance: $${topupAmount.toFixed(2)} (topup was today, ${topupDate} — no elapsed day to query yet, assuming $0 spend since)`)
    return topupAmount
  }
  const spendSinceTopup = await fetchCostReportTotal(topupDate, isoDate(new Date()))
  if (spendSinceTopup === null) {
    log(`Credit balance: $${topupAmount.toFixed(2)} (static snapshot from ${source} — Cost Report API unavailable, couldn't subtract spend since topup ${topupDate})`)
    return topupAmount
  }

  const balance = Math.max(0, topupAmount - spendSinceTopup)
  log(`Credit balance: $${balance.toFixed(4)} = $${topupAmount.toFixed(2)} topup (${topupDate}, via ${source}) − $${spendSinceTopup.toFixed(4)} real spend since`)
  return balance
}

// Sends a Telegram message using the project-standard credentials.
async function sendTelegramMessage(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    log('WARNING: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — skipping runway alert')
    return false
  }
  for (const parse_mode of ['Markdown', null]) {
    const body = Object.assign({ chat_id: chatId, text }, parse_mode ? { parse_mode } : {})
    try {
      const res  = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) return true
      if (parse_mode && (data.description?.toLowerCase().includes('parse') || data.description?.toLowerCase().includes('entity'))) continue
      throw new Error(JSON.stringify(data))
    } catch (err) {
      log(`ERROR: Telegram send failed: ${err.message}`)
      return false
    }
  }
  return false
}

// ─── Cost calculations ────────────────────────────────────────────────────────

function claudeCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000) * CLAUDE_INPUT_PER_M
       + (outputTokens / 1_000_000) * CLAUDE_OUTPUT_PER_M
}

function imagenCost(images) {
  return images * IMAGEN_PER_IMAGE
}

function veoCost(videos) {
  return videos * VEO_PER_SECOND * VEO_CLIP_SECONDS
}

// ─── Build one window's summary ───────────────────────────────────────────────

async function summarise(label, window, mdirLog, imgLog, vidLog) {
  const { start, end } = window

  // Imagen + Veo from logs (no direct billing API without GCP billing account)
  const images = countImageUploads(imgLog, start, end)
  const videos = countVideoUploads(vidLog, start, end)

  // Claude: prefer the real Cost Report API (Admin key) for an actual $ total.
  // "Today" is skipped here on purpose — confirmed live 2026-06-28 that the
  // API 400s whenever ending_at is in the future, which Today's window
  // (end = tomorrow's date boundary) always is until the day is over. No
  // point burning a call that's guaranteed to fail; go straight to the
  // existing log-estimate fallback for this window only.
  const realCost = (label === 'Today') ? null : await fetchCostReportTotal(isoDate(start), isoDate(end))

  let claudeCalls, claudeInputTok, claudeOutputTok, claudeSource, cCost
  if (realCost !== null) {
    claudeCalls     = null
    claudeInputTok  = null
    claudeOutputTok = null
    claudeSource    = 'Anthropic Cost Report API (real $)'
    cCost           = realCost
  } else {
    // Fall back to the old (non-functional) Usage API attempt, then logs.
    let claudeData
    if (label !== 'Week') {
      claudeData = await fetchAnthropicUsage(isoDate(start), isoDate(end))
    }
    if (claudeData) {
      claudeCalls     = claudeData.calls
      claudeInputTok  = claudeData.inputTokens
      claudeOutputTok = claudeData.outputTokens
      claudeSource    = claudeData.source
    } else {
      const parsed = parseClaudeLogs(mdirLog, start, end)
      claudeCalls     = parsed.calls
      claudeOutputTok = parsed.outputTokens
      // Input tokens not logged — estimate at 2× output (conservative for long system prompts)
      claudeInputTok  = parsed.outputTokens * 2
      claudeSource    = (label === 'Today')
        ? 'log estimate (input ≈ 2× output) — Cost Report API has no data for the current, still-in-progress day'
        : 'log estimate (input ≈ 2× output) — ANTHROPIC_ADMIN_API_KEY not set or call failed'
    }
    cCost = claudeCost(claudeInputTok, claudeOutputTok)
  }

  const iCost = imagenCost(images)
  const vCost = veoCost(videos)
  const total = cCost + iCost + vCost

  return { label, start, end, claudeCalls, claudeInputTok, claudeOutputTok, claudeSource, cCost, images, iCost, videos, vCost, total }
}

// ─── Markdown report ──────────────────────────────────────────────────────────

function buildReport(today, week, month, reportDate) {
  const dayOfMonth  = new Date().getDate()
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const budgetPct   = (month.total / MONTHLY_BUDGET) * 100
  const midMonthFlag = dayOfMonth <= Math.floor(daysInMonth / 2) && budgetPct > 50

  const budgetLine = midMonthFlag
    ? `⚠️  **BUDGET ALERT**: ${budgetPct.toFixed(1)}% of $${MONTHLY_BUDGET} monthly budget used — mid-month pace is over 50%`
    : `✓ ${budgetPct.toFixed(1)}% of $${MONTHLY_BUDGET} monthly budget used`

  function windowSection(w) {
    const claudeUnits = (w.claudeInputTok === null)
      ? 'real $ from Cost Report API'
      : `${w.claudeCalls} calls, ~${(w.claudeInputTok / 1000).toFixed(1)}K in / ${(w.claudeOutputTok / 1000).toFixed(1)}K out tokens`
    return [
      `### ${w.label} (${isoDate(w.start)} → ${isoDate(w.end)})`,
      '',
      '| Service | Units | Est. Cost |',
      '|---------|-------|-----------|',
      `| Claude API (${claudeUnits}) | — | ${fmt(w.cCost)} |`,
      `| Imagen 4 Fast (${w.images} images @ ${fmt(IMAGEN_PER_IMAGE)}/image) | ${w.images} | ${fmt(w.iCost)} |`,
      `| Veo 3.1 Fast (${w.videos} videos @ ${fmt(VEO_PER_SECOND)}/s × ${VEO_CLIP_SECONDS}s) | ${w.videos} | ${fmt(w.vCost)} |`,
      `| **Total** | | **${fmt(w.total)}** |`,
      '',
      `_Claude token data source: ${w.claudeSource}_`,
    ].join('\n')
  }

  return [
    `# BSV Cost Report — ${reportDate}`,
    '',
    `_Generated: ${new Date().toISOString()}_`,
    '',
    '---',
    '',
    '## Budget Status',
    '',
    budgetLine,
    '',
    `Monthly spend so far: **${fmt(month.total)}** of **$${MONTHLY_BUDGET.toFixed(2)}** budget`,
    '',
    '---',
    '',
    '## Today',
    '',
    windowSection(today),
    '',
    '---',
    '',
    '## This Week',
    '',
    windowSection(week),
    '',
    '---',
    '',
    '## This Month',
    '',
    windowSection(month),
    '',
    '---',
    '',
    '## Pricing Reference',
    '',
    '| Model | Rate |',
    '|-------|------|',
    `| Claude Sonnet 4.x | $${CLAUDE_INPUT_PER_M}/M input, $${CLAUDE_OUTPUT_PER_M}/M output |`,
    `| Imagen 4 Fast | $${IMAGEN_PER_IMAGE}/image |`,
    `| Veo 3.1 Fast | $${VEO_PER_SECOND}/second (${VEO_CLIP_SECONDS}s clip = ${fmt(VEO_PER_SECOND * VEO_CLIP_SECONDS)}) |`,
    '',
    '_Note: Imagen and Veo costs are estimated from log counts._',
    '_For exact GCP costs, enable billing export to BigQuery in the Google Cloud Console._',
  ].join('\n')
}

// ─── Drive context loaders ────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  log('━━━ cost-report start ━━━')

  log('Loading directive...')
  const directive = loadDirective()
  log(`Directive: ${directive ? directive.length + ' chars' : 'not found'}`)
  log('Loading memory...')
  const memory = await loadMemory()
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  const reportDate = isoDate(new Date())
  const mdirLog = readLog('media-director.log')
  const imgLog  = readLog('image-gen.log')
  const vidLog  = readLog('video-gen.log')

  const [todayData, weekData, monthData] = await Promise.all([
    summarise('Today', todayWindow(), mdirLog, imgLog, vidLog),
    summarise('Week',  weekWindow(),  mdirLog, imgLog, vidLog),
    summarise('Month', monthWindow(), mdirLog, imgLog, vidLog),
  ])

  log(`Today  — Claude: ${todayData.claudeCalls} calls, Imagen: ${todayData.images}, Veo: ${todayData.videos}, cost: ${fmt(todayData.total)}`)
  log(`Week   — Claude: ${weekData.claudeCalls} calls, Imagen: ${weekData.images}, Veo: ${weekData.videos}, cost: ${fmt(weekData.total)}`)
  log(`Month  — Claude: ${monthData.claudeCalls} calls, Imagen: ${monthData.images}, Veo: ${monthData.videos}, cost: ${fmt(monthData.total)}`)

  // ── Runway check ────────────────────────────────────────────────────────────

  const burnHistory  = await fetchBurnHistory(3)
  const avgDailyBurn = burnHistory.length
    ? burnHistory.reduce((s, d) => s + d.cost, 0) / burnHistory.length
    : todayData.total   // single-day fallback if history unavailable

  const balance     = await fetchAnthropicBalance()
  const runwayHours = (balance !== null && avgDailyBurn > 0)
    ? (balance / avgDailyBurn) * 24
    : null

  // Load previous state for balance alert dedup — must happen before costState is written
  let prevCostState = {}
  try { prevCostState = JSON.parse(fs.readFileSync(COST_STATE_FILE, 'utf8')) } catch {}

  log(`Burn history (${burnHistory.length}d): ${burnHistory.map(d => `${d.date}=${fmt(d.cost)}`).join(', ') || 'unavailable'}`)
  log(`Avg daily burn: ${fmt(avgDailyBurn)} (${burnHistory.length || 1}-day basis)`)
  if (balance !== null)  log(`Credit balance: $${balance.toFixed(4)}`)
  else                   log('Credit balance: unknown — tell Claude the current balance (record_credit_topup) or set ANTHROPIC_CREDIT_BALANCE in .env')
  if (runwayHours !== null) log(`Projected runway: ${runwayHours.toFixed(1)} hours`)

  // Determine balance alert state before writing cost-state.json
  const prevBalance       = prevCostState.balance ?? null
  const prevAlertSentAt   = prevCostState.balance_alert_sent_at ?? null
  const balanceNowLow     = balance !== null && balance < LOW_BALANCE_THRESHOLD
  const wasAboveThreshold = prevBalance === null || prevBalance >= LOW_BALANCE_THRESHOLD
  const shouldSendBalanceAlert = balanceNowLow && (!prevAlertSentAt || wasAboveThreshold)

  // Write cost-state.json so chief-of-staff can read runway into the stand-up
  const hasAdminKey  = !!process.env.ANTHROPIC_ADMIN_API_KEY
  const topupForState = readTopupState()
  const hasTopupDate = !!topupForState?.date
  const balanceSource = !hasAdminKey
    ? 'static (no ANTHROPIC_ADMIN_API_KEY)'
    : !hasTopupDate
      ? 'static (no topup date recorded)'
      : `computed (topup via ${topupForState.source} − real spend via Cost Report API)`

  const costState = {
    date:                   reportDate,
    today_cost:             todayData.total,
    avg_daily_burn:         avgDailyBurn,
    burn_days:              burnHistory.length,
    balance:                balance,
    balance_source:         balanceSource,
    runway_hours:           runwayHours,
    burn_history:           burnHistory,
    balance_alert_sent_at:  balanceNowLow
      ? (shouldSendBalanceAlert ? new Date().toISOString() : prevAlertSentAt)
      : null,
  }
  try {
    fs.writeFileSync(COST_STATE_FILE, JSON.stringify(costState, null, 2))
    log('Cost state written → logs/cost-state.json')
  } catch (err) {
    log(`ERROR: cost state write failed: ${err.message}`)
  }

  // Telegram balance alert — fires once when balance drops below $5, suppressed until topped up
  if (balanceNowLow) {
    if (shouldSendBalanceAlert) {
      const msg =
        `🚨 *BSV — API Credit Balance Low*\n\n` +
        `Balance: *$${balance.toFixed(2)}* (threshold: $${LOW_BALANCE_THRESHOLD.toFixed(2)})\n` +
        `Avg daily burn: *${fmt(avgDailyBurn)}*\n\n` +
        `Top up now to keep the pipeline running:\n` +
        `https://console.anthropic.com`
      const sent = await sendTelegramMessage(msg)
      log(`Telegram low-balance alert ($${balance.toFixed(2)}): ${sent ? 'sent ✓' : 'failed'}`)
    } else {
      log(`Balance $${balance.toFixed(2)} below threshold — alert already sent (${prevAlertSentAt}), suppressing`)
    }
  }

  // Telegram runway alerts — fire before report upload so alert lands even on upload failure
  if (runwayHours !== null) {
    if (runwayHours < RUNWAY_URGENT_HOURS) {
      const msg =
        `🚨 *BSV — URGENT: API Credits Critical*\n\n` +
        `Estimated balance: *$${balance.toFixed(2)}*\n` +
        `Avg daily burn (${burnHistory.length}d): *${fmt(avgDailyBurn)}*\n` +
        `Projected runway: *${runwayHours.toFixed(1)} hours*\n\n` +
        `Pipeline goes dark in under 24h without a top-up.\n\n` +
        `Top up: https://console.anthropic.com`
      const sent = await sendTelegramMessage(msg)
      log(`Telegram URGENT runway alert: ${sent ? 'sent ✓' : 'failed'}`)
    } else if (runwayHours < RUNWAY_WARN_HOURS) {
      const msg =
        `⚠️ *BSV — API Credits Low*\n\n` +
        `Estimated balance: *$${balance.toFixed(2)}*\n` +
        `Avg daily burn (${burnHistory.length}d): *${fmt(avgDailyBurn)}*\n` +
        `Projected runway: *${runwayHours.toFixed(1)} hours*\n\n` +
        `Top up soon: https://console.anthropic.com`
      const sent = await sendTelegramMessage(msg)
      log(`Telegram low-runway alert: ${sent ? 'sent ✓' : 'failed'}`)
    } else {
      log(`Runway OK: ${runwayHours.toFixed(1)}h — no alert needed`)
    }
  }

  const report   = buildReport(todayData, weekData, monthData, reportDate)
  const filename = `cost-report-${reportDate}.md`
  const tmpPath  = `/tmp/${filename}`

  fs.writeFileSync(tmpPath, report)
  log(`Report written to ${tmpPath}`)

  try {
    execSync(`rclone copyto "${tmpPath}" "${REMOTE}/Reports/${filename}"`, { stdio: ['pipe', 'pipe', 'pipe'] })
    log(`✓ uploaded → ${REMOTE}/Reports/${filename}`)
  } catch (err) {
    log(`ERROR: Drive upload failed: ${err.message}`)
  }

  // Budget alert to console so launchd captures it
  const budgetPct = (monthData.total / MONTHLY_BUDGET) * 100
  const dayOfMonth = new Date().getDate()
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  if (dayOfMonth <= Math.floor(daysInMonth / 2) && budgetPct > 50) {
    log(`⚠️  BUDGET ALERT: ${budgetPct.toFixed(1)}% of $${MONTHLY_BUDGET} budget used mid-month`)
  }

  log('━━━ cost-report complete ━━━\n')
})()
