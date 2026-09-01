'use client'

import { useEffect, useState } from 'react'

// eBay OAuth redirect target (RuName Auth Accepted URL) — registered in the
// eBay Developer Portal as https://bigsolevibes.com/api/auth/ebay/callback
//
// Same pattern as app/api/auth/tiktok/callback/page.tsx and for the same
// reason: production is a static export for Cloudflare Pages (no Next.js
// server at runtime), so this has to be a client-side page reading the code
// out of window.location, not a route.ts handler. No secrets live here —
// EBAY_SANDBOX_CERT_ID / EBAY_PROD_CERT_ID stay in .env on Big D's machine.
// He pastes the resulting command into `node scripts/ebay-auth.js` there.

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

export default function EbayCallbackPage() {
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
            <h1 style={{ color: '#C17D2E', fontSize: 20, margin: '0 0 16px' }}>eBay authorization failed</h1>
            <p>{params.error}{params.errorDescription ? `: ${params.errorDescription}` : ''}</p>
            <p style={mutedStyle}>
              Close this and re-run <code>node scripts/ebay-auth.js</code> to get a fresh authorization link.
            </p>
          </>
        )}

        {params && !params.error && !params.code && (
          <>
            <h1 style={{ color: '#C17D2E', fontSize: 20, margin: '0 0 16px' }}>No authorization code received</h1>
            <p style={mutedStyle}>
              This page expects eBay to redirect here with a <code>code</code> parameter. If you navigated here
              directly, start over with <code>node scripts/ebay-auth.js</code>.
            </p>
          </>
        )}

        {params?.code && (
          <>
            <h1 style={{ color: '#C17D2E', fontSize: 20, margin: '0 0 16px' }}>eBay authorized ✓</h1>
            <p>
              Copy the command below and run it on your machine to finish connecting eBay. The code is single-use
              and expires in a few minutes — run this now.
            </p>
            <pre style={cmdStyle}>{`node scripts/ebay-auth.js --code '${params.code}'`}</pre>
            <p style={mutedStyle}>
              Note: paste the command exactly as shown, with single quotes. eBay codes contain <code>^</code>,{' '}
              <code>#</code> and <code>=</code>, which zsh/bash mangle inside double quotes or unquoted.
            </p>
            <p style={mutedStyle}>state: {params.state ?? '(none)'}</p>
          </>
        )}
      </div>
    </div>
  )
}

// deploy-retrigger: 2026-09-01T04:15:15Z
