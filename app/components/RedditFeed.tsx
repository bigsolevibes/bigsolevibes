'use client'

import { useState, useEffect } from 'react'

interface RedditPost {
  title:     string
  author:    string
  url:       string
  published: string
  score:     number
  summary:   string | null
}

interface ThreadsData {
  subreddit:     string
  subreddit_url: string
  fetched_at:    string
  post_count:    number
  posts:         RedditPost[]
}

export default function RedditFeed() {
  const [threads, setThreads] = useState<ThreadsData | null>(null)
  const [loaded, setLoaded]   = useState(false)

  useEffect(() => {
    fetch('/community/threads.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setThreads(data) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const hasPosts = loaded && threads && threads.post_count > 0

  return (
    <section className="py-16 border-t border-white/5">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-8">

        <div>
          <p className="font-heading text-xs tracking-widest text-bsv-amber mb-2 uppercase">
            The Community
          </p>
          <p className="text-bsv-muted text-sm leading-relaxed">
            r/bigsolevibes — where the man who already holds the standard compares notes.
          </p>
        </div>

        {hasPosts ? (
          <div className="flex flex-col gap-4">
            {threads!.posts.slice(0, 5).map((post, i) => (
              <a
                key={i}
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-2 p-5 border border-white/5 hover:border-bsv-amber/30 transition-colors bg-bsv-card"
              >
                <p className="font-heading text-sm leading-snug text-bsv-cream">
                  {post.title}
                </p>
                {post.summary && (
                  <p className="text-bsv-muted text-xs leading-relaxed">
                    {post.summary}{post.summary.length >= 220 ? '…' : ''}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-1">
                  <span className="font-heading text-xs text-bsv-muted">u/{post.author}</span>
                  {post.score > 0 && (
                    <span className="font-heading text-xs text-bsv-amber">↑ {post.score}</span>
                  )}
                  <span className="font-heading text-xs text-bsv-muted ml-auto">VIEW THREAD ↗</span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <a
            href="https://www.reddit.com/r/bigsolevibes/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-heading text-xs tracking-widest text-bsv-amber hover:opacity-70 transition-opacity uppercase"
          >
            Join the conversation on r/bigsolevibes ↗
          </a>
        )}

      </div>
    </section>
  )
}
