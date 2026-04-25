const REDIRECT = 'https://bigsolevibes.com/auth/callback'

function html(body: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BSV Auth</title>
  <style>
    body { font-family: monospace; background: #0D1B2A; color: #F5ECD7; padding: 2rem; }
    h2   { color: #C17D2E; }
    pre  { background: #111d2e; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.95rem; }
    .err { color: #ff6b6b; }
    .lbl { color: #888; margin-bottom: 0.25rem; }
  </style>
</head>
<body>${body}</body>
</html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}

export async function onRequestGet(context: any) {
  const url = new URL(context.request.url)
  const code  = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    const desc = url.searchParams.get('error_description') || error
    return html(`<h2 class="err">Auth failed</h2><p>${desc}</p>`)
  }

  if (!code) {
    return html(`<h2 class="err">Missing code</h2><p>No OAuth code in the callback URL.</p>`)
  }

  const appId     = context.env.META_APP_ID
  const appSecret = context.env.META_APP_SECRET

  if (!appId || !appSecret) {
    return html(`<h2 class="err">Server misconfigured</h2><p>META_APP_ID and META_APP_SECRET must be set in Cloudflare Pages environment variables.</p>`)
  }

  try {
    // Step 1: exchange code for short-lived token
    const tokenParams = new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      grant_type:    'authorization_code',
      redirect_uri:  REDIRECT,
      code,
    })
    const tokenRes  = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: tokenParams })
    const tokenData = await tokenRes.json() as any
    if (tokenData.error_message) throw new Error(tokenData.error_message)
    if (tokenData.error)         throw new Error(tokenData.error.message || JSON.stringify(tokenData.error))
    const shortToken = tokenData.access_token

    // Step 2: exchange for long-lived token (~60 days)
    const longParams = new URLSearchParams({
      grant_type:    'ig_exchange_token',
      client_secret: appSecret,
      access_token:  shortToken,
    })
    const longRes  = await fetch(`https://graph.instagram.com/access_token?${longParams}`)
    const longData = await longRes.json() as any
    if (longData.error) throw new Error(longData.error.message || JSON.stringify(longData.error))
    const longToken = longData.access_token

    // Step 3: fetch account info
    const meRes  = await fetch(`https://graph.instagram.com/me?fields=id,username,name&access_token=${longToken}`)
    const me     = await meRes.json() as any
    if (me.error) throw new Error(me.error.message || JSON.stringify(me.error))

    return html(`
      <h2>✓ Authentication successful</h2>
      ${me.username ? `<p>Instagram: <strong>@${me.username}</strong>${me.name ? ` &mdash; ${me.name}` : ''}</p>` : ''}
      <p class="lbl">Add these to your .env and Cloudflare Pages environment variables:</p>
      <pre>META_IG_ACCOUNT_ID=${me.id}
META_ACCESS_TOKEN=${longToken}</pre>
      <p style="color:#888;font-size:0.85rem">This token is valid for ~60 days. Re-run <code>node scripts/meta-auth.js</code> to refresh it.</p>
    `)
  } catch (err: any) {
    return html(`<h2 class="err">Error</h2><pre>${err.message}</pre>`)
  }
}
