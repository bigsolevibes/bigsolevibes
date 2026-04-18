import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'bsv-bg':      '#0D1B2A',
        'bsv-card':    '#162233',
        'bsv-surface': '#1C2E42',
        'bsv-amber':   '#C17D2E',
        'bsv-cream':   '#F5ECD7',
        'bsv-muted':   '#4A6380',
        // legacy aliases kept for components not yet updated
        'bsv-orange':  '#C17D2E',
        'bsv-white':   '#F5ECD7',
      },
      fontFamily: {
        heading: ['var(--font-bebas)', 'sans-serif'],
        body:    ['var(--font-playfair)', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
