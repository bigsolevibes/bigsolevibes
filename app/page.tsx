'use client'

import { useState, useEffect, FormEvent } from 'react'

// ── Social links ──────────────────────────────────────────────────────────────
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
    href: '#',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" aria-hidden="true">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
]

// ── Countdown target: 60 days from April 16, 2026 ────────────────────────────
const TARGET = new Date('2026-06-15T00:00:00').getTime()

function useCountdown() {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 })

  useEffect(() => {
    function tick() {
      const diff = TARGET - Date.now()
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 })
        return
      }
      setTimeLeft({
        days:    Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours:   Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      })
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return timeLeft
}

function CountdownBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: '#242424' }}
      >
        <span
          className="font-heading text-4xl sm:text-5xl tabular-nums leading-none"
          style={{ color: '#E8621A' }}
        >
          {String(value).padStart(2, '0')}
        </span>
      </div>
      <span className="text-xs sm:text-sm uppercase tracking-widest" style={{ color: '#999999' }}>
        {label}
      </span>
    </div>
  )
}

export default function ComingSoonPage() {
  const { days, hours, minutes, seconds } = useCountdown()
  const [firstName, setFirstName] = useState('')
  const [email, setEmail]         = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // TODO: Connect to Klaviyo — replace this block with Klaviyo list subscribe API call
    // POST to https://a.klaviyo.com/api/v2/list/{LIST_ID}/members
    // with { api_key, profiles: [{ email, first_name: firstName }] }
    console.log('Sole Squad signup:', { firstName, email })
    setSubmitted(true)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between px-4 py-12"
      style={{ backgroundColor: '#1a1a1a', color: '#ffffff' }}
    >

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="w-full text-center">
        <span
          className="font-heading text-5xl sm:text-6xl tracking-wider"
          style={{ color: '#E8621A' }}
        >
          BSV
        </span>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex flex-col items-center gap-14 w-full max-w-2xl text-center mt-10">

        {/* Hero */}
        <section className="flex flex-col gap-4">
          <h1 className="font-heading text-5xl sm:text-7xl leading-none tracking-wide">
            Something Big<br />
            <span style={{ color: '#E8621A' }}>Is Coming</span>
          </h1>
          <p className="text-base sm:text-lg leading-relaxed max-w-lg mx-auto" style={{ color: '#999999' }}>
            Premium foot care built for men who take care of their kicks — and themselves.
          </p>
        </section>

        {/* Countdown */}
        <section className="flex gap-4 sm:gap-6 justify-center">
          <CountdownBox value={days}    label="Days"    />
          <CountdownBox value={hours}   label="Hours"   />
          <CountdownBox value={minutes} label="Minutes" />
          <CountdownBox value={seconds} label="Seconds" />
        </section>

        {/* Email capture */}
        <section className="w-full flex flex-col gap-6">
          <h2 className="font-heading text-3xl sm:text-4xl tracking-wide">
            Join the <span style={{ color: '#E8621A' }}>Sole Squad</span>
          </h2>

          {submitted ? (
            <p className="text-lg" style={{ color: '#E8621A' }}>
              You&apos;re in. We&apos;ll hit you when it&apos;s time. 🔥
            </p>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col sm:flex-row gap-3 w-full"
            >
              <input
                type="text"
                placeholder="First name"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                className="flex-1 rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-orange-500 transition-colors"
                style={{ backgroundColor: '#242424', color: '#ffffff' }}
              />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="flex-1 rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-orange-500 transition-colors"
                style={{ backgroundColor: '#242424', color: '#ffffff' }}
              />
              <button
                type="submit"
                className="rounded-lg px-6 py-3 text-sm font-semibold uppercase tracking-widest transition-opacity hover:opacity-90 whitespace-nowrap"
                style={{ backgroundColor: '#E8621A', color: '#ffffff' }}
              >
                Notify Me
              </button>
            </form>
          )}
        </section>

        {/* Socials */}
        <section className="flex gap-6 justify-center">
          {SOCIALS.map(s => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              className="transition-colors hover:text-orange-500"
              style={{ color: '#999999' }}
            >
              {s.icon}
            </a>
          ))}
        </section>

      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="mt-10 text-xs" style={{ color: '#999999' }}>
        © 2025 Big Sole Vibes. All rights reserved.
      </footer>

    </div>
  )
}
