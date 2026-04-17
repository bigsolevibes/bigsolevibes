import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { MDXRemote } from 'next-mdx-remote/rsc'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import SocialShare from '@/components/SocialShare'
import { getAllPosts, getPostBySlug } from '@/lib/mdx'

interface Props {
  params: { slug: string }
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPostBySlug(params.slug)
  if (!post) return {}
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: 'article',
      publishedTime: post.date,
      images: post.coverImage ? [{ url: post.coverImage }] : [],
    },
  }
}

// MDX component overrides — styled to match brand
const mdxComponents = {
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="font-heading text-3xl text-bsv-orange tracking-wide mt-10 mb-4" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="font-heading text-2xl text-bsv-white tracking-wide mt-8 mb-3" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-bsv-muted leading-relaxed mb-5" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="text-bsv-white font-semibold" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc list-inside text-bsv-muted space-y-2 mb-5 ml-2" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside text-bsv-muted space-y-2 mb-5 ml-2" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props} />
  ),
  hr: () => <hr className="border-white/10 my-8" />,
  blockquote: (props: React.HTMLAttributes<HTMLElement>) => (
    <blockquote className="border-l-4 border-bsv-orange pl-6 italic text-bsv-muted my-6" {...props} />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="bg-bsv-surface text-bsv-orange px-1.5 py-0.5 text-sm font-mono" {...props} />
  ),
}

export default function BlogPostPage({ params }: Props) {
  const post = getPostBySlug(params.slug)
  if (!post) notFound()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bigsolevibes.com'
  const postUrl = `${siteUrl}/blog/${post.slug}`

  return (
    <>
      <Navbar />
      <main className="pt-16">
        {/* Hero */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link
              href="/blog"
              className="text-bsv-muted hover:text-bsv-orange text-sm font-heading tracking-widest transition-colors inline-flex items-center gap-2 mb-8"
            >
              <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
              </svg>
              BACK TO BLOG
            </Link>

            {/* Tags */}
            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
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

            <div className="flex items-center gap-3 mb-4">
              <span className="text-bsv-muted text-xs">{post.date}</span>
              <span className="text-white/20">·</span>
              <span className="text-bsv-muted text-xs">{post.readTime}</span>
            </div>

            <h1 className="font-heading text-5xl sm:text-6xl text-bsv-white tracking-wide leading-tight mb-6">
              {post.title}
            </h1>

            {/* Social share — top */}
            <SocialShare title={post.title} url={postUrl} />
          </div>
        </section>

        {/* MDX Content */}
        <section className="py-16 bg-bsv-bg">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <MDXRemote source={post.content} components={mdxComponents} />

            {/* Social share — bottom */}
            <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <SocialShare title={post.title} url={postUrl} />
              <Link
                href="/blog"
                className="text-bsv-orange hover:text-orange-400 font-heading tracking-widest text-sm transition-colors inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
                BACK TO BLOG
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
