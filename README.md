# Big Sole Vibes — Website

Next.js 14 website for [bigsolevibes.com](https://bigsolevibes.com).

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Vercel** (hosting)

## Local Development

```bash
# Install dependencies
npm install

# Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

### Option 1 — Vercel CLI (fastest)

```bash
npm i -g vercel
vercel
```

Follow the prompts. On first deploy it will ask you to link to a project — create new, name it `bigsolevibes-web`.

### Option 2 — GitHub + Vercel Dashboard

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Add New Project
3. Import your GitHub repo
4. Vercel auto-detects Next.js — click Deploy

### Custom Domain

1. In Vercel dashboard → your project → Settings → Domains
2. Add `bigsolevibes.com` and `www.bigsolevibes.com`
3. In Hostinger DNS, point your domain to Vercel's nameservers (Vercel will show you the exact records)

## Project Structure

```
app/
  layout.tsx          # Root layout, fonts, global metadata
  page.tsx            # Home page
  blog/
    page.tsx          # Blog index
    [slug]/page.tsx   # Individual blog post
  products/page.tsx   # Products page
  sitemap.ts          # Auto-generated sitemap
  robots.ts           # robots.txt

components/
  Navbar.tsx          # Sticky nav with mobile hamburger
  Hero.tsx            # Full-width hero section
  WhyBigSoleVibes.tsx # 3 feature cards
  ProductShowcase.tsx # Product cards (pulls from lib/affiliates.ts)
  BlogPreview.tsx     # 3 latest posts (pulls from lib/blog.ts)
  EmailCapture.tsx    # Email signup (wire to Mailchimp or Resend)
  AdPlaceholder.tsx   # Google AdSense slot
  Footer.tsx          # Footer with nav + social

lib/
  affiliates.ts       # All product data + affiliate URLs — edit here
  blog.ts             # All blog post content — add posts here
```

## Adding Affiliate Links

Open `lib/affiliates.ts` and replace `affiliateUrl: '#affiliate'` with your actual Amazon Associates or affiliate links.

## Adding Blog Posts

Open `lib/blog.ts` and add a new object to the `blogPosts` array. The slug becomes the URL (`/blog/your-slug`).

## Wiring Up Email Capture

In `components/EmailCapture.tsx`, the form currently does `e.preventDefault()`. To go live:

**Mailchimp:** Replace `onSubmit` with a POST to your Mailchimp embed form action URL.

**Resend:** Create `app/api/subscribe/route.ts` and call the Resend API with the submitted email.

## Adding Google AdSense

In `components/AdPlaceholder.tsx`, replace the inner content of the `#ad-slot-home` div with the `<ins>` tag from your AdSense dashboard.

## Brand Colors

| Token | Hex | Usage |
|---|---|---|
| `bsv-bg` | `#1a1a1a` | Page background |
| `bsv-card` | `#242424` | Card backgrounds |
| `bsv-surface` | `#2e2e2e` | Input fields |
| `bsv-orange` | `#E8621A` | Primary accent |
| `bsv-white` | `#ffffff` | Body text |
| `bsv-muted` | `#999999` | Secondary text |
