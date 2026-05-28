import { StateAdapter } from '@/lib/dashboard/state-adapter'
import DistributionFeed from '@/components/dashboard/DistributionFeed'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function FeedPage() {
  const feed = StateAdapter.getFeed('bsv')
    .filter(
      (p) =>
        new Date(p.timestamp).getTime() > Date.now() - 14 * 24 * 60 * 60 * 1000
    )
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

  return (
    <div className="mx-auto max-w-[900px] p-4 lg:p-8">
      <h1 className="mb-6 font-heading text-2xl tracking-wider text-bsv-cream">
        Distribution Feed
      </h1>
      <DistributionFeed feed={feed} />
    </div>
  )
}
