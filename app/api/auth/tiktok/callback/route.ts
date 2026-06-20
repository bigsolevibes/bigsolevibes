import { NextRequest, NextResponse } from 'next/server'

// TikTok OAuth redirect target — registered in the TikTok developer portal as
// https://bigsolevibes.com/api/auth/tiktok/callback
//
// This route holds NO secrets and does NOT perform the token exchange. It only
// surfaces the one-time authorization `code` TikTok hands back so Big D can paste
// it into `node scripts/tiktok-auth.js --code "..."` on the local machine, where
// the client secret actually lives. Keeping the exchange local means no TikTok
// credentials ever need to live in Cloudflare Pages env vars.
//
// Lives outside app/api/auth/[...nextauth]/, so it is NOT covered by the
// "Dashboard — local only, never deploy" .gitignore exclusion and ships normally.

function page(body: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>TikTok Authorization — Big Sole Vibes</title>
<style>
  body { background:#0D1B2A; color:#f5efe6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px; }
  .card { max-width:640px; background:#13243a; border:1px solid #2a3d56; border-radius:12px; padding:32px 36px; }
  h1 { color:#C17D2E; font-size:20px; margin:0 0 16px; }
  p { line-height:1.5; }
  code, .cmd { display:block; background:#0D1B2A; border:1px solid #C17D2E; border-radius:8px; padding:14px 16px; color:#f5efe6; font-family:'SF Mono',Menlo,monospace; font-size:13px; overflow-x:auto; white-space:pre-wrap; word-break:break-all; margin:16px 0; }
  .muted { color:#9aa7b8; font-size:13px; }
</style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    return page(`
      <h1>TikTok authorization failed</h1>
      <p>${error}${errorDescription ? `: ${errorDescription}` : ''}</p>
      <p class="muted">Close this and re-run <code>node scripts/tiktok-auth.js</code> to get a fresh authorization link.</p>
    `)
  }

  if (!code) {
    return page(`
      <h1>No authorization code received</h1>
      <p class="muted">This page expects TikTok to redirect here with a <code>code</code> parameter. If you navigated here directly, start over with <code>node scripts/tiktok-auth.js</code>.</p>
    `)
  }

  return page(`
    <h1>TikTok authorized ✓</h1>
    <p>Copy the command below and run it on your machine to finish connecting TikTok. The code is single-use and expires quickly — run this now.</p>
    <div class="cmd">node scripts/tiktok-auth.js --code "${code.replace(/"/g, '&quot;')}"</div>
    <p class="muted">state: ${state ?? '(none)'}</p>
  `)
}
