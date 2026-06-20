'use client'

import { useEffect, useState } from 'react'

// TikTok OAuth redirect target — registered in the TikTok developer portal as
// https://bigsolevibes.com/api/auth/tiktok/callback
//
// Why this is a PAGE and not a route.ts handler: the production site is
// statically exported for Cloudflare Pages (`output: 'export'` in
// next.config.js, gated on CF_PAGES=1). There is no Next.js server running in
// production — Cloudflare Pages just serves pre-built static files. A
// route.ts handler here read `req.url` per-request, which static export
// can't pre-render, and broke the Cloudflare build with
// "Export encountered errors on following paths: /api/auth/tiktok/callback".
//
// Fix: read TikTok's code/state/error straight out of the browser's URL
// (window.location) after the static HTML loads, client-side. No server
// logic, no secrets — same as the old route.ts's own comment said it never
// held secrets. Big D pastes the resulting command into
// `node scripts/tiktok-auth.js` on his machine, where TIKTOK_CLIENT_SECRET
// actually lives. Same URL as before, so the redirect URI registered in the
// TikTok developer portal does not need to change.

type CallbackParams = {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

const cardStyle: React.CSSProperties = {
  maxWidth: 640,
  background: '#13243a',
  border: '1px solid #2a3d56',
  borderRadius: 12,
  padding: '32px 36px',
}

const mutedStyle: React.CSSProperties = { color: '#9aa7b8', fontSize: 13 }

const cmdStyle: React.CSSProperties = {
  display: 'block',
  background: '#0D1B2A',
  border: '1px solid #C17D2E',
  borderRadius: 8,
  padding: '14px 16px',
  color: '#f5efe6',
  fontFamily: '"SF Mono", Menlo, monospace',
  fontSize: 13,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: '16px 0',
}

export default function TikTokCallbackPage() {
  const [params, setParams] = useState<CallbackParams | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    setParams({
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error: url.searchParams.get('error') ?? undefined,
      errorDescription: url.searchParams.get('error_description') ?? undefined,
    })
  }, [])

  return (
    <div
      style={{
        background: '#0D1B2A',
        color: '#f5efe6',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: 24,
        margin: 0,
      }}
    >
      <div style={cardStyle}>
        {params === null && <p>Loading…</p>}

        {params?.error && (
          <>
            <h1 style={{ color: '#C17D2E', fontSize: 20, margin: '0 0 16px' }}>TikTok authorization failed</h1>
            <p>{params.error}{params.errorDescription ? `: ${params.errorDescription}` : ''}</p>
            <p style={mutedStyle}>
              Close this and re-run <code>node scripts/tiktok-auth.js</code> to get a fresh authorization link.
            </p>
          </>
        )}

        {params && !params.error && !params.code && (
          <>
            <h1 style={{ color: '#C17D2E', fontSize: 20, margin: '0 0 16px' }}>No authorization code received</h1>
            <p style={mutedStyle}>
              This page expects TikTok to redirect here with a <code>code</code> parameter. If you navigated here
              directly, start over with <code>node scripts/tiktok-auth.js</code>.
            </p>
          </>
        )}

        {params?.code && (
          <>
            <h1 style={{ color: '#C17D2E', fontSize: 20, margin: '0 0 16px' }}>TikTok authorized ✓</h1>
            <p>
              Copy the command below and run it on your machine to finish connecting TikTok. The code is single-use
              and expires quickly — run this now.
            </p>
            <pre style={cmdStyle}>{`node scripts/tiktok-auth.js --code '${params.code}'`}</pre>
            <p style={mutedStyle}>
              Note: paste the command exactly as shown, with single quotes. TikTok codes can contain{' '}
              <code>!</code> and <code>*</code>, which zsh/bash mangle inside double quotes.
            </p>
            <p style={mutedStyle}>state: {params.state ?? '(none)'}</p>
          </>
        )}
      </div>
    </div>
  )
}
