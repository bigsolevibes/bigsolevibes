'use client'

import { useState } from 'react'
import type { OrgChartState, AgentStatus } from '@/lib/dashboard/types'

const STATUS_CONFIG: Record<
  AgentStatus,
  { dot: string; bg: string; label: string }
> = {
  active: {
    dot: 'bg-green-500',
    bg: 'border-green-700/40 bg-green-950/20',
    label: 'active',
  },
  stale: {
    dot: 'bg-yellow-500',
    bg: 'border-yellow-700/40 bg-yellow-950/20',
    label: 'stale',
  },
  error: {
    dot: 'bg-red-500',
    bg: 'border-red-700/40 bg-red-950/20',
    label: 'error',
  },
  'never-run': {
    dot: 'bg-bsv-muted',
    bg: 'border-bsv-muted/30 bg-bsv-surface/30',
    label: 'never run',
  },
  inactive: {
    dot: 'bg-bsv-muted/50',
    bg: 'border-bsv-muted/20 bg-bsv-surface/20',
    label: 'inactive',
  },
}

function timeAgo(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function PipelineHealth({ agents }: { agents: OrgChartState }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const agentEntries = Object.entries(agents.agents)

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-card">
      <div className="border-b border-bsv-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Pipeline Health
        </h2>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {agentEntries.map(([name, agent]) => {
          const cfg = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.inactive
          const isExpanded = expanded === name
          return (
            <div key={name} className="flex flex-col gap-1">
              <button
                onClick={() => setExpanded(isExpanded ? null : name)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${cfg.bg} hover:brightness-125`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />
                <span className="text-bsv-cream">{name}</span>
              </button>
              {isExpanded && (
                <div className="ml-1 rounded-lg border border-bsv-surface bg-bsv-surface/50 p-3 text-xs">
                  <div className="space-y-1">
                    <p className="text-bsv-muted">{agent.role}</p>
                    <p className="text-bsv-cream">
                      Status:{' '}
                      <span className="font-medium">{cfg.label}</span>
                    </p>
                    <p className="text-bsv-cream">
                      Last run:{' '}
                      <span className="text-bsv-muted">
                        {timeAgo(agent.lastSeen)}
                      </span>
                    </p>
                    <p className="text-bsv-cream">
                      Schedule:{' '}
                      <span className="text-bsv-muted">{agent.schedule}</span>
                    </p>
                    {agent.lastError && (
                      <p className="mt-2 rounded bg-red-950/50 p-2 font-mono text-red-400">
                        {agent.lastError}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-bsv-surface px-4 py-2">
        <p className="text-xs text-bsv-muted/60">
          Updated {new Date(agents.lastUpdated).toLocaleString()}
        </p>
      </div>
    </div>
  )
}
