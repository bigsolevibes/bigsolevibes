import type { Metadata } from 'next'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'The Brief',
  description: 'Weekly foot care intel, product drops, and editorial from Big Sole Vibes — delivered to your inbox.',
}

const pastIssues = [
  {
    number: '#004',
    headline: 'The Heel Crack Files',
    preview: 'Why standard moisturizers fail below the ankle, and the two-step system that doesn\'t.',
    date: 'Apr 14, 2026',
  },
  {
    number: '#003',
    headline: 'New Drop: The Scrub Edit',
    preview: 'We compared 11 foot scrubs. Three survived. Here\'s why — and which one is worth your money.',
    date: 'Apr 7, 2026',
  },
  {
    number: '#002',
    headline: 'Sock Science',
    preview: 'Everything you thought you knew about cotton socks is wrong. The data is embarrassingly clear.',
    date: 'Mar 31, 2026',
  },
  {
    number: '#001',
    headline: 'Welcome to The Brief',
    preview: 'Why we\'re building this, who it\'s for, and what you can expect every Monday morning.',
    date: 'Mar 24, 2026',
  },
]

const pillars = [
  { icon: '📋', label: 'One audit', detail: 'A single foot care check or technique, broken down simply.' },
  { icon: '🛍️', label: 'One product', detail: 'What we\'re using this week, and exactly why it made the cut.' },
  { icon: '📖', label: 'One read', detail: 'The best piece of content we found — inside or outside the brand.' },
]

export default function BriefPage() {
  return (
    <>
      <SiteNav />
      <main className="pt-16">

        {/* Hero */}
        <section className="py-24 bg-bsv-card border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-bsv-amber font-heading tracking-widest text-sm mb-4">WEEKLY NEWSLETTER</p>
            <h1 className="font-heading text-6xl sm:text-8xl text-bsv-cream tracking-wide mb-6 leading-none">
              THE <span className="text-bsv-amber">BRIEF</span>
            </h1>
            <p className="text-bsv-muted text-lg max-w-xl mx-auto mb-10 leading-relaxed">
              Three things, every Monday. Foot care intel that's actually worth reading —
              no padding, no spam, no nonsense.
            </p>

            {/* Signup form */}
            <form
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="email"
                placeholder="your@email.com"
                required
                className="flex-1 bg-bsv-bg border border-white/10 focus:border-bsv-amber/60 text-bsv-cream placeholder-bsv-muted px-5 py-4 text-sm outline-none transition-colors font-body"
              />
              <button
                type="submit"
                className="bg-bsv-amber hover:bg-amber-600 text-bsv-navy font-heading tracking-widest text-sm px-7 py-4 transition-colors whitespace-nowrap"
              >
                SUBSCRIBE
              </button>
            </form>
            <p className="text-bsv-muted text-xs mt-4">Free. Unsubscribe any time. No third-party sharing.</p>
          </div>
        </section>

        {/* What's inside */}
        <section className="py-20 bg-bsv-bg border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading text-4xl text-bsv-cream tracking-wide mb-12 text-center">
              WHAT'S <span className="text-bsv-amber">INSIDE</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {pillars.map((p) => (
                <div key={p.label} className="bg-bsv-card border border-white/5 p-8 text-center">
                  <div className="text-3xl mb-4">{p.icon}</div>
                  <p className="font-heading text-xl text-bsv-amber tracking-wide mb-3">{p.label}</p>
                  <p className="text-bsv-muted text-sm leading-relaxed">{p.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Past issues */}
        <section className="py-20 bg-bsv-bg">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading text-4xl text-bsv-cream tracking-wide mb-12">
              PAST <span className="text-bsv-amber">ISSUES</span>
            </h2>
            <div className="flex flex-col gap-4">
              {pastIssues.map((issue) => (
                <div
                  key={issue.number}
                  className="bg-bsv-card border border-white/5 hover:border-bsv-amber/30 transition-colors p-6 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  <span className="font-heading text-bsv-amber/50 text-sm tracking-widest flex-shrink-0 w-12">
                    {issue.number}
                  </span>
                  <div className="flex-1">
                    <p className="font-heading text-xl text-bsv-cream tracking-wide mb-1">{issue.headline}</p>
                    <p className="text-bsv-muted text-sm leading-relaxed">{issue.preview}</p>
                  </div>
                  <span className="text-bsv-muted text-xs flex-shrink-0">{issue.date}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA repeat */}
        <section className="py-20 bg-bsv-card border-t border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="font-heading text-4xl text-bsv-cream tracking-wide mb-4">
              JOIN <span className="text-bsv-amber">THE LIST</span>
            </h2>
            <p className="text-bsv-muted mb-8 max-w-sm mx-auto">
              Every Monday. One brief. The only foot care newsletter that respects your time.
            </p>
            <form className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto" onSubmit={(e) => e.preventDefault()}>
              <input
                type="email"
                placeholder="your@email.com"
                required
                className="flex-1 bg-bsv-bg border border-white/10 focus:border-bsv-amber/60 text-bsv-cream placeholder-bsv-muted px-5 py-4 text-sm outline-none transition-colors font-body"
              />
              <button
                type="submit"
                className="bg-bsv-amber hover:bg-amber-600 text-bsv-navy font-heading tracking-widest text-sm px-7 py-4 transition-colors whitespace-nowrap"
              >
                SUBSCRIBE
              </button>
            </form>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
