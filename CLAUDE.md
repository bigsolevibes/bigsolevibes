## Pre-Session Protocol — Read Before Responding

Before responding to any message in any session, read **in this order** and **present the stand-up to Big D immediately**:

1. **`BSV-Start-Here.md`** — orientation + precedence rules. Read this FIRST. (local — fast)
2. **Latest `standup-YYYY-MM-DD.md` in Drive's `Reports/` folder** — the chief brief. Has explicit BIG D and BIG C action items. Most actionable doc in the stack — surface it in full, including both action lists.
3. **`BSV-Session-Context.md` in Drive's `Handoff/` folder** — strategic context. When it conflicts with `BSV-Memory.md` on current state, trust this one.
4. **`BSV-BigC-Audit-Log.md`** — last 5–10 entries. Append at end of any session where something durable happened. (local — fast)

**Read on demand only — do NOT read every session:**
- `BSV-Handoff-YYYY-MM-DD.md` — only if session-context is missing or stale
- `eng-report-YYYY-MM-DD.md` — only if standup flags active agent failures
- `cost-report-YYYY-MM-DD.md` — only if standup flags a budget alert
- `BSV-Memory.md` — only when brand voice or strategic decisions are in question

**Present the stand-up to Big D as the opening of every session.** Cover all five sections — don't summarize into nothing:
- **Revenue** — yesterday's commissions, week total, action today
- **Posts** — confirmed, gaps, stuck media
- **Agent health** — errors and warnings surfaced from the eng report
- **Cost** — balance, burn rate, runway (from cost report)
- **Growth** — follower counts, email list, trend

**The stand-up is non-negotiable.** If Big D opens with anything other than "skip the brief" — present it first, then address their message.

For live pipeline state, pull directly via `mcp__bsv__*` tools — fresher than any cached doc.

Do not ask questions answered in `BSV-Start-Here.md`, `BSV-Memory.md`, or `BSV-BigC-Audit-Log.md`.
Do not ask Code to read scripts documented in the org chart.
Do not ask Big D for context that chief already reported or that the audit log already covers.

---

# Big Sole Vibes — Claude Code Session Guide

## Hard Rules
- **Never delete files unless Big D explicitly says so.** Big D has complete control over deletions — no exceptions, no "cleanup" judgment calls, no assuming a file is safe to remove because it looks stale, local-only, or redundant. Ask first, every time.
- **Never modify `.env`** — read credentials from it, never write to it. Tell the user what to add manually.
- Never commit `.env`, credential JSON files, or `config/youtube-token.json`.
- **Promoting to `main` requires Big D's explicit, live confirmation every time — no standing approval, no inferring it from an earlier "yes" on a different change.** The sanctioned path is the `mcp__bsv__push_to_main` MCP tool (`scripts/mcp-server.js`) — call it only in direct response to Big D telling you, in the current conversation, to push/promote to main right now. Never call it proactively, never as a default "next step," never from any pipeline/automation script. The tool never force-pushes — git rejects the update if main has diverged from `preview/full-site`, so it can't overwrite history. `scripts/push-to-main.js` remains available for Big D to run by hand too (same operation, same fast-forward-only safety). Added 2026-06-19 after recurring friction over Claude being unable to act on explicit permission — see `BSV-BigC-Audit-Log.md` same date.
- Never force-push to `main` — no tool or script in this repo does this, under any circumstance.

---

## Project Overview

BSV is a premium men's foot care brand. This repo is a Next.js 14 website (`app/`) plus a fully automated content production and social distribution pipeline (`scripts/`).

**Live site:** https://bigsolevibes.com  
**Git remote:** `https://github.com/bigsolevibes/bigsolevibes.git`

### Branch strategy

| Branch | Role |
|--------|------|
| `preview/full-site` | Active dev branch. All automated pipeline scripts push here via `git-push-guard.js → safePushToPreview()`. **No Cloudflare deploy triggers from this branch.** |
| `staging` | Intentional preview branch. When a manual Cloudflare preview is needed before merging to production, push `preview/full-site` → `staging` (`git push origin preview/full-site:staging`). Cloudflare preview deploy triggers from here. |
| `main` | Production. Triggers the live Cloudflare Pages deploy at bigsolevibes.com. Promoted only via explicit, live confirmation from Big D in the current session — either Big D runs `scripts/push-to-main.js` himself, or Claude calls the `push_to_main` MCP tool right after Big D explicitly says so. Never automated, never proactive — see Hard Rules above. |

