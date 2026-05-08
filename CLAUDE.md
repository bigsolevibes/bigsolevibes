# Big Sole Vibes — Claude Code Session Guide

## Hard Rules
- **Never modify `.env`** — read credentials from it, never write to it. Tell the user what to add manually.
- Never commit `.env`, credential JSON files, or `config/youtube-token.json`.
- Never force-push to `main` without explicit confirmation.

---

## Project Overview

BSV is a premium men's foot care brand. This repo is a Next.js 14 website (`app/`) plus a fully automated content production and social distribution pipeline (`scripts/`).

**Live site:** https://bigsolevibes.com  
**Branch:** `preview/full-site` is the active dev branch. `main` triggers Cloudflare Pages CI deploy.  
**Git remote:** `https://github.com/bigsolevibes/bigsolevibes.git`

---

## Pipeline Architecture

```
Google Drive "Ready to Post/"
  ↓ rclone poll (watch-drive.js, every 15 min via launchd)
  ↓ resize-post.js     — platform variants (1080×1080, 1600×900, 1080×1920)
  ↓ brand-image.js     — BSV logo overlay on images
  ↓ brand-video.js     — logo + audio bed on MP4s
  ↓ distribute.js      — posts to X, Instagram, Facebook, Bluesky, YouTube
      ↑ R2 upload for Instagram public URL (uploadToR2 in distribute.js)
  ↓ eng-bot.js         — runs after every poll, triages failures via Claude API
  ↓ update-handoff.js  — nightly 4am, rewrites BSV-Handoff-v5.md → Drive
```

---

## Key Scripts

| Script | Purpose |
|--------|---------|
| `watch-drive.js` | Main watcher loop — polls Drive, orchestrates the full pipeline |
| `distribute.js` | Posts to all platforms; `--force` bypasses `post_time` gate; `--platforms x,instagram` restricts targets |
| `resize-post.js` | Resizes to platform variants, copies to `posts/output/` and `public/posts/output/`, git pushes to main |
| `brand-video.js` | Adds BSV logo overlay + audio to MP4s |
| `brand-image.js` | Adds BSV logo overlay to still images |
| `eng-bot.js` | Reads `watch-drive.log`, calls Claude API to triage, emails digest via Zoho SMTP |
| `product-research.js` | Web search → affiliate product picks → Google Sheet; `--skip-research`, `--dry-run` flags |
| `product-development.js` | Product development research agent |
| `update-handoff.js` | Collects project state, rewrites handoff doc via Claude API, uploads to Drive |
| `youtube-auth.js` | OAuth flow for YouTube on port 3000 |
| `reauth.js` | YouTube reauth on port 3456, writes `config/youtube-token.json` |
| `sheets-client.js` | Google Sheets connection helper (product queue) |
| `sync-shop.js` | Pushes approved sheet rows to the shop page |
| `social-listening.js` | Monitors social signals via web search |
| `marketing-manager.js` | Marketing planning agent |
| `media-director.js` | Weekly content plan agent |
| `brand-manager.js` | Brand consistency agent |
| `cost-report.js` | Daily AI spend tracker, uploads to Drive |
| `gemini-bridge.js` | Gemini API wrapper (Imagen 4 / Veo 3.1) |
| `image-gen.js` | Image generation pipeline |
| `video-gen.js` | Video generation pipeline |

---

## Key Paths

```
posts/output/          — processed media ready to distribute (also mirrored to public/posts/output/)
public/posts/output/   — served by Next.js at /posts/output/ → used for Instagram CDN URL (R2 now preferred)
public/brand/          — BSV brand assets (logos, favicon)
logs/                  — all script logs + watch-drive-state.json
config/                — youtube-credentials.json, youtube-token.json (not committed)
~/tmp/bsv-ready/       — rclone download temp for Drive assets
~/tmp/bsv-handoff/     — handoff doc temp
```

---

## Google Drive Structure

```
Big Sole Vibes/
  Ready to Post/     — drop zone: caption .md + media file → triggers pipeline
  Posted/YYYY-MM-DD/ — archived after successful distribution
  Product Research/  — research-YYYY-MM-DD.md files
  Plans/             — weekly content plan .md files
  Brand/             — brand report .md files
  Handoff/           — BSV-Handoff-v5.md (nightly)
  Product Development/
```

---

## Credentials (names only — values in .env)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API — eng-bot, agents, handoff |
| `GEMINI_API_KEY` | Gemini image + video generation |
| `META_ACCESS_TOKEN` | Long-lived Meta Page token |
| `META_PAGE_ID` | Facebook Page ID |
| `META_APP_ID` / `META_APP_SECRET` | Meta app |
| `META_IG_APP_ID` / `META_IG_APP_SECRET` | Instagram app |
| `META_IG_ACCOUNT_ID` | Instagram Business account ID |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | X (Twitter) |
| `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` | Bluesky |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | YouTube OAuth |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_URL` | Cloudflare R2 |
| `KLAVIYO_API_KEY` / `KLAVIYO_LOUNGE_LIST_ID` / `KLAVIYO_DROP_LIST_ID` | Email capture |
| `ZOHO_SMTP_HOST` / `ZOHO_SMTP_USER` / `ZOHO_SMTP_PASSWORD` | Eng-bot email digest |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Google Sheets service account |
| `SHEETS_PRODUCT_QUEUE_ID` | Product queue spreadsheet ID |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics |

---

## Platform Notes

- **Instagram** — uses two-step Graph API (create container → media_publish). Image must be a public URL. Now uploaded to Cloudflare R2 via `uploadToR2()` in `distribute.js` before the Meta container call.
- **YouTube** — refresh token expires/revokes periodically. Re-auth: `node reauth.js` (port 3456, reads `config/youtube-credentials.json`, writes `config/youtube-token.json`).
- **X and Facebook** — currently in `PAUSED_PLATFORMS` in `distribute.js`. Remove to re-enable.
- **Bluesky** — direct blob upload, compressed to JPEG under 2MB via sharp.

---

## Known Issues (as of last handoff)

- `YOUTUBE_REFRESH_TOKEN` revoked — re-auth needed via `reauth.js`
- R2 uploads failing with SSL handshake error + Unauthorized — credential or endpoint issue
- Zoho SMTP rejecting auth — eng-bot email digest not sending
- `mon-pm`, `thu-pm` stuck in `_unknown: pending` — no platform variants emitted
- Git push in `resize-post.js` failing — public URL fallback pipeline broken

---

## Phase 2 — Product Strategy

- **First product:** Proprietor's Foot Balm — private label, custom formulation
- **Colorway:** Midnight `#0D1B2A` + Bourbon `#C17D2E`
- **Positioning:** "Nothing goes on this shelf that hasn't earned its place."
- **Revenue path:** Amazon Associates → Impact.com/Manscaped affiliate → private label balm → full BSV line
- **Launch condition:** Audience proven, affiliate revenue flowing
- **Research backlog:** Private label manufacturers, MOQ, packaging costs
- **Drive folder:** `Big Sole Vibes/Product Development/`
