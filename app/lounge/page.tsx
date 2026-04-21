import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'The Lounge',
  description: 'Culture, style, and the lifestyle behind the kicks. Big Sole Vibes editorial.',
}

const features = [
  {
    label: 'STYLE',
    title: 'How to Dress Around Your Sneakers',
    excerpt:
      'Your kicks tell the story before you say a word. Here\'s how to build fits that let them breathe.',
    readTime: '5 min read',
  },
  {
    label: 'CULTURE',
    title: 'The Rise of Sneaker Maintenance Culture',
    excerpt:
      'Clean shoes aren\'t just vanity — they\'re respect. We trace how sneaker care went from niche to necessary.',
    readTime: '7 min read',
  },
  {
    label: 'WELLNESS',
    title: 'Why Your Feet Deserve the Same Attention as Your Face',
    excerpt:
      'Skincare has had its moment. Foot care is next — and the science backs it up completely.',
    readTime: '4 min read',
  },
  {
    label: 'GROOMING',
    title: 'The 10-Minute Routine That Changes Everything',
    excerpt:
      'You don\'t need an hour. You need a system. This is ours, broken down step by step.',
    readTime: '3 min read',
  },
  {
    label: 'COMMUNITY',
    title: 'Men Who Care: Profiles in Foot Health',
    excerpt:
      'We talked to athletes, sneakerheads, and working professionals. Here\'s what they all have in common.',
    readTime: '6 min read',
  },
  {
    label: 'GEAR',
    title: 'The Shelf: What\'s Worth Keeping, What\'s Not',
    excerpt:
      'We tested everything so you don\'t have to. Monthly breakdown of what earns permanent shelf space.',
    readTime: '5 min read',
  },
]

export default function LoungePage() {
  return (
    <>
      <SiteNav />
      <main className="pt-16">

        {/* Hero */}
        <section className="py-24 bg-bsv-card border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-bsv-amber font-heading tracking-widest text-sm mb-4">THE LOUNGE</p>
              <h1 className="font-heading text-6xl sm:text-7xl text-bsv-cream tracking-wide mb-6 leading-none">
                CULTURE.<br />
                STYLE.<br />
                <span className="text-bsv-amber">VIBES.</span>
              </h1>
              <p className="text-bsv-muted text-lg leading-relaxed">
                Editorial content for men who take care of themselves. No fluff, no lectures —
                just real talk about the lifestyle behind the brand.
              </p>
            </div>
          </div>
        </section>

        {/* Featured grid */}
        <section className="py-24 bg-bsv-bg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((item) => (
                <article
                  key={item.title}
                  className="bg-bsv-card border border-white/5 hover:border-bsv-amber/30 transition-colors p-8 flex flex-col group cursor-pointer"
                >
                  <span className="text-bsv-amber font-heading tracking-widest text-xs mb-4">
                    {item.label}
                  </span>
                  <h2 className="font-heading text-2xl text-bsv-cream tracking-wide mb-3 group-hover:text-bsv-amber transition-colors">
                    {item.title}
                  </h2>
                  <p className="text-bsv-muted text-sm leading-relaxed flex-1 mb-6">
                    {item.excerpt}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-bsv-muted text-xs">{item.readTime}</span>
                    <span className="text-bsv-amber font-heading tracking-widest text-xs inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                      COMING SOON
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CTA strip */}
        <section className="py-16 bg-bsv-card border-t border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <p className="font-heading text-2xl text-bsv-cream tracking-wide">Want it in your inbox?</p>
              <p className="text-bsv-muted text-sm mt-1">Get The Brief — our weekly drop of the best content.</p>
            </div>
            <Link
              href="/brief"
              className="bg-bsv-amber hover:bg-amber-600 text-bsv-navy font-heading tracking-widest text-sm px-8 py-4 transition-colors whitespace-nowrap"
            >
              GET THE BRIEF
            </Link>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
