'use client'

import Link from 'next/link'
import type { LoungeChapter } from '@/lib/lounge'

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const CARD  = '#162233'
const MUTED = '#4A6380'

export default function LoungeChapterList({ chapters }: { chapters: LoungeChapter[] }) {
  if (!chapters.length) return null

  return (
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

            <p className="font-heading text-xs tracking-widest" style={{ color: AMBER }}>
              CHAPTER {chapter}
            </p>

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
  )
}
