import { StateAdapter } from '@/lib/dashboard/state-adapter'
import ContentQueue from '@/components/dashboard/ContentQueue'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function QueuePage() {
  const slots = StateAdapter.getSlots('bsv')

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-8">
      <h1 className="mb-6 font-heading text-2xl tracking-wider text-bsv-cream">
        Content Queue
      </h1>
      <ContentQueue slots={slots} />
    </div>
  )
}
