import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'The Sole Audit Shop — Big Sole Vibes',
  description: 'Proprietor-approved foot care. Every product on this shelf has been reviewed and earned its place.',
}

interface Product {
  name: string
  description: string
  affiliate: string
}

interface Category {
  label: string
  heading: string
  products: Product[]
}

const CATEGORIES: Category[] = [
  {
    label: 'FOOT FILES',
    heading: 'Foot Files',
    products: [
      {
        name: 'Microplane Foot File',
        description: 'The standard by which all others are judged. Surgical-grade stainless, removes dead skin without tearing. One pass and you know.',
        affiliate: 'https://www.amazon.com/s?k=microplane+foot+file&tag=bigsolevibes-20',
      },
      {
        name: 'Glass Foot File',
        description: 'Easy to sanitize, impossible to overuse. Crystal-etched surface buffs to smooth — no shredding, no debris.',
        affiliate: 'https://www.amazon.com/s?k=glass+foot+file+men&tag=bigsolevibes-20',
      },
      {
        name: 'Callus Remover Gel + File Kit',
        description: 'For the stubborn cases. Softening gel does the prep work so the file finishes clean. Two-step protocol.',
        affiliate: 'https://www.amazon.com/s?k=callus+remover+gel+kit+men&tag=bigsolevibes-20',
      },
    ],
  },
  {
    label: 'FOOT SERUMS',
    heading: 'Foot Serums',
    products: [
      {
        name: 'Gehwol Fusskraft Blue',
        description: 'A century of German podiatry in a tin. Urea-rich formula for cracked heels and dry skin. The benchmark.',
        affiliate: 'https://www.amazon.com/s?k=gehwol+fusskraft+blue&tag=bigsolevibes-20',
      },
      {
        name: 'Kerasal Intensive Foot Repair',
        description: 'Clinically proven overnight repair. Salicylic acid and urea working while you sleep. Results in 24 hours.',
        affiliate: 'https://www.amazon.com/s?k=kerasal+intensive+foot+repair&tag=bigsolevibes-20',
      },
      {
        name: 'Gold Bond Ultimate Healing Foot Cream',
        description: 'The accessible daily driver. Seven moisturizers, no residue, absorbs fast. Keeps the work done between deeper treatments.',
        affiliate: 'https://www.amazon.com/s?k=gold+bond+ultimate+foot+cream&tag=bigsolevibes-20',
      },
    ],
  },
  {
    label: 'FOOT SOAKS',
    heading: 'Foot Soaks',
    products: [
      {
        name: 'Dr. Teal\'s Epsom Salt Foot Soak',
        description: 'Magnesium sulfate draws out fatigue. Eucalyptus and spearmint cut the heat. Fifteen minutes and your feet are a different thing.',
        affiliate: 'https://www.amazon.com/s?k=dr+teals+epsom+salt+foot+soak&tag=bigsolevibes-20',
      },
      {
        name: 'Foot Soaking Basin with Massage Rollers',
        description: 'You can soak in a bucket or you can do it properly. Contoured basin, built-in rollers, no compromise.',
        affiliate: 'https://www.amazon.com/s?k=foot+soak+basin+massage+rollers&tag=bigsolevibes-20',
      },
      {
        name: 'Listerine Foot Soak (Original Formula)',
        description: 'The old school move that actually works. Antifungal, antibacterial, and costs nothing. The men who know, know.',
        affiliate: 'https://www.amazon.com/s?k=listerine+foot+soak&tag=bigsolevibes-20',
      },
    ],
  },
  {
    label: 'NAIL CARE',
    heading: 'Nail Care',
    products: [
      {
        name: 'Harperton Nail Clipper Set',
        description: 'Surgical-grade stainless steel, sharp enough to do the job in one clean cut. No jagged edges, no ingrowns.',
        affiliate: 'https://www.amazon.com/s?k=harperton+nail+clipper+set&tag=bigsolevibes-20',
      },
      {
        name: 'Tweezerman Toenail Clipper',
        description: 'Extra-wide jaw designed specifically for toenails. The right tool for the job — curved blade follows the nail bed.',
        affiliate: 'https://www.amazon.com/s?k=tweezerman+toenail+clipper&tag=bigsolevibes-20',
      },
      {
        name: 'Cuticle Oil Pen',
        description: 'Nails that look maintained without looking maintained. Roll on, let it absorb. Takes ten seconds.',
        affiliate: 'https://www.amazon.com/s?k=cuticle+oil+pen+men&tag=bigsolevibes-20',
      },
    ],
  },
  {
    label: "MEN'S GROOMING KITS",
    heading: "Men's Grooming Kits",
    products: [
      {
        name: 'Wahl Pedicure & Grooming Kit',
        description: 'Power tool for serious cases. Rotary system handles calluses, buffing, and filing. Set it, do the work, be done.',
        affiliate: 'https://www.amazon.com/s?k=wahl+pedicure+grooming+kit&tag=bigsolevibes-20',
      },
      {
        name: 'Complete Foot Care Kit (12-Piece)',
        description: 'Everything in one case. File, clipper, buffer, scrub brush, cuticle tool. Covers the full protocol without hunting for pieces.',
        affiliate: 'https://www.amazon.com/s?k=men+foot+care+kit+12+piece&tag=bigsolevibes-20',
      },
      {
        name: 'Burt\'s Bees Coconut Foot Cream + Pumice Kit',
        description: 'Natural-formula starter kit. Coconut oil base, real pumice stone, no synthetic fragrance. Good first shelf.',
        affiliate: "https://www.amazon.com/s?k=burt's+bees+coconut+foot+cream+kit&tag=bigsolevibes-20",
      },
    ],
  },
]