Scripts must not be changed to target `staging` or `main` — `safePushToPreview()` in `git-push-guard.js` enforces the `preview/full-site` target and will alert + abort if anything tries to push to `main`.

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
| `resize-post.js` | Resizes to platform variants, copies to `posts/output/` and `public/posts/output/`. **No git push** — deliberately removed 2026-05-27 (commit `495addb5`): Drive holds source assets, Cloudflare R2 serves the public Instagram URL, `distribute.js` posts from local disk + R2. Both output dirs are gitignored. |
| `brand-video.js` | Adds BSV logo overlay + audio to MP4s |
| `brand-image.js` | Adds BSV logo overlay to still images |
| `eng-bot.js` | Reads `watch-drive.log`, calls Claude API to triage, emails digest via Zoho SMTP |
| `product-research.js` | Web search → affiliate product picks → Google Sheet; `--skip-research`, `--dry-run` flags |
| `product-development.js` | Product development research agent |
| `update-handoff.js` | Collects project state, rewrites handoff doc via Claude API, uploads to Drive |
| `youtube-auth.js` | OAuth flow for YouTube on port 3000 (reads `client_secret.json` at repo root); `--check`/`--dry-run` tests the existing `.env` refresh token without starting the browser flow |
| `sheets-client.js` | Google Sheets connection helper (product queue) |
| `sync-shop.js` | Generates `public/shop/index.html` from approved sheet rows; git-commits and pushes to trigger Cloudflare deploy |
| `social-listening.js` | Monitors social signals via web search |
| `marketing-manager.js` | Marketing planning agent |
| `media-director.js` | Weekly content plan agent |
| `brand-manager.js` | Brand consistency agent |
| `learn.js` | Big D correction → pipeline. `--note "what was wrong"` appends to BSV-Directive.md (Drive, read by all agents) and `logs/creative-directives.json` (read by creative-agent on every brief). `--list` shows active corrections. `--clear` removes them. Big C calls this any time Big D flags bad output. |
| `edition-agent.js` | Monthly J. Peterman-style story engine — selects 5–6 shelf products, writes an 800–1000 word themed edition story, generates per-product vignettes + image briefs, uploads draft to Drive for approval, saves `logs/edition-state.json`; `--approve` activates it; `--force` re-runs; `--dry-run` generates without saving |
| `cost-report.js` | Daily AI spend tracker, uploads to Drive |
| `gemini-bridge.js` | Gemini API wrapper (Imagen 4 / Veo 3.1) |
| `image-gen.js` | Image generation pipeline |
| `video-gen.js` | Video generation pipeline |

---

## Key Paths

```
posts/output/          — processed media ready to distribute (also mirrored to public/posts/output/)
public/posts/output/   — served by Next.js at /posts/output/ → used for Instagram CDN URL (R2 now preferred)
public/shop/index.html — The Locker Room shop page, written by sync-shop.js (do not edit manually)
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
  Editions/              — monthly edition drafts: edition-N-YYYY-MM-draft.md (pending Big D approval)
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
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API — eng-bot alerts, chief escalations, missed-post OMG |
| `TELEGRAM_CHAT_ID` | Telegram chat ID to receive alerts |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Google Sheets service account |
| `SHEETS_PRODUCT_QUEUE_ID` | Product queue spreadsheet ID |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics |

---

## Platform Notes

- **Instagram** — uses two-step Graph API (create container → media_publish). Image must be a public URL. Now uploaded to Cloudflare R2 via `uploadToR2()` in `distribute.js` before the Meta container call.
- **YouTube** — refresh token expires/revokes periodically. Check first: `node scripts/youtube-auth.js --check` (or the `youtube_token_check` MCP tool) — never assume it's dead. Re-auth: `node scripts/youtube-auth.js` (port 3000, reads `client_secret.json` at repo root, prints new `YOUTUBE_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` to add to `.env` manually — never written automatically). The `youtube_reauth` MCP tool runs this for Big D with one browser click, no terminal.
- **X and Facebook** — currently in `PAUSED_PLATFORMS` in `distribute.js`. Remove to re-enable.
- **Bluesky** — direct blob upload, compressed to JPEG under 2MB via sharp.

---

## Deleted — do not recreate

- `app/shop/page.tsx` — replaced by `public/shop/index.html` (sync-shop.js owns this)
- `app/products/page.tsx` — old hardcoded products page, gone
- `app/dev/page.tsx` — dev placeholder, gone
- `components/ProductShowcase.tsx` — depended on deleted affiliates lib
- `lib/affiliates.ts` — hardcoded placeholder product data, gone
- `shop/index.html` (repo root) — was never served; output is now `public/shop/index.html`

---

## Known Issues (as of last handoff)

- ~~`YOUTUBE_REFRESH_TOKEN` revoked — re-auth needed via `reauth.js`~~ — **stale, corrected 2026-06-19.** `reauth.js` doesn't exist in this repo; only `youtube-auth.js` does (port 3000, auto-catches the localhost callback, no code paste needed). Verified live: the existing token in `.env` still refreshes fine (`node scripts/youtube-auth.js --check`, or `run_diagnostic` with script `youtube-auth`) — no re-auth was actually needed. If it ever does expire, that script (or the `youtube_reauth` MCP tool) handles it with one browser click, zero terminal use.
- R2 uploads failing with SSL handshake error + Unauthorized — credential or endpoint issue
- ~~Telegram alerts not confirmed — `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` may be missing from `.env`~~ — **stale, corrected 2026-06-20.** Both vars are present in `.env`. Outbound alerts (`sendTelegram` in `telegram.js`) work fine. However: the inbound listener (`telegram-webhook.js`, launchd job `com.bsv.telegram-webhook`) was found down — last exit signal -15, not in the live process list — meaning Big D's approve/deny replies aren't currently being picked up. Needs `launchctl kickstart -k gui/$(id -u)/com.bsv.telegram-webhook` to restart (no MCP path to do this remotely yet). (note: Zoho SMTP was replaced by Telegram — SMTP is no longer used)
- `mon-pm`, `thu-pm` stuck in `_unknown: pending` — no platform variants emitted
- ~~Git push in `resize-post.js` failing — public URL fallback pipeline broken~~ — **stale, corrected 2026-06-28.** Not failing — intentionally removed (see Key Scripts table). Confirmed via `git log --follow` that this was a deliberate 2026-05-27 decision, not a regression.

---

## Phase 2 — Product Strategy

- **First product:** Proprietor's Foot Balm — private label, custom formulation
- **Colorway:** Midnight `#0D1B2A` + Bourbon `#C17D2E`
- **Positioning:** "Nothing goes on this shelf that hasn't earned its place."
- **Revenue path:** Amazon Associates → Impact.com/Manscaped affiliate → private label balm → full BSV line
- **Launch condition:** Audience proven, affiliate revenue flowing
- **Research backlog:** Private label manufacturers, MOQ, packaging costs
- **Drive folder:** `Big Sole Vibes/Product Development/`
