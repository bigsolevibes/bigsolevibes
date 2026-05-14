# BSV-Memory.md — Strategic Memory

**Every agent exists to build the lounge — ten thousand men who hold the standard — so the Proprietor's Foot Balm earns its launch. Until that's done, the pipeline has one job: growth.**

---

This file is the living strategic record of Big Sole Vibes. It is distinct from the Directive (which is timeless) and the Handoff (which is operational). Memory is what we've learned, decided, tried, and are still figuring out. Every agent reads it. Chief of Staff updates it every morning.

---

## Who We Are

Big Sole Vibes is a premium men's foot care brand. Not a problem-solver. Not a medical product. An addition to the ritual of a man who already takes his core seriously — his skincare, his grooming, his recovery, his bourbon.

**The BSV Man:** Works hard and plays hard. Blue collar or white collar — the distinction doesn't live here. What lives here is the standard. He puts food on the table. He takes care of his people. He shows up. He's a self-preservation type — not vanity, investment. He maintains everything in his life at a high standard. BSV's argument is that his feet are part of that standard. Most men haven't made that connection yet. We make it for them.

**The Lounge:** Dark wood. Good leather. Low light. Music that doesn't demand your attention but earns it. The kind of place where a coal miner and a CFO sit next to each other and neither one feels out of place — because the common language is the standard, not the salary. Nobody justifies why they take care of themselves here. It's understood.

**The Voice:** Statements, not questions. Deadpan, confident, slightly amused. Never preachy. Never explains itself. The Proprietor has already made up his mind. He's inviting you to catch up.

**The North Star:** From head to toe. Finally.

---

## Where We're Going

**Phase 1 — Audience:** Build the lounge online. Men who recognize themselves in this standard follow because the content speaks to something real, not because it shows a foot. Social platforms first. Content that stops the scroll.

**Phase 2 — Revenue:** Amazon Associates → Impact.com / Manscaped affiliate → curated product shelf at bigsolevibes.com. Products that have earned their place. Not the first result on Amazon.

**Phase 3 — Private Label:** Proprietor's Foot Balm launches when two conditions are met simultaneously:
1. Audience proven: 10,000+ engaged followers across platforms
2. Affiliate revenue flowing: proof the audience converts

