# LANDING PAGE REDESIGN SPEC v2 — preview/full-site only

## Section 1 — Opening Crawl (NEW, full viewport)

Midnight background, crossfading images behind text at 60% dark overlay.
5 images fading every 8 seconds: cave painting / Roman soldier / Victorian gentleman / 1950s businessman / modern man.
Source from Unsplash royalty-free.

Star Wars-style text crawl, cream italic text centered max 600px, scrolls bottom to top over 22 seconds, auto-plays on load.

Small "SKIP" button top-right jumps to hero.

### Crawl text (exact)

> For 300,000 years, man has been getting better at this. He discovered fire. He invented the wheel. He built the pyramids, wrote symphonies, landed on the moon, and perfected the double Windsor knot. Somewhere in there he figured out soap. Then cologne. Then a seventeen-step skincare routine. He conditioned the beard. He exfoliated the face. He moisturized everything. Everything above the ankle. The feet remained a mystery. An afterthought. A closed chapter in the otherwise remarkable story of human self-improvement. Until now.

---

## Section 2 — Hero

Continues on Midnight background. Three lines centered, cream, breathing room between each.

- Line 1: "The hair is immaculate. The jacket is bespoke. The cologne smells like old money and minor scandals."
- Line 2: "He has, by every available metric, figured it out."
- Line 3 (slightly bolder): "His feet filed a formal complaint in 2019. It is still under review."

Two Bourbon (#C17D2E) buttons: **THE LOUNGE → /the-lounge** and **THE LOCKER ROOM → /shop**. Stack on mobile.

---

## Section 3 — The Manifesto

**Heading:** THE MANIFESTO

**Body:** "In 1823, a gentleman in Brussels conditioned his beard with imported oil, pressed his trousers to a knife edge, and then put on his boots without a second thought. Nothing has changed. For two centuries, men have applied extraordinary effort to everything above the ankle and treated everything below it as someone else's problem. The barber noticed. The tailor noticed. The woman who handed him his shoes noticed. Nobody said anything. Big Sole Vibes said something. We are a head-to-toe grooming brand for the man who has almost figured it out. The shelf covers the full body — face, hair, torso, recovery, and yes, the foundation. Because a man is one continuous structure, and the bottom of that structure has been quietly holding up the rest of it without so much as a thank you. The oversight ends here."

---

## Section 4 — The Sole Report (RESTORE)

**Heading:** THE SOLE REPORT

**Intro:** "Dispatches from a man paying attention to the things most men aren't. Written without judgment. Mostly."

3 most recent article cards. Link: VIEW ALL → /sole-report

---

## Section 5 — The Locker Room

**Heading:** THE LOCKER ROOM / WHAT'S ON THE SHELF

**Intro:** "The shelf. Head to toe. Curated by someone with strong opinions, too much time, and a working theory about why men have ignored the bottom six inches of themselves since the Renaissance. Nothing here is average. Nothing here was easy to find. Everything here has a reason to exist."

3 featured product cards. Link: FULL SHELF → /shop

---

## Section 6 — Email

**Heading:** THE BIG SOLE BRIEFING

**Body:** "The Proprietor sends a dispatch when something earns it. Product finds. Notes from the shelf. Occasional reminders that you are, technically, one continuous person from head to toe. Join the rational resistance."

**Button:** RECTIFY THE ERROR

---

## Footer

**Tagline:** "Head to toe considered. The feet were last. They're used to it."

---

## Do not change

Nav, article cards, product cards, form logic, footer links, routing, color system, font stack.

## Verification checklist

- [ ] Crawl plays on load
- [ ] Skip works (jumps to hero)
- [ ] Images crossfade every 8s
- [ ] Hero lands after crawl in document flow
- [ ] THE SOLE REPORT section restored
- [ ] Footer tagline updated
- [ ] Desktop tested
- [ ] Mobile tested
- [ ] Not pushed to main
