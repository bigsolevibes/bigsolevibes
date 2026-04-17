import Link from 'next/link'

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-bsv-bg overflow-hidden pt-16">
      {/* Background texture */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #E8621A 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Orange glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-bsv-orange/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-bsv-orange font-heading text-xl tracking-widest mb-4">
          BIG SOLE VIBES
        </p>

        <h1 className="font-heading text-6xl sm:text-8xl lg:text-9xl text-bsv-white leading-none tracking-wide mb-6">
          STEP UP.<br />
          FEEL GOOD.<br />
          <span className="text-bsv-orange">OWN IT.</span>
        </h1>

        <p className="text-bsv-muted text-lg sm:text-xl max-w-2xl mx-auto mb-10">
          Premium foot care built for men who take care of their kicks — and themselves.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/products"
            className="bg-bsv-orange hover:bg-orange-600 text-white font-heading text-xl tracking-widest px-10 py-4 transition-colors"
          >
            SHOP THE COLLECTION
          </Link>
          <Link
            href="/blog"
            className="border border-bsv-white/30 hover:border-bsv-orange text-bsv-white hover:text-bsv-orange font-heading text-xl tracking-widest px-10 py-4 transition-colors"
          >
            READ THE BLOG
          </Link>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <svg className="w-6 h-6 text-bsv-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
    </section>
  )
}
