'use client'

import { useState, useEffect } from 'react'

// Generated via scripts/gen-crawl-images.js + gen-beach-image.js (Imagen 4) — style
// progresses with the eras: cave/roman = Monty Python flat-cutout collage animation,
// victorian = hand-tinted engraving blending toward photographic, midcentury = mostly
// photographic w/ vintage grade, modern + beach = fully photorealistic cinematic
// (matches BSV visual standard). "Beach" is the closing beat — the convergence — and
// settles in as "Until now." resolves.
const BG_IMAGES = [
  '/crawl/cave.jpg',
  '/crawl/roman.jpg',
  '/crawl/victorian.jpg',
  '/crawl/midcentury.jpg',
  '/crawl/modern.jpg',
  '/crawl/beach.jpg',
]

const CRAWL_PARAGRAPHS = [
  'For 300,000 years, man has been getting better at this.',
  'He discovered fire. He invented the wheel. He built the pyramids, wrote symphonies, landed on the moon, and perfected the double Windsor knot.',
  'Somewhere in there he figured out soap. Then cologne. Then a seventeen-step skincare routine. He conditioned the beard. He exfoliated the face. He moisturized everything.',
  'Everything above the ankle.',
  'The feet remained a mystery. An afterthought. A closed chapter in the otherwise remarkable story of human self-improvement.',
  'Until now.',
]

// Slower read — let each line land before the next arrives. The image progression
// is paced off the same clock so "beach" (the convergence) settles in and holds
// as the crawl resolves on "Until now." — instead of cycling independently.
const CRAWL_DURATION_S = 34
const IMAGE_DWELL_MS   = (CRAWL_DURATION_S * 1000) / BG_IMAGES.length

export default function OpeningCrawl() {
  const [activeImg, setActiveImg]   = useState(0)
  const [showSkip, setShowSkip]     = useState(true)

  useEffect(() => {
    let i = 0
    const timer = setInterval(() => {
      i += 1
      if (i >= BG_IMAGES.length - 1) {
        setActiveImg(BG_IMAGES.length - 1)
        clearInterval(timer)
        return
      }
      setActiveImg(i)
    }, IMAGE_DWELL_MS)
    // Hide skip button after crawl completes
    const crawlEnd = setTimeout(() => setShowSkip(false), CRAWL_DURATION_S * 1000)
    return () => { clearInterval(timer); clearTimeout(crawlEnd) }
  }, [])

  function skip() {
    setShowSkip(false)
    document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="relative w-full overflow-hidden" style={{ height: '100svh' }}>

      {/* Crossfading background images */}
      {BG_IMAGES.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${src})`,
            opacity: i === activeImg ? 1 : 0,
            transition: 'opacity 2s ease-in-out',
          }}
        />
      ))}

      {/* 60% dark overlay */}
      <div className="absolute inset-0" style={{ background: 'rgba(13, 27, 42, 0.6)' }} />

      {/* SKIP button — fixed z-[60] clears the nav at z-50; hides after crawl or on click */}
      {showSkip && (
        <button
          onClick={skip}
          className="fixed top-4 right-6 z-[60] font-heading text-xs tracking-[0.3em] text-bsv-cream/60 hover:text-bsv-cream border border-white/20 hover:border-white/50 px-4 py-2 transition-colors bg-bsv-bg/60 backdrop-blur-sm"
          aria-label="Skip to main content"
        >
          SKIP
        </button>
      )}

      {/* Crawl viewport — clips the scrolling text */}
      <div className="absolute inset-0 overflow-hidden z-10">
        <div
          className="absolute left-0 right-0 flex justify-center px-8"
          style={{ bottom: 0, animation: `bsvCrawl ${CRAWL_DURATION_S}s linear forwards` }}
        >
          <div className="max-w-[600px] w-full text-center pb-8">
            {CRAWL_PARAGRAPHS.map((para, i) => (
              <p
                key={i}
                className="font-display italic text-bsv-cream leading-relaxed mb-10"
                style={{ fontSize: 'clamp(1rem, 2vw, 1.25rem)' }}
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bsvCrawl {
          from { transform: translateY(100vh); }
          to   { transform: translateY(-120vh); }
        }
      `}</style>
    </section>
  )
}
