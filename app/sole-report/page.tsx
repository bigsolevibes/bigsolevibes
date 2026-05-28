import type { Metadata } from 'next'
import fs from 'fs'
import path from 'path'
import SiteNav from '@/app/components/SiteNav'
import Footer from '@/components/Footer'
import RedditFeed from '@/app/components/RedditFeed'

export const metadata: Metadata = {
  title: 'The Sole Report — Big Sole Vibes',
  description: 'R&D for the man who takes himself seriously. Face, body, foot — the category intelligence behind the shelf.',
}

interface Entry {
  title:      string
  topic:      string
  verdict:    string
  url:        string
  published:  string
  link_text?: string
}

function linkText(url: string, override?: string): string {
  if (override) return override
  try {
    const host = new URL(url).hostname.replace('www.', '')
    if (host.includes('reddit.com')) return 'Read on Reddit →'
    if (host.includes('bigsolevibes.com') || url.startsWith('/')) return 'Read →'
    const name = host.split('.')[0]
    return `Read on ${name.charAt(0).toUpperCase() + name.slice(1)} →`
  } catch {
    return 'Read →'
  }
}

export default function SoleReportPage() {
  const indexPath = path.join(process.cwd(), 'public', 'sole-report', 'curated-index.json')
  const entries: Entry[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))

  return (
    <>
      <SiteNav />
      <main className="pt-16 min-h-screen bg-bsv-bg">

        {/* Header */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="font-heading text-xs tracking-widest text-bsv-amber mb-5 uppercase">
              The Sole Report
            </p>
            <p className="text-bsv-muted text-base italic leading-relaxed max-w-xl">
              R&D for the man who takes himself seriously. Face, body, foot — the category intelligence behind the shelf.
            </p>
          </div>
        </section>

        {/* Entry list */}
        <section className="bg-bsv-bg">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            {entries.map((entry, i) => (
              <article
                key={i}
                className="py-10 border-b border-white/5 last:border-b-0"
              >
                <p className="font-heading text-xs tracking-widest text-bsv-amber mb-3 uppercase">
                  {entry.topic}
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold text-bsv-cream leading-snug mb-3">
                  {entry.title}
                </h2>
                <p className="text-bsv-cream/55 italic text-sm leading-relaxed mb-5">
                  {entry.verdict}
                </p>
                <a
                  href={entry.url}
                  target={entry.url.startsWith('/') ? undefined : '_blank'}
                  rel={entry.url.startsWith('/') ? undefined : 'noopener noreferrer'}
                  className="text-bsv-amber hover:opacity-70 font-heading text-xs tracking-widest transition-opacity uppercase"
                >
                  {linkText(entry.url, entry.link_text)}
                </a>
              </article>
            ))}
          </div>
        </section>

        {/* Community */}
        <RedditFeed />

        {/* FTC */}
        <section className="py-10 bg-bsv-bg border-t border-white/5 mt-4">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-bsv-muted/60 text-xs italic">
              As an Amazon Associate, Big Sole Vibes earns from qualifying purchases.
            </p>
          </div>
        </section>

      </main>
      <Footer />
    </>
  )
}