**The Foot Balm:**
- Name: Proprietor's Foot Balm
- Tagline: "Nothing goes on this shelf that hasn't earned its place. This earned it."
- Target retail: $35–$50
- Colorway: Midnight (#0D1B2A) + Bourbon (#C17D2E)
- Packaging: Heavy, substantial. Not disposable-feeling.
- Formulation: Premium actives — shea butter, urea, tea tree or equivalent. No synthetic fragrance as primary. Long-lasting moisture, fast absorption.
- Milestone track: Week 1 Foundation → Week 2 Manufacturer research → Week 3 Packaging + FDA → Week 4 Cost model → Week 5+ Ready for calls

**Escalation rule:** When product-development milestone = "Ready for calls" — Chief leads the entire stand-up with it. That is a Big D decision point, not an autonomous one.

---

## What's Been Decided

**Active platforms (2 of 6):** Instagram and Bluesky are the only active distribution channels. X and Facebook are paused in `PAUSED_PLATFORMS` — not dead, just waiting for the audience to justify the overhead. YouTube is broken (refresh token revoked) and will be re-enabled post-reauth. TikTok is not yet implemented.

**Slot structure:** Content runs in two daily slots — `[day]-am` and `[day]-pm`. Each slot gets a theme. Slot names follow the pattern `mon-am`, `fri-pm`, etc. This is the universal identifier across the entire pipeline: brief file, prompt file, media file, caption file, and post-state entry all share the slot name.

**Theme calendar (locked):**
```
mon: am=The Standard,    pm=Street
tue: am=The Ritual,      pm=The Callout
wed: am=The Product,     pm=The Lounge
thu: am=The Story,       pm=Culture
fri: am=The Week,        pm=The Contrast
sat: am=Recovery,        pm=The Proprietor
sun: am=The Standard,    pm=The Invite
```

**Content posture:** We are not a foot care account. We are a men's lifestyle brand that sells foot care. Feet appear in content as evidence of the standard — not the subject of it. Premium, scroll-stopping, share-worthy. Tension, recognition, humor, provocation are tools. Safe and predictable is the enemy.

**Product shelf rules:** 100-point scoring (ritual fit 25%, discovery depth 20%, quality 20%, story 20%, availability 15%). 70+ score required for shelf. Permanent exclusions: antifungal, medicated, problem-positioned, first-page Google results. product-research.js excludes foot balms that would compete with Proprietor's Foot Balm — it curates ritual complements instead (tools, soaks, recovery items).

**Revenue sequencing decision:** Affiliate before private label. No exceptions. The audience must prove it converts before we carry inventory risk.

**Change Agent tier system (locked):**
- Tier 3 — Novel: never seen before → full stop, Big D decides
- Tier 2 — Monitored: seen before, not fully proven → Change Agent recommends, Big D approves
- Tier 1 — Pre-approved: 3+ successful fixes → Change Agent recommends the tier, Big D approves

Change Agent never promotes to Tier 1 unilaterally. Recommends only.

**Org chart governance:** Chief of Staff detects gaps (new scripts, inactive agents) and reports in the stand-up. Never updates autonomously. Big D approves → `node scripts/chief-of-staff.js --update-org-chart`.

**post-state.json audit trail:** Every platform attempt (success or fail) by distribute.js is recorded with slot, platform, post ID, timestamp, and status. Chief cross-references against watch-drive.log — slots archived in the log but absent from post-state.json are flagged as UNVERIFIED, not distributed.

---

## What's Working

**Distribution:** Instagram (Graph API + R2 upload) and Bluesky (direct blob, JPEG compressed under 2MB) are functional. Two platforms posting consistently.

**Creative pipeline:** The four-agent nightly chain (social-listening → media-director → creative-agent × 2 → gemini-bridge) runs reliably. Social intelligence informs the brief. Brief informs the image and video prompt. Prompts land in Drive/Ready to Post/ for image-gen and video-gen to pick up.

**Drive sync:** image-gen.js and video-gen.js now pull `*-prompt.txt` and `*-flow-prompt.txt` files directly from Drive before scanning — prompts no longer need to already be in `~/tmp/bsv-ready/` when the script starts.

**Watch-drive orchestration:** Polls every 15 minutes. Per-platform per-slot state tracking handles retries, exhaustion, and cross-day holds correctly. Post-time scheduling gate works.

**Eng-bot triage:** Runs after every watch-drive poll. Claude API triage of the log. Catches errors while they're fresh.

**Chief of Staff:** Morning stand-up at 8AM covering seven questions, full pipeline status, token budget, Telegram ping. Handoff doc updated every morning.

**Brand assets:** logo overlay on images (brand-image.js) and logo + audio bed on videos (brand-video.js) working correctly.

**Shop sync:** sync-shop.js generates `public/shop/index.html` from approved Google Sheets rows on every approval or rejection change. Cloudflare Pages deploys automatically on git push to main.

---

## What's Been Tried and Failed

**X (Twitter) posting:** In PAUSED_PLATFORMS. The API works at the code level but rate limits and access tier friction made consistent posting unreliable. Paused until audience justifies the overhead.

**Facebook posting:** In PAUSED_PLATFORMS. Page access token exchange works but the audience-to-effort ratio is not there yet.

**Zoho SMTP for eng-bot email digest:** Auth rejected. Eng-bot email reports not sending. The log triage still runs — only the email delivery is broken. Check ZOHO_SMTP_USER and app password.

**R2 SSL/auth failures:** Instagram public URL via Cloudflare R2 failing with SSL handshake error + Unauthorized. R2 credentials or endpoint likely misconfigured. Instagram falls back to the Cloudflare Pages CDN URL path, which only works if the image was git-pushed to main first — a fragile dependency.

**Hardcoded product data (lib/affiliates.ts):** Deleted. Replaced by the live product-research.js → Google Sheets → sync-shop.js pipeline. Do not recreate.

**Old shop page (app/shop/page.tsx):** Deleted. Replaced by public/shop/index.html owned by sync-shop.js. Do not recreate.

**Content plan parsing for image-gen/video-gen:** The original approach read a weekly content plan .md from Drive and parsed `day: N` blocks to extract prompts. This was fragile and tightly coupled to the plan format. Replaced by direct prompt files (`[slot]-prompt.txt`, `[slot]-flow-prompt.txt`) dropped into Drive/Ready to Post/ by gemini-bridge. Simpler, more reliable. Do not revert.

---

## Open Questions

**Awaiting Big D's decision or action:**

1. **YouTube reauth** — `YOUTUBE_REFRESH_TOKEN` revoked. Re-auth: `node scripts/reauth.js` (port 3456). Reads `config/youtube-credentials.json`, writes `config/youtube-token.json`. YouTube distribution is paused until this is done.

2. **R2 credentials** — R2 upload failing. Check `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` in .env. This is the Instagram public URL dependency — if R2 is broken, Instagram can't create a media container.

3. **Telegram setup** — `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` not set. Get bot token from @BotFather. Get chat ID by sending /start to @userinfobot. Until these are set, Chief's Telegram ping is skipped.

4. **Zoho SMTP** — `ZOHO_SMTP_PASSWORD` auth rejected. Check app password in .env. Eng-bot email digest not sending until resolved.

5. **X and Facebook re-enable** — When the audience justifies it, remove those platforms from `PAUSED_PLATFORMS` in distribute.js. Big D makes that call.

6. **change-agent post-commit hook** — Not installed. One-time setup:
   ```sh
   printf '#!/bin/sh\nnode /Users/davidgeer/claude/bigsolevibes-web/scripts/change-agent.js --post-commit\n' \
     > /Users/davidgeer/claude/bigsolevibes-web/.git/hooks/post-commit
   chmod +x /Users/davidgeer/claude/bigsolevibes-web/.git/hooks/post-commit
   ```

7. **Org chart update** — change-agent.js, image-gen.js, video-gen.js, gemini-bridge.js not yet in BSV-Org-Chart.svg. Approve with: `node scripts/chief-of-staff.js --update-org-chart`

---

## Competitive Landscape

BSV sits in the luxury men's grooming tier. The taste level to reference:

**Peer brands:** Margaret Dabbs (professional-grade foot care, sold at Liberty London and high-end spas), Cowshed, Grown Alchemist, Malin+Goetz, Caldera + Lab. These brands share BSV's register: serious ingredients, understated packaging, no explanation required.

**Retail context:** The BSV man shops at Gilt, Huckberry, Grooming Lounge, Art of Shaving, Nordstrom Men's. He does not find his grooming products on the first page of Google. He finds them through trusted sources, curated shelves, and word of mouth from men who pay attention.

**What this means for every agent:**
- Product decisions: if it wouldn't sell at Grooming Lounge or Huckberry, it doesn't belong on the BSV shelf
- Content decisions: if Margaret Dabbs wouldn't post it, reconsider the tone
- Brand voice: the register is luxury without announcement — the Proprietor does not explain himself
- Research: use Gilt, Huckberry, Grooming Lounge, and Art of Shaving as discovery sources before touching Amazon or generic search results

This is not aspirational positioning. This is the tier BSV operates in. Every decision should reflect that.

---

## Agent Rules

**What agents can do autonomously (Tier 1 behaviors):**
- Generate and upload content briefs, prompts, and caption files to Drive
- Post to active platforms (Instagram, Bluesky) at scheduled post_time
- Retry failed platform posts up to 3 attempts
- Triage errors and file reports
- Update state files (post-state.json, change-state.json, product-development-state.json)
- Rotate logs
- Sync the shop page when approved products change

**What agents must report and wait (Tier 2):**
- Known error patterns with unproven fixes
- Org chart gaps (new scripts, inactive agents)
- Platform exhaustion after 3 failed attempts
- Any agent cost trending over $1.50/day

**What requires Big D's explicit decision (Tier 3 / full stop):**
- Re-enabling paused platforms (X, Facebook)
- YouTube reauth
- Fixing R2 or Zoho credentials
- Launching or delisting products from the shelf
- Any private label or manufacturer decisions
- Org chart updates (Chief flags, Big D approves via `--update-org-chart`)
- Promoting a known-fix to Tier 1 status
- Any spend above $2.00/day ceiling
- Content that would violate platform terms of service

**What agents must never do:**
- Modify .env — read credentials, never write. Tell Big D what to add manually.
- Commit `.env`, credential JSON files, or `config/youtube-token.json`
- Force-push to main without explicit confirmation
- Promote a known-fix to Tier 1 unilaterally (Change Agent recommends, Big D decides)
- Update the org chart autonomously (Chief flags, Big D approves)
- Post content that hasn't earned its place in the lounge
- Recreate deleted files: `app/shop/page.tsx`, `app/products/page.tsx`, `app/dev/page.tsx`, `components/ProductShowcase.tsx`, `lib/affiliates.ts`

---

*Updated by chief-of-staff.js every morning. Last updated: see git log. Strategic decisions updated by Big D only.*
