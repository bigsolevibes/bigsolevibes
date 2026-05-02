import Link from 'next/link'

const AMBER = '#C17D2E'
const CREAM = '#F5ECD7'
const MUTED = '#4A6380'
const NAVY  = '#0D1B2A'

export const metadata = {
  title: 'Privacy Policy — Big Sole Vibes',
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

export default function PrivacyPage() {
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
          <h1 className="font-body text-4xl sm:text-5xl leading-none" style={{ color: CREAM }}>Privacy Policy</h1>
          <p className="font-body text-sm" style={{ color: MUTED }}>Effective date: May 1, 2025</p>
        </div>

        <div className="w-16 h-px" style={{ backgroundColor: AMBER }} />

        <Section title="WHO WE ARE">
          <p>Big Sole Vibes ("BSV," "we," "us") operates the website bigsolevibes.com and related email newsletters. We make content about men's foot care and accessories.</p>
        </Section>

        <Section title="WHAT WE COLLECT">
          <p>We collect only what you give us directly:</p>
          <ul className="list-disc pl-5 mt-2 flex flex-col gap-1">
            <li><strong style={{ color: CREAM }}>Email address and first name</strong> — when you sign up for The Lounge or The Kick Off newsletter.</li>
            <li><strong style={{ color: CREAM }}>Usage data</strong> — standard server logs and analytics (page views, referrer, browser type) collected automatically when you visit the site. This data is aggregated and not tied to your identity.</li>
          </ul>
          <p className="mt-2">We do not collect payment information. We do not collect your physical address. We do not run advertising trackers.</p>
        </Section>

        <Section title="HOW WE USE IT">
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>To send you the newsletter you signed up for.</li>
            <li>To notify you about product launches and early access offers.</li>
            <li>To understand how the site is being used so we can improve it.</li>
          </ul>
          <p className="mt-2">We will never sell your information. We will never share it with third parties for their own marketing purposes.</p>
        </Section>

        <Section title="EMAIL & KLAVIYO">
          <p>We use <strong style={{ color: CREAM }}>Klaviyo</strong> to manage our email list and send newsletters. Your email address and first name are stored in Klaviyo on our behalf. Klaviyo's privacy policy is available at klaviyo.com/legal/privacy-policy.</p>
          <p className="mt-2">You can unsubscribe at any time using the link in any email we send. Once unsubscribed, we will not contact you again.</p>
        </Section>

        <Section title="AMAZON AFFILIATE LINKS">
          <p>Some links on this site and in our newsletters are Amazon affiliate links. If you click one and make a purchase, we may earn a small commission at no extra cost to you. We only recommend products we have reviewed and believe in. Affiliate status does not influence our editorial opinions.</p>
          <p className="mt-2">As an Amazon Associate, Big Sole Vibes earns from qualifying purchases.</p>
        </Section>

        <Section title="COOKIES">
          <p>We use minimal cookies necessary for the site to function. We do not use advertising cookies or cross-site tracking cookies. Analytics data is collected in aggregate only.</p>
        </Section>

        <Section title="YOUR RIGHTS">
          <p>You can request to access, correct, or delete the personal information we hold about you at any time. To do so, email us at <a href="mailto:admin@bigsolevibes.com" className="underline hover:opacity-70" style={{ color: AMBER }}>admin@bigsolevibes.com</a>.</p>
        </Section>

        <Section title="CHILDREN">
          <p>This site is not directed at children under 13. We do not knowingly collect personal information from anyone under 13.</p>
        </Section>

        <Section title="CHANGES">
          <p>If we make material changes to this policy, we will update the effective date at the top of this page. Continued use of the site after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="CONTACT">
          <p>Questions? Email us at <a href="mailto:admin@bigsolevibes.com" className="underline hover:opacity-70" style={{ color: AMBER }}>admin@bigsolevibes.com</a>.</p>
        </Section>

      </main>

      {/* Footer */}
      <footer className="px-6 py-8 text-center font-body text-xs border-t" style={{ color: MUTED, borderColor: AMBER + '22' }}>
        © 2025 Big Sole Vibes. All rights reserved.
        <span className="mx-3" style={{ color: AMBER + '44' }}>|</span>
        <Link href="/terms" className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>Terms of Service</Link>
      </footer>

    </div>
  )
}
