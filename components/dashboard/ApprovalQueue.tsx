'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ApprovalItem } from '@/lib/dashboard/types'

export default function ApprovalQueue({ items }: { items: ApprovalItem[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [acting, setActing] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())

  async function handleAction(item: ApprovalItem, action: 'approve' | 'deny') {
    const key = item.id
    setActing(key)

    const endpoint =
      item.type === 'content'
        ? `/api/dashboard/${action}`
        : `/api/dashboard/shelf/${action}`

    const body =
      item.type === 'content'
        ? { slot: item.slot }
        : { asin: item.product?.asin }

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setDone((prev) => { const next = new Set(Array.from(prev)); next.add(key); return next })
    setActing(null)
    startTransition(() => router.refresh())
  }

  const visible = items.filter((i) => !done.has(i.id))

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-bsv-surface bg-bsv-card">
        <div className="border-b border-bsv-surface px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
            Approval Queue
          </h2>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-bsv-muted">
            Nothing waiting on you. Go touch grass.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-card">
      <div className="border-b border-bsv-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Approval Queue{' '}
          <span className="ml-1 rounded-full bg-bsv-amber/20 px-1.5 py-0.5 text-bsv-amber">
            {visible.length}
          </span>
        </h2>
      </div>
      <div className="divide-y divide-bsv-surface">
        {visible.map((item) => (
          <div key={item.id} className="px-4 py-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded bg-bsv-surface px-2 py-0.5 text-xs font-mono text-bsv-muted">
                {item.type}
              </span>
              <span className="font-medium text-bsv-cream">
                {item.type === 'content' ? item.slot : item.product?.name}
              </span>
            </div>

            {item.type === 'content' && item.requestedAt && (
              <p className="mb-3 text-xs text-bsv-muted">
                Requested{' '}
                {new Date(item.requestedAt).toLocaleString()}
              </p>
            )}

            {item.type === 'product' && item.product && (
              <div className="mb-3 space-y-1 text-xs text-bsv-muted">
                <p>
                  Score:{' '}
                  <span className="text-bsv-cream">{item.product.score}</span>
                </p>
                <p>
                  Track:{' '}
                  <span className="text-bsv-cream">{item.product.track}</span>
                </p>
                {item.product.crossoverSignal && (
                  <p>
                    Signal:{' '}
                    <span className="text-bsv-cream">
                      {item.product.crossoverSignal}
                    </span>
                  </p>
                )}
                <p className="text-bsv-cream/70">{item.product.reasoning}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => handleAction(item, 'approve')}
                disabled={acting === item.id || isPending}
                className="min-h-[44px] flex-1 rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-600 disabled:opacity-50"
              >
                APPROVE
              </button>
              <button
                onClick={() => handleAction(item, 'deny')}
                disabled={acting === item.id || isPending}
                className="min-h-[44px] flex-1 rounded bg-red-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                DENY
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
