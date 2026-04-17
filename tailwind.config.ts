import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'bsv-bg':      '#1a1a1a',
        'bsv-card':    '#242424',
        'bsv-surface': '#2e2e2e',
        'bsv-orange':  '#E8621A',
        'bsv-white':   '#ffffff',
        'bsv-muted':   '#999999',
      },
      fontFamily: {
        heading: ['var(--font-bebas)', 'sans-serif'],
        body:    ['var(--font-inter)', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
