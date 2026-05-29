function parseStandupSection(standup: string | null, sectionPattern: RegExp): string | null {
  if (!standup) return null
  const match = standup.match(sectionPattern)
  return match ? match[0] : null
}

function extractNumber(text: string, pattern: RegExp): number | null {
  const m = text.match(pattern)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  return isNaN(n) ? null : n
}

interface AudienceData {
  instagram: number | null
  bluesky: number | null
  loungeSubscribers: number | null
  dropSubscribers: number | null
}

interface RevenueData {
  amazon: { monthly: number | null; allTime: number | null }
  cj: { monthly: number | null; allTime: number | null }
  flexOffers: { monthly: number | null; allTime: number | null }
}

function parseAudience(standup: string | null): AudienceData {
  if (!standup) return { instagram: null, bluesky: null, loungeSubscribers: null, dropSubscribers: null }

  const growthSection = standup.match(/GROWTH[\s\S]*?(?=\n\*\d|$)/i)?.[0] ?? ''

  return {
    instagram: extractNumber(growthSection, /Instagram:\s*([\d,]+)\s*follower/i),
    bluesky: extractNumber(growthSection, /Bluesky:\s*([\d,]+)\s*follower/i),
    loungeSubscribers: extractNumber(growthSection, /Lounge[:\s]*([\d,]+)/i),
    dropSubscribers: extractNumber(growthSection, /Drop[:\s]*([\d,]+)/i),
  }
}

function parseRevenue(standup: string | null): RevenueData {
  if (!standup) {
    return {
      amazon: { monthly: null, allTime: null },
      cj: { monthly: null, allTime: null },
      flexOffers: { monthly: null, allTime: null },
    }
  }

  const revenueSection =
    standup.match(/REVENUE[\s\S]*?(?=\n\*\d|$)/i)?.[0] ?? ''

  return {
    amazon: {
      monthly: extractNumber(revenueSection, /Amazon[^$]*\$([\d.]+)/i),
      allTime: null,
    },
    cj: {
      monthly: extractNumber(revenueSection, /CJ[^$]*\$([\d.]+)/i),
      allTime: null,
    },
    flexOffers: {
      monthly: extractNumber(revenueSection, /FlexOffers[^$]*\$([\d.]+)/i),
      allTime: null,
    },
  }
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number | null
  sub?: string
}) {
  return (
    <div>
      <p className="text-xs text-bsv-muted">{label}</p>
      <p className="text-xl font-semibold text-bsv-cream">
        {value === null ? <span className="text-sm text-bsv-muted/60">—</span> : value}
      </p>
      {sub && <p className="text-xs text-bsv-muted/60">{sub}</p>}
    </div>
  )
}

function formatCurrency(n: number | null): string {
  if (n === null) return '—'
  return `$${n.toFixed(2)}`
}

export default function AudienceRevenue({
  standup,
}: {
  standup: string | null
}) {
  const audience = parseAudience(standup)
  const revenue = parseRevenue(standup)

  const totalAudience =
    (audience.instagram ?? 0) +
    (audience.bluesky ?? 0) +
    (audience.loungeSubscribers ?? 0) +
    (audience.dropSubscribers ?? 0)

  const totalRevenue =
    (revenue.amazon.monthly ?? 0) +
    (revenue.cj.monthly ?? 0) +
    (revenue.flexOffers.monthly ?? 0)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Audience */}
      <div className="rounded-lg border border-bsv-surface bg-bsv-card p-4">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Audience
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Instagram" value={audience.instagram} />
          <Stat label="Bluesky" value={audience.bluesky} />
          <Stat label="The Lounge" value={audience.loungeSubscribers} sub="email" />
          <Stat label="The Drop" value={audience.dropSubscribers} sub="email" />
          <Stat
            label="Total Engaged"
            value={totalAudience > 0 ? totalAudience : null}
          />
        </div>
      </div>

      {/* Revenue */}
      <div className="rounded-lg border border-bsv-surface bg-bsv-card p-4">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Revenue — This Month
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Amazon Associates" value={formatCurrency(revenue.amazon.monthly)} />
          <Stat label="CJ Affiliate" value={formatCurrency(revenue.cj.monthly)} />
          <Stat label="FlexOffers" value={formatCurrency(revenue.flexOffers.monthly)} />
          <Stat
            label="Total"
            value={
              revenue.amazon.monthly !== null ||
              revenue.cj.monthly !== null ||
              revenue.flexOffers.monthly !== null
                ? `$${totalRevenue.toFixed(2)}`
                : null
            }
          />
        </div>
      </div>
    </div>
  )
}
