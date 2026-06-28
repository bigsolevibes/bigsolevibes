// push-to-main.js — merge preview/full-site into main and push (production deploy)
require('dotenv').config({ quiet: true })
const { execSync } = require('child_process')
const path = require('path')
const ROOT = path.join(__dirname, '..')

function run(cmd) {
  console.log(`$ ${cmd}`)
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 180000 }).trim()
  if (out) console.log(out)
  return out
}

try {
  run('git fetch origin')
  // Push preview/full-site directly to main — no branch switch required
  run('git push origin origin/preview/full-site:refs/heads/main')
  console.log('\n✓ main updated — Cloudflare production deploy triggered')
} catch (err) {
  console.error('ERROR:', err.stderr?.toString().trim() || err.message)
  process.exit(1)
}
