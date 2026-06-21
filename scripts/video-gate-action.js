#!/usr/bin/env node
// CLI wrapper around video-gate-actions.js so the dashboard's
// /api/dashboard/video-review route can trigger Drive approve/deny via
// spawnSync — same pattern tiktok/post/route.ts uses to shell out to
// tiktok-post.js — rather than requiring a CommonJS script into the
// Next.js bundle.
//
// Usage:
//   node video-gate-action.js --approve "Video Review/mon-am.mp4"
//   node video-gate-action.js --deny "Video Review/mon-am.mp4"

const { approveVideo, rejectVideo } = require('./video-gate-actions')

const args        = process.argv.slice(2)
const approveIdx  = args.indexOf('--approve')
const denyIdx     = args.indexOf('--deny')

try {
  if (approveIdx !== -1) {
    const driveFile = args[approveIdx + 1]
    if (!driveFile) throw new Error('--approve requires a driveFile argument')
    approveVideo(driveFile)
    console.log(`OK approved ${driveFile}`)
  } else if (denyIdx !== -1) {
    const driveFile = args[denyIdx + 1]
    if (!driveFile) throw new Error('--deny requires a driveFile argument')
    rejectVideo(driveFile)
    console.log(`OK denied ${driveFile}`)
  } else {
    throw new Error('Usage: video-gate-action.js --approve|--deny "Video Review/<file>"')
  }
} catch (err) {
  console.error(`ERROR ${err.message}`)
  process.exit(1)
}
