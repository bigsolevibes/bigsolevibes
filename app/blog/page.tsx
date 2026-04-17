import type { Metadata } from 'next'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getAllPosts } from '@/lib/mdx'

export const metadata: Metadata = {
  title: 'Blog',
  description: "Real talk about men's foot care. Tips, guides, and product breakdowns — no fluff.",
}

export default function BlogPage() {
  const posts = getAllPosts()

  return (
    <>
      <Navbar />
      <main className="pt-16">
        {/* Header */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="font-heading text-6xl sm:text-7xl text-bsv-white tracking-wide mb-4">
              THE <span className="text-bsv-orange">BLOG</span>
            </h1>
            <p className="text-bsv-muted text-lg max-w-xl mx-auto">
              Real talk about foot care. No gatekeeping, no filler.
            </p>
          </div>
        </section>

        {/* Posts */}
        <section className="py-24 bg-bsv-bg">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-8">
              {posts.map((post) => (
                <article
                  key={post.slug}
                  className="bg-bsv-card border border-white/5 hover:border-bsv-orange/30 transition-colors p-8"
                >
                  {/* Tags */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-bsv-orange text-xs font-heading tracking-widest border border-bsv-orange/30 px-2 py-0.5"
                        >
                          {tag.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-bsv-muted text-xs">{post.date}</span>
                    <span className="text-white/20">·</span>
                    <span className="text-bsv-muted text-xs">{post.readTime}</span>
                  </div>

                  <h2 className="font-heading text-3xl text-bsv-white tracking-wide mb-3">
                    {post.title}
                  </h2>
                  <p className="text-bsv-muted leading-relaxed mb-6">{post.excerpt}</p>

                  <Link
                    href={`/blog/${post.slug}`}
                    className="text-bsv-orange hover:text-orange-400 font-heading tracking-widest text-sm transition-colors inline-flex items-center gap-2"
                  >
                    READ MORE
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
