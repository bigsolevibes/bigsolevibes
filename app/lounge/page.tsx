'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const CARD  = '#162233'
const MUTED = '#4A6380'
const NAVY  = '#0D1B2A'

export default function LoungePage() {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail]         = useState('')
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe-lounge', {
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
    <>
      <SiteNav />
    <div
      className="min-h-screen flex flex-col pt-16"
      style={{ backgroundColor: NAVY, color: CREAM }}
    >

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col items-center justify-center text-center px-6 py-24 gap-8"
        style={{ borderBottom: `1px solid ${AMBER}22` }}
      >
        <p
          className="font-heading text-xs tracking-widest"
          style={{ color: AMBER }}
        >
          THE LOUNGE
        </p>

        <h1
          className="font-body text-5xl sm:text-7xl leading-none max-w-2xl"
          style={{ color: CREAM }}
        >
          The Good Life Starts at the{' '}
          <span style={{ color: AMBER }}>Foundation.</span>
        </h1>

        <p
          className="font-body text-base sm:text-lg italic max-w-lg leading-relaxed"
          style={{ color: MUTED }}
        >
          The boots are off. The day is done. The man who takes care of every
          detail knows the ritual doesn&apos;t start at the collar — it starts
          at the sole. Pull up a chair.
        </p>

        <div className="w-16 h-px" style={{ backgroundColor: AMBER }} />

        <p
          className="font-heading text-xs tracking-widest"
          style={{ color: MUTED }}
        >
          YOUR FEET WORK HARD. START ACTING LIKE IT.
        </p>
      </section>

      {/* ── What you get ────────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-10">
          <h2
            className="font-heading text-2xl sm:text-3xl tracking-wide text-center"
            style={{ color: CREAM }}
          >
            What The Lounge Delivers
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                label: 'The Weekly Audit',
                body:  "We test so you don't have to. Curated reviews of the best foot care products — ranked, scored, and proprietor-approved.",
              },
              {
                label: 'The Standard',
                body:  'Ritual guides. Recovery protocols. The difference between a man who gets by and a man who commands a room.',
              },
              {
                label: 'First Access',
                body:  "Early access to the Proprietor's Foot Balm launch. Founding member pricing. The shelf doesn't open to everyone.",
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
              Reserve Your Seat
            </h2>
            <p
              className="font-body text-sm italic"
              style={{ color: MUTED }}
            >
              No spam. No noise. Just the good stuff, when it&apos;s ready.
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
              Welcome to the Lounge.
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
                  {status === 'loading' ? 'One moment…' : 'Step Inside'}
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
            &ldquo;Nothing goes on this shelf that hasn&apos;t earned its place.&rdquo;
          </blockquote>
          <cite
            className="font-heading text-xs tracking-widest not-italic"
            style={{ color: AMBER }}
          >
            — THE PROPRIETOR
          </cite>
          <div className="w-12 h-px" style={{ backgroundColor: AMBER }} />
        </div>
      </section>

    </div>
      <Footer />
    </>
  )
}
