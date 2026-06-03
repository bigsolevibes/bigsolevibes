import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { StateAdapter } from '@/lib/dashboard/state-adapter'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = 'bsv'
  const [slots, agents, feed, cost, standup] = await Promise.all([
    Promise.resolve(StateAdapter.getSlots(tenantId)),
    Promise.resolve(StateAdapter.getAgents(tenantId)),
    Promise.resolve(StateAdapter.getFeed(tenantId)),
    Promise.resolve(StateAdapter.getCost(tenantId)),
    Promise.resolve(StateAdapter.getLatestStandup(tenantId)),
  ])

  const blockers = StateAdapter.extractBlockers(standup, slots, agents)
  const approvalItems = StateAdapter.getApprovalItems(slots)

  return Response.json({ slots, agents, feed, cost, blockers, approvalItems })
}
