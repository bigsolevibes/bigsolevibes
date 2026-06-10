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

        {/* Section header */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="font-heading text-xs tracking-widest text-bsv-amber uppercase">
              Field Intelligence
            </span>
            <span className="flex-1 h-px bg-white/5" />
            <a
              href="https://www.reddit.com/r/bigsolevibes/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-heading text-xs tracking-widest text-bsv-muted hover:text-bsv-amber transition-colors uppercase"
            >
              r/bigsolevibes ↗
            </a>
          </div>
          <p className="text-bsv-muted text-sm leading-relaxed italic">
            Where the man who already holds the standard compares notes.
          </p>
        </div>

        {hasPosts ? (
          <div className="flex flex-col gap-3">
            {threads!.posts.slice(0, 5).map((post, i) => (
              <a
                key={i}
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex gap-0 border border-white/5 hover:border-bsv-amber/20 transition-colors bg-bsv-card overflow-hidden"
              >
                {/* Amber left accent — the "premium forum" signal */}
                <span className="w-0.5 flex-shrink-0 bg-bsv-amber/30 group-hover:bg-bsv-amber/60 transition-colors" />
                <div className="flex flex-col gap-2 p-5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-heading text-xs tracking-widest text-bsv-amber/50 uppercase">
                      Thread
                    </span>
                    <span className="w-4 h-px bg-white/10" />
                    <span className="font-heading text-xs text-bsv-muted">u/{post.author}</span>
                    {post.score > 0 && (
                      <>
                        <span className="text-white/10">·</span>
                        <span className="font-heading text-xs text-bsv-amber/60">↑ {post.score}</span>
                      </>
                    )}
                  </div>
                  <p className="font-body text-sm leading-snug text-bsv-cream group-hover:text-white transition-colors">
                    {post.title}
                  </p>
                  {post.summary && (
                    <p className="text-bsv-muted text-xs leading-relaxed">
                      {post.summary}{post.summary.length >= 220 ? '…' : ''}
                    </p>
                  )}
                  <span className="font-heading text-xs tracking-widest text-bsv-muted group-hover:text-bsv-amber transition-colors uppercase mt-1">
                    Read the thread ↗
                  </span>
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
