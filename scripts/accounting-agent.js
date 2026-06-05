require('dotenv').config()
const { execSync } = require('child_process')
const path         = require('path')
const fs           = require('fs')
const os           = require('os')

const ROOT           = path.join(__dirname, '..')
const LOG_FILE       = path.join(ROOT, 'logs', 'accounting-agent.log')
const COST_STATE     = path.join(ROOT, 'logs', 'cost-state.json')
const TEMP_DIR       = path.join(os.homedir(), 'tmp', 'bsv-accounting')
const REMOTE         = 'big sole vibes:Big Sole Vibes'
const ACCOUNTING_DIR = REMOTE + '/Accounting'

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}
function fmt(n) { return '$' + Number(n || 0).toFixed(2) }
function monthLabel() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
function monthName() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function loadCostState() {
  try { return JSON.parse(fs.readFileSync(COST_STATE, 'utf8')) }
  catch { log('WARNING: cost-state.json not found'); return {} }
}
async function fetchCJRevenue() {
  const token = process.env.CJ_API_TOKEN
  const cid   = process.env.CJ_CID
  if (!token || !cid) { log('WARNING: CJ credentials not set'); return { amount: 0, note: 'CJ credentials not configured' } }
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const end   = now.toISOString().slice(0, 10)
  const url   = 'https://commissions.api.cj.com/v3/commissions?date-type=posting&start-date=' + start + '&end-date=' + end + '&website-id=' + cid
  try {
    const res   = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/xml' }, signal: AbortSignal.timeout(10000) })
    const xml   = await res.text()
    if (!res.ok) { log('CJ API ' + res.status); return { amount: 0, note: 'CJ API ' + res.status } }
    const tm     = xml.match(/total-matched="(\d+)"/)
    const count  = tm ? parseInt(tm[1]) : 0
    const amount = [...xml.matchAll(/<commission-amount>([\d.]+)<\/commission-amount>/g)].reduce((s, m) => s + parseFloat(m[1]), 0)
    log('CJ revenue: ' + fmt(amount) + ' (' + count + ' commissions)')
    return { amount, count, note: count === 0 ? 'CJ: no commissions this month' : null }
  } catch (err) { log('CJ exception: ' + err.message); return { amount: 0, note: 'CJ exception: ' + err.message } }
}

function loadAmazonRevenue() {
  const csvPath = path.join(TEMP_DIR, 'amazon-' + monthLabel() + '.csv')
  if (!fs.existsSync(csvPath)) {
    log('Amazon CSV not found: ' + csvPath)
    return { amount: 0, note: 'Manual entry required — export Associates CSV to ' + csvPath }
  }
  try {
    const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n')
    let total = 0
    for (const line of lines.slice(1)) {
      const cols = line.split(',')
      const val  = parseFloat(cols[cols.length - 1].replace(/[$,"]/g, ''))
      if (!isNaN(val)) total += val
    }
    log('Amazon revenue: ' + fmt(total))
    return { amount: total, note: null }
  } catch (err) {
    return { amount: 0, note: 'CSV parse error: ' + err.message }
  }
}

function buildPNL({ cj, amazon, apiCost, notes }) {
  const rev    = cj.amount + amazon.amount
  const fixed  = [
    { item: 'Cloudflare Pages',  cat: 'Infrastructure', amt: 0 },
    { item: 'Cloudflare R2',     cat: 'Infrastructure', amt: 0 },
    { item: 'Klaviyo',           cat: 'Software',       amt: 0 },
    { item: 'Zoho SMTP',         cat: 'Software',       amt: 0 },
    { item: 'Google Workspace',  cat: 'Software',       amt: 0 },
    { item: 'Domain (annual/12)',cat: 'Infrastructure', amt: 1.50 },
  ]
  const fixedTotal = fixed.reduce((s, r) => s + r.amt, 0)
  const grand      = apiCost + fixedTotal
  const allNotes   = [cj.note, amazon.note, ...notes].filter(Boolean)

  const out = [
    '# BSV P&L - ' + monthName(), '',
    '## Revenue', '',
    '| Source | Amount |', '|--------|--------|',
    '| Amazon Associates | ' + fmt(amazon.amount) + ' |',
    '| CJ Affiliate' + (cj.count ? ' (' + cj.count + ' commissions)' : '') + ' | ' + fmt(cj.amount) + ' |',
    '| Foot Balm Direct | $0.00 |',
    '| **Total Revenue** | **' + fmt(rev) + '** |', '',
    '## Expenses', '',
    '| Item | Category | Amount |', '|------|----------|--------|',
    '| Claude API (est.) | API | ' + fmt(apiCost) + ' |',
    '| Gemini API (Imagen) | API | $0.00 |',
    ...fixed.map(r => '| ' + r.item + ' | ' + r.cat + ' | ' + fmt(r.amt) + ' |'),
    '| **Total Expenses** | | **' + fmt(grand) + '** |', '',
    '## Net', '',
    '| | |', '|-|-|',
    '| Net P&L | ' + fmt(rev - grand) + ' |',
    '| YTD Revenue | ' + fmt(rev) + ' |',
    '| YTD Expenses | ' + fmt(grand) + ' |',
    '| YTD Net | ' + fmt(rev - grand) + ' |', '',
  ]
  if (allNotes.length) {
    out.push('## Notes', '')
    allNotes.forEach(n => out.push('- ' + n))
    out.push('')
  }
  out.push('_Generated by accounting-agent.js - ' + new Date().toISOString() + '_')
  return out.join('\n')
}

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })
  log('--- accounting-agent start ---')

  const [cj, amazon] = await Promise.all([fetchCJRevenue(), Promise.resolve(loadAmazonRevenue())])
  const costState    = loadCostState()
  const apiCost      = costState.today_cost ?? 0
  const notes        = costState.date ? [] : ['cost-state.json missing — run cost-report.js first']

  const pnl      = buildPNL({ cj, amazon, apiCost, notes })
  const filename  = 'BSV-PNL-' + monthLabel() + '.md'
  const tmpPath   = path.join(TEMP_DIR, filename)
  fs.writeFileSync(tmpPath, pnl)

  try {
    execSync('rclone copyto "' + tmpPath + '" "' + ACCOUNTING_DIR + '/' + filename + '"', { stdio: ['pipe', 'pipe', 'pipe'] })
    log('uploaded -> ' + ACCOUNTING_DIR + '/' + filename)
  } catch (err) {
    log('ERROR: Drive upload failed: ' + err.message)
  }

  log('--- accounting-agent complete ---\n')
})()
