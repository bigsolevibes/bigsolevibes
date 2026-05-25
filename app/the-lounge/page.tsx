import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'
import { getLoungeChapters } from '@/lib/lounge'

export const metadata: Metadata = {
  title: 'The Lounge — Big Sole Vibes',
  description: "The Proprietor's long-form take on the standard. The maintenance mentality, the products that earned their place, and the chapters of a man who finally looked in the mirror.",
}

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const CARD  = '#162233'
const MUTED = '#4A6380'
const NAVY  = '#0D1B2A'

export default function TheLoungePage() {
  const chapters = getLoungeChapters()

  return (
    <>
      <SiteNav />
      <main
        className="min-h-screen pt-16"
        style={{ backgroundColor: NAVY, color: CREAM }}
      >

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <section
          className="py-20 px-6 text-center"
          style={{ borderBottom: `1px solid ${AMBER}22` }}
        >
          <p className="font-heading text-xs tracking-widest mb-6" style={{ color: AMBER }}>
            THE LOUNGE
          </p>
          <h1 className="font-heading text-5xl sm:text-7xl tracking-wide leading-none mb-6" style={{ color: CREAM }}>
            THE LOUNGE
          </h1>
          <p className="font-body text-base sm:text-lg italic max-w-xl mx-auto leading-relaxed" style={{ color: MUTED }}>
            The Proprietor's long-form take on the standard. Not a listicle. Not a review.
            A record of what it means to take care of yourself like a man who actually thought about it.
          </p>
        </section>

        {/* ── Introduction prose ─────────────────────────────────────────────── */}
        <section className="py-20 px-6">
          <div className="max-w-2xl mx-auto flex flex-col gap-10 font-body text-base leading-relaxed" style={{ color: MUTED }}>

            <p>
              It was the end of a long day.
            </p>
            <p>
              The kind of day that doesn&apos;t ask permission — it just takes what it takes and leaves you standing in your bathroom at 9pm looking at a man in the mirror who looks approximately how you feel, which is not, if you&apos;re being honest, how you&apos;d like to look.
            </p>
            <p>
              He wasn&apos;t being honest. Not yet.
            </p>
            <p>
              He reached for the soap.
            </p>

            <div className="w-12 h-px mx-auto" style={{ backgroundColor: `${AMBER}44` }} />

            <p>
              Nobody told him the soap was wrong. Nobody told him the thin grey bar sitting on the edge of the sink was doing something to his face every morning that his face spent every evening quietly trying to undo. Nobody mentioned that the tight dry feeling after washing wasn&apos;t clean — it was damage. That the lines arriving a little earlier than expected weren&apos;t just time — they were a maintenance decision he hadn&apos;t known he was making.
            </p>
            <p>
              He just thought he was tired.
            </p>
            <p>
              He was tired. But that wasn&apos;t all of it.
            </p>

            <div className="w-12 h-px mx-auto" style={{ backgroundColor: `${AMBER}44` }} />

            <p>
              He looked at the mirror.
            </p>
            <p>
              Really looked.
            </p>
            <p>
              Then he walked to the couch, dropped into it the way a man drops into a couch at the end of a day that has taken everything, kicked his shoes off without thinking about it, closed his eyes —
            </p>
            <p>
              and found himself on a path.
            </p>
            <p>
              The forest stretched out ahead of him, quiet and enormous, full of things he didn&apos;t know he was missing. Things that had been waiting patiently in the dark while he moved through his days, performing competence, coming home to a mirror that was keeping score.
            </p>
            <p>
              He didn&apos;t remember deciding to go in.
            </p>
            <p>
              He was already walking.
            </p>

            <div className="w-12 h-px mx-auto" style={{ backgroundColor: `${AMBER}44` }} />

            <p className="italic" style={{ color: `${CREAM}99` }}>
              Pull up a chair.
            </p>
            <p className="italic" style={{ color: `${CREAM}99` }}>
              The forest starts in Chapter 1.
            </p>
            <p className="italic" style={{ color: `${CREAM}99` }}>
              He left the light on.
            </p>

          </div>
        </section>

        {/* ── Chapter index ──────────────────────────────────────────────────── */}
        {chapters.length > 0 && (
          <section
            className="py-20 px-6"
            style={{ borderTop: `1px solid ${AMBER}22` }}
          >
            <div className="max-w-2xl mx-auto flex flex-col gap-16">

              <h2
                className="font-heading text-2xl sm:text-3xl tracking-wide text-center"
                style={{ color: CREAM }}
              >
                THE CHAPTERS
              </h2>

              {chapters.map(({ chapter, hub, spokes }) => (
                <div key={chapter} className="flex flex-col gap-6">

                  {/* Chapter label */}
                  <p className="font-heading text-xs tracking-widest" style={{ color: AMBER }}>
                    CHAPTER {chapter}
                  </p>

                  {/* Hub */}
                  {hub && (
                    <Link
                      href={`/the-lounge/${hub.slug}`}
                      className="block p-6 border transition-colors"
                      style={{ backgroundColor: CARD, borderColor: `${AMBER}33` }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${AMBER}88`)}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${AMBER}33`)}
                    >
                      <p className="font-heading text-xs tracking-widest mb-2" style={{ color: AMBER }}>
                        HUB
                      </p>
                      <h3 className="font-heading text-xl tracking-wide mb-2" style={{ color: CREAM }}>
                        {hub.title}
                      </h3>
                      <p className="font-body text-sm leading-relaxed" style={{ color: MUTED }}>
                        {hub.excerpt}
                      </p>
                      <p className="font-heading text-xs tracking-widest mt-4" style={{ color: AMBER }}>
                        READ → {hub.readTime.toUpperCase()}
                      </p>
                    </Link>
                  )}

                  {/* Spokes */}
                  {spokes.length > 0 && (
                    <div className="flex flex-col gap-3 pl-4" style={{ borderLeft: `2px solid ${AMBER}22` }}>
                      {spokes
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                        .map((spoke) => (
                          <Link
                            key={spoke.slug}
                            href={`/the-lounge/${spoke.slug}`}
                            className="block p-5 border transition-colors"
                            style={{ backgroundColor: CARD, borderColor: `${AMBER}22` }}
                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${AMBER}66`)}
                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${AMBER}22`)}
                          >
                            <p className="font-heading text-xs tracking-widest mb-1" style={{ color: `${AMBER}88` }}>
                              DEEP DIVE
                            </p>
                            <h4 className="font-heading text-lg tracking-wide mb-1" style={{ color: CREAM }}>
                              {spoke.title}
                            </h4>
                            <p className="font-body text-sm leading-relaxed" style={{ color: MUTED }}>
                              {spoke.excerpt}
                            </p>
                          </Link>
                        ))}
                    </div>
                  )}
                </div>
              ))}

            </div>
          </section>
        )}

        {/* ── Quote ──────────────────────────────────────────────────────────── */}
        <section className="py-20 px-6 text-center" style={{ borderTop: `1px solid ${AMBER}22` }}>
          <div className="max-w-2xl mx-auto flex flex-col items-center gap-6">
            <div className="w-12 h-px" style={{ backgroundColor: AMBER }} />
            <blockquote
              className="font-body text-xl sm:text-2xl italic leading-relaxed"
              style={{ color: CREAM }}
            >
              &ldquo;Nothing goes on this shelf that hasn&apos;t earned its place.&rdquo;
            </blockquote>
            <cite className="font-heading text-xs tracking-widest not-italic" style={{ color: AMBER }}>
              — THE PROPRIETOR
            </cite>
            <div className="w-12 h-px" style={{ backgroundColor: AMBER }} />
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
