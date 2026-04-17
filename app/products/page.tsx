import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { products } from '@/lib/affiliates'

export const metadata: Metadata = {
  title: 'Products',
  description:
    'Handpicked foot care products for men. No fluff — just what actually works.',
}

export default function ProductsPage() {
  return (
    <>
      <Navbar />
      <main className="pt-16">
        {/* Header */}
        <section className="py-20 bg-bsv-card border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="font-heading text-6xl sm:text-7xl text-bsv-white tracking-wide mb-4">
              THE <span className="text-bsv-orange">COLLECTION</span>
            </h1>
            <p className="text-bsv-muted text-lg max-w-xl mx-auto">
              Every product here is handpicked. If it doesn't work, it doesn't make the list.
            </p>
          </div>
        </section>

        {/* Products grid */}
        <section className="py-24 bg-bsv-bg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="bg-bsv-card border border-white/5 hover:border-bsv-orange/30 transition-colors flex flex-col"
                >
                  {/* Placeholder image */}
                  <div
                    className="h-64 w-full flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, #E8621A22 0%, #E8621A44 100%)',
                    }}
                  >
                    <span className="font-heading text-5xl text-bsv-orange/50 tracking-widest">
                      BSV
                    </span>
                  </div>

                  <div className="p-6 flex flex-col flex-1">
                    <h2 className="font-heading text-2xl text-bsv-white tracking-wide mb-2">
                      {product.name}
                    </h2>
                    <p className="text-bsv-muted text-sm leading-relaxed mb-6 flex-1">
                      {product.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-2xl text-bsv-orange">
                        {product.price}
                      </span>
                      {/* Replace with your Amazon Associates or affiliate URL */}
                      <a
                        href={product.affiliateUrl}
                        className="bg-bsv-orange hover:bg-orange-600 text-white font-heading tracking-widest text-sm px-6 py-3 transition-colors"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        SHOP NOW
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
