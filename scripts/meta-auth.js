require('dotenv').config()
const { exec } = require('child_process')
const { URL } = require('url')

const APP_ID   = process.env.META_APP_ID
const REDIRECT = 'https://bigsolevibes.com/auth/callback'
const SCOPES   = 'instagram_business_basic,instagram_business_content_publish'

if (!APP_ID) {
  console.error('✗ META_APP_ID must be set in .env')
  process.exit(1)
}

const authUrl = new URL('https://www.instagram.com/oauth/authorize')
authUrl.searchParams.set('client_id',     APP_ID)
authUrl.searchParams.set('redirect_uri',  REDIRECT)
authUrl.searchParams.set('scope',         SCOPES)
authUrl.searchParams.set('response_type', 'code')

console.log('\nOpening browser for Instagram login...')
console.log('After login, your token and account IDs will appear at:')
console.log('  https://bigsolevibes.com/auth/callback\n')
console.log('If the browser does not open, visit:\n' + authUrl.toString() + '\n')

exec(`open "${authUrl.toString()}"`)
