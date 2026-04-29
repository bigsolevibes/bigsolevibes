const REDIRECT = 'https://bigsolevibes.com/'

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
  const url   = new URL(context.request.url)
  const code  = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  // No OAuth params — serve the normal static homepage
  if (!code && !error) {
    return context.next()
  }

  if (error) {
    const desc = url.searchParams.get('error_description') || error
    return html(`<h2 class="err">Auth failed</h2><p>${desc}</p>`)
  }

  const appId     = context.env.META_APP_ID
  const appSecret = context.env.META_APP_SECRET

  if (!appId || !appSecret) {
    return html(`<h2 class="err">Server misconfigured</h2><p>META_APP_ID and META_APP_SECRET must be set in Cloudflare Pages environment variables.</p>`)
  }

  try {
    // Step 1: exchange code for short-lived User Access Token
    const tokenParams = new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      redirect_uri:  REDIRECT,
      code:          code as string,
    })
    const tokenRes  = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams}`)
    const tokenData = await tokenRes.json() as any
    if (tokenData.error) throw new Error(tokenData.error.message || JSON.stringify(tokenData.error))
    const shortToken = tokenData.access_token

    // Step 2: exchange for long-lived User Access Token (~60 days)
    const longParams = new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         appId,
      client_secret:     appSecret,
      fb_exchange_token: shortToken,
    })
    const longRes  = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${longParams}`)
    const longData = await longRes.json() as any
    if (longData.error) throw new Error(longData.error.message || JSON.stringify(longData.error))
    const longToken = longData.access_token

    // Step 3: fetch Pages this token can manage
    const pagesRes  = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${longToken}`)
    const pagesData = await pagesRes.json() as any
    if (pagesData.error) throw new Error(pagesData.error.message || JSON.stringify(pagesData.error))
    const pages = (pagesData.data || []) as any[]

    const pageRows = pages.map((p: any) =>
      `<tr><td style="padding:4px 12px 4px 0">${p.name}</td><td><code>META_PAGE_ID=${p.id}</code></td></tr>`
    ).join('')

    return html(`
      <h2>✓ Authentication successful</h2>
      <p class="lbl">Add these to your .env and Cloudflare Pages environment variables:</p>
      <pre>META_ACCESS_TOKEN=${longToken}</pre>
      ${pages.length > 0 ? `
        <p class="lbl">Facebook Pages found:</p>
        <table style="border-collapse:collapse">
          ${pageRows}
        </table>
      ` : '<p style="color:#888">No Pages found for this token.</p>'}
      <p style="color:#888;font-size:0.85rem;margin-top:1.5rem">Token is valid for ~60 days. Re-run <code>node scripts/meta-auth.js</code> to refresh.</p>
    `)
  } catch (err: any) {
    return html(`<h2 class="err">Error</h2><pre>${err.message}</pre>`)
  }
}
