import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: "The Lounge Collection | Big Sole Vibes",
  description:
    "Hand-selected foot care products. Proprietor-approved. Nothing goes on this shelf that hasn't earned its place.",
}

interface Product {
  badge: string
  name: string
  brand: string
  category: string
  desc: string
  price: string
  href: string
  featured: boolean
}

const KIT: Product[] = [
  {
    badge: "★ Proprietor's Pick",
    name: 'Holy Foot Cream',
    brand: 'Derm Dude',
    category: 'Creams & Balms',
    desc: "The one that started it all. Clinical-grade urea formula in packaging that doesn't embarrass you to leave on the counter. Fast-absorbing, no grease, no excuses.",
    price: '~$18',
    href: 'https://amzn.to/4cKzIMO',
    featured: true,
  },
  {
    badge: 'Creams & Balms',
    name: 'Massage Formula',
    brand: 'FOOTLOGIX',
    category: 'Creams & Balms',
    desc: 'Professional-grade mousse formula. The kind of thing that used to live exclusively in high-end spas.',
    price: '~$22',
    href: 'https://amzn.to/4thmAWi',
    featured: false,
  },
  {
    badge: 'Heavy Duty',
    name: 'Med Salve',
    brand: 'Gehwol',
    category: 'Heavy Duty',
    desc: 'German engineering applied to cracked heels. Over a century of podiatric credibility in a tin. No marketing. Just results.',
    price: '~$14',
    href: 'https://amzn.to/425zLOl',
    featured: false,
  },
  {
    badge: 'The Workhorse',
    name: 'Healthy Feet Jar',
    brand: "O'Keeffe's",
    category: 'The Essentials',
    desc: "No frills. No excuses. Concentrated results in a jar your grandfather would have respected.",
    price: '~$11',
    href: 'https://amzn.to/4dZ2g7t',
    featured: false,
  },
  {
    badge: 'Clinical',
    name: 'Foot Repair Serum',
    brand: 'Dr. Canuso',
    category: 'Clinical',
    desc: 'Dermatologist-formulated for when the situation requires actual science, not optimism.',
    price: '~$28',
    href: 'https://amzn.to/4u5pQUV',
    featured: false,
  },
]

function ProductCard({ product }: { product: Product }) {
  return (
    <a
      href={product.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-bsv-card border border-white/5 hover:border-bsv-amber/40 transition-colors p-8"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <span className="font-heading text-xs tracking-widest text-bsv-amber">
          {product.badge}
        </span>
        <span className="font-body text-xs text-bsv-muted whitespace-nowrap">
          {product.price}
        </span>
      </div>

      <p className="font-heading text-xs tracking-widest text-bsv-muted mb-1">
        {product.brand}
      </p>
      <h3 className="font-heading text-2xl tracking-wide text-bsv-cream group-hover:text-bsv-amber transition-colors mb-4 leading-tight">
        {product.name}
      </h3>

      <p className="font-body text-sm text-bsv-muted leading-relaxed flex-1 mb-6">
        {product.desc}
      </p>

      <span className="font-heading text-xs tracking-widest text-bsv-amber inline-flex items-center gap-1 group-hover:gap-2 transition-all">
        VIEW ON AMAZON →
      </span>
    </a>
  )
}

export default function LoungePage() {
  const featured = KIT.find((p) => p.featured)!
  const rest     = KIT.filter((p) => !p.featured)

  return (
    <>
      <SiteNav />
      <main className="pt-16 bg-bsv-bg min-h-screen">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-4">
              THE PROPRIETOR&apos;S KIT
            </p>
            <h1 className="font-heading text-5xl sm:text-6xl text-bsv-cream tracking-wide leading-none mb-6">
              The Lounge Collection
            </h1>
            <p className="font-body text-base sm:text-lg italic text-bsv-muted max-w-xl mx-auto">
              Hand-selected. Proprietor-approved. Nothing goes on this shelf that hasn&apos;t earned its place.
            </p>
          </div>
        </section>

        {/* ── Founding members strip ───────────────────────────────────────── */}
        <section className="py-5 bg-bsv-bg border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-center sm:text-left">
            <p className="font-body text-sm text-bsv-muted">
              <span className="text-bsv-cream font-semibold">Founding Members</span> get early access to new additions before they hit the shelf.
            </p>
            <Link
              href="/"
              className="font-heading text-xs tracking-widest bg-bsv-amber text-bsv-navy px-6 py-3 hover:opacity-85 transition-opacity whitespace-nowrap"
            >
              JOIN NOW
            </Link>
          </div>
        </section>

        {/* ── Product grid ─────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-6">

            {/* Featured card — full width */}
            {featured && (
              <a
                href={featured.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col sm:flex-row bg-bsv-card border border-bsv-amber/30 hover:border-bsv-amber/60 transition-colors p-8 sm:p-10 gap-8"
              >
                <div className="flex-1">
                  <span className="font-heading text-xs tracking-widest text-bsv-amber mb-2 block">
                    {featured.badge}
                  </span>
                  <p className="font-heading text-xs tracking-widest text-bsv-muted mb-1">
                    {featured.brand}
                  </p>
                  <h2 className="font-heading text-3xl sm:text-4xl tracking-wide text-bsv-cream group-hover:text-bsv-amber transition-colors leading-tight mb-4">
                    {featured.name}
                  </h2>
                  <p className="font-body text-base text-bsv-muted leading-relaxed max-w-xl">
                    {featured.desc}
                  </p>
                </div>
                <div className="flex sm:flex-col items-start sm:items-end justify-between sm:justify-between gap-4 sm:min-w-[120px]">
                  <span className="font-heading text-2xl text-bsv-cream">{featured.price}</span>
                  <span className="font-heading text-xs tracking-widest text-bsv-amber inline-flex items-center gap-1 group-hover:gap-2 transition-all whitespace-nowrap">
                    VIEW ON AMAZON →
                  </span>
                </div>
              </a>
            )}

            {/* Remaining 4 in a 2×2 grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {rest.map((product) => (
                <ProductCard key={product.name} product={product} />
              ))}
            </div>

          </div>
        </section>

        {/* ── Editorial quote ───────────────────────────────────────────────── */}
        <section className="py-20 bg-bsv-card border-t border-white/5">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-12 h-px bg-bsv-amber mx-auto mb-8" />
            <blockquote className="font-body text-xl sm:text-2xl italic text-bsv-cream leading-relaxed mb-6">
              &ldquo;Nothing goes on this shelf that hasn&apos;t earned its place.&rdquo;
            </blockquote>
            <cite className="font-heading text-xs tracking-widest text-bsv-amber not-italic">
              — THE PROPRIETOR
            </cite>
            <div className="w-12 h-px bg-bsv-amber mx-auto mt-8" />
          </div>
        </section>

        {/* ── Amazon Associates disclosure ─────────────────────────────────── */}
        <section className="py-6 bg-bsv-bg border-t border-white/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-body text-xs text-bsv-muted">
              As an Amazon Associate, Big Sole Vibes earns from qualifying purchases.
            </p>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
