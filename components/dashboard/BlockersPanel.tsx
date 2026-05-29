import type { Blocker } from '@/lib/dashboard/types'

export default function BlockersPanel({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) {
    return (
      <div className="rounded-lg border border-green-800/40 bg-green-950/30 px-4 py-3">
        <p className="text-sm font-medium text-green-400">
          No blockers. Pipeline clear.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-red-700/50 bg-red-950/40">
      <div className="flex items-center gap-2 border-b border-red-700/30 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <h2 className="text-sm font-semibold tracking-wide text-red-400 uppercase">
          Blockers ({blockers.length})
        </h2>
      </div>
      <div className="divide-y divide-red-900/30">
        {blockers.map((blocker, i) => (
          <div key={i} className="px-4 py-4">
            <p className="mb-2 font-semibold text-red-300">
              BLOCKER: {blocker.name}
            </p>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-red-500/70">WHAT</dt>
                <dd className="text-bsv-cream/80">{blocker.what}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-red-500/70">WHY</dt>
                <dd className="text-bsv-cream/80">{blocker.why}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-red-500/70">IMPACT</dt>
                <dd className="text-bsv-cream/80">{blocker.impact}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-red-500/70">DECISION</dt>
                <dd className="font-medium text-red-300">{blocker.decision}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}
