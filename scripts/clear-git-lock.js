// One-shot: remove stale .git lock files so git can operate again
require('dotenv').config({ quiet: true })
const fs   = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

const locks = [
  '.git/HEAD.lock',
  '.git/index.lock',
  '.git/MERGE_HEAD.lock',
].map(l => path.join(ROOT, l))

for (const f of locks) {
  if (fs.existsSync(f)) {
    fs.unlinkSync(f)
    console.log(`Removed: ${f}`)
  } else {
    console.log(`Not found (ok): ${f}`)
  }
}
console.log('Done.')
