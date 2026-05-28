import bsvConfig from '@/config/tenants/bsv.json'

export default function SettingsPage() {
  const config = bsvConfig

  return (
    <div className="mx-auto max-w-[700px] p-4 lg:p-8">
      <h1 className="mb-6 font-heading text-2xl tracking-wider text-bsv-cream">
        Settings
      </h1>

      <div className="rounded-lg border border-bsv-surface bg-bsv-card">
        <div className="border-b border-bsv-surface px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-bsv-muted">
            Tenant Config — {config.tenant_id}
          </h2>
        </div>
        <div className="divide-y divide-bsv-surface">
          {(
            [
              ['Brand Name', config.brand_name],
              ['Tenant ID', config.tenant_id],
              ['Primary Color', config.primary_color],
              ['Accent Color', config.accent_color],
              ['Platforms', config.platforms.join(', ')],
              ['Drive Folder', config.drive_folder],
              ['Pipeline Root', config.pipeline_root],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label} className="flex items-center gap-4 px-4 py-3">
              <dt className="w-36 shrink-0 text-xs text-bsv-muted">{label}</dt>
              <dd className="text-sm text-bsv-cream font-mono">{value}</dd>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-bsv-surface bg-bsv-card p-4">
        <p className="text-xs text-bsv-muted">
          To edit tenant config, update{' '}
          <code className="rounded bg-bsv-surface px-1 py-0.5 font-mono text-bsv-cream">
            config/tenants/bsv.json
          </code>{' '}
          and restart the server.
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-bsv-surface bg-bsv-card p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-bsv-muted">
          Environment Variables Required
        </h3>
        <div className="space-y-1 font-mono text-xs text-bsv-muted">
          {[
            'DASHBOARD_EMAIL',
            'DASHBOARD_PASSWORD_HASH',
            'DASHBOARD_SECRET',
          ].map((v) => (
            <div key={v} className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  process.env[v] ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className={process.env[v] ? 'text-bsv-cream' : 'text-red-400'}>
                {v}
              </span>
              {!process.env[v] && (
                <span className="text-red-400/60">— not set</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
