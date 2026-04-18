import type { Metadata } from 'next'
import { Playfair_Display, Bebas_Neue } from 'next/font/google'
import './globals.css'
import GoogleAnalytics from '@/components/GoogleAnalytics'
import AffiliateBanner from '@/components/AffiliateBanner'

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://bigsolevibes.com'),
  title: {
    default: 'Big Sole Vibes — Premium Men\'s Foot Care',
    template: '%s | Big Sole Vibes',
  },
  description:
    'Premium foot care and accessories built for men who take care of their kicks — and themselves.',
  openGraph: {
    title: 'Big Sole Vibes',
    description:
      'Premium foot care built for men who take care of their kicks — and themselves.',
    url: 'https://bigsolevibes.com',
    siteName: 'Big Sole Vibes',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630 }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Big Sole Vibes',
    description: 'Premium foot care built for men.',
    images: ['/og-image.jpg'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? ''

  return (
    <html lang="en" className={`${playfair.variable} ${bebasNeue.variable}`}>
      <body className="bg-bsv-bg text-bsv-white font-body antialiased">
        {gaId && <GoogleAnalytics gaId={gaId} />}
        <AffiliateBanner />
        {children}
      </body>
    </html>
  )
}
