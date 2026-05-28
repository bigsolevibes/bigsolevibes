import SessionProvider from '@/components/dashboard/SessionProvider'

export const metadata = {
  title: 'Dashboard',
  robots: 'noindex, nofollow',
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-bsv-bg">{children}</div>
    </SessionProvider>
  )
}
