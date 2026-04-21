import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'The Sole Audits',
  description:
    "We audit the industry's best and worst so you don't have to. Each Sole Audit is a verdict, not a review.",
}

interface Audit {
  number: string
  title: string
  teaser: string
  status: 'Dropping Soon' | 'In Queue'
}

const AUDITS: Audit[] = [
  {
    number: '01',
    title: 'The Mojito Mistake',
    teaser: 'A story as old as summer. The sandals. The occasion. The aftermath.',
    status: 'Dropping Soon',
  },
  {
    number: '02',
    title: 'The German Question',
    teaser: 'Is Gehwol actually worth the tin? We put a century of credibility to the test.',
    status: 'In Queue',
  },
  {
    number: '03',
    title: 'The Spa Day Confession',
    teaser: 'Men who get pedicures and men who lie about getting pedicures. There are only two kinds.',
    status: 'In Queue',
  },
  {
    number: '04',
    title: 'The Locker Room Report',
    teaser: "What's actually living in your gym shoes. Not for the faint of heart.",
    status: 'In Queue',
  },
]

export default function AuditsPage() {
  return (
    <>
      <SiteNav />
      <main className="pt-16 bg-bsv-bg min-h-screen">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-4">
              THE SOLE AUDITS
            </p>
            <h1 className="font-body text-5xl sm:text-6xl text-bsv-cream leading-none mb-6">
              We Audit. You Decide.
            </h1>
            <p className="font-body text-base sm:text-lg italic text-bsv-muted max-w-2xl mx-auto">
              We&apos;ve spent the hours auditing the industry&apos;s best and worst so you don&apos;t have to.
              Each Sole Audit is a verdict, not a review.
            </p>
          </div>
        </section>

        {/* ── Featured coming-soon band ─────────────────────────────────────── */}
        <section className="py-16 bg-bsv-surface border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="border border-bsv-amber/30 p-10 sm:p-14 flex flex-col items-center text-center gap-6">
              <span className="font-heading text-xs tracking-widest text-bsv-amber">
                FIRST AUDIT — DROPPING SOON
              </span>
              <h2 className="font-body text-4xl sm:text-5xl text-bsv-cream leading-none">
                The Mojito Mistake
              </h2>
              <p className="font-body text-base sm:text-lg text-bsv-muted max-w-xl leading-relaxed">
                You know what you did. We&apos;re going to talk about it. The first Sole Audit drops
                soon — join The Lounge to get notified first.
              </p>
              <Link
                href="/"
                className="font-heading text-xs tracking-widest bg-bsv-amber text-bsv-navy px-8 py-4 hover:opacity-85 transition-opacity whitespace-nowrap"
              >
                JOIN THE LOUNGE
              </Link>
            </div>
          </div>
        </section>

        {/* ── Audit cards 2×2 ──────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-10 text-center">
              UP NEXT
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {AUDITS.map((audit) => (
                <div
                  key={audit.number}
                  className="bg-bsv-card border border-white/5 p-8 flex flex-col gap-4"
                >
                  <span className="font-heading text-5xl text-bsv-amber/20 leading-none select-none">
                    {audit.number}
                  </span>
                  <h3 className="font-heading text-2xl text-bsv-cream tracking-wide leading-tight">
                    {audit.title}
                  </h3>
                  <p className="font-body text-sm text-bsv-muted leading-relaxed flex-1">
                    {audit.teaser}
                  </p>
                  <span
                    className={`font-heading text-xs tracking-widest self-start px-3 py-1 ${
                      audit.status === 'Dropping Soon'
                        ? 'bg-bsv-amber text-bsv-navy'
                        : 'border border-white/10 text-bsv-muted'
                    }`}
                  >
                    {audit.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
