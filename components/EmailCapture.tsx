'use client'

import { useState } from 'react'

export default function EmailCapture() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')

    const form = e.currentTarget
    const firstName = (form.elements.namedItem('firstName') as HTMLInputElement).value.trim()
    const email     = (form.elements.namedItem('email') as HTMLInputElement).value.trim()

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email }),
      })
      if (res.ok) {
        setStatus('success')
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || 'Something went wrong. Try again.')
        setStatus('error')
      }
    } catch {
      setErrorMsg('Network error. Try again.')
      setStatus('error')
    }
  }

  return (
    <section id="email-capture" className="py-24 bg-bsv-bg border-t border-white/10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="font-heading text-5xl sm:text-6xl text-bsv-cream tracking-wide mb-6">
          THE BIG SOLE BRIEFING
        </h2>
        <p className="text-bsv-muted text-base mb-10 max-w-md mx-auto">
          The Proprietor sends a dispatch when something earns it. Product finds. Notes from the shelf. Occasional reminders that you are, technically, one continuous person from head to toe. Join the rational resistance.
        </p>

        {status === 'success' ? (
          <p className="text-bsv-amber font-heading text-2xl tracking-wide">You&apos;re on the list.</p>
        ) : (
          <form className="flex flex-col sm:flex-row gap-4" onSubmit={handleSubmit}>
            <input
              type="text"
              name="firstName"
              placeholder="First Name"
              required
              disabled={status === 'loading'}
              className="flex-1 bg-bsv-card border border-white/10 focus:border-bsv-amber text-bsv-cream placeholder-bsv-muted px-5 py-4 outline-none transition-colors disabled:opacity-50"
            />
            <input
              type="email"
              name="email"
              placeholder="Email Address"
              required
              disabled={status === 'loading'}
              className="flex-1 bg-bsv-card border border-white/10 focus:border-bsv-amber text-bsv-cream placeholder-bsv-muted px-5 py-4 outline-none transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="bg-bsv-amber text-bsv-bg font-heading text-lg tracking-widest px-10 py-4 transition-opacity hover:opacity-90 whitespace-nowrap disabled:opacity-50"
            >
              {status === 'loading' ? 'JOINING…' : 'RECTIFY THE ERROR'}
            </button>
          </form>
        )}

        {status === 'error' && (
          <p className="text-red-400 text-sm mt-4">{errorMsg}</p>
        )}

        {status !== 'success' && (
          <p className="text-bsv-muted text-xs mt-4">
            By joining you agree to receive emails from Big Sole Vibes.
          </p>
        )}
      </div>
    </section>
  )
}
