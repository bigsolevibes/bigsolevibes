import { StateAdapter } from '@/lib/dashboard/state-adapter'
import BlockersPanel from '@/components/dashboard/BlockersPanel'
import PipelineHealth from '@/components/dashboard/PipelineHealth'
import ContentQueue from '@/components/dashboard/ContentQueue'
import ApprovalQueue from '@/components/dashboard/ApprovalQueue'
import DistributionFeed from '@/components/dashboard/DistributionFeed'
import AudienceRevenue from '@/components/dashboard/AudienceRevenue'
import CostPanel from '@/components/dashboard/CostPanel'
import ProductShelf from '@/components/dashboard/ProductShelf'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OverviewPage() {
  const tenantId = 'bsv'

  const [slots, agents, feed, cost, standup, shelf] = await Promise.all([
    Promise.resolve(StateAdapter.getSlots(tenantId)),
    Promise.resolve(StateAdapter.getAgents(tenantId)),
    Promise.resolve(
      StateAdapter.getFeed(tenantId)
        .filter(
          (p) =>
            new Date(p.timestamp).getTime() > Date.now() - 14 * 24 * 60 * 60 * 1000
        )
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
    ),
    Promise.resolve(StateAdapter.getCost(tenantId)),
    Promise.resolve(StateAdapter.getLatestStandup(tenantId)),
    StateAdapter.getShelf(tenantId),
  ])

  const blockers = StateAdapter.extractBlockers(standup, slots, agents)
  const approvalItems = StateAdapter.getApprovalItems(slots)

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 lg:p-8">
      {/* Panel 1 — Blockers (always first, full width) */}
      <BlockersPanel blockers={blockers} />

      {/* Panel 4 — Approval Queue (mobile: second) */}
      <div className="lg:hidden">
        <ApprovalQueue items={approvalItems} />
      </div>

      {/* Panel 2 — Pipeline Health */}
      <PipelineHealth agents={agents} />

      {/* Panels 3 + 4 — Content Queue + Approval Queue (desktop side by side) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <ContentQueue slots={slots} />
        <div className="hidden lg:block">
          <ApprovalQueue items={approvalItems} />
        </div>
      </div>

      {/* Panel 5 — Distribution Feed */}
      <DistributionFeed feed={feed} limit={20} />

      {/* Panel 6 — Audience & Revenue */}
      <AudienceRevenue standup={standup} />

      {/* Panel 7 — Cost */}
      <CostPanel cost={cost} />

      {/* Panel 8 — Product Shelf */}
      <ProductShelf active={shelf.active} pending={shelf.pending} />
    </div>
  )
}
