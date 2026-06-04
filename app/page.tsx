import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'
import EmailCapture from '@/components/EmailCapture'
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

        {/* ── HERO ──────────────────────────────────────────────────────── */}
        <section className="relative bg-bsv-bg pt-20 pb-0 overflow-hidden border-b border-white/10">

          {/* Ambient grain texture */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }}
            aria-hidden="true"
          />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

            {/* Kicker */}
            <p className="font-heading text-xs tracking-[0.4em] text-bsv-amber text-center mb-10">
              BIG SOLE VIBES — FROM HEAD TO TOE
            </p>

            {/* Four comic panels */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/10">

              {/* Panel 1 — The Chef */}
              <div className="bg-bsv-bg group relative overflow-hidden">
                <div className="aspect-[3/4] relative flex flex-col">
                  <svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                    {/* Background */}
                    <rect width="300" height="400" fill="#0D1B2A"/>
                    {/* Kitchen floor lines */}
                    <line x1="0" y1="370" x2="300" y2="370" stroke="#1C2E42" strokeWidth="2"/>
                    <line x1="0" y1="340" x2="300" y2="340" stroke="#1C2E42" strokeWidth="1" opacity="0.5"/>
                    {/* Chef figure — whites, tall hat */}
                    {/* Hat */}
                    <rect x="115" y="60" width="70" height="70" rx="4" fill="#F5ECD7" opacity="0.9"/>
                    <rect x="105" y="125" width="90" height="12" rx="2" fill="#F5ECD7"/>
                    {/* Head */}
                    <ellipse cx="150" cy="160" rx="32" ry="35" fill="#D4A574"/>
                    {/* Body / whites */}
                    <rect x="105" y="190" width="90" height="110" rx="6" fill="#F5ECD7" opacity="0.92"/>
                    {/* Double-breasted buttons */}
                    <circle cx="135" cy="215" r="3" fill="#C17D2E"/>
                    <circle cx="135" cy="235" r="3" fill="#C17D2E"/>
                    <circle cx="135" cy="255" r="3" fill="#C17D2E"/>
                    <circle cx="165" cy="215" r="3" fill="#C17D2E"/>
                    <circle cx="165" cy="235" r="3" fill="#C17D2E"/>
                    <circle cx="165" cy="255" r="3" fill="#C17D2E"/>
                    {/* Arms */}
                    <rect x="70" y="195" width="38" height="22" rx="10" fill="#F5ECD7" opacity="0.9"/>
                    <rect x="192" y="195" width="38" height="22" rx="10" fill="#F5ECD7" opacity="0.9"/>
                    {/* Knife in right hand */}
                    <rect x="225" y="188" width="4" height="40" rx="2" fill="#4A6380"/>
                    <rect x="223" y="185" width="8" height="4" rx="1" fill="#C17D2E"/>
                    {/* Legs / trousers */}
                    <rect x="112" y="295" width="32" height="70" rx="4" fill="#2A3F55"/>
                    <rect x="156" y="295" width="32" height="70" rx="4" fill="#2A3F55"/>
                    {/* The destroyed clogs */}
                    <ellipse cx="128" cy="368" rx="22" ry="10" fill="#5C3A1E" opacity="0.7"/>
                    <ellipse cx="172" cy="368" rx="22" ry="10" fill="#5C3A1E" opacity="0.7"/>
                    {/* Crack / wear marks on clogs */}
                    <line x1="115" y1="363" x2="125" y2="373" stroke="#0D1B2A" strokeWidth="1.5"/>
                    <line x1="140" y1="361" x2="145" y2="371" stroke="#0D1B2A" strokeWidth="1"/>
                    {/* Caption area */}
                    <rect x="0" y="375" width="300" height="25" fill="#162233"/>
                    <text x="150" y="391" textAnchor="middle" fill="#C17D2E" fontFamily="serif" fontSize="10" letterSpacing="2">THE CHEF</text>
                  </svg>
                  {/* Speech bubble caption */}
                  <div className="absolute bottom-8 left-0 right-0 px-3">
                    <p className="font-body text-[10px] sm:text-xs text-bsv-cream/70 text-center leading-snug italic">
                      &ldquo;The mise en place was perfect.&rdquo;
                    </p>
                  </div>
                </div>
              </div>

              {/* Panel 2 — The Athlete */}
              <div className="bg-bsv-bg group relative overflow-hidden">
                <div className="aspect-[3/4] relative flex flex-col">
                  <svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                    <rect width="300" height="400" fill="#0D1B2A"/>
                    {/* Locker room tiles */}
                    <rect x="0" y="0" width="300" height="400" fill="#0D1B2A"/>
                    {/* Bench */}
                    <rect x="30" y="320" width="240" height="18" rx="3" fill="#1C2E42"/>
                    <rect x="50" y="338" width="12" height="30" rx="2" fill="#162233"/>
                    <rect x="238" y="338" width="12" height="30" rx="2" fill="#162233"/>
                    {/* Figure — athletic build, sitting */}
                    {/* Head */}
                    <ellipse cx="150" cy="100" rx="30" ry="33" fill="#C68642"/>
                    {/* Body / compression shirt */}
                    <rect x="112" y="128" width="76" height="90" rx="8" fill="#1C2E42"/>
                    {/* Shorts */}
                    <rect x="108" y="210" width="84" height="60" rx="6" fill="#C17D2E" opacity="0.8"/>
                    {/* Legs */}
                    <rect x="112" y="265" width="28" height="55" rx="4" fill="#C68642"/>
                    <rect x="160" y="265" width="28" height="55" rx="4" fill="#C68642"/>
                    {/* Bare feet on cold tile — the gap */}
                    <ellipse cx="126" cy="323" rx="20" ry="9" fill="#B07040"/>
                    <ellipse cx="174" cy="323" rx="20" ry="9" fill="#B07040"/>
                    {/* Ice bath bucket nearby */}
                    <rect x="230" y="280" width="45" height="55" rx="4" fill="#162233" stroke="#1C2E42" strokeWidth="2"/>
                    <rect x="233" y="270" width="39" height="12" rx="2" fill="#1C2E42"/>
                    {/* Ice cubes */}
                    <rect x="238" y="295" width="10" height="10" rx="1" fill="#4A6380" opacity="0.6"/>
                    <rect x="252" y="290" width="8" height="8" rx="1" fill="#4A6380" opacity="0.5"/>
                    <rect x="244" y="305" width="9" height="9" rx="1" fill="#4A6380" opacity="0.7"/>
                    {/* Protein shaker */}
                    <rect x="25" y="285" width="28" height="45" rx="8" fill="#162233" stroke="#C17D2E" strokeWidth="1.5"/>
                    {/* Caption bar */}
                    <rect x="0" y="375" width="300" height="25" fill="#162233"/>
                    <text x="150" y="391" textAnchor="middle" fill="#C17D2E" fontFamily="serif" fontSize="10" letterSpacing="2">THE ATHLETE</text>
                  </svg>
                  <div className="absolute bottom-8 left-0 right-0 px-3">
                    <p className="font-body text-[10px] sm:text-xs text-bsv-cream/70 text-center leading-snug italic">
                      &ldquo;He had a system.&rdquo;
                    </p>
                  </div>
                </div>
              </div>

              {/* Panel 3 — The Professional */}
              <div className="bg-bsv-bg group relative overflow-hidden">
                <div className="aspect-[3/4] relative flex flex-col">
                  <svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                    <rect width="300" height="400" fill="#0D1B2A"/>
                    {/* Office / leather chair scene */}
                    {/* Window / city light behind */}
                    <rect x="180" y="20" width="110" height="200" fill="#0D1B2A"/>
                    <rect x="185" y="25" width="48" height="90" fill="#1C2E42" opacity="0.6"/>
                    <rect x="237" y="25" width="48" height="90" fill="#162233" opacity="0.8"/>
                    <rect x="185" y="120" width="48" height="90" fill="#162233" opacity="0.5"/>
                    <rect x="237" y="120" width="48" height="90" fill="#1C2E42" opacity="0.7"/>
                    {/* Leather chair */}
                    <rect x="50" y="240" width="180" height="130" rx="12" fill="#1A0F07"/>
                    <rect x="60" y="230" width="160" height="50" rx="10" fill="#231208"/>
                    <rect x="40" y="265" width="30" height="80" rx="8" fill="#1A0F07"/>
                    <rect x="210" y="265" width="30" height="80" rx="8" fill="#1A0F07"/>
                    {/* Figure — suit, one shoe off */}
                    {/* Head */}
                    <ellipse cx="150" cy="95" rx="28" ry="31" fill="#D4A574"/>
                    {/* Suit jacket */}
                    <rect x="108" y="122" width="84" height="100" rx="6" fill="#162233"/>
                    {/* Lapels */}
                    <polygon points="150,125 130,145 140,122" fill="#1C2E42"/>
                    <polygon points="150,125 170,145 160,122" fill="#1C2E42"/>
                    {/* Tie */}
                    <polygon points="150,130 145,185 150,190 155,185" fill="#C17D2E"/>
                    {/* Trousers */}
                    <rect x="115" y="215" width="30" height="75" rx="4" fill="#1C2E42"/>
                    <rect x="155" y="215" width="30" height="75" rx="4" fill="#1C2E42"/>
                    {/* The expensive shoe — one on */}
                    <path d="M110 288 Q125 280 155 285 Q158 295 150 300 Q130 305 108 298 Z" fill="#2C1810"/>
                    <rect x="108" y="288" width="8" height="14" rx="2" fill="#3D2418"/>
                    {/* The shoe — one off, on floor */}
                    <path d="M60 358 Q80 348 110 353 Q113 363 105 368 Q82 373 58 366 Z" fill="#2C1810"/>
                    {/* Bare foot */}
                    <ellipse cx="172" cy="294" rx="22" ry="10" fill="#C68642"/>
                    {/* Toes */}
                    <circle cx="158" cy="291" r="3" fill="#B07040"/>
                    <circle cx="165" cy="288" r="3.5" fill="#B07040"/>
                    <circle cx="173" cy="287" r="3.5" fill="#B07040"/>
                    <circle cx="180" cy="289" r="3" fill="#B07040"/>
                    <circle cx="186" cy="292" r="2.5" fill="#B07040"/>
                    {/* Caption bar */}
                    <rect x="0" y="375" width="300" height="25" fill="#162233"/>
                    <text x="150" y="391" textAnchor="middle" fill="#C17D2E" fontFamily="serif" fontSize="10" letterSpacing="2">THE PROFESSIONAL</text>
                  </svg>
                  <div className="absolute bottom-8 left-0 right-0 px-3">
                    <p className="font-body text-[10px] sm:text-xs text-bsv-cream/70 text-center leading-snug italic">
                      &ldquo;The shoes were reviewed.&rdquo;
                    </p>
                  </div>
                </div>
              </div>

              {/* Panel 4 — The Style Guy */}
              <div className="bg-bsv-bg group relative overflow-hidden">
                <div className="aspect-[3/4] relative flex flex-col">
                  <svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                    <rect width="300" height="400" fill="#0D1B2A"/>
                    {/* Mirror frame */}
                    <rect x="80" y="20" width="140" height="200" rx="4" fill="#162233" stroke="#1C2E42" strokeWidth="3"/>
                    <rect x="88" y="28" width="124" height="184" rx="2" fill="#0D1B2A" opacity="0.8"/>
                    {/* Reflection — perfect outfit */}
                    <ellipse cx="150" cy="75" rx="22" ry="25" fill="#C68642" opacity="0.7"/>
                    <rect x="120" y="97" width="60" height="70" rx="4" fill="#1C2E42" opacity="0.7"/>
                    <rect x="125" y="162" width="22" height="45" rx="3" fill="#2A3F55" opacity="0.7"/>
                    <rect x="153" y="162" width="22" height="45" rx="3" fill="#2A3F55" opacity="0.7"/>
                    {/* Boots in mirror — perfect */}
                    <path d="M120 205 Q132 198 150 202 Q152 210 147 215 Q132 218 118 212 Z" fill="#1A0F07" opacity="0.8"/>
                    <path d="M153 205 Q165 198 180 202 Q182 210 177 215 Q162 218 151 212 Z" fill="#1A0F07" opacity="0.8"/>
                    {/* Annotation arrow pointing down at feet in mirror */}
                    <line x1="210" y1="160" x2="175" y2="208" stroke="#C17D2E" strokeWidth="1.5" strokeDasharray="4,3"/>
                    <polygon points="175,208 170,198 180,200" fill="#C17D2E"/>
                    <rect x="200" y="148" width="55" height="16" rx="2" fill="#C17D2E" opacity="0.15"/>
                    <text x="228" y="160" textAnchor="middle" fill="#C17D2E" fontFamily="serif" fontSize="8" letterSpacing="1">ALMOST.</text>
                    {/* Actual figure in front of mirror */}
                    <ellipse cx="150" cy="270" rx="26" ry="29" fill="#C68642"/>
                    <rect x="118" y="294" width="64" height="75" rx="6" fill="#162233"/>
                    {/* Caption bar */}
                    <rect x="0" y="375" width="300" height="25" fill="#162233"/>
                    <text x="150" y="391" textAnchor="middle" fill="#C17D2E" fontFamily="serif" fontSize="10" letterSpacing="2">THE STYLE GUY</text>
                  </svg>
                  <div className="absolute bottom-8 left-0 right-0 px-3">
                    <p className="font-body text-[10px] sm:text-xs text-bsv-cream/70 text-center leading-snug italic">
                      &ldquo;Head to toe considered.&rdquo;
                    </p>
                  </div>
                </div>
              </div>

            </div>{/* end grid */}

            {/* Tagline strip */}
            <div className="text-center py-16">
              <h1 className="font-heading text-5xl sm:text-7xl lg:text-8xl leading-none tracking-wide text-bsv-cream mb-4">
                FROM HEAD TO TOE.
              </h1>
              <p className="font-heading text-4xl sm:text-6xl lg:text-7xl leading-none tracking-wide text-bsv-amber mb-8">
                FINALLY.
              </p>
              <p className="font-body text-bsv-muted text-sm sm:text-base max-w-md mx-auto mb-12 leading-relaxed">
                The gap is different for every man. The standard is the same.
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
                  href="/sole-report"
                  className="px-8 py-4 border border-bsv-amber text-bsv-amber font-heading text-lg tracking-widest hover:bg-bsv-amber hover:text-bsv-bg transition-colors"
                >
                  THE SOLE REPORT
                </Link>
              </div>
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

        {/* ── EMAIL CAPTURE ─────────────────────────────────────────────── */}
        <EmailCapture />

      </main>
      <Footer />
    </>
  )
}
