import Link from 'next/link'
import { products } from '@/lib/affiliates'

export default function ProductShowcase() {
  return (
    <section className="py-24 bg-bsv-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="font-heading text-5xl sm:text-6xl text-bsv-white tracking-wide mb-4">
            FEATURED <span className="text-bsv-orange">PRODUCTS</span>
          </h2>
          <p className="text-bsv-muted text-lg max-w-xl mx-auto">
            Handpicked for men who take the whole package seriously.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {products.map((product) => (
            <div
              key={product.id}
              className="bg-bsv-bg border border-white/5 hover:border-bsv-orange/30 transition-colors flex flex-col"
            >
              {/* Placeholder image area */}
              <div
                className="h-56 w-full flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #E8621A22 0%, #E8621A44 100%)',
                }}
              >
                <span className="font-heading text-4xl text-bsv-orange/50 tracking-widest">
                  BSV
                </span>
              </div>

              <div className="p-6 flex flex-col flex-1">
                <h3 className="font-heading text-2xl text-bsv-white tracking-wide mb-2">
                  {product.name}
                </h3>
                <p className="text-bsv-muted text-sm leading-relaxed mb-4 flex-1">
                  {product.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="font-heading text-2xl text-bsv-orange">
                    {product.price}
                  </span>
                  {/* Replace with your Amazon Associates or affiliate URL */}
                  <a
                    href={product.affiliateUrl}
                    className="bg-bsv-orange hover:bg-orange-600 text-white font-heading tracking-widest text-sm px-6 py-2 transition-colors"
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

        <div className="text-center mt-12">
          <Link
            href="/products"
            className="border border-bsv-orange text-bsv-orange hover:bg-bsv-orange hover:text-white font-heading text-xl tracking-widest px-12 py-4 transition-colors inline-block"
          >
            VIEW ALL PRODUCTS
          </Link>
        </div>
      </div>
    </section>
  )
}
