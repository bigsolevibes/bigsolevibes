import type { CostState } from '@/lib/dashboard/types'

const CEILING = 2.0

function costColor(cost: number): string {
  if (cost > CEILING) return 'text-red-400'
  if (cost >= 1.5) return 'text-yellow-400'
  return 'text-green-400'
}

export default function CostPanel({ cost }: { cost: CostState | null }) {
  if (!cost) {
    return (
      <div className="rounded-lg border border-bsv-surface bg-bsv-card px-4 py-3">
        <p className="text-xs text-bsv-muted">Cost data unavailable.</p>
      </div>
    )
  }

  const today = cost.today_cost ?? 0
  const avg = cost.avg_daily_burn ?? 0
  const balance = cost.balance ?? 0
  const runway =
    avg > 0 ? Math.floor(balance / avg) : null

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-card">
      <div className="border-b border-bsv-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Cost
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-6 px-4 py-3">
        <div>
          <span className="text-xs text-bsv-muted">Today</span>
          <span className={`ml-2 text-xl font-bold tabular-nums ${costColor(today)}`}>
            ${today.toFixed(4)}
          </span>
          {today > CEILING && (
            <span className="ml-2 text-xs text-red-400">⚠ over ceiling</span>
          )}
        </div>
        <div className="text-bsv-muted/30">·</div>
        <div>
          <span className="text-xs text-bsv-muted">7-day avg</span>
          <span className="ml-2 font-semibold text-bsv-cream tabular-nums">
            ${avg.toFixed(4)}/day
          </span>
        </div>
        <div className="text-bsv-muted/30">·</div>
        <div>
          <span className="text-xs text-bsv-muted">Balance</span>
          <span className="ml-2 font-semibold text-bsv-cream tabular-nums">
            ${balance.toFixed(2)}
          </span>
        </div>
        <div className="text-bsv-muted/30">·</div>
        <div>
          <span className="text-xs text-bsv-muted">Runway</span>
          <span className="ml-2 font-semibold text-bsv-cream">
            {runway !== null ? `${runway} days` : 'unknown'}
          </span>
        </div>
        <div className="text-bsv-muted/30">·</div>
        <div>
          <span className="text-xs text-bsv-muted">Ceiling</span>
          <span className="ml-2 font-semibold text-bsv-muted/60">
            ${CEILING.toFixed(2)}/day
          </span>
        </div>
      </div>
    </div>
  )
}
