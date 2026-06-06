import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'
import EmailCapture from '@/components/EmailCapture'
import OpeningCrawl from '@/app/components/OpeningCrawl'
import { getAllPosts } from '@/lib/mdx'

type FeaturedProduct = {
  name: string
  category: string
  affiliate_url: string
  narrative: string
}

function getFeaturedProducts(): FeaturedProduct[] {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public/shop/featured.json'), 'utf8')
    return (JSON.parse(raw).picks || []) as FeaturedProduct[]
  } catch {
    return []
  }
}

export default function HomePage() {
  const today    = new Date()
  today.setHours(0, 0, 0, 0)
  const posts    = getAllPosts()
    .filter((p) => new Date(p.date) <= today)
    .slice(0, 3)
  const products = getFeaturedProducts()

  return (
    <>
      <SiteNav />
      <main className="bg-bsv-bg">

        {/* ── OPENING CRAWL ─────────────────────────────────────────────── */}
        <OpeningCrawl />

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section id="hero" className="relative bg-bsv-bg py-28 sm:py-36 border-b border-white/10 overflow-hidden">

          {/* Ambient grain texture */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }}
            aria-hidden="true"
          />

          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">

            <p className="font-heading text-xs tracking-[0.4em] text-bsv-amber mb-16">
              BIG SOLE VIBES — FROM HEAD TO TOE
            </p>

            <p className="font-display text-xl sm:text-2xl text-bsv-cream leading-relaxed mb-10">
              The hair is immaculate. The jacket is bespoke. The cologne smells like old money and minor scandals.
            </p>

            <p className="font-display text-xl sm:text-2xl text-bsv-cream leading-relaxed mb-10">
              He has, by every available metric, figured it out.
            </p>

            <p className="font-display text-2xl sm:text-3xl text-bsv-cream leading-relaxed font-semibold mb-20">
              His feet filed a formal complaint in 2019. It is still under review.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/the-lounge"
                className="bg-bsv-amber text-bsv-bg font-heading text-lg tracking-widest px-10 py-4 hover:opacity-90 transition-opacity"
              >
                THE LOUNGE
              </Link>
              <Link
                href="/shop"
                className="bg-bsv-amber text-bsv-bg font-heading text-lg tracking-widest px-10 py-4 hover:opacity-90 transition-opacity"
              >
                THE LOCKER ROOM
              </Link>
            </div>

          </div>
        </section>

        {/* ── THE MANIFESTO ─────────────────────────────────────────────── */}
        <section className="py-24 border-b border-white/10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="font-heading text-4xl sm:text-5xl text-bsv-amber tracking-wide mb-10">
              THE MANIFESTO
            </h2>
            <p className="font-body text-bsv-cream text-base sm:text-lg leading-relaxed">
              In 1823, a gentleman in Brussels conditioned his beard with imported oil, pressed his trousers to a knife edge, and then put on his boots without a second thought. Nothing has changed. For two centuries, men have applied extraordinary effort to everything above the ankle and treated everything below it as someone else&apos;s problem. The barber noticed. The tailor noticed. The woman who handed him his shoes noticed. Nobody said anything. Big Sole Vibes said something. We are a head-to-toe grooming brand for the man who has almost figured it out. The shelf covers the full body — face, hair, torso, recovery, and yes, the foundation. Because a man is one continuous structure, and the bottom of that structure has been quietly holding up the rest of it without so much as a thank you. The oversight ends here.
            </p>
          </div>
        </section>

        {/* ── THE SOLE REPORT ───────────────────────────────────────────── */}
        <section className="py-24 border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-heading text-4xl sm:text-5xl text-bsv-cream tracking-wide">
                THE SOLE REPORT
              </h2>
              <Link
                href="/sole-report"
                className="text-bsv-amber font-heading text-xs tracking-widest hover:opacity-70 transition-opacity hidden sm:block"
              >
                VIEW ALL →
              </Link>
            </div>

            <p className="font-body text-bsv-muted text-base mb-10 max-w-2xl">
              Dispatches from a man paying attention to the things most men aren&apos;t. Written without judgment. Mostly.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 border border-white/10">
              {posts.map((post, i) => {
                const spanClass   = posts.length === 2 && i === 0 ? 'md:col-span-2' : ''
                const borderClass = i < posts.length - 1
                  ? 'border-b md:border-b-0 md:border-r border-white/10'
                  : ''
                return (
                  <Link
                    key={post.slug}
                    href={`/sole-report/${post.slug}`}
                    className={`block p-8 hover:bg-bsv-card transition-colors ${spanClass} ${borderClass}`.trim()}
                  >
                    <p className="text-bsv-amber font-heading text-xs tracking-widest mb-3">
                      {new Date(post.date).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                    <h3 className="font-heading text-2xl text-bsv-cream tracking-wide leading-tight mb-3">
                      {post.title.toUpperCase()}
                    </h3>
                    <p className="text-bsv-muted text-sm leading-relaxed">{post.excerpt}</p>
                  </Link>
                )
              })}
            </div>

            <div className="mt-8 sm:hidden">
              <Link
                href="/sole-report"
                className="text-bsv-amber font-heading text-xs tracking-widest hover:opacity-70 transition-opacity"
              >
                VIEW ALL →
              </Link>
            </div>
          </div>
        </section>

        {/* ── THE LOCKER ROOM ───────────────────────────────────────────── */}
        <section className="py-24 bg-bsv-surface border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <p className="text-bsv-amber font-heading text-xs tracking-widest mb-2">
                  THE LOCKER ROOM
                </p>
                <h2 className="font-heading text-4xl sm:text-5xl text-bsv-cream tracking-wide">
                  WHAT&apos;S ON THE SHELF
                </h2>
              </div>
              <Link
                href="/shop"
                className="text-bsv-amber font-heading text-xs tracking-widest hover:opacity-70 transition-opacity hidden sm:block"
              >
                FULL SHELF →
              </Link>
            </div>

            <p className="font-body text-bsv-muted text-base mb-10 max-w-2xl">
              The shelf. Head to toe. Curated by someone with strong opinions, too much time, and a working theory about why men have ignored the bottom six inches of themselves since the Renaissance. Nothing here is average. Nothing here was easy to find. Everything here has a reason to exist.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 border border-white/10">
              {products.map((product, i) => (
                <div
                  key={product.name}
                  className={`p-8 flex flex-col${
                    i < products.length - 1 ? ' border-b md:border-b-0 md:border-r border-white/10' : ''
                  }`}
                >
                  <p className="text-bsv-amber font-heading text-xs tracking-widest mb-3">
                    {product.category.toUpperCase()}
                  </p>
                  <h3 className="font-heading text-xl text-bsv-cream tracking-wide mb-3">
                    {product.name.toUpperCase()}
                  </h3>
                  <p className="text-bsv-muted text-sm leading-relaxed mb-6 flex-1">
                    {product.narrative}
                  </p>
                  <div className="flex items-center justify-end">
                    <a
                      href={product.affiliate_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-bsv-amber font-heading text-xs tracking-widest border border-bsv-amber px-4 py-2 hover:bg-bsv-amber hover:text-bsv-bg transition-colors"
                    >
                      VIEW →
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 sm:hidden">
              <Link
                href="/shop"
                className="text-bsv-amber font-heading text-xs tracking-widest hover:opacity-70 transition-opacity"
              >
                FULL SHELF →
              </Link>
            </div>
          </div>
        </section>

        {/* ── THE BIG SOLE BRIEFING ─────────────────────────────────────── */}
        <EmailCapture />

      </main>
      <Footer />
    </>
  )
}
