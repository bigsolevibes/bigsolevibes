import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'
import EmailCapture from '@/components/EmailCapture'
import { getAllPosts } from '@/lib/mdx'
import shopData from '@/data/shop-products.json'

export default function HomePage() {
  const today    = new Date()
  today.setHours(0, 0, 0, 0)
  const posts    = getAllPosts()
    .filter((p) => new Date(p.date) <= today)
    .slice(0, 3)
  const products = shopData.picks.slice(0, 3)

  return (
    <>
      <SiteNav />
      <main className="bg-bsv-bg">

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section className="relative min-h-screen flex items-center justify-center pt-16">
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url('/brand/bsv-hero-foundation.png')" }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-bsv-bg" style={{ opacity: 0.65 }} aria-hidden="true" />

          <div className="relative z-10 max-w-2xl mx-auto px-4 text-center">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-6">
              THE STANDARD
            </p>
            <h1 className="font-heading text-6xl sm:text-8xl leading-none tracking-wide text-bsv-cream mb-6">
              We&apos;ve Been<br />
              <span className="text-bsv-amber">Expecting You.</span>
            </h1>
            <p className="text-bsv-muted text-base sm:text-lg leading-relaxed mb-10 max-w-md mx-auto">
              The standard doesn&apos;t stop at the ankle. Everything on this shelf earned its place.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/the-lounge"
                className="px-8 py-4 border border-bsv-amber text-bsv-amber font-heading text-lg tracking-widest hover:bg-bsv-amber hover:text-bsv-bg transition-colors"
              >
                THE LOUNGE
              </Link>
              <Link
                href="/shop"
                className="px-8 py-4 border border-bsv-amber text-bsv-amber font-heading text-lg tracking-widest hover:bg-bsv-amber hover:text-bsv-bg transition-colors"
              >
                THE LOCKER ROOM
              </Link>
              <Link
                href="/#email-capture"
                className="px-8 py-4 border border-bsv-amber text-bsv-amber font-heading text-lg tracking-widest hover:bg-bsv-amber hover:text-bsv-bg transition-colors"
              >
                THE LOUNGE
              </Link>
            </div>
          </div>
        </section>

        {/* ── THE LOUNGE ────────────────────────────────────────────────── */}
        <section className="py-24 border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline justify-between mb-12">
              <h2 className="font-heading text-4xl sm:text-5xl text-bsv-cream tracking-wide">
                THE LOUNGE
              </h2>
              <Link
                href="/the-lounge"
                className="text-bsv-amber font-heading text-xs tracking-widest hover:opacity-70 transition-opacity hidden sm:block"
              >
                VIEW ALL →
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border border-white/10">
              {posts.map((post, i) => {
                const spanClass  = posts.length === 2 && i === 0 ? 'md:col-span-2' : ''
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
                href="/the-lounge"
                className="text-bsv-amber font-heading text-xs tracking-widest hover:opacity-70 transition-opacity"
              >
                VIEW ALL →
              </Link>
            </div>
          </div>
        </section>

        {/* ── SHELF PREVIEW ─────────────────────────────────────────────── */}
        <section className="py-24 bg-bsv-surface border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline justify-between mb-12">
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

            <div className="grid grid-cols-1 md:grid-cols-3 border border-white/10">
              {products.map((product, i) => (
                <div
                  key={product.asin}
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
                    {product.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-heading text-lg text-bsv-cream">{product.price}</span>
                    <a
                      href={product.affiliate}
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

        {/* ── EMAIL CAPTURE ─────────────────────────────────────────────── */}
        <EmailCapture />

      </main>
      <Footer />
    </>
  )
}
