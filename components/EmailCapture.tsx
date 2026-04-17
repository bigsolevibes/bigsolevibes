'use client'

// Wire up form submission to Mailchimp or Resend:
// - Mailchimp: replace action URL with your Mailchimp embed form action
// - Resend: create an /api/subscribe route that calls Resend's API
// - The form currently does a no-op submit for UI preview purposes

export default function EmailCapture() {
  return (
    <section className="py-24 bg-bsv-surface">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="font-heading text-5xl sm:text-6xl text-bsv-white tracking-wide mb-4">
          JOIN THE <span className="text-bsv-orange">SOLE SQUAD</span>
        </h2>
        <p className="text-bsv-muted text-lg mb-10">
          Drop your info. Get exclusive tips, early product drops, and content that actually helps.
          No spam. Unsubscribe anytime.
        </p>

        {/* Replace form action with Mailchimp embed URL or wire to /api/subscribe */}
        <form
          className="flex flex-col sm:flex-row gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <input
            type="text"
            name="firstName"
            placeholder="First Name"
            required
            className="flex-1 bg-bsv-bg border border-white/10 focus:border-bsv-orange text-bsv-white placeholder-bsv-muted px-5 py-4 outline-none transition-colors"
          />
          <input
            type="email"
            name="email"
            placeholder="Email Address"
            required
            className="flex-1 bg-bsv-bg border border-white/10 focus:border-bsv-orange text-bsv-white placeholder-bsv-muted px-5 py-4 outline-none transition-colors"
          />
          <button
            type="submit"
            className="bg-bsv-orange hover:bg-orange-600 text-white font-heading text-xl tracking-widest px-10 py-4 transition-colors whitespace-nowrap"
          >
            JOIN THE SQUAD
          </button>
        </form>

        <p className="text-bsv-muted text-xs mt-4">
          By joining you agree to receive emails from Big Sole Vibes. No BS, ever.
        </p>
      </div>
    </section>
  )
}
