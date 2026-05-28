#!/usr/bin/env node
/**
 * Run once to generate dashboard credentials.
 * Usage: node scripts/dashboard-setup.js
 * Outputs the three env vars to add to .env
 */
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const readline = require('readline')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

rl.question('Dashboard password: ', async (password) => {
  rl.close()
  const hash = await bcrypt.hash(password.trim(), 12)
  const secret = crypto.randomBytes(32).toString('hex')

  console.log('\n# Add these to .env:\n')
  console.log(`DASHBOARD_EMAIL=david@bigsolevibes.com`)
  console.log(`DASHBOARD_PASSWORD_HASH='${hash}'`)
  console.log(`NEXTAUTH_SECRET='${secret}'`)
  console.log('\nNextAuth reads NEXTAUTH_SECRET automatically — use this name exactly.\n')
})
