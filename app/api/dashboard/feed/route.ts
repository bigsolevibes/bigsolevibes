import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { StateAdapter } from '@/lib/dashboard/state-adapter'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const feed = StateAdapter.getFeed('bsv')
  // Most recent first, last 14 days
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const filtered = feed
    .filter((p) => new Date(p.timestamp).getTime() > cutoff)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return Response.json(filtered)
}
