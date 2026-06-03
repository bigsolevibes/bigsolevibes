import DashboardNav from '@/components/dashboard/DashboardNav'
import bsvConfig from '@/config/tenants/bsv.json'

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <DashboardNav brandName={bsvConfig.brand_name} />
      <main className="pb-16">{children}</main>
    </>
  )
}
