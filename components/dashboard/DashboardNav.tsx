'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

const NAV_LINKS = [
  { href: '/dashboard/overview', label: 'Overview' },
  { href: '/dashboard/queue', label: 'Queue' },
  { href: '/dashboard/approvals', label: 'Approvals' },
  { href: '/dashboard/feed', label: 'Feed' },
  { href: '/dashboard/shelf', label: 'Shelf' },
  { href: '/dashboard/settings', label: 'Settings' },
]

export default function DashboardNav({ brandName }: { brandName: string }) {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 z-50 border-b border-bsv-surface bg-bsv-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 lg:px-8">
        <div className="flex items-center gap-6">
          <span className="font-heading text-lg tracking-wider text-bsv-cream">
            {brandName}
          </span>
          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  pathname?.startsWith(link.href)
                    ? 'bg-bsv-surface text-bsv-cream'
                    : 'text-bsv-muted hover:text-bsv-cream'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/dashboard/login' })}
          className="text-sm text-bsv-muted transition-colors hover:text-bsv-cream"
        >
          Sign out
        </button>
      </div>
      {/* Mobile nav */}
      <div className="flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`shrink-0 rounded px-3 py-1 text-xs font-medium transition-colors ${
              pathname?.startsWith(link.href)
                ? 'bg-bsv-surface text-bsv-cream'
                : 'text-bsv-muted hover:text-bsv-cream'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
