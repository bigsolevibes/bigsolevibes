// Ad slot — drop your Google AdSense code inside the div below.
// 1. Sign up at adsense.google.com
// 2. Create an ad unit
// 3. Replace the inner content with the <ins> tag AdSense provides
// 4. Remove the placeholder styling once ads are live

export default function AdPlaceholder() {
  return (
    <section className="py-12 bg-bsv-bg">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-center">
        {/* Ad slot — replace contents with AdSense code */}
        <div
          id="ad-slot-home"
          className="w-full max-w-2xl h-24 border-2 border-dashed border-bsv-orange/40 flex items-center justify-center"
        >
          <span className="text-bsv-muted text-sm tracking-widest font-heading">
            AD SPACE
          </span>
        </div>
      </div>
    </section>
  )
}
