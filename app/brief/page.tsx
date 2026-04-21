import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'The Brief',
  description:
    "The Proprietor's take on foot care, grooming, ritual, and the quiet dignity of looking after yourself.",
}

const VOLUMES = [
  {
    vol: 'Vol. 001',
    title: 'Why Men Ignore Their Feet (And Why That\'s About to Change)',
  },
  {
    vol: 'Vol. 002',
    title: 'Five Products. One Shelf. No Compromises.',
  },
  {
    vol: 'Vol. 003',
    title: 'The Eleven-Minute Investment',
  },
]

export default function BriefPage() {
  return (
    <>
      <SiteNav />
      <main className="pt-16 bg-bsv-bg min-h-screen">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-4">
              THE BRIEF
            </p>
            <h1 className="font-body text-5xl sm:text-6xl text-bsv-cream leading-none mb-6">
              Dispatches from The Lounge.
            </h1>
            <p className="font-body text-base sm:text-lg italic text-bsv-muted max-w-2xl mx-auto">
              The Proprietor&apos;s take on foot care, grooming, ritual, and the quiet dignity
              of looking after yourself.
            </p>
          </div>
        </section>

        {/* ── Email signup ─────────────────────────────────────────────────── */}
        <section className="py-20 border-b border-white/5">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center gap-6">
            <div className="w-12 h-px bg-bsv-amber" />
            <h2 className="font-body text-3xl sm:text-4xl text-bsv-cream">
              Join The Lounge.
            </h2>
            <p className="font-body text-base text-bsv-muted leading-relaxed max-w-md">
              Founding members receive The Brief before anyone else. No spam, no nonsense.
              Just the good stuff.
            </p>
            <Link
              href="/"
              className="font-heading text-xs tracking-widest bg-bsv-amber text-bsv-navy px-10 py-4 hover:opacity-85 transition-opacity whitespace-nowrap"
            >
              RESERVE YOUR SEAT
            </Link>
            <div className="w-12 h-px bg-bsv-amber" />
          </div>
        </section>

        {/* ── What's Inside ────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-12 text-center">
              WHAT&apos;S INSIDE
            </p>
            <div className="flex flex-col divide-y divide-white/5">
              {VOLUMES.map((item) => (
                <div
                  key={item.vol}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-8"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                    <span className="font-heading text-xs tracking-widest text-bsv-amber whitespace-nowrap">
                      {item.vol}
                    </span>
                    <h3 className="font-heading text-xl sm:text-2xl text-bsv-cream tracking-wide leading-snug">
                      {item.title}
                    </h3>
                  </div>
                  <span className="font-heading text-xs tracking-widest text-bsv-muted border border-white/10 px-3 py-1 self-start sm:self-auto whitespace-nowrap">
                    COMING SOON
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Footer note ──────────────────────────────────────────────────── */}
        <section className="py-10 bg-bsv-card border-t border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-body text-sm italic text-bsv-muted">
              The Brief arrives in your inbox when you join The Lounge.
            </p>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
