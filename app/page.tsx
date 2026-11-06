import fs from 'fs'
import path from 'path'
import Footer from '@/components/Footer'
import EmailCapture from '@/components/EmailCapture'
import OpeningCrawl from '@/app/components/OpeningCrawl'

// ─── One-page home — BSV reset 2026-11-05 ─────────────────────────────────────
// One product (Spongelle Men's Super Buffer), one recurring character (Brok).
// Land, laugh, get it in a few seconds, order. The previous home page is kept
// at app/_archive/home-page-2026-11-05.tsx.bak; the Lounge, Sole Report, shop
// and other pages still build and their URLs keep working — they're just no
// longer linked from here.

type Episode = {
  slug: string
  number: number
  title: string
  teaser: string
  story: string[]
  image?: string
}

function getEpisodes(): Episode[] {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'content/episodes/episodes.json'), 'utf8')
    return (JSON.parse(raw).episodes || []) as Episode[]
  } catch {
    return []
  }
}

// The affiliate link lives in scripts/data/affiliate-overrides.json (same
// source the pipeline's lib/brok-doctrine.js reads) — never hardcode it here.
function getBuyUrl(): string {
  let link = 'https://spongelle.com/SFGCP6TP'
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'scripts/data/affiliate-overrides.json'), 'utf8')
    link = JSON.parse(raw)['Spongelle Men Super Buffer']?.affiliate_url || link
  } catch {}
  // Routed through the click-count Pages Function (functions/api/go/[key].ts).
  return `/api/go/spongelle-super-buffer?to=${encodeURIComponent(link)}`
}

// **bold** → <strong>
function Rich({ text }: { text: string }) {
  const parts = text.split('**')
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <strong key={i} className="text-bsv-amber font-semibold">{p}</strong> : <span key={i}>{p}</span>
      )}
    </>
  )
}

function BuyButton({ href, label, big = false }: { href: string; label: string; big?: boolean }) {
  return (
    <a
      href={href}
      rel="sponsored noopener"
      className={`inline-flex items-center justify-center bg-bsv-amber text-bsv-bg font-heading tracking-widest hover:opacity-90 transition-opacity ${big ? 'text-xl px-10 py-5' : 'text-lg px-8 py-4'}`}
    >
      {label}
    </a>
  )
}