function ProductCard({ product }: { product: Product }) {
  return (
    <div className="bg-bsv-card border border-white/5 p-6 flex flex-col gap-4">
      <h3 className="font-body text-lg text-bsv-cream leading-snug">{product.name}</h3>
      <p className="font-body text-sm text-bsv-muted leading-relaxed flex-1">{product.description}</p>
      <a
        href={product.affiliate}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="font-heading text-xs tracking-widest bg-bsv-amber text-bsv-navy px-5 py-3 text-center hover:opacity-85 transition-opacity self-start"
      >
        SHOP ON AMAZON ↗
      </a>
    </div>
  )
}

export default function ShopPage() {
  return (
    <>
      <SiteNav />
      <main className="pt-16 bg-bsv-bg min-h-screen">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-4">
              THE SOLE AUDIT SHOP
            </p>
            <h1 className="font-body text-5xl sm:text-6xl text-bsv-cream leading-none mb-6">
              Nothing Goes on This Shelf<br />
              <span className="text-bsv-amber">That Hasn&apos;t Earned Its Place.</span>
            </h1>
            <p className="font-body text-base sm:text-lg italic text-bsv-muted max-w-2xl mx-auto">
              Proprietor-approved picks across every category of men&apos;s foot care.
              We tested them, ranked them, and kept the ones worth your time and money.
            </p>
          </div>
        </section>

        {/* ── Affiliate disclosure ──────────────────────────────────────────── */}
        <div className="bg-bsv-surface border-b border-white/5 py-3 px-4">
          <p className="max-w-4xl mx-auto text-center font-body text-xs text-bsv-muted/70">
            BSV participates in the Amazon Associates Program. Links on this page are affiliate links — we may earn a commission at no cost to you.
          </p>
        </div>

        {/* ── Category sections ─────────────────────────────────────────────── */}
        {CATEGORIES.map((category, i) => (
          <section
            key={category.label}
            className={`py-16 border-b border-white/5 ${i % 2 === 1 ? 'bg-bsv-surface' : ''}`}
          >
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="mb-10">
                <p className="font-heading text-xs tracking-widest text-bsv-amber mb-2">
                  {category.label}
                </p>
                <div className="w-8 h-px bg-bsv-amber" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {category.products.map((product) => (
                  <ProductCard key={product.name} product={product} />
                ))}
              </div>
            </div>
          </section>
        ))}

        {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center flex flex-col items-center gap-6">
            <div className="w-8 h-px bg-bsv-amber" />
            <p className="font-body text-2xl sm:text-3xl text-bsv-cream leading-snug">
              Want the full breakdown before you buy?
            </p>
            <p className="font-body text-base italic text-bsv-muted">
              The Sole Audits go deeper — every pick tested, ranked, and given a verdict.
            </p>
            <Link
              href="/audits"
              className="font-heading text-xs tracking-widest border border-bsv-amber text-bsv-amber px-8 py-4 hover:bg-bsv-amber hover:text-bsv-navy transition-colors"
            >
              READ THE AUDITS →
            </Link>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
