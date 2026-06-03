import { StateAdapter } from '@/lib/dashboard/state-adapter'
import ProductShelf from '@/components/dashboard/ProductShelf'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ShelfPage() {
  const shelf = await StateAdapter.getShelf('bsv')

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-8">
      <h1 className="mb-6 font-heading text-2xl tracking-wider text-bsv-cream">
        Product Shelf
      </h1>
      <ProductShelf active={shelf.active} pending={shelf.pending} />
    </div>
  )
}