export default function HomePage() {
  const episodes = getEpisodes()
  const latest   = episodes[0]
  const older    = episodes.slice(1)
  const buyUrl   = getBuyUrl()

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-50 bg-bsv-bg/90 backdrop-blur border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <a href="#hero" className="font-heading text-2xl sm:text-3xl tracking-[0.15em] text-bsv-cream">BIG SOLE VIBES</a>
          <a href={buyUrl} rel="sponsored noopener" className="bg-bsv-amber text-bsv-bg font-heading tracking-widest text-sm sm:text-base px-4 sm:px-6 py-3 hover:opacity-90 transition-opacity">
            GET THE BUFFER
          </a>
        </div>
      </header>

      <main className="bg-bsv-bg text-bsv-cream">

        {/* ── OPENING CRAWL — cave to beach, which is Brok's whole arc ───── */}
        <OpeningCrawl />

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section id="hero" className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(/crawl/cave.jpg)' }} aria-hidden="true" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(13,27,42,0.95) 0%, rgba(13,27,42,0.8) 50%, rgba(13,27,42,0.35) 100%)' }} aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-28 sm:py-40">
            <div className="max-w-2xl flex flex-col gap-6">
              <p className="text-bsv-amber font-heading tracking-[0.3em] text-sm">A PUBLIC SERVICE FOR MEN</p>
              <h1 className="font-heading text-7xl sm:text-8xl lg:text-9xl leading-[0.9] tracking-wide">DON&apos;T BE A CAVEMAN.</h1>
              <p className="font-display italic text-2xl sm:text-3xl leading-snug">
                Why are men so barbaric about their feet? Brok was. Then he found the buffer.
              </p>
              <div className="flex flex-wrap items-center gap-6 pt-2">
                <BuyButton href={buyUrl} label="GET THE BUFFER — 30% OFF" big />
                <a href="#episode" className="text-bsv-cream underline underline-offset-4 hover:text-bsv-amber transition-colors">
                  Watch Brok&apos;s shame →
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── THIS WEEK'S EPISODE ──────────────────────────────────────── */}
        {latest && (
          <section id="episode" className="bg-bsv-card py-24 border-b border-white/10">
            <article id={latest.slug} className="max-w-3xl mx-auto px-4 sm:px-6 flex flex-col gap-6 scroll-mt-24">
              <p className="text-bsv-amber font-heading tracking-[0.3em] text-sm">THIS WEEK · EPISODE {latest.number}</p>
              <h2 className="font-heading text-6xl sm:text-7xl leading-[0.95] tracking-wide">{latest.title.toUpperCase()}</h2>
              {latest.image && <img src={latest.image} alt="" className="w-full rounded" />}
              {latest.story.map((para, i) => (
                <p key={i} className="text-lg sm:text-xl leading-relaxed"><Rich text={para} /></p>
              ))}
              <p className="font-display italic text-2xl sm:text-3xl text-bsv-amber pt-2">Why are men so barbaric? They don&apos;t have to be.</p>
            </article>
          </section>
        )}

        {/* ── THE BUFFER ───────────────────────────────────────────────── */}
        <section id="buffer" className="py-28 border-b border-white/10 scroll-mt-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 flex flex-col gap-6">
            <p className="text-bsv-amber font-heading tracking-[0.3em] text-sm">THE FIX</p>
            <h2 className="font-heading text-6xl sm:text-7xl leading-[0.92] tracking-wide">THE SUPER BUFFER</h2>
            <p className="font-display text-2xl leading-snug">The one thing standing between a man and his inner caveman.</p>
            <ul className="flex flex-col gap-3 text-lg leading-relaxed list-disc pl-6">
              <li>Body wash built right in. Just add water.</li>
              <li>Buffs rough heels and calluses while you shower.</li>
              <li>No bottles, no routine, no excuses.</li>
            </ul>
            <div className="bg-bsv-card p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5 sm:justify-between mt-2">
              <p className="text-lg"><span className="text-bsv-amber font-semibold">30% off</span> for BSV readers, through our link.</p>
              <BuyButton href={buyUrl} label="GET THE BUFFER" />
            </div>
          </div>
        </section>

        {/* ── MORE EPISODES ────────────────────────────────────────────── */}
        {older.length > 0 && (
          <section className="bg-bsv-card py-24 border-b border-white/10">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 flex flex-col gap-6">
              <h2 className="font-heading text-5xl sm:text-6xl tracking-wide">MORE OF BROK&apos;S SHAME</h2>
              {older.map((ep) => (
                <details key={ep.slug} id={ep.slug} className="group bg-bsv-bg border border-white/10 scroll-mt-24">
                  <summary className="cursor-pointer list-none p-6 flex flex-col gap-2">
                    <span className="text-bsv-amber font-heading tracking-[0.25em] text-xs">EPISODE {ep.number}</span>
                    <span className="font-heading text-3xl sm:text-4xl tracking-wide">{ep.title.toUpperCase()}</span>
                    <span className="text-bsv-cream/80">{ep.teaser}</span>
                    <span className="text-bsv-amber text-sm pt-1 group-open:hidden">Read the episode →</span>
                  </summary>
                  <div className="px-6 pb-8 flex flex-col gap-4">
                    {ep.story.map((para, i) => (
                      <p key={i} className="text-lg leading-relaxed"><Rich text={para} /></p>
                    ))}
                    <div className="pt-2"><BuyButton href={buyUrl} label="GET THE BUFFER — 30% OFF" /></div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* ── EPISODE SIGNUP ───────────────────────────────────────────── */}
        <EmailCapture
          title="BROK'S NEXT DISGRACE, IN YOUR INBOX."
          blurb="New episodes as they happen. Nothing else."
          cta="COUNT ME IN"
        />
      </main>

      <Footer minimal />
    </>
  )
}
