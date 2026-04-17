import Link from 'next/link'
import { getAllPosts } from '@/lib/mdx'

export default function BlogPreview() {
  const preview = getAllPosts().slice(0, 3)

  return (
    <section className="py-24 bg-bsv-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="font-heading text-5xl sm:text-6xl text-bsv-white tracking-wide mb-4">
            FROM THE <span className="text-bsv-orange">BLOG</span>
          </h2>
          <p className="text-bsv-muted text-lg max-w-xl mx-auto">
            Real talk about foot care. No gatekeeping.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {preview.map((post) => (
            <div
              key={post.slug}
              className="bg-bsv-card border border-white/5 hover:border-bsv-orange/30 transition-colors p-8 flex flex-col"
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="text-bsv-muted text-xs">{post.date}</span>
                <span className="text-white/20">·</span>
                <span className="text-bsv-muted text-xs">{post.readTime}</span>
              </div>

              <h3 className="font-heading text-2xl text-bsv-white tracking-wide leading-tight mb-3">
                {post.title}
              </h3>
              <p className="text-bsv-muted text-sm leading-relaxed mb-6 flex-1">
                {post.excerpt}
              </p>

              <Link
                href={`/blog/${post.slug}`}
                className="text-bsv-orange hover:text-orange-400 font-heading tracking-widest text-sm transition-colors inline-flex items-center gap-2"
              >
                READ MORE
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href="/blog"
            className="border border-bsv-orange text-bsv-orange hover:bg-bsv-orange hover:text-white font-heading text-xl tracking-widest px-12 py-4 transition-colors inline-block"
          >
            VIEW ALL POSTS
          </Link>
        </div>
      </div>
    </section>
  )
}
