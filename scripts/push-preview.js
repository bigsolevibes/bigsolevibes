// push-preview.js — push current preview/full-site to origin (with extended timeout)
require('dotenv').config({ quiet: true })
const { execSync } = require('child_process')
const path = require('path')
const ROOT = path.join(__dirname, '..')

console.log('[push-preview] pushing origin preview/full-site…')
try {
  const out = execSync('git push origin preview/full-site', {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 180000,
  })
  console.log('[push-preview] done —', out.trim() || 'ok')
} catch (err) {
  console.error('[push-preview] ERROR:', err.stderr?.toString().trim() || err.message)
  process.exit(1)
}
