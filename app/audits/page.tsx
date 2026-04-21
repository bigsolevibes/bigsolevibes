import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Foot Audits',
  description: 'Find out exactly what your feet need. Free foot health audit from Big Sole Vibes.',
}

const auditCards = [
  {
    step: '01',
    title: 'Skin Condition',
    questions: [
      'Do you have dry, cracked heels?',
      'Is the skin on your soles rough or calloused?',
      'Do you experience persistent itching or peeling?',
    ],
    result: 'Dry to severe — needs moisture and exfoliation protocol.',
    tag: 'HYDRATION',
  },
  {
    step: '02',
    title: 'Nail Health',
    questions: [
      'Are your nails thick, discolored, or brittle?',
      'Do ingrown nails recur on any toe?',
      'When did you last trim and file your nails properly?',
    ],
    result: 'Maintenance overdue — weekly trim and cuticle care required.',
    tag: 'NAILS',
  },
  {
    step: '03',
    title: 'Odor & Hygiene',
    questions: [
      'Do your feet odor persists after washing?',
      'Do you rotate footwear and use moisture-wicking socks?',
      'Are you using an antifungal or deodorizing product?',
    ],
    result: 'Bacteria imbalance likely — hygiene and product routine needed.',
    tag: 'HYGIENE',
  },
  {
    step: '04',
    title: 'Comfort & Pain',
    questions: [
      'Do you experience heel or arch pain after standing?',
      'Do your feet swell noticeably by end of day?',
      'Are your current shoes providing adequate support?',
    ],
    result: 'Structural support gap — insoles and footwear assessment recommended.',
    tag: 'COMFORT',
  },
]

const recommendations = [
  { score: '0–1 flags', label: 'SOLID', note: 'You\'re already ahead. Maintain with a simple weekly routine.' },
  { score: '2–4 flags', label: 'NEEDS WORK', note: 'Targeted products and a consistent routine will fix this fast.' },
  { score: '5–8 flags', label: 'CRITICAL', note: 'Full reset required. Start with our recommended starter kit.' },
  { score: '9+ flags', label: 'SEE A PRO', note: 'Some conditions need a podiatrist. Don\'t ignore it.' },
]

export default function AuditsPage() {
  return (
    <>
      <SiteNav />
      <main className="pt-16">

        {/* Hero */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-bsv-amber font-heading tracking-widest text-sm mb-4">FREE TOOL</p>
            <h1 className="font-heading text-6xl sm:text-7xl text-bsv-cream tracking-wide mb-4 leading-none">
              THE FOOT <span className="text-bsv-amber">AUDIT</span>
            </h1>
            <p className="text-bsv-muted text-lg max-w-xl mx-auto">
              Four categories. Sixteen questions. A clear picture of exactly where you stand
              — and what to do about it.
            </p>
          </div>
        </section>

        {/* Audit cards */}
        <section className="py-24 bg-bsv-bg">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-8">
              {auditCards.map((card) => (
                <div
                  key={card.step}
                  className="bg-bsv-card border border-white/5 p-8 sm:p-10"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                    <div className="flex-shrink-0">
                      <span className="font-heading text-5xl text-bsv-amber/30 leading-none">
                        {card.step}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <h2 className="font-heading text-3xl text-bsv-cream tracking-wide">
                          {card.title}
                        </h2>
                        <span className="text-bsv-amber font-heading tracking-widest text-xs border border-bsv-amber/30 px-2 py-0.5">
                          {card.tag}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-3 mb-6">
                        {card.questions.map((q) => (
                          <li key={q} className="flex items-start gap-3 text-bsv-muted text-sm leading-relaxed">
                            <span className="text-bsv-amber mt-0.5 flex-shrink-0">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                              </svg>
                            </span>
                            {q}
                          </li>
                        ))}
                      </ul>
                      <div className="border-l-2 border-bsv-amber/40 pl-4">
                        <p className="text-bsv-cream text-sm font-medium">
                          <span className="text-bsv-amber font-heading tracking-widest text-xs mr-2">BENCHMARK</span>
                          {card.result}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Score key */}
        <section className="py-20 bg-bsv-card border-t border-white/5">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading text-4xl text-bsv-cream tracking-wide mb-12 text-center">
              READ YOUR <span className="text-bsv-amber">RESULTS</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {recommendations.map((rec) => (
                <div key={rec.label} className="bg-bsv-bg border border-white/5 p-6 text-center">
                  <p className="text-bsv-muted font-heading tracking-widest text-xs mb-2">{rec.score}</p>
                  <p className="font-heading text-2xl text-bsv-amber tracking-wide mb-3">{rec.label}</p>
                  <p className="text-bsv-muted text-sm leading-relaxed">{rec.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-bsv-bg border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <p className="font-heading text-2xl text-bsv-cream tracking-wide">Ready to fix what's flagged?</p>
              <p className="text-bsv-muted text-sm mt-1">Browse the full collection — every product is chosen for a reason.</p>
            </div>
            <Link
              href="/products"
              className="bg-bsv-amber hover:bg-amber-600 text-bsv-navy font-heading tracking-widest text-sm px-8 py-4 transition-colors whitespace-nowrap"
            >
              SHOP THE FIX
            </Link>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
