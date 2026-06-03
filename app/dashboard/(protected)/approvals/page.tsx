import { StateAdapter } from '@/lib/dashboard/state-adapter'
import ApprovalQueue from '@/components/dashboard/ApprovalQueue'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ApprovalsPage() {
  const slots = StateAdapter.getSlots('bsv')
  const approvalItems = StateAdapter.getApprovalItems(slots)
  const shelf = await StateAdapter.getShelf('bsv')

  // Add pending product items to the approval queue
  const productItems = shelf.pending.map((p) => ({
    type: 'product' as const,
    id: p.asin || p.name,
    product: p,
  }))

  const allItems = [...approvalItems, ...productItems]

  return (
    <div className="mx-auto max-w-[800px] p-4 lg:p-8">
      <h1 className="mb-6 font-heading text-2xl tracking-wider text-bsv-cream">
        Approval Queue
      </h1>
      <ApprovalQueue items={allItems} />
    </div>
  )
}
