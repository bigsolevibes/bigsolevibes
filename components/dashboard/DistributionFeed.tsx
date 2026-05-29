import type { PostRecord } from '@/lib/dashboard/types'

const PLATFORM_ICON: Record<string, string> = {
  instagram: '📸',
  bluesky: '🦋',
  youtube: '▶',
  twitter: '𝕏',
  facebook: '𝖋',
  tiktok: '♪',
}

function platformLabel(platform: string): string {
  return PLATFORM_ICON[platform] ?? platform
}

function platformUrl(record: PostRecord): string | null {
  if (record.platform === 'bluesky' && record.postId?.startsWith('at://')) {
    const parts = record.postId.replace('at://', '').split('/')
    if (parts.length >= 3) {
      const handle = parts[0]
      const rkey = parts[parts.length - 1]
      return `https://bsky.app/profile/${handle}/post/${rkey}`
    }
  }
  if (record.platform === 'instagram') {
    return `https://www.instagram.com/p/${record.postId}/`
  }
  return null
}

export default function DistributionFeed({
  feed,
  limit,
}: {
  feed: PostRecord[]
  limit?: number
}) {
  const displayFeed = limit ? feed.slice(0, limit) : feed

  if (displayFeed.length === 0) {
    return (
      <div className="rounded-lg border border-bsv-surface bg-bsv-card">
        <div className="border-b border-bsv-surface px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
            Distribution Feed
          </h2>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-bsv-muted">No posts in the last 14 days.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-card">
      <div className="border-b border-bsv-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Distribution Feed
        </h2>
      </div>
      <div className="divide-y divide-bsv-surface">
        {displayFeed.map((record, i) => {
          const url = platformUrl(record)
          return (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <span className="text-lg">{platformLabel(record.platform)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-bsv-cream">
                    {record.slot}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      record.status === 'success'
                        ? 'bg-green-900/40 text-green-400'
                        : 'bg-red-900/40 text-red-400'
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-bsv-muted">
                  <span>{new Date(record.timestamp).toLocaleString()}</span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate font-mono hover:text-bsv-amber"
                    >
                      {record.postId}
                    </a>
                  ) : (
                    <span className="truncate font-mono">{record.postId}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
