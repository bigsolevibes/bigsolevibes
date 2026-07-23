// scripts/lib/approved-slots.js — shared read/write for logs/approved-slots.json.
//
// Extracted 2026-07-23 after the same `{slot: true}` read/write pattern was
// independently copy-pasted in watch-drive.js and mcp-server.js (see
// feedback_bsv_shared_logic_single_module precedent — agent-health.js,
// visual-doctrine.js: one shared module, not N hardcoded copies). image-gen.js
// now needs to write here too — see visualQaCheck() in image-gen.js and Big
// D's 2026-07-23 sign-off on an auto-approve "probation" trial: a slot whose
// rendered image gets a clean Visual QA PASS releases without waiting on the
// dashboard, logged to logs/auto-qa-approvals.json so Big C can spot-check it
// in the digest instead of it shipping silently.
//
// Value shape: entries are either `true` (legacy manual approval, written
// before this file existed) or `{ method, reason, at }` for provenance.
// Both are truthy, so every existing `if (!approvedSlots[base])` gate check
// keeps working unchanged — this is purely an internal-shape upgrade.

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const APPROVED_SLOTS_FILE = path.join(ROOT, 'logs', 'approved-slots.json')

function loadApprovedSlots() {
  try { return JSON.parse(fs.readFileSync(APPROVED_SLOTS_FILE, 'utf8')) } catch { return {} }
}

function saveApprovedSlots(slots) {
  fs.writeFileSync(APPROVED_SLOTS_FILE, JSON.stringify(slots, null, 2))
}

// method: 'manual' (dashboard/MCP approve_slot), 'auto-qa' (image-gen.js clean
// QA pass, probation trial), or 'self-heal-caption' (watch-drive.js flow-caption repair).
function approveSlot(slot, { method = 'manual', reason = null } = {}) {
  const slots = loadApprovedSlots()
  slots[slot] = { method, reason, at: new Date().toISOString() }
  saveApprovedSlots(slots)
  return slots
}

function denySlot(slot) {
  const slots = loadApprovedSlots()
  delete slots[slot]
  saveApprovedSlots(slots)
  return slots
}

module.exports = { APPROVED_SLOTS_FILE, loadApprovedSlots, saveApprovedSlots, approveSlot, denySlot }
