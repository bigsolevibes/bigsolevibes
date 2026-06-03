import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { StateAdapter } from '@/lib/dashboard/state-adapter'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  return Response.json(StateAdapter.getCost('bsv'))
}
