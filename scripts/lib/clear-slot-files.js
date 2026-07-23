// scripts/lib/clear-slot-files.js — clear a slot's generated files everywhere
// they can live, not just on the Drive remote.
//
// Added 2026-07-23. Root cause found while investigating Big D's report that
// "old posts that should have been denied are still showing" on the
// dashboard: `deny_slot` and `clear_drive_slot` in mcp-server.js only ever ran
// `rclone delete` against the Drive "Ready to Post/" remote. Every download
// path in this repo (watch-drive.js, image-gen.js, video-gen.js,
// telegram-queue.js) pulls from Drive with `rclone copy` — never `rclone
// sync` — so a file removed on the remote is never pruned from its local
// mirror at `~/tmp/bsv-ready/`. image-gen.js's scanPromptFiles() and
// watch-drive.js's caption scan both read straight from that local directory,
// so a "denied" slot's stale local .png/.md/-prompt.txt files kept getting
// picked back up on the next poll as if nothing had happened — confirmed live
// this session: thu-pm-flow was denied, then reappeared in
// watch-drive-state.json with `_approval_requested:true` on the very next
// `get_pipeline_state` check.
//
// This is the single place both denial tools now go through, so there's one
// definition of "actually cleared" instead of two copies that can drift.

const { execSync } = require('child_process')
const fs   = require('fs')
const os   = require('os')
const path = require('path')

const READY_DIR = path.join(os.homedir(), 'tmp', 'bsv-ready')

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

// Clears Drive "Ready to Post/" + the local ~/tmp/bsv-ready/ mirror for a slot
// and its -flow sibling. Returns { driveOk, driveMsg, localRemoved: string[] }.
function clearSlotFiles(slot, { root } = {}) {
  const REMOTE = 'big sole vibes:Big Sole Vibes/Ready to Post'
  const patterns = [`${slot}.*`, `${slot}-flow.*`, `${slot}-*prompt*`]

  const result = { driveOk: false, driveMsg: '', localRemoved: [] }

  try {
    execSync(
      `rclone delete "${REMOTE}" ${patterns.map(p => `--include "${p}"`).join(' ')}`,
      { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
    )
    result.driveOk = true
    result.driveMsg = `Drive: cleared "${slot}*" from Ready to Post/`
  } catch (e) {
    result.driveMsg = `Drive warning: ${e.stderr?.toString().trim() || e.message}`
  }

  try {
    const regexes = patterns.map(globToRegExp)
    const entries = fs.existsSync(READY_DIR) ? fs.readdirSync(READY_DIR) : []
    for (const name of entries) {
      if (regexes.some(re => re.test(name))) {
        try {
          fs.unlinkSync(path.join(READY_DIR, name))
          result.localRemoved.push(name)
        } catch { /* best-effort */ }
      }
    }
  } catch { /* READY_DIR unreadable — nothing local to clear */ }

  return result
}

module.exports = { clearSlotFiles, READY_DIR }
