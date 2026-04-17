'use client'

import { useState } from 'react'

interface Props {
  title: string
  url: string
}

export default function SocialShare({ title, url }: Props) {
  const [copied, setCopied] = useState(false)

  const encoded = encodeURIComponent(url)
  const encodedTitle = encodeURIComponent(title)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('input')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-bsv-muted text-xs font-heading tracking-widest">SHARE</span>

      {/* X / Twitter */}
      <a
        href={`https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className="flex items-center gap-1.5 bg-bsv-surface hover:bg-bsv-orange/20 border border-white/10 hover:border-bsv-orange text-bsv-muted hover:text-bsv-orange px-3 py-1.5 text-xs font-heading tracking-widest transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.626 5.905-5.626zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
        POST
      </a>

      {/* Facebook */}
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
        className="flex items-center gap-1.5 bg-bsv-surface hover:bg-bsv-orange/20 border border-white/10 hover:border-bsv-orange text-bsv-muted hover:text-bsv-orange px-3 py-1.5 text-xs font-heading tracking-widest transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        SHARE
      </a>

      {/* Copy link */}
      <button
        onClick={handleCopy}
        aria-label="Copy link"
        className="flex items-center gap-1.5 bg-bsv-surface hover:bg-bsv-orange/20 border border-white/10 hover:border-bsv-orange text-bsv-muted hover:text-bsv-orange px-3 py-1.5 text-xs font-heading tracking-widest transition-colors"
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
            </svg>
            COPIED
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            COPY LINK
          </>
        )}
      </button>
    </div>
  )
}
