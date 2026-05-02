import Link from 'next/link'

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const MUTED = '#4A6380'
const NAVY  = '#0D1B2A'

export const metadata = {
  title: 'Terms of Service — Big Sole Vibes',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-sm tracking-widest" style={{ color: AMBER }}>{title}</h2>
      <div className="font-body text-sm leading-relaxed" style={{ color: MUTED }}>
        {children}
      </div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: NAVY, color: CREAM }}>

      {/* Nav */}
      <nav className="w-full flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: AMBER + '22' }}>
        <Link href="/" className="font-heading text-xl tracking-widest hover:opacity-70 transition-opacity" style={{ color: CREAM }}>
          BIG SOLE VIBES
        </Link>
      </nav>

      {/* Content */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-16 flex flex-col gap-10">

        <div className="flex flex-col gap-2">
          <p className="font-heading text-xs tracking-widest" style={{ color: AMBER }}>LEGAL</p>
          <h1 className="font-body text-4xl sm:text-5xl leading-none" style={{ color: CREAM }}>Terms of Service</h1>
          <p className="font-body text-sm" style={{ color: MUTED }}>Effective date: May 1, 2025</p>
        </div>

        <div className="w-16 h-px" style={{ backgroundColor: AMBER }} />

        <Section title="ACCEPTANCE">
          <p>By accessing bigsolevibes.com or signing up for any Big Sole Vibes newsletter, you agree to these Terms of Service. If you do not agree, do not use the site.</p>
        </Section>

        <Section title="WHAT WE PROVIDE">
          <p>Big Sole Vibes is a content and newsletter brand covering men's foot care and accessories. We publish editorial reviews, product recommendations, and related content. We are not a medical service. Nothing on this site constitutes medical advice.</p>
        </Section>

        <Section title="NEWSLETTER">
          <p>By submitting your email address, you agree to receive email communications from Big Sole Vibes. You can unsubscribe at any time using the link in any email. We reserve the right to remove subscribers who have not engaged with our emails for an extended period.</p>
        </Section>

        <Section title="AFFILIATE DISCLOSURE">
          <p>Big Sole Vibes participates in the Amazon Services LLC Associates Program, an affiliate advertising program designed to provide a means for sites to earn advertising fees by advertising and linking to Amazon.com. Some links on this site are affiliate links. We may earn a commission if you make a purchase through these links, at no additional cost to you.</p>
          <p className="mt-2">Affiliate relationships do not influence our editorial content. We only recommend products we believe are worth your time and money.</p>
        </Section>

        <Section title="INTELLECTUAL PROPERTY">
          <p>All content on this site — including text, images, brand name, and logos — is owned by or licensed to Big Sole Vibes. You may not reproduce, distribute, or use our content for commercial purposes without written permission.</p>
          <p className="mt-2">You are welcome to share links to our content and quote brief excerpts with proper attribution.</p>
        </Section>

        <Section title="USER CONDUCT">
          <p>You agree not to use this site to:</p>
          <ul className="list-disc pl-5 mt-2 flex flex-col gap-1">
            <li>Violate any applicable law or regulation.</li>
            <li>Transmit spam, malware, or any harmful content.</li>
            <li>Attempt to gain unauthorized access to any part of the site or its systems.</li>
            <li>Impersonate Big Sole Vibes or any person associated with it.</li>
          </ul>
        </Section>

        <Section title="THIRD-PARTY LINKS">
          <p>This site contains links to third-party websites, including Amazon and other retailers. We are not responsible for the content, privacy practices, or terms of those sites. Visiting third-party sites is at your own risk.</p>
        </Section>

        <Section title="DISCLAIMER OF WARRANTIES">
          <p>This site and its content are provided "as is" without warranty of any kind. We make no guarantees that the site will be available at all times, error-free, or free of viruses. Product reviews reflect our honest opinions but individual results may vary.</p>
        </Section>

        <Section title="LIMITATION OF LIABILITY">
          <p>To the fullest extent permitted by law, Big Sole Vibes shall not be liable for any indirect, incidental, or consequential damages arising from your use of this site or any products recommended on it.</p>
        </Section>

        <Section title="GOVERNING LAW">
          <p>These terms are governed by the laws of the United States. Any disputes will be resolved in a court of competent jurisdiction.</p>
        </Section>

        <Section title="CHANGES">
          <p>We may update these terms at any time. The effective date at the top of this page will reflect the most recent revision. Continued use of the site after changes constitutes acceptance.</p>
        </Section>

        <Section title="CONTACT">
          <p>Questions about these terms? Email us at <a href="mailto:admin@bigsolevibes.com" className="underline hover:opacity-70" style={{ color: AMBER }}>admin@bigsolevibes.com</a>.</p>
        </Section>

      </main>

      {/* Footer */}
      <footer className="px-6 py-8 text-center font-body text-xs border-t" style={{ color: MUTED, borderColor: AMBER + '22' }}>
        © 2025 Big Sole Vibes. All rights reserved.
        <span className="mx-3" style={{ color: AMBER + '44' }}>|</span>
        <Link href="/privacy" className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>Privacy Policy</Link>
      </footer>

    </div>
  )
}
