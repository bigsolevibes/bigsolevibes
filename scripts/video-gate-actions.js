// video-gate-actions.js — shared Drive actions for video-gate approval items.
//
// Single source of truth for "approve" (move Video Review → Ready to Post)
// and "reject" (delete from Video Review) so telegram-webhook.js and the
// dashboard's /api/dashboard/video-review route can't drift out of sync.
//
// driveFile is always relative to DRIVE_ROOT, e.g. "Video Review/mon-am.mp4"
// — this is the exact string video-gen.js writes into
// metadata.driveFile when it stages a video (see addPendingItem call).

const { execSync } = require('child_process')

const DRIVE_ROOT = 'big sole vibes:Big Sole Vibes' // matches video-gen.js's GDRIVE_REMOTE

function approveVideo(driveFile) {
  const filename = driveFile.split('/').pop()
  execSync(
    `rclone moveto "${DRIVE_ROOT}/${driveFile}" "${DRIVE_ROOT}/Ready to Post/${filename}"`,
    { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
  )
}

function rejectVideo(driveFile) {
  execSync(
    `rclone deletefile "${DRIVE_ROOT}/${driveFile}"`,
    { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
  )
}

// Streams the raw mp4 bytes for preview without writing a temp file.
// maxBuffer covers Veo 3.1 Fast clip sizes (typically a few MB) with headroom.
function readVideoBuffer(driveFile) {
  return execSync(`rclone cat "${DRIVE_ROOT}/${driveFile}"`, {
    maxBuffer: 100 * 1024 * 1024,
    timeout: 30000,
  })
}

module.exports = { DRIVE_ROOT, approveVideo, rejectVideo, readVideoBuffer }
