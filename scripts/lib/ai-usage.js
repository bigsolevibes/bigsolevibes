// scripts/lib/ai-usage.js — shared AI cost telemetry
//
// Added 2026-09-14. Big D flagged that eng-bot "still feels like it's eating
// all our tokens" despite the 09-10 fixes that cut its diagnosis calls ~90%
// (51/day -> 6/day). Investigating turned up the real gap: cost-report.js's
// only real cost source (the Admin Cost Report API) returns one org-wide
// total, not a per-script breakdown, and most scripts never logged their own
// token counts — none logged input tokens, which is usually where the real
// cost hides (especially the multi-turn/web-search agents, e.g.
// product-research.js, social-listening.js, product-development.js).
//
// Call logAiUsage() right after every client.messages.create() call (or
// stream.finalMessage() for streamed calls), across every script, so
// cost-report.js can finally show which agent is actually spending money.
// This is the only place pricing lives — update PRICING here, nowhere else,
// when Anthropic's rates change.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-09-14).
//
// Never throws — telemetry must never break a pipeline script.

const fs   = require('fs')
const path = require('path')

const ROOT      = path.join(__dirname, '..', '..')
const USAGE_LOG = path.join(ROOT, 'logs', 'ai-usage.jsonl')

// $ per 1M tokens.
const PRICING = {
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cacheWrite5m: 3.75, cacheWrite1h: 6.00, cacheRead: 0.30 },
  'claude-sonnet-4-5':         { input: 3.00, output: 15.00, cacheWrite5m: 3.75, cacheWrite1h: 6.00, cacheRead: 0.30 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00,  cacheWrite5m: 1.25, cacheWrite1h: 2.00, cacheRead: 0.10 },
}

function ratesFor(model) {
  if (!model) return null
  if (PRICING[model]) return PRICING[model]
  // Loose match for a model string with an unlisted date suffix (e.g. a
  // future 'claude-sonnet-4-6-20261201') — match on the known prefix rather
  // than silently pricing an unrecognized model at $0.
  const prefix = Object.keys(PRICING).find(k => model.startsWith(k))
  return prefix ? PRICING[prefix] : null
}

function computeCost(model, usage) {
  const rates = ratesFor(model)
  if (!rates || !usage) return null
  const input        = usage.input_tokens ?? 0
  const output       = usage.output_tokens ?? 0
  const cacheWrite5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const cacheRead    = usage.cache_read_input_tokens ?? 0
  return (
    (input        / 1e6) * rates.input +
    (output       / 1e6) * rates.output +
    (cacheWrite5m / 1e6) * rates.cacheWrite5m +
    (cacheWrite1h / 1e6) * rates.cacheWrite1h +
    (cacheRead    / 1e6) * rates.cacheRead
  )
}

// logAiUsage({ script, tag, model, response })
// - script: the agent name as AGENT_ROSTER / agent-output-digest.md spells it
//   (e.g. 'eng-bot', 'product-research') — this is what makes the breakdown
//   line up with the rest of the reporting.
// - tag: optional label for one call site within a script that makes several
//   different calls (e.g. 'standup' / 'handoff' / 'memory' for chief-of-staff)
// - model: the model string passed to messages.create/stream
// - response: the raw SDK response (messages.create) or the resolved
//   stream.finalMessage() — either way, needs a .usage field
function logAiUsage({ script, tag, model, response }) {
  try {
    const usage = response && response.usage
    const cost  = computeCost(model, usage)
    const line = {
      ts:                          new Date().toISOString(),
      script:                      script || 'unknown',
      tag:                         tag || null,
      model:                       model || 'unknown',
      input_tokens:                usage ? (usage.input_tokens ?? null) : null,
      output_tokens:               usage ? (usage.output_tokens ?? null) : null,
      cache_creation_input_tokens: usage ? (usage.cache_creation_input_tokens ?? null) : null,
      cache_read_input_tokens:     usage ? (usage.cache_read_input_tokens ?? null) : null,
      cost_usd:                    cost === null ? null : Number(cost.toFixed(6)),
    }
    fs.mkdirSync(path.dirname(USAGE_LOG), { recursive: true })
    fs.appendFileSync(USAGE_LOG, JSON.stringify(line) + '\n')
  } catch (err) {
    try { console.error(`[ai-usage] logging failed: ${err.message}`) } catch {}
  }
}

// summarize({ since }) — aggregate logs/ai-usage.jsonl by script, for
// cost-report.js. `since` is a Date; only lines at/after it are counted.
function summarize({ since } = {}) {
  const byScript = {}
  let text = ''
  try { text = fs.readFileSync(USAGE_LOG, 'utf8') } catch { return { byScript, totalCost: 0, totalCalls: 0 } }

  let totalCost = 0
  let totalCalls = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (since && new Date(row.ts) < since) continue
    const key = row.script || 'unknown'
    if (!byScript[key]) byScript[key] = { calls: 0, input_tokens: 0, output_tokens: 0, cost: 0, unpriced_calls: 0 }
    byScript[key].calls++
    byScript[key].input_tokens  += row.input_tokens  || 0
    byScript[key].output_tokens += row.output_tokens || 0
    if (row.cost_usd === null) byScript[key].unpriced_calls++
    else byScript[key].cost += row.cost_usd
    totalCalls++
    totalCost += row.cost_usd || 0
  }
  return { byScript, totalCost, totalCalls }
}

module.exports = { logAiUsage, computeCost, summarize, PRICING, USAGE_LOG }
