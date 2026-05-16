'use client'

import { useState, useEffect, FormEvent } from 'react'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

interface RedditPost {
  title:     string
  author:    string
  url:       string
  published: string
  score:     number
  summary:   string | null
}

interface ThreadsData {
  subreddit:     string
  subreddit_url: string
  fetched_at:    string
  post_count:    number
  posts:         RedditPost[]
}

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const CARD  = '#162233'
const MUTED = '#4A6380'
const NAVY  = '#0D1B2A'

export default function LoungePage() {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail]         = useState('')
  const [status, setStatus]       = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [threads, setThreads]     = useState<ThreadsData | null>(null)

  useEffect(() => {
    fetch('/community/threads.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setThreads(data) })
      .catch(() => {})
  }, [])

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

      {/* ── Community / Reddit ──────────────────────────────────────────────── */}
      <section
        className="py-20 px-6"
        style={{ borderTop: `1px solid ${AMBER}22` }}
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-10">

          {/* Header */}
          <div className="flex flex-col items-center text-center gap-4">
            <p className="font-heading text-xs tracking-widest" style={{ color: AMBER }}>
              THE COMMUNITY
            </p>
            <h2
              className="font-heading text-2xl sm:text-3xl tracking-wide"
              style={{ color: CREAM }}
            >
              The Conversation Happening Now
            </h2>
            <p className="font-body text-sm max-w-lg leading-relaxed" style={{ color: MUTED }}>
              r/bigsolevibes is the community space — where the man who already holds the standard
              compares notes, asks the real questions, and occasionally calls out something that
              doesn&apos;t belong on the shelf. No judgment. Real conversations.
            </p>
          </div>

          {/* Thread cards */}
          {threads && threads.post_count > 0 ? (
            <div className="flex flex-col gap-4">
              {threads.posts.slice(0, 5).map((post, i) => (
                <a
                  key={i}
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col gap-2 p-5 border transition-colors"
                  style={{
                    backgroundColor: CARD,
                    borderColor:     `${AMBER}22`,
                    textDecoration:  'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = `${AMBER}66`)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = `${AMBER}22`)}
                >
                  <p
                    className="font-heading text-sm leading-snug"
                    style={{ color: CREAM }}
                  >
                    {post.title}
                  </p>
                  {post.summary && (
                    <p className="font-body text-xs leading-relaxed" style={{ color: MUTED }}>
                      {post.summary}{post.summary.length >= 220 ? '…' : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-1">
                    <span className="font-heading text-xs" style={{ color: MUTED }}>
                      u/{post.author}
                    </span>
                    {post.score > 0 && (
                      <span className="font-heading text-xs" style={{ color: AMBER }}>
                        ↑ {post.score}
                      </span>
                    )}
                    <span className="font-heading text-xs ml-auto" style={{ color: MUTED }}>
                      VIEW THREAD ↗
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            /* Empty state — sub is new, no posts yet */
            <div
              className="flex flex-col items-center gap-4 p-10 border text-center"
              style={{ backgroundColor: CARD, borderColor: `${AMBER}22` }}
            >
              <p className="font-heading text-xs tracking-widest" style={{ color: AMBER }}>
                FIRST IN THE DOOR
              </p>
              <p className="font-body text-sm leading-relaxed max-w-sm" style={{ color: MUTED }}>
                The room is open. Nobody has pulled up a chair yet — which means whoever gets
                here first sets the tone. That&apos;s usually how the best rooms start.
              </p>
            </div>
          )}

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://www.reddit.com/r/bigsolevibes/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 font-heading text-xs tracking-widest border transition-colors"
              style={{ borderColor: AMBER, color: AMBER }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = AMBER
                e.currentTarget.style.color = NAVY
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = AMBER
              }}
            >
              JOIN THE CONVERSATION ↗
            </a>
            {threads?.fetched_at && (
              <p className="font-body text-xs" style={{ color: MUTED }}>
                Updated {new Date(threads.fetched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            )}
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
