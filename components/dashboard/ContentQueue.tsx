'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { WatchDriveState, SlotState } from '@/lib/dashboard/types'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const ALL_SLOTS = DAYS.flatMap((d) => [
  `${d}-am`,
  `${d}-am-flow`,
  `${d}-pm`,
  `${d}-pm-flow`,
])

type SlotCellStatus =
  | 'posted'
  | 'pending'
  | 'hold'
  | 'approval'
  | 'exhausted'
  | 'empty'

function getSlotStatus(slot: SlotState, activePlatforms: string[]): SlotCellStatus {
  if (slot._hold_since) return 'hold'
  if (slot._approval_requested) return 'approval'

  const active = activePlatforms.map((p) => slot[p] as { status: string; attempts: number } | undefined)
  const statuses = active.map((p) => p?.status ?? 'pending')

  if (statuses.every((s) => s === 'success')) return 'posted'
  if (statuses.some((s) => s === 'exhausted')) return 'exhausted'
  if (slot._media_since) return 'pending'
  return 'empty'
}

const STATUS_STYLE: Record<SlotCellStatus, string> = {
  posted: 'border-green-700/50 bg-green-950/30',
  pending: 'border-yellow-700/50 bg-yellow-950/20',
  hold: 'border-orange-700/50 bg-orange-950/20',
  approval: 'border-blue-600/50 bg-blue-950/30',
  exhausted: 'border-red-700/50 bg-red-950/20',
  empty: 'border-bsv-surface bg-bsv-surface/30',
}

const STATUS_DOT: Record<SlotCellStatus, string> = {
  posted: 'bg-green-500',
  pending: 'bg-yellow-500',
  hold: 'bg-orange-500',
  approval: 'bg-blue-400',
  exhausted: 'bg-red-500',
  empty: 'bg-bsv-muted/40',
}

const ACTIVE_PLATFORMS = ['instagram', 'bluesky']

export default function ContentQueue({
  slots,
  compact,
}: {
  slots: WatchDriveState
  compact?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  async function handleApprove(slot: string) {
    setActing(slot)
    await fetch('/api/dashboard/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    })
    setActing(null)
    startTransition(() => router.refresh())
  }

  async function handleDeny(slot: string) {
    setActing(slot)
    await fetch('/api/dashboard/deny', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    })
    setActing(null)
    startTransition(() => router.refresh())
  }

  const displaySlots = compact ? ALL_SLOTS.slice(0, 14) : ALL_SLOTS

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-card">
      <div className="border-b border-bsv-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Content Queue
        </h2>
      </div>
      <div className="overflow-x-auto p-4">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${DAYS.length}, minmax(90px, 1fr))`,
          }}
        >
          {/* Day headers */}
          {DAYS.map((day) => (
            <div
              key={day}
              className="text-center text-xs font-semibold uppercase tracking-widest text-bsv-muted"
            >
              {day}
            </div>
          ))}

          {/* Slot rows: am, am-flow, pm, pm-flow */}
          {(['am', 'am-flow', 'pm', 'pm-flow'] as const).map((timeSlot) => (
            <>
              {DAYS.map((day) => {
                const slotName = `${day}-${timeSlot}`
                const slot = slots[slotName] ?? {}
                const status = getSlotStatus(slot as SlotState, ACTIVE_PLATFORMS)
                const isExp = expanded === slotName
                const isFlow = timeSlot.endsWith('-flow')

                return (
                  <div key={slotName} className="flex flex-col gap-1">
                    <button
                      onClick={() => setExpanded(isExp ? null : slotName)}
                      className={`rounded border p-2 text-left transition-all hover:brightness-125 ${STATUS_STYLE[status]}`}
                    >
                      <div className="mb-1 flex items-center gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
                        <span className="text-[10px] font-mono text-bsv-muted">
                          {timeSlot.toUpperCase()}
                        </span>
                        {isFlow && (
                          <span className="text-[8px] text-bsv-muted/50">flow</span>
                        )}
                      </div>
                      <div className="flex gap-1 text-[9px] text-bsv-muted/70">
                        <span title="Media">
                          {slot._media_since ? '✓' : '✗'} med
                        </span>
                        <span title="Instagram">
                          {(slot.instagram as { status: string } | undefined)?.status === 'success'
                            ? '✓'
                            : '·'}{' '}
                          ig
                        </span>
                        <span title="Bluesky">
                          {(slot.bluesky as { status: string } | undefined)?.status === 'success'
                            ? '✓'
                            : '·'}{' '}
                          bsky
                        </span>
                      </div>
                    </button>

                    {isExp && (
                      <div className="rounded-lg border border-bsv-surface bg-bsv-surface/50 p-3 text-xs">
                        <p className="mb-2 font-mono font-medium text-bsv-cream">
                          {slotName}
                        </p>
                        <div className="space-y-1 text-bsv-muted">
                          {slot._media_since && (
                            <p>
                              Media:{' '}
                              <span className="text-bsv-cream">
                                {new Date(slot._media_since as string).toLocaleString()}
                              </span>
                            </p>
                          )}
                          {slot._hold_since && (
                            <p className="text-orange-400">
                              On hold since {new Date(slot._hold_since as string).toLocaleString()}
                            </p>
                          )}
                          {ACTIVE_PLATFORMS.map((p) => {
                            const ps = slot[p] as
                              | { status: string; attempts: number; error?: string }
                              | undefined
                            if (!ps) return null
                            return (
                              <p key={p}>
                                {p}:{' '}
                                <span
                                  className={
                                    ps.status === 'success'
                                      ? 'text-green-400'
                                      : ps.status === 'error'
                                      ? 'text-red-400'
                                      : 'text-bsv-cream'
                                  }
                                >
                                  {ps.status}
                                </span>
                                {ps.attempts > 0 && (
                                  <span className="ml-1 text-bsv-muted/60">
                                    ({ps.attempts} attempts)
                                  </span>
                                )}
                                {ps.error && (
                                  <span className="ml-1 text-red-400/80">
                                    — {ps.error}
                                  </span>
                                )}
                              </p>
                            )
                          })}
                        </div>
                        {status === 'approval' && (
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => handleApprove(slotName)}
                              disabled={acting === slotName || isPending}
                              className="min-h-[44px] flex-1 rounded bg-green-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-600 disabled:opacity-50"
                            >
                              APPROVE
                            </button>
                            <button
                              onClick={() => handleDeny(slotName)}
                              disabled={acting === slotName || isPending}
                              className="min-h-[44px] flex-1 rounded bg-red-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                            >
                              DENY
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  )
}
