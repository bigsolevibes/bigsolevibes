'use client' // redeploy

import { useState, FormEvent } from 'react'

const AMBER  = '#C17D2E'
const CREAM  = '#F5ECD7'
const CARD   = '#162233'
const MUTED  = '#4A6380'
const NAVY   = '#0D1B2A'

const SOCIALS = [
  {
    label: 'Instagram',
    href: 'https://instagram.com/bigsolevibes',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    ),
  },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/profile.php?id=61574284755297',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  {
    label: 'X',
    href: 'https://x.com/bigsolevibes',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: 'TikTok',
    href: 'https://tiktok.com/@bigsolevibes',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.53V6.77a4.85 4.85 0 01-1.01-.08z" />
      </svg>
    ),
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@bigsolevibes',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
]


export default function ComingSoonPage() {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail]         = useState('')
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email }),
      })
      if (!res.ok) throw new Error('failed')
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between px-4 py-12"
      style={{ backgroundColor: NAVY, color: CREAM }}
    >

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="w-full text-center flex flex-col items-center gap-1">
        <span className="font-heading text-4xl sm:text-5xl tracking-widest" style={{ color: CREAM }}>
          BIG SOLE VIBES
        </span>
        <span className="font-body text-sm sm:text-base italic" style={{ color: AMBER }}>
          Men&apos;s Foot Care &amp; Accessories
        </span>
        <div className="mt-2 w-16 h-px" style={{ backgroundColor: AMBER }} />
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex flex-col items-center gap-14 w-full text-center mt-10">

        {/* Hero — full width with background image */}
        <section className="relative w-screen flex flex-col items-center justify-center gap-5 py-24 px-4" style={{ marginLeft: 'calc(-50vw + 50%)' }}>
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url('/foundation_blurred_hero.png')" }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: NAVY, opacity: 0.6 }}
            aria-hidden="true"
          />
          <div className="relative z-10 flex flex-col items-center gap-5 w-full max-w-2xl mx-auto text-center px-4">
            <h1 className="font-heading text-5xl sm:text-7xl leading-none tracking-wide text-center" style={{ color: CREAM }}>
              We&apos;ve Been<br />
              <span style={{ color: AMBER }}>Expecting You.</span>
            </h1>
            <p className="font-body text-base sm:text-lg leading-relaxed max-w-lg text-center italic" style={{ color: MUTED }}>
              The day is done and the boots are off. Now, the man remains. This isn&apos;t about hygiene—it&apos;s about the ritual. Pull up a chair, pour a glass, and let&apos;s attend to the foundation. We&apos;ve spent the hours auditing the industry&apos;s best and worst so you don&apos;t have to.
            </p>
          </div>
        </section>

        {/* Cheeky line */}
        <section className="flex flex-col items-center gap-3 px-4">
          <p className="font-body text-base sm:text-lg italic text-center" style={{ color: MUTED }}>
            Relax. Your secret—and your socks—are safe with us.
          </p>
        </section>

        {/* Amber divider */}
        <div className="w-24 h-px" style={{ backgroundColor: AMBER }} />

        {/* Email capture */}
        <section className="flex flex-col items-center gap-6 w-full px-4">
          <h2 className="font-heading text-3xl sm:text-4xl tracking-wide text-center" style={{ color: CREAM }}>
            Reserve Your Seat for <span style={{ color: AMBER }}>the First Audit.</span>
          </h2>
          <p className="font-body text-sm italic text-center" style={{ color: MUTED }}>
            Join the Sole Squad — no spam, no nonsense. Just the good stuff.
          </p>

          <div className="relative w-full flex flex-col items-center" style={{ maxWidth: 500 }}>

            {/* Success message — fades in, sits behind form until needed */}
            <p
              className="font-body text-lg italic text-center absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                color: AMBER,
                opacity: status === 'success' ? 1 : 0,
                transition: 'opacity 250ms ease',
              }}
            >
              Welcome to the Lounge.
            </p>

            {/* Form — fades out on success, no transition on the button itself */}
            <div
              className="flex flex-col items-center gap-3 w-full"
              style={{
                opacity: status === 'success' ? 0 : 1,
                transition: 'opacity 200ms ease',
                pointerEvents: status === 'success' ? 'none' : 'auto',
              }}
            >
              <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 w-full">
                <input
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                  disabled={status === 'loading'}
                  className="flex-1 rounded-lg px-4 py-3 text-sm outline-none border font-body disabled:opacity-50"
                  style={{ backgroundColor: CARD, color: CREAM, borderColor: MUTED + '55' }}
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={status === 'loading'}
                  className="flex-1 rounded-lg px-4 py-3 text-sm outline-none border font-body disabled:opacity-50"
                  style={{ backgroundColor: CARD, color: CREAM, borderColor: MUTED + '55' }}
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="rounded-lg px-6 py-3 text-sm font-semibold uppercase tracking-widest whitespace-nowrap font-heading disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: AMBER, color: NAVY }}
                >
                  {status === 'loading' ? 'One moment…' : 'Step Inside'}
                </button>
              </form>
              {status === 'error' && (
                <p className="font-body text-sm text-center" style={{ color: '#C0392B' }}>
                  Something went wrong. Try again.
                </p>
              )}
            </div>

          </div>
        </section>

        {/* Socials */}
        <section className="flex gap-6 justify-center items-center">
          {SOCIALS.map(s => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              className="transition-opacity hover:opacity-70"
              style={{ color: AMBER }}
            >
              {s.icon}
            </a>
          ))}
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="mt-10 font-body text-xs text-center" style={{ color: MUTED }}>
        © 2025 Big Sole Vibes. All rights reserved.
      </footer>

    </div>
  )
}
