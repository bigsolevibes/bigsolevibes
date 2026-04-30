'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const CARD  = '#162233'
const MUTED = '#4A6380'
const NAVY  = '#0D1B2A'

export default function DropPage() {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail]         = useState('')
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe-drop', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ firstName, email }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: NAVY, color: CREAM }}
    >
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav
        className="w-full flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: AMBER + '22' }}
      >
        <Link
          href="/"
          className="font-heading text-xl tracking-widest hover:opacity-70 transition-opacity"
          style={{ color: CREAM }}
        >
          BIG SOLE VIBES
        </Link>
        <Link
          href="/lounge"
          className="font-heading text-xs tracking-widest hover:opacity-70 transition-opacity"
          style={{ color: MUTED }}
        >
          THE LOUNGE →
        </Link>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col items-center justify-center text-center px-6 py-24 gap-8"
        style={{ borderBottom: `1px solid ${AMBER}22` }}
      >
        <p
          className="font-heading text-xs tracking-widest"
          style={{ color: AMBER }}
        >
          THE DROP
        </p>

        <h1
          className="font-body text-5xl sm:text-7xl leading-none max-w-2xl"
          style={{ color: CREAM }}
        >
          The kicks come off soon. What&apos;s underneath better{' '}
          <span style={{ color: AMBER }}>be right.</span>
        </h1>

        <p
          className="font-body text-base sm:text-lg italic max-w-lg leading-relaxed"
          style={{ color: MUTED }}
        >
          The fit is dialed. The laces are clean. But the day ends, the shoes
          come off, and the real check happens. Big Sole Vibes does the research
          so your foundation is as locked as everything above it.
          You already know.
        </p>

        <div className="w-16 h-px" style={{ backgroundColor: AMBER }} />

        <p
          className="font-heading text-xs tracking-widest"
          style={{ color: MUTED }}
        >
          THE FOUNDATION DOESN&apos;T DISCRIMINATE.
        </p>
      </section>

      {/* ── What you get ────────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-10">
          <h2
            className="font-heading text-2xl sm:text-3xl tracking-wide text-center"
            style={{ color: CREAM }}
          >
            What The Drop Delivers
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                label: 'The Audit',
                body:  "We put in the reps so you don't have to. Every product tested, graded, and ranked. No hype, no filler — just what actually holds up.",
              },
              {
                label: 'The Standard',
                body:  "Game-day prep starts at the ground level. Recovery protocols, pre-fit rituals, and the habits that separate the guys who finish strong from the ones who tap out.",
              },
              {
                label: 'First Access',
                body:  "First look at the Proprietor's Foot Balm drop. Founding member pricing. The shelf opens to the list first — everyone else waits.",
              },
            ].map(item => (
              <div
                key={item.label}
                className="flex flex-col gap-3 p-6 border"
                style={{ backgroundColor: CARD, borderColor: AMBER + '22' }}
              >
                <p
                  className="font-heading text-xs tracking-widest"
                  style={{ color: AMBER }}
                >
                  {item.label}
                </p>
                <p
                  className="font-body text-sm leading-relaxed"
                  style={{ color: MUTED }}
                >
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Signup ──────────────────────────────────────────────────────────── */}
      <section
        className="py-20 px-6"
        style={{ backgroundColor: CARD, borderTop: `1px solid ${AMBER}22`, borderBottom: `1px solid ${AMBER}22` }}
      >
        <div className="max-w-lg mx-auto flex flex-col items-center gap-8 text-center">

          <div className="flex flex-col gap-2">
            <h2
              className="font-heading text-3xl sm:text-4xl tracking-wide"
              style={{ color: CREAM }}
            >
              Get On the List
            </h2>
            <p
              className="font-body text-sm italic"
              style={{ color: MUTED }}
            >
              No spam. No noise. Just the drop, when it hits.
            </p>
          </div>

          <div className="relative w-full">
            {/* Success */}
            <p
              className="font-body text-xl italic text-center absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                color:      AMBER,
                opacity:    status === 'success' ? 1 : 0,
                transition: 'opacity 250ms ease',
              }}
            >
              You&apos;re in. Stay fresh.
            </p>

            {/* Form */}
            <div
              style={{
                opacity:       status === 'success' ? 0 : 1,
                transition:    'opacity 200ms ease',
                pointerEvents: status === 'success' ? 'none' : 'auto',
              }}
            >
              <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full">
                <input
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  required
                  disabled={status === 'loading'}
                  className="rounded-lg px-4 py-3 text-sm outline-none border font-body disabled:opacity-50 w-full"
                  style={{ backgroundColor: NAVY, color: CREAM, borderColor: MUTED + '55' }}
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={status === 'loading'}
                  className="rounded-lg px-4 py-3 text-sm outline-none border font-body disabled:opacity-50 w-full"
                  style={{ backgroundColor: NAVY, color: CREAM, borderColor: MUTED + '55' }}
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="rounded-lg px-6 py-3 text-sm font-semibold uppercase tracking-widest font-heading disabled:opacity-60 disabled:cursor-not-allowed w-full"
                  style={{ backgroundColor: AMBER, color: NAVY }}
                >
                  {status === 'loading' ? 'One moment…' : 'Lock It In'}
                </button>
              </form>
              {status === 'error' && (
                <p className="font-body text-sm text-center mt-2" style={{ color: '#C0392B' }}>
                  Something went wrong. Try again.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Quote ───────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-6">
          <div className="w-12 h-px" style={{ backgroundColor: AMBER }} />
          <blockquote
            className="font-body text-xl sm:text-2xl italic leading-relaxed"
            style={{ color: CREAM }}
          >
            &ldquo;20 or 80. Boots or Jordans. The standard is the same.&rdquo;
          </blockquote>
          <cite
            className="font-heading text-xs tracking-widest not-italic"
            style={{ color: AMBER }}
          >
            — BIG SOLE VIBES
          </cite>
          <div className="w-12 h-px" style={{ backgroundColor: AMBER }} />
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        className="mt-auto px-6 py-8 text-center font-body text-xs border-t"
        style={{ color: MUTED, borderColor: AMBER + '22' }}
      >
        © 2025 Big Sole Vibes. All rights reserved.
        <span className="mx-3" style={{ color: AMBER + '44' }}>|</span>
        <Link href="/lounge" className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>
          The Lounge →
        </Link>
      </footer>
    </div>
  )
}
