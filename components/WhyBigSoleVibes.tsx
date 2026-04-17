const features = [
  {
    icon: (
      <svg className="w-10 h-10 text-bsv-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
      </svg>
    ),
    title: 'Built for Men',
    description:
      "Most foot care is designed for everyone — which means it's designed for no one. We make products that work with how men actually live.",
  },
  {
    icon: (
      <svg className="w-10 h-10 text-bsv-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>
      </svg>
    ),
    title: 'No Nonsense Formulas',
    description:
      'No filler. No fluff. Every product we recommend is chosen for one reason: it actually works. Your time is too valuable for anything less.',
  },
  {
    icon: (
      <svg className="w-10 h-10 text-bsv-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
    ),
    title: 'Sole to Soul Confidence',
    description:
      "When your feet feel good, everything changes. Stand taller. Move better. Show up with the kind of confidence that starts from the ground up.",
  },
]

export default function WhyBigSoleVibes() {
  return (
    <section className="py-24 bg-bsv-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="font-heading text-5xl sm:text-6xl text-bsv-white tracking-wide mb-4">
            WHY <span className="text-bsv-orange">BIG SOLE VIBES</span>
          </h2>
          <p className="text-bsv-muted text-lg max-w-xl mx-auto">
            Because your foundation matters. Every step you take starts here.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-bsv-card border border-white/5 p-8 hover:border-bsv-orange/30 transition-colors"
            >
              <div className="mb-6">{feature.icon}</div>
              <h3 className="font-heading text-2xl text-bsv-white tracking-wide mb-3">
                {feature.title}
              </h3>
              <p className="text-bsv-muted leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
