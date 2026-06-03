import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { StateAdapter } from '@/lib/dashboard/state-adapter'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slot } = await req.json()
  if (!slot || typeof slot !== 'string') {
    return Response.json({ error: 'slot required' }, { status: 400 })
  }

  StateAdapter.writeApproval('bsv', slot, 'approved')
  return Response.json({ ok: true, slot, action: 'approved' })
}
