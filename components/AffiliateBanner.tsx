'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'bsv_affiliate_dismissed'

export default function AffiliateBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY)
    if (!dismissed) setVisible(true)
  }, [])

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="w-full bg-bsv-surface border-b border-white/10 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <p className="text-bsv-muted text-xs text-center flex-1">
          This site contains affiliate links. We may earn a commission at no extra cost to you.
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-bsv-muted hover:text-bsv-white transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
