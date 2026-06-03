'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ProductRow } from '@/lib/dashboard/types'

const TRACK_LABEL: Record<string, string> = {
  '1': 'Premium Transposition',
  '2': 'Cultural Crossover',
}

function ProductCard({ product }: { product: ProductRow }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-surface/40 p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-bsv-cream">{product.name}</p>
          {product.track && (
            <span className="shrink-0 rounded bg-bsv-amber/10 px-1.5 py-0.5 text-[10px] text-bsv-amber">
              T{product.track}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-bsv-muted">
          {product.affiliateNetwork && (
            <span>{product.affiliateNetwork}</span>
          )}
          {product.price && (
            <>
              <span>·</span>
              <span>{product.price}</span>
            </>
          )}
          {product.score && (
            <>
              <span>·</span>
              <span>Score: {product.score}</span>
            </>
          )}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-bsv-surface pt-2 text-xs text-bsv-muted">
          <p className="text-bsv-cream/80">{product.description}</p>
          {product.track && (
            <p>Track: {TRACK_LABEL[product.track] ?? product.track}</p>
          )}
          {product.crossoverSignal && (
            <p>Signal: {product.crossoverSignal}</p>
          )}
          {product.category && <p>Category: {product.category}</p>}
          {product.affiliateLink && (
            <a
              href={product.affiliateLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-bsv-amber hover:underline"
            >
              Affiliate link ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function PendingCard({
  product,
  onApprove,
  onDeny,
  disabled,
}: {
  product: ProductRow
  onApprove: () => void
  onDeny: () => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-bsv-amber/20 bg-bsv-surface/40 p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-bsv-cream">{product.name}</p>
          <span className="shrink-0 rounded bg-bsv-amber/20 px-1.5 py-0.5 text-[10px] text-bsv-amber">
            PENDING
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-bsv-muted">
          {product.track && (
            <span>Track {product.track}</span>
          )}
          {product.score && (
            <>
              <span>·</span>
              <span>Score: {product.score}</span>
            </>
          )}
          {product.crossoverSignal && (
            <>
              <span>·</span>
              <span className="text-bsv-amber/80">{product.crossoverSignal}</span>
            </>
          )}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-bsv-surface pt-2 text-xs text-bsv-muted">
          <p className="text-bsv-cream/80">{product.description}</p>
          {product.reasoning && (
            <p className="italic text-bsv-muted/80">{product.reasoning}</p>
          )}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onApprove() }}
          disabled={disabled}
          className="min-h-[44px] flex-1 rounded bg-green-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-green-600 disabled:opacity-50"
        >
          APPROVE
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDeny() }}
          disabled={disabled}
          className="min-h-[44px] flex-1 rounded bg-red-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          DENY
        </button>
      </div>
    </div>
  )
}

export default function ProductShelf({
  active,
  pending,
}: {
  active: ProductRow[]
  pending: ProductRow[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [acting, setActing] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  async function handleShelfAction(
    product: ProductRow,
    action: 'approve' | 'deny'
  ) {
    const key = product.asin || product.name
    setActing(key)
    await fetch(`/api/dashboard/shelf/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asin: product.asin }),
    })
    setDismissed((prev) => { const next = new Set(Array.from(prev)); next.add(key); return next })
    setActing(null)
    startTransition(() => router.refresh())
  }

  const visiblePending = pending.filter(
    (p) => !dismissed.has(p.asin || p.name)
  )

  return (
    <div className="rounded-lg border border-bsv-surface bg-bsv-card">
      <div className="border-b border-bsv-surface px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Product Shelf
        </h2>
      </div>
      <div className="p-4">
        {/* Active shelf */}
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-medium text-bsv-muted">
            Active Shelf ({active.length})
          </h3>
          {active.length === 0 ? (
            <p className="text-sm text-bsv-muted/60">No approved products yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((product, i) => (
                <ProductCard key={i} product={product} />
              ))}
            </div>
          )}
        </div>

        {/* Pending review */}
        {visiblePending.length > 0 && (
          <div>
            <h3 className="mb-3 text-xs font-medium text-bsv-muted">
              Pending Review ({visiblePending.length})
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePending.map((product, i) => (
                <PendingCard
                  key={i}
                  product={product}
                  onApprove={() => handleShelfAction(product, 'approve')}
                  onDeny={() => handleShelfAction(product, 'deny')}
                  disabled={acting === (product.asin || product.name) || isPending}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
