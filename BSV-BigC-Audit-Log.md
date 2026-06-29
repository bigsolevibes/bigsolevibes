# BSV-BigC-Audit-Log.md
**Owner:** Big C (Claude.ai / chat sessions with Big D)
**Read by:** Big C — at the start of every session, per CLAUDE.md Pre-Session Protocol
**Written by:** Big C — appended at the end of every session (or when something durable happens)
**Purpose:** A running, chronological record of what Big D and Big C actually did together — decisions, deliverables, things discovered, things broken, things fixed. Memory holds the *consolidated* understanding; this holds the *play-by-play*, so Big C stops re-deriving (or mis-deriving) things Big D already explained.

## 2026-06-19 — TikTok OAuth connected; tiktok_token_exchange MCP tool added

TikTok account is now authorized. `config/tiktok-token.json` has a valid `access_token` (24h) and `refresh_token` (1yr), scope `user.info.basic,video.upload`. `getValidAccessToken()` in `tiktok-auth.js` will auto-refresh going forward.

## 2026-06-19 — YouTube: existing token verified still valid, stale docs fixed; no re-auth needed

Big D asked to get YouTube posting working "now that we have our DBA." Investigated before touching anything:

- CLAUDE.md referenced `reauth.js` (port 3456) for YouTube re-auth — **that file doesn't exist**. Only `youtube-auth.js` exists (port 3000, different flow: auto-opens browser, auto-catches the localhost callback itself, no code paste needed — unlike TikTok). Corrected the doc.
- Added a `--check`/`--dry-run` path to `youtube-auth.js` that tests the existing `.env` refresh token against Google's OAuth endpoint without opening a browser or printing any secret value. This runs through the already-live `run_diagnostic` MCP tool immediately, no mcp-server.js restart required.
- Ran it: **the existing `YOUTUBE_REFRESH_TOKEN` is still valid.** CLAUDE.md's "Known Issues" line claiming it was revoked was stale — corrected.
- Also added `youtube_token_check` and `youtube_reauth` tools to `mcp-server.js` for whenever it actually does expire — `youtube_reauth` runs the full flow with one browser click from Big D, writes new credentials to a gitignored local file (`config/.youtube-new-credentials.txt`) instead of printing them through chat, since `.env` must never be written by Claude. These two tools were committed but hadn't shown up as live yet by end of session (auto-restart via `fs.watch` didn't pick them up within this session — worth confirming next session that they're live).
- Net finding: **YouTube credentials were never actually the blocker.** The real blocker is that zero video files exist anywhere in the pipeline (`posts/output/` has no `.mp4`s) — confirmed earlier this session. Video production needs to actually resume (Veo/Gemini generation or manual upload) before YouTube or the TikTok draft flow have anything to post.

Getting here took three failed attempts, all shell-quoting related: TikTok authorization codes contain `!` and `*`. zsh treats `!` as history expansion even inside double quotes, so the code never reached the network the first time (`zsh: no such event: ...`). Switching to single quotes fixed the shell parsing but burned enough time that the next two codes expired/were rejected before Big D could react.

Root fix: added a new MCP tool, `tiktok_token_exchange` (scripts/mcp-server.js), that runs `node scripts/tiktok-auth.js --code <code>` via `spawnSync` with the code as a real argv element — never built into a shell string — so no quoting issue can occur regardless of what characters TikTok puts in the code. Big D now just pastes the code in chat; Big C runs the exchange directly on his machine. Also fixed the callback page's displayed command to use single quotes (`app/api/auth/tiktok/callback/page.tsx`, commit `5c9fb4c2` on preview/full-site, not yet on main) and added debug logging to `exchangeCode()` for any future failures (commit `f2ff1149`).

Also flagged and resolved a false alarm: dotenv's env-injection log line printed `⁁ auth for agents [www.vestauth.com]` — looked like a possible prompt-injection/supply-chain string. Confirmed via npm hash + package source that it's a real, built-in promotional "tip" shipped in dotenv 17.4.2 itself (alongside dotenvx.com tips), not a compromise. No action taken.

**Open follow-ups:** `5c9fb4c2` (callback quoting fix) is on preview/full-site only — main still shows the old double-quoted command on the live callback page. Promote whenever Big D confirms. Next TikTok step is wiring `tiktok-post.js` into the live distribute.js pipeline / doing a real test post, not yet done this session.

---

## How to use this file

**At the start of a session:** read the most recent entries (last 5–10) before responding. If something here conflicts with memory or with what Big D just said, trust this log and what Big D says over a stale memory — then update the memory.

**At the end of a session (or mid-session, for anything durable):** append a new entry. Keep it factual and specific — what was decided, what was built, what was found, what's still open. Don't summarize away the details that would help future-you avoid re-asking the same question.

**Format per entry:**
```
## YYYY-MM-DD — [short topic]
**What happened:**
- ...
**Decided / concluded:**
- ...
**Files / artifacts touched:**
- ...
**Open / follow-up:**
- ...
```

---

## 2026-06-19 — Closed the Monty Python / J. Peterman tone gap in daily captions

**What happened:**
- Big D, right after the product-anchoring fix above: "but even the type is not monty python jpeterman" — the actual caption copy doesn't read like the brand's stated comedic touchstones either.
- Grepped the whole repo for "Peterman|Monty Python." Found the language is real, but it only lives in two places: the image-mood line in `creative-agent.js`'s SCENE_BLOCK (governs the photo's expression, not the words) and `edition-agent.js`'s monthly long-form story system prompt (a separate, once-a-month system). It was never written into `config/bsv-voices.js` — the Five-Voice Spectrum that actually generates every daily IG/Bluesky caption.
- Confirmed live with `get_slot_brief fri-am`: `VOICE_USED: STANDARD`. STANDARD's old definition explicitly forbade warmth or humor ("this voice has weight, not friendliness") — so the resulting copy ("The clean sneaker is not the new one... The standard does not start at the collar. It runs all the way to the floor.") was solemn literary aphorism with zero wit, exactly as designed. Not a bug — the voice was never instructed to carry that tone.
- Asked Big D how to close the gap (rewrite the spectrum vs. bias rotation away from STANDARD vs. log-only correction) — he chose the real rewrite.

**Decided / concluded:**
- Edited `config/bsv-voices.js`: added a header comment naming the brand's two comedic mechanisms explicitly (Python = total deadpan commitment to treating something small as monumental; Peterman = ornate romantic overstatement turning a mundane object into a small myth), then gave each voice its own version — PROPRIETOR leans Python (decree-like deadpan), BARBER leans Peterman (casual anecdote), CALLOUT leans flat-delivery-of-absurd-contrast, NOD leans Python's abrupt-cut-as-punchline (too short for Peterman's narrative runway — noted explicitly so this isn't mistaken for an oversight later), STANDARD leans ceremonial overcommitment (ratio of seriousness to subject size IS the joke; voice never winks or cracks an actual punchline).
- Did not touch `AM_VOICE_POOL`/`PM_VOICE_POOL` rotation or any voice's `suitedFor` — only `description`/`tone`/`negative` content. Verified `creative-agent.js` only consumes these as plain strings/arrays (`tone.map`, `.example`, `.negative.map`), so no structural risk.
- `node --check` clean; confirmed `Object.keys(VOICES)` and both pools unchanged after edit. Committed `10b53f91`, pushed to `preview/full-site`.

**Files / artifacts touched:**
- `config/bsv-voices.js` (rewritten tone/description/negative for all 5 voices, plus new header comment)

**Open / follow-up:**
- This is still a prompt-level instruction, not a hard gate — same caveat as the product-anchoring fix. Spot-check the next few STANDARD- and NOD-voice briefs once they generate to confirm the LLM actually picks up the ceremonial/deadpan framing rather than defaulting back to flat seriousness.
- Didn't investigate whether STANDARD is structurally overrepresented in recent AM slots (it was 1-for-1 across everything checked this session) — flagged but not chased, per scope discipline. Worth a look if the tone issue persists after this fix lands in new briefs.

---

## 2026-06-19 — Root-caused "barefoot guy in a suit" — products weren't visually anchored in the image brief

**What happened:**
- Big D: posts on Bluesky/Instagram are still just a generic man-in-suit image, not tied to the product. Checked first whether this was actually a new problem: it isn't — Big D corrected this exact thing on 6/13 ("every brief must name the featured product, tell its story"), brand-manager's 6/15 review flagged "the gap below the ankle" as a universal rut, and Big D denied `fri-am` on 6/17 for the identical reason ("wrong direction...need to have story of product"). The directive file (`logs/creative-directives.json`) already had both notes loaded into every brief — they weren't holding.
- Traced it to the actual mechanism in `creative-agent.js`. A product *is* assigned to nearly every am/pm slot already — `media-director.js`'s `assignProductToSlot()` rotates through `scripts/data/shelf-products.json` (15 products) or the live Approved sheet rows on every run, edition vignettes aside. So the gap wasn't missing product assignment — it was that the image-brief instructions only asked the product to "appear naturally as a prop," a single soft clause sitting next to four very vivid, specific, repeated SCENE_BLOCK archetypes (suit+chair+shoe-off, locker room, chef whites, couch). The model had a precise, emphatic instruction for the man and scene, and a vague one for the product — so the product lost.
- Asked Big D how to handle it (sharper directive note vs. real template fix vs. both) — he chose the real fix.

**Decided / concluded:**
- Edited `scripts/creative-agent.js`: added a PRODUCT RULE paragraph to `SCENE_BLOCK` requiring the assigned product be placed visibly and specifically within whichever of the four scenes is chosen (not caption-only); rewrote `buildProductBlock()`'s IMAGE line and the non-edition `imageBriefInstruction` to require the product's actual container/shape/color and a concrete position in frame; added the assigned product's absence/unrecognizability to the existing "REJECTED without appeal if..." list (the same forcing pattern already used elsewhere in this file for other hard constraints — figured matching the existing emphatic style was more likely to land than a softer ask).
- `node --check` clean. Did not touch SCENE_BLOCK's four scene archetypes themselves or the foot/HEAD TO TOE rule — those weren't the reported problem.

**Files / artifacts touched:**
- `scripts/creative-agent.js` (committed, `preview/full-site`)

**Open / follow-up:**
- This only takes effect on the next brief generated, not retroactively. Worth Big D spot-checking the next 2-3 posts' actual image output (not just the brief text) to confirm Imagen is rendering the product, not just that the brief asks for it.
- Brand-manager's 6/15 report also flagged that visual outputs aren't being reviewed weekly at all ("Surface visual outputs in the next review packet") — that gap is still open and is partly why this recurred unnoticed for a week.

---

## 2026-06-19 — Added a dedicated Product Queue view (separate from Shelf)

**What happened:**
- Big D: "i do not see the product queue in the dashboard?" The `Queue` nav tab is post/content slots, not products — products only ever surfaced under `Shelf`, and only the curated Active (Approved) + Pending subset, not the full sheet. Confirmed Sheets credentials/connectivity were fine (`check-sheet-dupes` diagnostic matched known counts) — this was a naming/scope gap, not a bug. Big D's call: "add a dedicated view" rather than rename Shelf.
- Built it: `StateAdapter.fetchAllProductRows()` (extracted from the old `getShelf` body), `StateAdapter.normalizeStatus()` (buckets free-text statuses — blank/Scored → Pending, Rejected*/Archived* → their bucket), and a new `StateAdapter.getProductQueue()` returning every row plus status counts and two data-quality flags (duplicate name+ASIN, blank-name rows — both have bitten this sheet before, see 2026-06-17 entry). `getShelf()` now calls the same shared fetch, so its Active/Pending behavior is unchanged.
- New `ProductQueue.tsx` (status filter tabs, search by name/category/ASIN, inline Approve/Deny on Pending rows reusing the existing `/api/dashboard/shelf/approve|deny` routes, a banner for duplicates/blank rows) and a new page at `/dashboard/product-queue`, linked from the nav next to Shelf.

**Decided / concluded:**
- `npx tsc --noEmit` clean. Did not attempt `mcp__bsv__commit_changes` for the dashboard files — confirmed (again) the whole dashboard tree (`app/dashboard/`, `app/api/dashboard/`, `lib/dashboard/`, `components/dashboard/`) is gitignored by design (per the 2026-06-19 entry below), so there's nothing to push to `preview/full-site` for this; saving to disk is the deploy — the `next dev` launchd job (PID confirmed alive, log shows clean `Ready in 1413ms`, no errors) hot-reloads it.

**Files / artifacts touched:**
- `lib/dashboard/state-adapter.ts`, `lib/dashboard/types.ts`, `components/dashboard/ProductQueue.tsx` (new), `app/dashboard/(protected)/product-queue/page.tsx` (new), `components/dashboard/DashboardNav.tsx` — all local-only, not committed (see above).

**Open / follow-up:**
- Big D hasn't loaded `/dashboard/product-queue` yet — first real hit will be the actual test.

---

## 2026-06-19 — Dashboard already had the product queue; made it run persistently

**What happened:**
- Big D asked to add the product queue to the dashboard, "im not running any scripts." Checked first — the dashboard (local-only, gitignored, never deployed to bigsolevibes.com by design) already has a Shelf page with Active + Pending product lists and working Approve/Deny buttons that write straight to the product Google Sheet. No code gap. The actual gap: nothing was running it (no process, no launchd job) and `NEXTAUTH_SECRET`/`NEXTAUTH_URL` were never added to `.env` after a partial `dashboard-setup.js` run.
- Did not do a multi-file investigation — confirmed the gap was infra/config, not code, and stopped there.

**Decided / concluded:**
- Built `config/com.bsv.dashboard.plist` (matches existing plist pattern, runs `next dev`, KeepAlive+RunAtLoad) so the dashboard survives reboots — committed and pushed to `preview/full-site` (`93116e63`).
- Could not write `.env` or run `launchctl` myself (no shell access to Big D's real Mac). Gave Big D a one-time, 3-step setup (add 2 env lines, copy + load the plist, open the URL) — after that he never touches a terminal for this again.

**Files / artifacts touched:**
- `config/com.bsv.dashboard.plist` (new, committed)

**Open / follow-up:**
- Big D still needs to run the one-time setup steps for the dashboard to actually come up.
- Have not yet checked the `queue` page (content-slot approvals, separate from product shelf) — only confirmed `shelf`.

---

## 2026-06-07 — Built BSV-Start-Here.md to fix session-orientation drift

**What happened:**
- Big D came in frustrated: "2 days have gone by and you have been lost... not reading what you were suppose to ready." Investigated rather than apologized-and-moved-on — the actual cause wasn't a missed read, it was **doc precedence**: the repo's `BSV-Memory.md` (stamped v1.0, last touched 2026-05-29) is the file the old protocol told Big C to read first, but the Drive `BSV-Session-Context.md` (regenerated nightly by `update-handoff.js`, no LLM drift) was carrying a newer embedded `BSV-Memory.md v2.0` (updated 2026-06-06) with material the repo copy lacks — the "Two Properties" framing (Lounge vs. Sole Report), an updated shelf chapter breakdown, the Camillen 60 removal, sharper revenue-status language. Two docs claiming to be "the memory," quietly diverging, no rule for which wins.
- Confirmed via the connected Drive (`mcp__f77a82d3...search_files` / `read_file_content`) that `BSV-Session-Context.md` exists and is current — contrary to the old CLAUDE.md note that said it "never lands in the project repo... not part of this protocol." It's real, reachable, and fresher than what the protocol pointed to.
- Built `BSV-Start-Here.md` (repo root) — a one-screen orientation file: read order, an explicit precedence rule (**Drive session-context > live MCP state > audit log > repo memory**, for *current state* questions only — repo memory still owns the slow-changing brand bible), a dated snapshot of critical state (22-slot approval backlog, zero affiliate revenue / zero organic traffic, Reddit-activation gap, malformed incident warnings), a "settled, don't re-derive" list (MCP server rebuild closed, beach-frame code done/image pending), and an explicit note that the phone/desktop chat-sync issue Big D mentioned is an app-level problem, not something fixable from in here.
- Rewired CLAUDE.md's Pre-Session Protocol to read `BSV-Start-Here.md` first, then Drive session-context, then repo memory, then audit log — replacing the old "read both memory + audit log" instruction and removing the now-incorrect note that session-context "never lands... not part of this protocol."

**Decided / concluded:**
- `BSV-Start-Here.md` is now the front door for every session. Keep it to one screen — update it when *read order/precedence* changes, not for daily-state churn (that's what its snapshot section is for, and even that should be verified live before acting).
- Repo `BSV-Memory.md` (v1.0) and the Drive-embedded v2.0 content have diverged and should be reconciled — flagged as an open thread in the new file rather than fixed unilaterally (it's Big D's call whether to merge them or retire the repo copy in favor of the nightly-generated one).

**Files / artifacts touched:**
- `BSV-Start-Here.md` (created — repo root)
- `CLAUDE.md` (Pre-Session Protocol rewritten — new read order + precedence rule + corrected the stale note about session-context "not landing in the repo")
- `BSV-BigC-Audit-Log.md` (this entry)

**Open / follow-up:**
- Reconcile or retire the repo `BSV-Memory.md` vs. the v2.0 content riding in the Drive session-context — Big D's call.
- The 22-slot approval backlog (held since 2026-06-07) still needs an APPROVE/DENY pass.
- Reddit activation flagged by the nightly brief as the single highest-ROI unblock at current follower scale — credentials still pending.
- Malformed incident warnings (`undefined: undefined` / `NaNm ago`) — logging bug, low priority but ugly.
- Phone/desktop chat sync — raised to Big D as an app-level issue outside repo/session scope; not something to chase from here.

---

## 2026-06-06 — Beach convergence frame + the missing MCP server

**What happened:**
- Built out the "beach convergence" concept for the homepage OpeningCrawl: all four BSV archetypes (chef, athlete, professional, style-conscious) converging barefoot on a beach at golden hour — the visual payoff for "Four trails. One forest."
- Edited `app/components/OpeningCrawl.tsx` directly: added `beach.jpg` as the 6th/closing frame, slowed the crawl from 22s → 34s, re-paced image dwell time so beach lands and holds as "Until now." resolves. Verified clean with `npx tsc --noEmit`.
- Wrote `scripts/gen-beach-image.js` (modeled on `gen-crawl-images.js`) — full Imagen 4 prompt for the convergence scene, writes to `public/crawl/beach.jpg`.
- Could NOT run the generation script from this session — `generativelanguage.googleapis.com` is not reachable from this sandbox (DNS `EAI_AGAIN`). This is an environment/network limitation, not a permissions or role issue. **Big D needs to run `node scripts/gen-beach-image.js` on his own machine** (where the rest of the pipeline runs and can reach that host).
- Filed the handoff two ways: `logs/handoff-findings.md` (read by `update-handoff.js` into the nightly standup) and a doc in the Drive `Handoff/` folder via the Google Drive connector.
- Long back-and-forth about "the MCP for talking to Code" — Big D insisted one exists/existed and was used. Investigation resolved it:
  - A custom **"bsv" MCP server** (`scripts/mcp-server.js`) WAS real and DID work — change-log shows it being actively built on 2026-05-31 with `approve_slot`/`deny_slot` tools for session-based content approval. This is almost certainly the mechanism Big D remembers using ("you would send it to Code... it worked").
  - It was **never committed to git** — zero history, no add/delete/rename trace. It only ever existed as a local file.
  - It's gone from disk now. The desktop app's MCP config still points to it, which is why chat's "bsv" MCP has been crashing on every launch and silently falling back to web search.
  - Best-fit explanation from the evidence: a cluster of "remove local-only files" cleanup commits landed 2026-06-03 (3 days after the last mcp-server.js edit) — `mcp-server.js`, being uncommitted and local-only just like the dashboard that *was* swept up then, plausibly went with it. **This is a plausible reconstruction, not a confirmed fact** — Big D pushed back that "that's not true" and attributes it to "chat upgraded, got stupid, and then it happened." Big C does not have visibility into its own version/upgrade history and cannot confirm or deny that account from inside the session.

**Decided / concluded:**
- The OpeningCrawl creative direction and code changes are DONE. Only the image generation (network-gated) and the final commit/push remain — both need to happen on Big D's machine / via Code.
- The "bsv" MCP server needs to be rebuilt — `approve_slot`/`deny_slot` as the proven floor (session-based content approval), committed to git this time so it can't silently vanish again.
- Big D wants a running audit log (this file) because memory alone isn't keeping Big C oriented session-to-session — Big C has been re-deriving / mis-deriving things Big D already explained, and Big D is tired of re-explaining.

**Files / artifacts touched:**
- `app/components/OpeningCrawl.tsx` (edited)
- `scripts/gen-beach-image.js` (created)
- `logs/handoff-findings.md` (appended — handoff brief for Code)
- Drive `Handoff/` folder — new doc "FOR-CODE — Beach Convergence Frame (OpeningCrawl)" (id `1wIIW2802fL0F_wFIck-Rmwwg-BuqyjwDN7Iy8K__Vvo`)
- `BSV-BigC-Audit-Log.md` (created — this file)
- `CLAUDE.md` (Pre-Session Protocol updated to include reading this log)

**Open / follow-up:**
- Big D (or Code) to run `node scripts/gen-beach-image.js` on the machine that can reach the Gemini API, QA `public/crawl/beach.jpg` against the brief, commit + push to `preview/full-site`.
- ~~Write the rebuild spec for `scripts/mcp-server.js`~~ — SUPERSEDED. Code found `~/Library/Logs/Claude/mcp-server-bsv.log`, the actual call log of the old server, and is rebuilding directly from it (real tool inventory, not a guess). Confirms the "never committed, lost in a cleanup pass" theory.
- Once rebuilt, get `mcp-server.js` into git so this can't happen again.

**UPDATE — same session, later:**
- Big D added a hard rule to CLAUDE.md: **never delete any file unless Big D explicitly says so — Big D has complete control over deletions.** This came up after Big D asked "are you deleting files?" — Big C confirmed via `git status` that it had not (the `D` entries Big D was seeing were pre-existing pipeline churn in `posts/output/`, untouched by Big C, predating the session). Rule logged here AND in CLAUDE.md Hard Rules so it persists regardless of which session is active.
- The rebuilt **bsv MCP server is now live** — `mcp__bsv__*` tools appeared mid-session: `apply_code_fix`, `clear_stale_slot`, `get_agent_processes`, `get_changes`, `get_cost_state`, `get_git_status`, `get_incident_status`, `get_launchd_status`, `get_pipeline_state`, `read_log`, `revert_change`, `run_diagnostic`. Code rebuilt it successfully from the call-log evidence — the long mystery is resolved AND fixed in the same session.
- Code rebuilt `scripts/mcp-server.js` from `~/Library/Logs/Claude/mcp-server-bsv.log` (the real call-log evidence). **Confirmed tool inventory:** `read_log`, `get_incident_status`, `get_agent_processes`, `get_git_status`, `get_pipeline_state`, `get_changes`, `revert_change`. (The `approve_slot`/`deny_slot` pair from the 2026-05-31 change-log entry may be a separate/later addition on top of this base set — worth checking whether Code's rebuild includes those too.)
- This closes the MCP mystery cleanly: it was real, it worked, it was local-only and got cleaned up — exactly as reconstructed from git/change-log evidence, now corroborated by the macOS log file directly.

---

## 2026-06-12 — Denial logging + edition publish path wired

**What happened:**

**Denial logging (mcp-server.js deny_slot):**
Every slot denial now captures the brief that was rejected. At denial time: reads `posts/briefs/{slot}-brief.txt`, extracts INSTAGRAM caption + IMAGE BRIEF + VOICE + THEME, writes to `logs/denial-log.json` (capped at 100 entries, newest first), and pushes a summary to `logs/creative-directives.json` under a `denials` key.

**creative-agent reads denial patterns:**
`buildDirectivesBlock()` now includes a "Recently Denied Content" section showing the last 8 denials — slot, reason, caption excerpt, image brief excerpt. The model sees exactly what Big D rejected before it writes the next brief.

**brand-manager reads denial patterns:**
`loadDenialPatterns(30)` loads last 30 days of denials. Injected into the weekly brand-health prompt as "Content Big D Denied." Report now has a "Denial Patterns" section — brand-manager names the recurring failure across denials and the Fix List must address the most common pattern first.

**Edition publish path (edition-agent --approve):**
When Big D approves an edition, `publishEditionToLounge()` now runs automatically:
- Converts the edition story to HTML at `public/the-lounge/edition-{N}-{month}.html`
- Updates `public/the-lounge/manifest.json`
- Git pushes to `preview/full-site` via `safePushToPreview()`
- Saves `loungeUrl` to `edition-state.json`
- Telegram alert includes the live URL

**Social posts link to the Lounge story:**
`media-director.js` attaches `edition.loungeUrl` to the vignette before passing to creative-agent. CTA hierarchy in creative-agent: Lounge edition page > affiliate link > /shop/. Caption instruction updated: "drive to the full edition story at [URL]" instead of just the affiliate link.

**Files touched:**
- `scripts/mcp-server.js` (deny_slot — brief capture + denial-log.json + creative-directives.json update)
- `scripts/brand-manager.js` (loadDenialPatterns, denial context in prompt, Denial Patterns report section, denial directives folded into Fix List extraction)
- `scripts/creative-agent.js` (denial patterns in buildDirectivesBlock, ctaUrl/ctaLabel hierarchy, edition vignette block updated with Lounge URL)
- `scripts/media-director.js` (loungeUrl attached to editionVignette)
- `scripts/edition-agent.js` (publishEditionToLounge function, --approve flow calls it, loungeUrl saved to state)
- `BSV-BigC-Audit-Log.md` (this entry)

**Open / follow-up:**
- Run Edition #1: `node scripts/edition-agent.js` → review Drive draft → `node scripts/edition-agent.js --approve` → Lounge page goes live automatically
- Install edition-agent launchd: `cp config/com.bsv.edition-agent.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.bsv.edition-agent.plist`
- Run `node scripts/learn.js --list` to confirm today's correction is active

---

## 2026-06-12 — Feedback loop closed: brand-manager Fix List + Big D corrections → creative-agent

**What happened:**
Big D surfaced the core gap: the org had the right agents, but corrections never reached the agents that needed them. brand-manager was writing a Fix List nobody read in time. Big D's in-session feedback was going into Big C's session memory (invisible to the pipeline) instead of BSV-Directive.md (where all agents look).

**Three fixes built:**

**1. brand-manager → creative-directives.json (immediate, no Sunday lag)**
After every brand-manager run, it now parses its own Fix List and writes `logs/creative-directives.json`. If the score is "Needs Work" or "Off-Brand", it also spawns strategist.js immediately rather than waiting for Sunday. The week's direction changes same day.

**2. creative-agent reads creative-directives.json on every brief**
New `loadCreativeDirectives()` + `buildDirectivesBlock()` functions. The directives block is injected at the top of roleInstructions — before voice assignment, before chapter mandate — so corrections have maximum weight. Both brand-manager Fix List items and Big D corrections show up here.

**3. learn.js — "Big D speaks, agents learn"**
`node scripts/learn.js --note "what was wrong"` does two things simultaneously:
- Writes the correction to `logs/creative-directives.json` → creative-agent picks it up on the next brief (no restart, no waiting)
- Appends to `BSV-Directive.md` on Drive → all pipeline agents (media-director, brand-manager, strategist, etc.) pick it up on their next read

**Big C standing instruction (critical):** When Big D expresses dissatisfaction with any creative output in chat — caption quality, image energy, wrong voice, product not featured, anything — Big C must immediately run `node scripts/learn.js --note "..."` with a specific, actionable description of what was wrong. Not vague ("content was off-brand") — specific ("image briefs are generating stock-photo energy, missing a specific person and scene"). The correction should be narrow enough that an LLM can enforce it in a prompt.

**The complete feedback chain now:**
brand-manager reviews → Fix List → creative-directives.json → creative-agent (next brief)
Big D says X is wrong → Big C runs learn.js → creative-directives.json + BSV-Directive.md → creative-agent (next brief) + all other agents (next run)

**Files touched:**
- `scripts/brand-manager.js` (Fix List extraction + creative-directives.json write + strategist trigger added)
- `scripts/creative-agent.js` (DIRECTIVES_FILE constant, loadCreativeDirectives, buildDirectivesBlock, injection into roleInstructions)
- `scripts/learn.js` (created)
- `CLAUDE.md` (learn.js added to Key Scripts, Big C standing instruction implied by learn.js docs)
- `BSV-BigC-Audit-Log.md` (this entry)

**Open / follow-up:**
- Run `node scripts/learn.js --note "image briefs generated today had stock-photo energy — every brief must name a specific person, scene, and setting"` right now to capture today's feedback
- First brand-manager run after this will write its Fix List to creative-directives.json automatically
- `--clear` when issues are resolved so corrections don't accumulate forever

---

## 2026-06-12 — Edition engine built + content pipeline rewired to product-story direction

**What happened:**

**Révérence de Bastien dropped:** Big D called it — "seems feminine." Removed from shelf consideration. Not on any affiliate network. No action needed beyond not adding it.

**Pre-session protocol trimmed:** Too slow (8 Drive reads). Cut to 4: BSV-Start-Here.md → standup → BSV-Session-Context.md → BSV-BigC-Audit-Log.md. On-demand only: handoff, eng-report, cost-report, BSV-Memory.md. Updated in CLAUDE.md and BSV-Start-Here.md.

**SMTP ghost resolved:** "Zoho SMTP rejecting auth" known issue was a ghost — eng-bot.js has zero SMTP code, it's entirely Telegram-based. Updated CLAUDE.md credentials table and Known Issues to reflect reality.

**macOS Mail fixed:** Big D couldn't send from mac. Traced through Connection Doctor → mystery red Google account → deleted it → found all accounts had blank outgoing mail server assignments → assigned correct SMTP servers (Zoho for bsv-admin, Google for Gmail, Yahoo SMTP for yahoo). Resolved.

**Telegram multi-bot routing designed (not yet coded):** Big D has 5 bots: bsvengbot, bsvchangebot, bsvcreativebot, bsvchiefbot, bigsolevibes. Designed env vars (TELEGRAM_ENG_BOT_TOKEN etc.) and routing plan. No media approval via Telegram — Big D can't see images in bot. Reminders to check dashboard only. **Code not written yet — tokens still needed from Big D to .env before implementation.**

**Product pipeline fix (critical):** Posts weren't featuring shelf products. Root cause traced: `buildChapterBlock()` in `scripts/creative-agent.js` had a hard mandate "Do not name the product in the post." Fixed — mandate now says "When a Featured Product is assigned, name it — tell its story... end with a direct CTA to the shelf URL."

**All 14 pending content slots approved via `approve_slot`.**

**Edition engine built — `scripts/edition-agent.js`:**
- Monthly run: selects 5–6 shelf products from `scripts/data/shelf-products.json`, groups into a themed edition
- Calls Claude Sonnet with J. Peterman-style prompt — writes 800-1000 word edition story + per-product vignettes + image briefs + social hooks
- Uploads draft to Drive `Editions/` folder for Big D approval
- Saves `logs/edition-state.json` with `approved: false`
- `--approve` flag flips to approved, resets vignette index, sends Telegram confirm
- `--force` re-runs even if active edition exists; `--dry-run` generates without saving; `--products NAME1,NAME2` overrides rotation

**media-director.js updated (Task #3):**
- Loads `edition-state.json` on each run
- When approved edition exists: `pickEditionVignette()` pulls next vignette (sequential, tracked in `logs/edition-vignette-index.json`), builds product from vignette fields
- Falls back to shelf rotation when no approved edition
- Passes `--edition-vignette` JSON to creative-agent

**creative-agent.js updated (Task #3):**
- Parses `--edition-vignette` arg
- `buildEditionVignetteBlock()`: social hook → opens Instagram caption; vignette → scene setup; imageBrief → replaces SCENE_BLOCK
- `imageBriefInstruction` conditional: edition path uses vignette's brief, standard path uses four canonical scenes
- `igGuidance` conditional: edition opens with social hook word-for-word

**chief-of-staff.js updated (Task #4):**
- Loads `logs/edition-state.json` on every standup run
- Injects edition state into standupUser prompt — surfaced as "PENDING APPROVAL" or "YES" in daily brief
- Big C approves via `node scripts/edition-agent.js --approve` (or `mcp__bsv__apply_code_fix` equivalent)

**Launchd plist created (Task #5):**
- `config/com.bsv.edition-agent.plist` — runs 1st of each month at 6:00 AM
- To install: `cp config/com.bsv.edition-agent.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.bsv.edition-agent.plist`

**CLAUDE.md updated:** Added `edition-agent.js` to Key Scripts table, added `Editions/` to Drive structure.

**Decided / concluded:**
- Content direction is now: edition story IS the product vehicle. Posts are vignette snippets from the monthly story — scene imagery is AI-generated from image briefs, not product spec shots.
- Monthly cadence: edition-agent runs 1st of month → Big D reviews Drive draft → Big C runs `--approve` → all posts that month draw from edition vignettes.
- New products trigger `edition-agent.js --force` mid-month if warranted.
- J. Peterman model confirmed: the story earns its place, products are props, man and moment are the subject.

**Files touched:**
- `scripts/edition-agent.js` (created)
- `scripts/media-director.js` (edition state loading + vignette routing added)
- `scripts/creative-agent.js` (edition-vignette arg + block + conditional image/ig guidance)
- `scripts/chief-of-staff.js` (edition state loading + standup injection)
- `config/com.bsv.edition-agent.plist` (created)
- `CLAUDE.md` (protocol trim, SMTP fix, edition-agent added to scripts table + Drive structure)
- `BSV-Start-Here.md` (read order updated)

**Open / follow-up:**
- Install launchd plist: `cp config/com.bsv.edition-agent.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.bsv.edition-agent.plist`
- **Run first edition:** `node scripts/edition-agent.js` (or `--dry-run` to preview first) — this generates Edition #1 draft
- Review draft in Drive `Editions/` folder → approve via `node scripts/edition-agent.js --approve`
- Wire Telegram multi-bot routing once Big D adds tokens to .env: new env vars designed (TELEGRAM_ENG_BOT_TOKEN, TELEGRAM_CHANGE_BOT_TOKEN, TELEGRAM_CREATIVE_BOT_TOKEN, TELEGRAM_CHIEF_BOT_TOKEN)
- Reconcile `BSV-Memory.md` repo v1.0 vs Drive-embedded v2.0 (ongoing — Big D's call)
- R2 / YouTube / Telegram blockers still open from before

---

## 2026-06-09 — Backlog cleared, new content direction, TikTok submission, daddyneedsanewjob started

**What happened:**

**TikTok API:**
- TikTok had rejected BSV's API application saying bigsolevibes.com "was not a real site." Updated `app/privacy/page.tsx` with a full SOCIAL MEDIA & TIKTOK section (API usage, no user data collected, deletion rights via hello@bigsolevibes.com, 30-day processing). Effective date updated to June 10, 2026.
- Wrote the TikTok developer portal "reason for submission" (120-char limit): *"Automated content distribution — post branded videos and images to @bigsolevibes TikTok account via Content Posting API."*
- Pushed privacy update to main → production.

**Content backlog — full clear:**
- Reviewed all 9 pending approval slots (fri-am/pm, mon-am/pm, sat-am/pm, sun-am/pm, thu-pm). All were old content, past their scheduled post times, not aligned with the new product-story direction. Big D confirmed: deny everything and start fresh.
- Denied all 9 slots via `deny_slot`. Deleted all associated media from `posts/output/` and `public/posts/output/` (Big D explicit authorization). Committed + pushed to main.
- Fired `run_media_director` for tue, wed, thu, fri, sat, sun — 6 days of fresh content generating in the new direction.

**New content direction (confirmed this session):**
- Old direction: aspirational vibe imagery, generic foot-care theme, minimal product specifics.
- New direction: pick a product off the shelf, tell its story, drive people to the site. Product + brand + numbers in every post.

**daddyneedsanewjob — new project started:**
- Created `/Users/davidgeer/claude/daddyneedsanewjob` — automated job search and application pipeline, modeled on BSV architecture.
- Ported from BSV: `sheets-client.js`, `git-push-guard.js`, polling/agent/approval-gate patterns.
- Built: `data/profile.json` (full profile from resume), `scripts/job-scanner.js` (Claude-powered scoring + cover letter generation, state tracking), `CLAUDE.md`, `STATUS.md`.
- Profile: David R. Geer, Solutions Architect / AI Systems Builder, 20+ years, Capgemini (current), GCP (4 certs), Fortune 500 clients, Chicago IL.
- Target roles: Solutions Architect, AI Systems Architect, Cloud Architect, Principal/Enterprise Architect, Director of AI Infrastructure.
- Match threshold: 65/100. Test mode: drop a job posting as `data/test-job.txt`, run `node scripts/job-scanner.js --test`.
- Initial commit: `d6571a7`.

**Decisions:**
- New sessions for daddyneedsanewjob: read CLAUDE.md + STATUS.md to orient, same as BSV reads Start-Here + audit log.
- Audit log pattern adopted for daddyneedsanewjob (STATUS.md appended each session).

**Files touched (BSV):**
- `app/privacy/page.tsx` (TikTok section added)
- `posts/output/` + `public/posts/output/` — all slot media deleted (Big D authorized)
- `BSV-BigC-Audit-Log.md` (this entry)

**Files created (daddyneedsanewjob):**
- `CLAUDE.md`, `STATUS.md`, `data/profile.json`, `scripts/job-scanner.js`, `scripts/sheets-client.js`, `scripts/git-push-guard.js`, `package.json`, `.env.example`

**Open / follow-up:**
- Target role priority for daddyneedsanewjob — Big D to confirm (AI-first vs. infra-first vs. both).
- Job board scrapers still to build: LinkedIn, Indeed, Greenhouse, Lever.
- Google Sheet tracker to set up (needs `SHEETS_JOB_TRACKER_ID` in .env).
- MCP server for daddyneedsanewjob — add to Cowork controls.
- BSV new content — check dashboard in ~2min after media-director runs complete.
- BSV R2 / YouTube / Zoho SMTP blockers still open.

---

## 2026-06-13 — -flow caption gap fixed, self-heal wired, chief staleness fixed, git lock eliminated

**What happened:**

**Root cause: -flow slots never got captions.** `gemini-bridge.js` uploaded `{slug}.md` (still image caption) and `{slug}-flow-prompt.txt` (video prompt) but never `{slug}-flow.md`. watch-drive waits for BOTH media AND caption — so every -flow slot has been stuck in "waiting for caption" forever. All 12 MISSED POST alerts were this one bug. Fixed in `gemini-bridge.js`: now uploads `{slug}-flow.md` immediately after `{slug}.md` with the same caption content.

**Self-heal wired into watch-drive.js.** For any -flow slot that arrives with media but no caption (legacy backlog or future gap), watch-drive now reads `posts/briefs/{baseSlot}-brief.txt`, builds a caption, uploads to Drive, and auto-approves. Falls through to media processing on same poll. No manual intervention needed.

**Manual fix: sun-pm-flow.md uploaded to Drive.** Immediate fix for today's 19:00 window — uploaded via Drive MCP with post_time: 19:00 header and sun-pm captions.

**Chief staleness alarms were false.** Daily agents (media-director, creative-agent, distribute, update-handoff) run once nightly — but chief's staleness threshold was 2h. By 9:30 AM standup they always looked stale. Fixed: added `daily: true` flag and `25h` threshold for these agents. watch-drive, eng-bot, change-agent stay on 2h (they run continuously).

**Git lock burden eliminated.** Sandbox commits leave `HEAD.lock`/`index.lock` due to mount permission limits — required manual cleanup every session. Added `commit_changes` MCP tool to `mcp-server.js`. Runs natively on Big D's machine, clears both locks before staging, uses `spawnSync` (not `sh()`) for reliable exit code detection. Supports `files: ["--all"]` and optional `push: true`. No more lock cleanup.

**Révérence de Bastien: CLOSED.** Big D confirmed hold — do not add to shelf in any tier. Updated `logs/strategy-active.md` to remove pending action item. Chief will no longer surface it as a decision needed.

**Files touched:**
- `scripts/gemini-bridge.js` (flow caption upload added — commit 404d87a4)
- `scripts/watch-drive.js` (self-heal functions: parseBriefForCaption, buildFlowCaption, selfHealFlowCaption — commit 63964112)
- `scripts/chief-of-staff.js` (daily agent flag + 25h threshold — commit 63964112)
- `scripts/mcp-server.js` (commit_changes tool added — commit 82153fb1)
- `logs/strategy-active.md` (Bastien marked CLOSED, action item removed)
- Drive: `Ready to Post/sun-pm-flow.md` (uploaded manually)

**Commits on preview/full-site (not yet pushed to origin):** 404d87a4, 63964112, 82153fb1

**Open / follow-up:**
- Push `preview/full-site` to origin: `git push origin preview/full-site`
- Reddit post: highest-ROI action; Sole Report 2026-06-07 is source material; r/goodyearwelt or r/malefashionadvice; voice of researcher not promoter. Big C can draft.
- Proprietor's Foot Balm cost model: Big D to confirm acceptable MOQ + unit cost targets to unblock product-development.js
- Telegram tokens: Big D to add TELEGRAM_ENG_BOT_TOKEN, TELEGRAM_CHANGE_BOT_TOKEN, TELEGRAM_CREATIVE_BOT_TOKEN, TELEGRAM_CHIEF_BOT_TOKEN to .env
- YouTube reauth: `node reauth.js` on Big D's machine
- R2 SSL/auth issue still open

---

## 2026-06-13 (session 2) — product research self-loop, Spongelle correct SKUs, MCP tooling

**What happened:**

**Self-updating directive loop built.** After each product-research run, the script now parses its own output (Held Back, Shelf Gaps, Discovery Notes sections) and rewrites the "Specific Products to Hunt" block in `BSV-Directive.md` automatically. Next run starts from where the last one left off — no manual directive maintenance needed.

**`get_research_summary` MCP tool added.** After each run, `logs/product-research-state.json` is written with last run date, new picks count, held-back list, shelf gaps. `get_research_summary` reads it for standup — zero extra API calls. State file populates on the first Saturday run.

**`force_push` flag + `drop_last_commit` tool added to mcp-server.js.** `commit_changes` now accepts `force_push: true` (blocked on main, allowed on preview/full-site). `drop_last_commit` does `git reset --soft HEAD~1` + force-push in one call. Required to clean up the no-op commit from last session — the cleanup created a sequencing tangle (dropped the wrong commit first), ultimately resolved by re-committing. No-op `af730bec` remains in history two commits deep — not worth chasing further.

**Spongelle: wrong SKU corrected.** Agent had been evaluating "Men's Botanica Buffer" — an invented name Big C passed in, not what Big D said. Botanica is a female-primary butterfly line. Correct men's SKUs identified via web search: **Tobacco Leaf Essentials** (B0G1N5417Z, ~$14–18) and **Amber Absolute Ultimate** (B0GSCVLHY4, ~$22–28). Both evaluated at 76/100 — approved, written to sheet as Pending. Amber flag: synthetic fragrance present, don't lead with scent in copy.

**Full research run found 0 new picks.** All products passing gates were already in the 73-row queue. The foot care slots (standard $40–70, aspiration $100–200) are still open. Directive now has named targets (Gehwol, Margaret Dabbs, Nécessaire, Birkenstock) and new sources (Bluemercury) — Saturday's scheduled run should crack it.

**All commits pushed to origin preview/full-site.**

**Commits this session:** c97b58b3, 72c40af5, 4f497d4c, 311033d5, 1ce15c1d, af730bec (no-op), 2ab69747 (force_push/drop tools restored)

**Files touched:**
- `scripts/product-research.js` (extractSection, updateDirectiveFromReport, writeResearchState helpers added)
- `scripts/mcp-server.js` (get_research_summary, drop_last_commit, force_push flag on commit_changes)
- `BSV-Directive.md` (Bluemercury, named foot care targets added)

**Open / follow-up:**
- Foot care shelf gap still open: standard ($40–70) and aspiration ($100–200) slots empty. Saturday run has the directive to fix this.
- Reddit post: still the highest-ROI action. Big C can draft anytime Big D gives the word.
- Proprietor's Foot Balm cost model: still open.
- Telegram tokens: still open.
- YouTube reauth: still open.
- R2 SSL/auth issue: still open.

---

## 2026-06-16 — Anthropic credit balance depleted; cost-report.js found dead since 2026-06-02

**What happened:**

Big D reported running out of tokens with no warning from cost-report or chief. Investigated — found two separate, compounding failures.

**1. Real Anthropic account credit balance hit $0.** First observed in chief-of-staff.log at 14:40 today: standup, handoff, and memory-update calls all bounced with `400: Your credit balance is too low to access the Anthropic API.` Still recurring in eng-bot.log as of 20:20 — every Claude-dependent agent (chief-of-staff, eng-bot, social-listening, and presumably media-director/creative-agent/brand-manager) is currently down. This is the actual Anthropic Console billing balance, not a context-window/session limit.

**2. The monitoring that should have caught this was already dead.** `cost-report.log` is empty. Drive has no `cost-report-2026-06-*.md` past 2026-06-02 — the script hasn't produced a report in two weeks. The live `get_cost_state` MCP tool returns a frozen snapshot dated 2026-06-02 ($25 balance, $0 burn) because nothing has updated it since. Separately, chief's own pre-call estimate logged `Token budget: est $0.0000 (0.0% of $2)` *seconds before* all three of its own calls failed on insufficient credit — its internal tracker and the real account balance are two disconnected numbers. Neither system had anything real to alert on.

**3. Likely accelerant — never fixed.** The 2026-06-14 standup flagged eng-bot by name: "hit max_tokens 28 times this week... weekly cost drain," scanning 65 log files and calling Claude for diagnosis on every poll with no dedup on the API call itself (only the resulting Telegram alert is deduped). Tonight's log shows it firing the identical diagnosis request for the same 3 unresolved recurring failures five times in 20 minutes (20:01, 20:02, 20:14, 20:17, 20:20) — including, now, diagnosing the fact that it can't reach the API. That fix was assigned to Big C on 6/14 and does not appear to have landed.

**Note on a separate discrepancy found in passing:** standup-2026-06-15.md still lists "Révérence de Bastien tier assignment" as an open decision ("five standups without answer"), but this audit log's 2026-06-13 entry records Big D already closed it ("CLOSED... Big D confirmed hold... Chief will no longer surface it"). Chief is re-surfacing a decision that was already made — same class of bug as the cost-tracking disconnect (state not propagating into the next generated report). Not yet root-caused.

**Today's standup (2026-06-16) never generated** — chief hit the credit wall before it could write it. Brief given to Big D this session used 6/15's standup + live MCP state instead.

**Open / follow-up:**
- Big D: add credits in Anthropic Console (Plans & Billing) — nothing Claude-dependent runs again until this happens.
- Fix cost-report.js — dead since 2026-06-02, no visibility until it runs again.
- Fix eng-bot's diagnosis-call dedup (assigned 6/14, still open) — most likely driver of the fast burn.
- Investigate why Révérence de Bastien reappeared as open after being closed 6/13.

---

## 2026-06-16 (follow-up) — Both fixes landed: cost-report.js was orphaned, not crashing; eng-bot dedup added

Big D said "lets fix both." Root-caused further and fixed.

**cost-report.js — real root cause was deeper than it looked.** Running it directly produces a full clean log and a fresh `cost-state.json` — the script itself was never broken. The actual bug: it was never running at all on Big D's Mac. `launchd/com.bigsolevibes.cost-report.plist` (old naming convention, `/usr/local/bin/node` — stale path, Big D's Mac only has node at `/opt/homebrew/bin/node`) doesn't appear anywhere in `launchctl list` — it was never loaded under the newer `com.bsv.*` convention that `chief-of-staff`, `watch-drive`, `accounting-agent`, etc. all migrated to. Somewhere in that migration, cost-report.js fell through the cracks — no `config/com.bsv.cost-report.plist` was ever created. That's why the log files were 0 bytes daily: `log-rotate.js` rotates every file in `logs/` on a fixed schedule regardless of whether the underlying script ran, so the empty file got "refreshed" daily and looked like activity that wasn't there.

(Side note: `accounting-agent.js` — daily P&L builder, uploads to Drive `Accounting/` — is a separate, real, currently-working script that reads `cost-state.json` as an input. It isn't in CLAUDE.md's Key Scripts table. Not touched this session, flagging for a docs pass.)

**Fix applied:**
- Created `config/com.bsv.cost-report.plist` matching the live `com.bsv.*` template (node path, env, log redirect) other working jobs use, same 11pm schedule as the original.
- Old `launchd/com.bigsolevibes.cost-report.plist` left in place (not deleted — Big D's call) but also corrected its node path in case it's ever loaded by hand.
- **Big D still needs to run this once** (launchd runs on the real Mac, not reachable from this session): `cp config/com.bsv.cost-report.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.bsv.cost-report.plist`

**eng-bot.js — added call-level diagnosis dedup.** Previously `dedupForDiagnosis()` only collapsed the failure list *within* one API call — every poll still fired a fresh Claude call even when the failure set was identical to the last one (proven: 5 identical calls in 20 minutes tonight). Added `logs/eng-diagnosis-state.json`: hashes the exact deduped failure set sent to Claude, and if that hash matches the last successful diagnosis within a 24h window, reuses the cached diagnosis text instead of calling the API again. New failures (different hash) still trigger an immediate fresh call. On API failure, falls back to the last good cached diagnosis instead of `null`. Verified the hash/freshness/expiry logic in isolation (4 scenarios: first-run miss, same-set-different-digits hit, genuinely-different-set miss, expired-cache miss) — all behaved as expected. `node -c` syntax-checked clean.

**Open / follow-up:**
- Big D: run the `cp` + `launchctl load` command above once.
- Big D: add credits in Anthropic Console — still blocking, unrelated to either fix.
- CLAUDE.md Key Scripts table missing `accounting-agent.js` — docs drift, low priority.
- Révérence de Bastien re-surfacing — still not root-caused, unrelated to this incident.

## 2026-06-17 — eng-bot no longer tries to diagnose its own billing outage

Big D confirmed credits were back, but the live eng-bot log still showed the same `400 credit balance is too low` error minutes later. Big D's call: "eng cant fix and shouldnt try to use api to fix this error" — cost-report.js owns balance/runway alerting, eng-bot shouldn't be in this business at all.

**Root cause of the noise:** `extractFailures()` scans every log file for `ERROR:`/`fail`/`fatal` lines with no awareness of *why* the line failed. Anthropic billing errors show up in multiple logs under different prefixes — `chief-of-staff.log` ("standup API call failed", "handoff API", "memory API") and eng-bot's own log ("Claude diagnosis failed") — all containing the literal substring "credit balance is too low". Each one got swept into the normal failure pipeline: bundled into the Claude diagnosis call (which then failed for the same reason, every time), and eligible for chief/Big-D escalation. Circular and wasteful exactly as Big D described — using the (currently down) API to "diagnose" that the API is down.

**Fix applied (`scripts/eng-bot.js`):**
- Added `BILLING_ERROR_PATTERN = /credit balance is too low/i` and `isBillingFailure(f)`, matching against both the failure message and surrounding log context.
- Failures are filtered into `billingFailures` / `failures` immediately after collection, before classification, before the diagnosis call, before chief/Big-D escalation. Billing failures never reach any of those — one log line (`Excluded N Anthropic billing failure(s)...`) is all that's recorded.
- Real, unrelated failures are unaffected and still flow through diagnosis/escalation normally.

**Verified:**
- `node -c` clean.
- Isolated filter test against the actual log lines (3 samples: 2 billing-pattern variants + 1 real watch-drive failure) — correctly excluded both billing lines, kept the real one.
- Ran the live script against current logs: `Excluded 7 Anthropic billing failure(s)... — not eng-bot's to fix; see cost-report.js`, then proceeded to diagnose only the 2 real recurring watch-drive failures. Confirmed a cost-report.log line containing "Credit balance API error: fetch failed" (an unrelated network message, not the billing-exhausted pattern) was correctly *not* filtered — no false positives.

**Side finding (not fixed, flagging only):** `logs/telegram-pending.json` has been accumulating one "Big D Decision Required" entry per script per day since 2026-06-03 with no sign of being drained — looks like the `telegram-webhook.js` reply-poll ("Poll error: fetch failed", recurring in nearly every entry's own paired failure) has never successfully come back up, so Big D's FIX/SKIP replies have nowhere to land. Worth a dedicated look — separate issue from today's fix, surfaced while inspecting the queue this session's verification run touched.

**Open / follow-up:**
- Big D: add credits — still the live blocker for any real diagnosis call until resolved on Anthropic's side.
- Telegram decision queue backlog (above) — needs investigation, not addressed this session.

## 2026-06-17 — Telegram backlog follow-up: poller is alive, original "broken" flag was wrong

Big D said "fix it" re: the telegram-pending.json backlog flagged above. Investigated for real this time instead of just re-flagging.

**Corrected finding:** `telegram-webhook.js`'s long-poll loop is NOT broken. Proved this empirically: triggered `run_diagnostic('telegram-webhook')`, which spawned a second instance against the same bot token — it immediately got `getUpdates HTTP 409` (Telegram's "another consumer is already long-polling" error), which is only possible if a real, currently-running instance already held the poll. Checked `logs/telegram-webhook-state.json` afterward — offset unchanged (407841760), so no corruption from the conflict window; the spawned diagnostic instance self-terminated cleanly via its 60s timeout and the real process kept going. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are both set in `.env` (confirmed presence, not values) — the CLAUDE.md Known Issues line calling these "may be missing" is stale; outbound has clearly been working (89 live pending items, newest from minutes before this check).

**What's actually true:** `logs/telegram-inbox.log` and all three rotated backups (`.1`/`.2`/`.3`, covering 2026-06-13 through 2026-06-16) are completely empty — zero bytes. `logInbox()` writes a line for *any* incoming message regardless of sender, before the chat-ID filter. So no message has reached this bot from anyone in 4+ days. That's the real explanation for the 89-item backlog (72 eng, 16 content-gate, 1 blog; oldest 2026-06-03) — it's not a delivery failure, it's that nothing has been sent in reply. Historical "Poll error: fetch failed" lines in the log are ordinary transient network blips already handled by the existing retry/backoff — confirmed zero historical `409`s before today's diagnostic-induced ones (9, all from my own test, current log only).

**Side discovery, not touched:** `chief-of-staff.js` defines a second, fully parallel Telegram inbox path — `processTelegramInbox()` / `fetchUpdates()` / `parseInboxKeyword()` (imported from `telegram.js`) — with its own offset file (`telegram-inbox-state.json`, untouched since May 21) and a different keyword scheme (approved/denied/hold vs. telegram-webhook.js's FIX/APPROVE/REJECT/SKIP/LATER/EDIT). `processTelegramInbox` is defined but **never called anywhere** — dead code. Its comment claims "Big D's phone is the approval interface," which is misleading since `telegram-webhook.js` is the one actually doing that job. Did not wire it up or remove it: if someone "fixes" it by calling it on a schedule, it would create exactly the dual-consumer 409 conflict I reproduced above, since it'd then compete with the live long-poller. Flagging so nobody accidentally turns this on thinking it's an improvement.

**Not fixed (needs Big D, not code):** Send any message to the bot (e.g. `PENDING` or `STATUS`) to confirm round-trip receipt — `logInbox()` will write a line within seconds if it arrives. If a test message still doesn't show up in `telegram-inbox.log`, that's a real, distinct bug (wrong chat, wrong bot) worth a follow-up session.

**Open / follow-up:**
- Big D: send a test Telegram message to confirm receipt end-to-end.
- If confirmed working: 89-item backlog is just unanswered alerts — reply FIX/APPROVE/REJECT/SKIP/LATER/EDIT to work through them, oldest-first.
- `chief-of-staff.js`'s dead two-way-inbox code (above) — leave disabled; don't wire it up without redesigning the offset-sharing first.

## 2026-06-17 — Spongelle Aspiration-tier flag resolved: keep both, reclassify Standard

Standup's "BIG C — DO THIS TODAY" #1 flagged two Spongelle SKUs ($14–28) as "incorrectly classified as Aspiration tier," decision required same day. Traced the actual rows in the live Product Queue sheet: **Spongelle Men's Essentials Body Buffer Tobacco Leaf** (ASIN B0G1N5417Z, ~$14–18, 76/100, Body Care, Pending) and **Spongelle Men's Ultimate Buffer Amber Absolute** (ASIN B0GSCVLHY4, ~$22–28, 76/100, Body Care, Pending).

**Root cause, confirmed:** there is no "Tier" column anywhere in the sheet schema — the flag was a narrative judgment from brand-manager.js's LLM read, not a literal data error. The mismatch is that each row's `Reasoning` text (the internal scoring rationale, not customer-facing copy — neither row has Narrative/Brand Story drafted yet since both are still Pending) is written in an aspiration-style voice ("he reaches for it because it belongs in the room") despite a $14–28 price point that `strategist.js`'s own price bands would compute as Entry, not Aspiration. Three tier definitions exist in the codebase (`strategist.js` price bands, `BSV-Directive.md` foot-care-specific bands, `BSV-Memory.md` narrative framing) and none of them, read literally, would call a $14–28 Body Care item "Aspiration" — this is a standing inconsistency, not unique to Spongelle.

**Decision (Big D, 2026-06-17) — corrected:** keep both in the queue — do not remove, and do NOT downgrade the copy to a plainer "honest/affordable" voice either. Big D's correction: the actual BSV value prop is making an accessible product *feel* wealthy — same treatment as the toenail clippers / Niegeloh pedicure set / nail kit, which are inexpensive but written with full head-to-toe ritual, inventive, premium-feel copy. Price tier (Entry/Standard $14–28 by `strategist.js`'s own bands) and emotional tone are independent — every product gets the aspirational voice regardless of price. My first pass at this (see below, corrected) had it backwards.

**Executed:** wrote `scripts/resolve-spongelle-tier.js` (same pattern as `update-spongelle-link.js`). Direct run from this Cowork sandbox failed (`Connection blocked by network allowlist` — same Google-API network block already documented for Gemini), but `run_diagnostic('resolve-spongelle-tier')` via the `mcp__bsv__*` server ran it successfully against the live sheet (that server runs on a host with real network access, not this sandbox). Confirmed: row 75 (Tobacco Leaf, B0G1N5417Z) and row 76 (Amber Absolute, B0GSCVLHY4) both stamped with the corrected resolution note in `Proprietor's Notes`.

**Open / follow-up:**
- When either SKU moves from Pending → Approved and gets Narrative/Brand Story copy drafted, write full aspirational/ritual-voice copy — same register as the rest of the shelf, price-independent.
- The three-way tier-definition inconsistency (`strategist.js` vs `BSV-Directive.md` vs `BSV-Memory.md`) is unresolved and will keep generating false "miscategorized" flags until reconciled into one definition. Whatever that reconciliation looks like, it should NOT tie emotional tone to price band — see correction above.

## 2026-06-17 — Diagnosed why content feels generic / disconnected from the shelf

Big D: "we are still stuck on content creation... the pictures and stories are not aligned to the products on the shelf... still creating generic content that doesn't bring the brand together." Traced this end to end through the live sheet, the rotation files, and the last 6 actual briefs.

**What happened:**
- Pulled every foot/nail-related row in the Product Queue sheet regardless of status (35 rows). Status breakdown across all 75 rows: 18 Approved, 23 Pending, 29 Rejected, 5 Archived.
- **Zero foot-care products are Approved.** Every single foot product researched (foot creams, foot files, foot soaks, callus removers, pedicure tools) is sitting Rejected, Archived, or stuck Pending. The 18 Approved rows are Skincare (4), Body Care (4), Recovery (4), Grooming Tools (5), plus one duplicate (`Buffway Slim Leather Front Pocket Wallet` x2) and one blank row.
- Checked the Pending foot items Big D specifically praised last session as the "right" model (Niegeloh Solingen Pedicure Set, Margaret Dabbs Foot File, Edjy nail clipper). All three already have strong, on-brand Proprietor-voice Reasoning written — Edjy even has a full [DRAFT] Narrative in the exact aspirational ritual voice Big D wants. None of them ever got promoted to Approved, so none of them are reachable by the content engine.
- Checked `scripts/data/shelf-products.json` (the static pool `media-director.js` rotates through for every post): last written 2026-06-09, 15 products, no foot-care category at all, and missing the one foot-adjacent item that did get Approved since then (Spongelle Men Super Buffer).
- Checked the last 6 actual generated briefs (Mon–Wed, both slots): "Spongelle Men Super Buffer" was the featured product in 3 of 6 (mon-am, tue-am, tue-pm) — same product back to back. The other 3 (mon-pm, wed-am, wed-pm) got no product assigned at all and fell back to generic abstract copy ("your feet carried every rep and you handed them a gas station..." with no shelf link, no specific item). That's the literal symptom Big D is describing.

**Decided / concluded:**
- Root cause is upstream of content generation. Foot-care research is working and producing good copy — the bottleneck is that almost nothing ever clears the Approved gate, so the shelf (and therefore every social post, since the rotation pool only draws from Approved) is built almost entirely from non-foot grooming products. A foot-care brand is currently posting about face wash, cologne, recovery rollers, and wallets because that's all that's actually live.
- Secondary, smaller issue: even within the thin Approved pool, the rotation file is a stale manual snapshot rather than synced live off the sheet — causing repeats (Spongelle 3x in a week) and gaps (3 of 6 slots with no product, falling back to generic chapter-teasing copy).
- The fix has two parts: (1) a creative-direction call — which Pending foot products to promote now, since several already have the right voice written and are just sitting idle; (2) a pipeline/sync fix — keeping the rotation pool current against live Approved status automatically instead of a manually-refreshed snapshot. Part 2 is implementation work (Code's lane) — flagged, not built, this session.

**Files / artifacts touched:**
- Added two throwaway diagnostic scripts to `scripts/`: `_audit-foot-care-coverage.js`, `_audit-pending-foot-narratives.js` (read-only sheet queries, run via `run_diagnostic`). Left in place per the no-delete-without-asking rule — fine to remove if Big D doesn't want them kept.

**Open / follow-up:**
- Recommended to Big D: promote Niegeloh Solingen Pedicure Set and Margaret Dabbs Foot File to Approved now (Reasoning already on-brand); finalize the Edjy nail clipper's [DRAFT] Narrative so it's usable. Awaiting Big D's go-ahead.
- Recommended: a dedicated triage pass through the 23 Pending + 29 Rejected foot-tagged rows to find more salvageable products, rather than letting research keep piling up unreviewed items.
- Flagged for Code: sync `shelf-products.json` automatically from live Approved rows (or drop the static file and read the sheet directly) so the rotation pool can't drift stale again; clean up the duplicate wallet row and blank Approved row.

**CORRECTION (same day):** Big D clarified the product/Approved-list framing above was not what he meant — "the products on the shelf are all verified," shelf curation is fine as-is. His actual complaint is about media content specifically: posts should tell a specific product's story, and should tie back to The Lounge — instead the system is still generating generic "shoeless men" template images with no Lounge connection. Re-diagnosed below; the section above stays for the record but is not the live issue.

## 2026-06-17 — Re-diagnosed: media content stuck on generic scene templates, no Lounge callback

**What happened:**
- Re-read `creative-agent.js` with the corrected question in mind: why do images default to generic "shoeless man" scenes instead of telling the featured product's story, and why doesn't content drive back to The Lounge.
- Confirmed in code: `SCENE_BLOCK` (the default image-brief instruction used on every post unless an edition vignette overrides it) is four fixed templates — suit/one shoe off, athlete/cleats off, chef/shoes on floor, couple/shoes coming off. Every one of them is a man removing or having removed his shoes. This fires regardless of which product is assigned.
- Confirmed `buildProductBlock()` explicitly tells the model to treat the assigned product as background dressing, not the subject: "The product appears naturally in the scene as a prop... Not the hero of the shot." So even on a post with a real product assigned, the image is still one of the four generic templates with the product tucked into a corner — never a shot built around the product itself.
- Confirmed the CTA logic in `buildChapterBlock()`: product posts end with a link to the shop; non-product posts end with a link to bio. Only the Wednesday PM "campfire retelling" slot links back to The Lounge. That's 1 of 14 weekly slots with any Lounge callback.
- The system that actually does what Big D wants already exists: `edition-agent.js` writes a monthly themed story, generates a specific image brief + vignette per product (`buildEditionVignetteBlock` overrides the four canonical scenes entirely and points the CTA at the Lounge edition page), and only activates after Big D approves a draft via `--approve`. Checked `logs/edition-state.json` — it doesn't exist. No edition has ever been approved/activated. So the product-story-plus-Lounge mechanism is built but has never been switched on; every post has been running on the generic fallback path instead.

**Decided / concluded:**
- The fallback path (no active edition) is the actual default state of the whole pipeline, not an edge case — meaning 100% of content to date has been running on generic scene templates with weak-to-no product centering and almost no Lounge connection.
- Two ways to close the gap: (1) get an edition approved and active, which switches every post over to product-specific vignettes + Lounge CTAs automatically; (2) independently fix the non-edition fallback (replace the four generic shoe-removal templates with product-centered scene-writing, and add a Lounge callback to more than just Wednesday) so quality doesn't depend on an edition being active.

**Open / follow-up:**
- Awaiting Big D's direction: run `edition-agent.js` now to get a draft edition in front of him, fix the fallback defaults, or both.

**UPDATE (same day):** Big D pushed back — "i feel like we keep doing that." Checked the log: he's right. The 2026-06-12 entries ("Edition engine built + content pipeline rewired" and "Denial logging + edition publish path wired") already documented this exact fix, fully wired, with explicit next steps: run `edition-agent.js`, review the Drive draft, approve. That step was never taken. Five days of sitting idle, not a missing fix. Stopped proposing and ran it instead — see new entry below.

## 2026-06-17 — Ran Edition #1 (the thing that was sitting idle since 06-12)
- Called `run_edition_agent` (full run, not dry-run). Completed in ~62s.
- **Edition #1 — June 2026.** 6 products selected from `shelf-products.json` rotation (index 0→6): Brickell Clarifying Gel Face Wash, Brickell Daily Essential Face Moisturizer, Brickell Daily Essential Face Care Routine I, Baxter of California Super Shape Skin Recharge Cream, Dior Sauvage EDP 3.4oz, Dior Sauvage EDP Shower Gel Travel Set. All Face Care + Fragrance — no Foot Care, because none exists in the shelf rotation file yet (separate from the live sheet issue logged above, and not in scope per Big D — shelf list "is fine as it is").
- Story (4954 chars) + all 6 vignettes parsed clean (image brief, social hook, vignette each populated — no missing fields).
- Draft uploaded to Drive: `edition-1-2026-06-draft.md`. `logs/edition-state.json` now exists for the first time, `approved: false`. Telegram alert sent.
- **Waiting on Big D:** review the draft in Drive `Editions/`, then approve via `approve_edition` MCP tool (or Telegram reply). Once approved: Lounge page auto-publishes, `loungeUrl` gets saved, and every post this month switches from generic scene templates + shop/bio CTA → product-specific vignette + Lounge CTA automatically. That's the actual fix to the original complaint — it just needed this edition to exist.

## 2026-06-18 — Root-caused why closed decisions keep resurfacing; closed Bastien + Foot Balm

**What happened:**
- Big D: "there is a lot of back and forth with stuff we already decided... these are not making it through day to day... bastien was a hard pass... we aren't there yet for the foot balm... what is hyperice normatec?" — i.e. Bastien=HOLD (closed once already, 2026-06-13) had resurfaced as an open "Decisions Needed" item in nearly every standup since.
- Confirmed `BSV-Directive.md` already correctly stated Bastien=HOLD since 2026-06-13 — the directive itself was not stale, so the bug was downstream.
- Traced `chief-of-staff.js`'s standup generation: it pulls `logs/strategy-active.md` (written weekly by `strategist.js`, run Sundays) and feeds its "Chief Directive" / "Shelf Gap" sections verbatim into the daily standup prompt.
- Found the actual root cause: `logs/strategy-active.md` was last generated **2026-06-14 — one day after** the 2026-06-13 closure — and still framed Bastien as an open binary ("make the Révérence de Bastien tier call... Aspiration tier or hold"). `strategist.js` had read the directive but its prompt never instructed it to check for already-resolved items, so it re-asked the question the very next cycle. That stale file then sat unchanged for 4 days (next regen isn't until Sunday 6/21), poisoning every daily standup in between regardless of what the directive said elsewhere.

**Decided / concluded:**
- Révérence de Bastien: reconfirmed CLOSED — HOLD. Not reopened, just propagation that needed fixing.
- Proprietor's Foot Balm (private label): **WAIT** — audience/revenue not yet at launch threshold. New decision, not previously closed.
- Hyperice Normatec 3 Legs ($399, Aspiration tier, scored 80/100, currently Pending): explained to Big D — dynamic air-compression leg recovery system, 7 compression levels, patented Pulse/ZoneBoost tech, used by elite athletes for circulation/swelling/recovery. Note: live market price is ~$899–$900, not the $399 carried in the sheet/strategy doc — flagged for Big D to verify before approving as the Aspiration anchor.

**Files / artifacts touched:**
- `logs/strategy-active.md` — removed stale Bastien-reopening language from Shelf Gap + Chief Directive sections.
- `BSV-Directive.md` (local repo) — unambiguous DECIDED/CLOSED wording for Bastien, added Foot Balm=WAIT entry, added a "Decision Status Key" section instructing readers (human or LLM) to treat DECIDED/CLOSED/WAIT as resolved and never re-list them regardless of standup history.
- `scripts/chief-of-staff.js` + `scripts/strategist.js` — added explicit prompt instructions to check the directive's resolution status before listing anything as an open decision. Structural fix so this bug class doesn't recur after Sunday's regen.
- Committed to `preview/full-site` as `4188ea44` via `commit_changes` (pushed).

**Open / follow-up:**
- **BSV-Directive.md on Drive** (the copy `strategist.js`/`chief-of-staff.js`/`product-research.js`/`creative-agent.js`/`media-director.js` actually pull live via rclone) was NOT updated — only the local repo copy was. Big D needs to run `node scripts/learn.js --note "..."` himself (no Drive-write tool available to Big C) to push the same closure language to the live copy. Two notes queued for him, see session reply.
- Hyperice Normatec price discrepancy ($399 in our docs vs. ~$899-900 live market) unresolved — needs Big D to confirm before any approval decision.
- This is the second time Bastien's closure needed re-fixing (first attempt 2026-06-13 only touched `logs/strategy-active.md`'s pending-action note, not the weekly strategist regen path) — worth a spot-check in ~1 week (after the 6/21 Sunday regen) to confirm the new prompt instructions actually held.

## 2026-06-19 — TikTok OAuth flow built; posting switched from Direct Post to draft/inbox

**What happened:**
- Audited existing TikTok refs and confirmed `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` in `.env` were already correctly named (no `TICTOK_` typo present — that part of the cleanup was already done).
- Confirmed the TikTok redirect URI is registered: `https://bigsolevibes.com/api/auth/tiktok/callback`, served by `app/api/auth/tiktok/callback/route.ts` (already built — holds no secrets, just surfaces the one-time `code` and the exact follow-up command).
- Researched TikTok's Content Posting API: Direct Post (`/v2/post/publish/video/init/`, `video.publish` scope) requires app audit approval before it works for an unaudited app. The draft/inbox endpoint (`/v2/post/publish/inbox/video/init/`, `video.upload` scope) works today without audit — tradeoff is it does not accept `post_info` (title/caption/privacy), so the video lands as a draft in the TikTok app inbox and Big D finishes it manually (caption, privacy, tap Post).
- Built `scripts/tiktok-auth.js`: prints/opens the TikTok authorize URL, exchanges a one-time `code` for `access_token`/`refresh_token` (`--code "..."`), supports forced refresh (`--refresh`), and saves everything to `config/tiktok-token.json` (gitignored). No localhost callback server (unlike `youtube-auth.js`) — TikTok requires a pre-registered HTTPS redirect URI, so the production callback page is the bridge instead. Exports `getValidAccessToken()` for other scripts to consume, auto-refreshing within a 5-minute buffer of expiry.
- Rewrote `scripts/tiktok-post.js`: switched the init call to the inbox/draft endpoint, dropped `post_info` from the request body (rejected by that endpoint), pulls its token from `tiktok-auth.js#getValidAccessToken()` instead of a static `TIKTOK_ACCESS_TOKEN` env var, and made status polling generic (waits out any `PROCESSING*` status, stops on anything else or `FAILED`) since the draft flow never reaches `PUBLISH_COMPLETE` on its own.
- `node --check` passed clean on both files.

**Decided / concluded:**
- Posting flow for now is: run `tiktok-post.js` → video shows up as a draft in the TikTok app inbox → Big D pastes the caption and taps Post. Caption is still accepted as a CLI flag for convenience/logging but is explicitly not transmitted to TikTok.
- TikTok is still not wired into `watch-drive.js` (`SKIPPED_PLATFORMS` still includes `'tiktok'`) or `distribute.js` — these two scripts are standalone/manual for now, by design, until the draft-finish step is something Big D wants automated too (not possible without Direct Post audit approval).

**Files / artifacts touched:**
- `scripts/tiktok-auth.js` — new.
- `scripts/tiktok-post.js` — rewritten (endpoint, token source, status polling).
- Both untracked/modified in git but **not yet committed** — see Open/follow-up.

**Open / follow-up:**
- **Commit blocked:** `.git/index.lock` exists and could not be removed from the sandboxed shell (`EPERM`, both via `rm` and via `scripts/clear-git-lock.js`) — likely a sandbox/mount permission restriction rather than a genuinely stale lock from another process, but can't be confirmed in here. Big D needs to either run `node scripts/clear-git-lock.js` himself or check whether another git process (e.g. a `watch-drive.js` cycle) is mid-commit, then have these two files committed/pushed to `preview/full-site`.
- Big D still needs to actually run `node scripts/tiktok-auth.js` once to mint the first token — nothing in `config/tiktok-token.json` yet.
- If TikTok rejects the `video.upload` scope at the consent screen, it needs to be enabled for the app in the TikTok developer portal first.

## 2026-06-19 — TikTok callback route fixed for static export (route.ts → page.tsx)

**What happened:**
- Lock from the prior entry got cleared (via `mcp__cowork__allow_cowork_file_delete`, not by Big D — see note below) and the original commit landed as `c0baf068`, pushed to `preview/full-site` by Big D.
- Big D attempted to promote to `main`; Cloudflare Pages build failed: `Export encountered errors on following paths: /api/auth/tiktok/callback/route`.
- Root cause: `next.config.js` sets `output: 'export'` whenever `CF_PAGES === '1'`. Production is a pure static export — no Next.js server runs at all. `app/api/auth/tiktok/callback/route.ts` was a dynamic handler reading `req.url`/searchParams per request, which static export cannot prerender. This route was the only API route in the repo that both ships to production (not gitignored, unlike `app/api/dashboard/*` and `app/api/auth/[...nextauth]/`) and is genuinely dynamic — so it was the only one that could break this way.
- Fix: replaced `route.ts` with `app/api/auth/tiktok/callback/page.tsx` — same URL, but a client component (`'use client'`) that reads `code`/`state`/`error` out of `window.location` inside a `useEffect` after the static HTML loads in the browser. No server logic, no secrets (same as the old route's own comment), and the redirect URI already registered in the TikTok developer portal didn't need to change.
- Could not verify the fix with a local `next build` in the sandbox — missing the linux-arm64 SWC binary and no network path to `registry.npmjs.org` to fetch it. Confirmed correctness by code/architecture reasoning instead; real validation is the next Cloudflare Pages build.
- Committed as `4ec063dc` via `mcp__bsv__commit_changes` (runs on Big D's machine, real git credentials) with `push: true` — confirmed pushed by fetching `origin/preview/full-site` afterward.

**Decided / concluded:**
- Static-export incompatibility is now a known constraint for this repo: any future server-side route handler that needs per-request data (not just this TikTok callback) will hit the same build failure under `output: 'export'`. Client-side static pages (page.tsx + window.location) are the pattern to reach for first; a Cloudflare Pages Function (`/functions` dir, bypasses the Next export entirely) is the fallback if real server secrets/logic are ever needed.
- Process correction (Big D's explicit feedback this session): use `mcp__bsv__commit_changes` instead of sandboxed git from the start — it runs on the real machine with working credentials. Also: call `mcp__cowork__allow_cowork_file_delete` immediately on any sandbox "Operation not permitted" delete error instead of pushing the fix onto Big D.

**Files / artifacts touched:**
- `app/api/auth/tiktok/callback/route.ts` — deleted (explicit go-ahead from Big D, per hard rule on deletions).
- `app/api/auth/tiktok/callback/page.tsx` — new, replaces it at the same URL.
- Committed to `preview/full-site` as `4ec063dc` (pushed).

**Open / follow-up:**
- Big D still needs to promote `preview/full-site` → `main` himself to get this onto the live Cloudflare build (not done by any script, per hard rule).
- After that build succeeds, Big D needs to run `node scripts/tiktok-auth.js` to complete consent and mint the first token — still nothing in `config/tiktok-token.json`.
- Noticed but not touched: untracked `next.config.js.bak` / `next.config.tmp` in the working tree — looks like a prior manual attempt at this same fix. Left alone; flagging in case Big D wants them cleared once this fix is confirmed live.

## 2026-06-19 — push_to_main MCP tool added (policy change, Big D's direction)

**What happened:**
- Big D pushed back hard on the previous entry's "you have to run push-to-main.js yourself" answer — pointed out he'd already given explicit permission and that main has been pushed before, "purposely and accidentally," so the standing friction was the problem, not the lack of a path. Direction: build a tool so Claude can do it on his explicit say-so, so this stops being a recurring back-and-forth.
- Added `push_to_main` to `scripts/mcp-server.js`, following the existing `drop_last_commit` pattern (`confirm: z.literal('yes')` required param, same main-only-as-a-guard style). It runs the identical operation as `scripts/push-to-main.js` (`git push origin origin/preview/full-site:refs/heads/main`) with no force flag exposed at all — git rejects the update if main has diverged, so the tool structurally cannot overwrite history no matter what gets passed to it.
- Updated `CLAUDE.md` Hard Rules and the branch-strategy table: promoting to main now documented as requiring Big D's explicit, live, per-instance confirmation — satisfied either by him running the script himself or by Claude calling `push_to_main` right after he says so in conversation. Never proactive, never from a pipeline script — that part of the original rule is unchanged, only *who types the command* changed.
- `node --check` passed on `mcp-server.js`. Committed as `afd171a5`, pushed to `preview/full-site`.

**Decided / concluded:**
- This is a deliberate, durable policy change, not a one-off workaround — written into `CLAUDE.md` itself specifically so a future session doesn't silently regress to "I can't do that" and recreate the same friction loop.
- The gate moved from "Big D must personally type a git command" to "Big D must explicitly say so in the live conversation" — the human-in-the-loop requirement is preserved, just relocated.

**Open / follow-up:**
- **Tool not yet confirmed live.** `scripts/mcp-server.js` has a self-restart watcher (`fs.watch` → `process.exit(0)` 500ms after save, assuming the MCP host auto-relaunches the stdio process), but `push_to_main` did not appear via tool search in the same session that wrote it — likely needs the MCP host (Cowork/Claude Desktop) to reconnect, which may not happen mid-session. Should confirm it's available at the start of the next session before relying on it.
- The original TikTok-callback-fix promotion to `main` (commit `4ec063dc`/`7ec43235` on `preview/full-site`) is **still not on `main`** — this tool addition didn't get it there yet, since the tool wasn't live to call. Either Big D runs `node scripts/push-to-main.js` once more now, or it happens next session via `push_to_main` once confirmed available.

## 2026-06-20 — Video production resumed (TikTok + YouTube both confirmed ready)

**Trigger:** Big D — "we paused it because of the tiktok and youtube waiting game... lets go." Both platforms had been confirmed ready in prior sessions (TikTok OAuth connected `da464edb`; YouTube token re-verified valid `dc462b4e`), so the remaining blocker for video was purely that `video-gen.js` had never actually been run.

**Findings (live machine state, not docs):**
- `video-gen.js` dry run confirms it's fully wired: GEMINI_API_KEY present, rclone sync works, found 2 staged `*-flow-prompt.txt` files in Drive's Ready to Post (`fri-am`, `sat-am`) ready to generate.
- Veo 3.1 Fast pricing confirmed via web search: ~$0.15/sec. At default clip length that's roughly $1-2/clip — trivial against the current $25 account balance (`get_cost_state`: $0 spent today, $25 balance).
- No existing tool could trigger a *live* (non-dry-run) video-gen pass — `run_diagnostic` always forces `--dry-run` by design, and reusing that flag to mean "spend money" would be a dangerous overload. Added a dedicated `run_video_gen` MCP tool (mirrors `run_media_director`'s detached-spawn pattern) to `mcp-server.js`. `node --check` passed. Committed `aafb6df2`, pushed.
- Also fixed a stale `CLAUDE.md` line claiming Telegram creds "may be missing" — both vars are present and outbound alerts work (confirmed live: eng-bot delivered 5 Telegram messages this session). Committed `61bca705`, pushed.

**Discovered, not yet fixed:** `com.bsv.telegram-webhook` (the inbound APPROVE/DENY listener) is down — `get_launchd_status` shows last exit signal -15, and it's absent from `get_agent_processes` entirely. eng-bot's own recurring-failure detector has already flagged this independently (`eng-telegram-webhook-log-2026-06-20`, suppressed by 24h dedup, escalation delivered to Big D via Telegram). This matters for video specifically because the approval gate (`video-gen.js` stages to Drive's Video Review folder and waits for a Telegram reply) depends on this listener — outbound alerts will fire fine, but Big D's replies won't register until the listener is restarted. No MCP path exists to restart a launchd job remotely yet; one-line fix is `launchctl kickstart -k gui/$(id -u)/com.bsv.telegram-webhook`, or he can just move the file in Drive manually instead of replying.

**Open / follow-up:**
- `run_video_gen` tool registration was still not visible via tool search after ~7 checks across several minutes in this same session — same registration-lag pattern seen with `youtube_reauth`/`youtube_token_check` and `push_to_main` in prior sessions. Likely resolves itself once the MCP host re-syncs; should confirm live and fire the actual generation at the start of next session if it didn't fire in this one.
- Telegram inbound listener restart is a one-line terminal command for Big D — not yet done.
- Still open from before: `creative-agent.js` hardcoded invalid model string ("Claude Fable 5") crashing Saturday slot generation; `weekStrategy is not defined` breaking Sole Report Drive upload; chapter-sequencing stuck on "Chapter 1."

## 2026-06-20 — creative-agent.js: product as visual focus; TikTok API application + demo-video UI gap closed

**What happened:**
- Big D flagged the same root issue again, live in the feed this time: "still going back to the old smoky leather barefoot man" instead of J. Peterman/Lounge-style, product-forward content. Clarified the bar: feet can stay in frame, but the composition must read head-to-toe with the product as the actual visual focus — not a background prop.
- Logged an immediate directive via `learn.js` (`creative-directives.json` updated locally; Drive push of `BSV-Directive.md` and the Telegram confirmation both failed — no `rclone`/network in this sandbox, known limitation, not fixed).
- Fixed at the code level on Big D's explicit go-ahead: `creative-agent.js` — `buildProductBlock()`'s "Not the hero of the shot" line replaced with explicit visual-focus language; full `SCENE_BLOCK` rewritten (kept the four scene settings, sharpened the head-to-toe rule, added a "VISUAL FOCUS — PRODUCT FIRST" rule, reserved the old foot-as-punchline beat for product-free posts only); "THE PROPRIETOR'S TEST" failure example updated; `imageBriefInstruction` ternary (both the edition-vignette and fallback paths) updated to match, plus an explicit head-to-toe instruction and a new REJECTED-without-appeal case for the product being reduced to background dressing.
- `node --check` passed. Committed `79964fd3` via `commit_changes`, pushed to `preview/full-site`. Not yet verified against a real generated brief (next real post is the actual test).
- Separately, Big D started TikTok's Content Posting API application. Drafted answers for: organization info, the App ID pointer (told him to copy `TIKTOK_CLIENT_KEY` from `.env` himself — value never printed), the integration goal/benefit (ties to the existing automated multi-platform pipeline; TikTok is the one platform still requiring manual draft-finish), daily publishing users (**1** — single-brand account, not multi-tenant), and which API response fields get stored (`access_token`/`refresh_token`/`open_id`/`scope`/`expires_in`/`refresh_expires_in` in `config/tiktok-token.json`, plus `publish_id`/`status` — confirmed by reading `tiktok-auth.js`/`tiktok-post.js` directly rather than guessing).
- The application then asked for a screen recording proving: (1) the TikTok auth flow, (2) the flow to an "Export/Post-to-TikTok page" in BSV's own app, (3) what happens after triggering it. Investigated and confirmed no such page existed — TikTok posting has only ever been a CLI script (`tiktok-post.js`), never a UI control. Big D chose to build the real page rather than submit a recording of the manual TikTok-app draft-finish flow (which doesn't satisfy requirement 2 either way, and risks an easy reject).
- Confirmed the dashboard's actual runtime first, since this matters: `next.config.js`'s `output: 'export'` only applies when Cloudflare's own build sets `CF_PAGES=1` — the dashboard runs as a normal Next server (`next dev`, kept alive by the `com.bsv.dashboard` launchd job), so real `route.ts` handlers with secrets work fine there, unlike the public marketing site.
- Built `app/dashboard/(protected)/tiktok/page.tsx` (lists any `posts/output/<slot>-youtube.mp4` — the only video variant the pipeline produces, tiktok has no resize variant of its own — with a per-slot "Post to TikTok" button and inline result message) and `app/api/dashboard/tiktok/post/route.ts` (NextAuth session-gated GET/POST; POST shells out to the existing `tiktok-post.js` via `spawnSync`, same pattern `distribute.js` already uses for `youtube-post.js`, rather than re-implementing the upload calls). Added a "TikTok" link to `DashboardNav.tsx`.
- Verified with `npx tsc --noEmit -p tsconfig.json` (whole-project type check) — zero errors.

**Decided / concluded:**
- The dashboard tree (`app/dashboard/`, `app/api/dashboard/`, `lib/dashboard/`, `components/dashboard/`) is gitignored by design and never goes through Cloudflare — saving to disk *is* the deploy, the launchd `next dev` job hot-reloads it. No commit was made (or needed) for the TikTok page/route/nav changes.
- The button currently posts to TikTok's draft/inbox endpoint only (`video.upload` scope, no audit needed) — clicking it does not publish live; Big D still finishes the draft in the TikTok app. That's intentional and matches the existing CLI behavior, just removes the terminal step.

**Files / artifacts touched:**
- `scripts/creative-agent.js` (preview/full-site, commit `79964fd3`)
- `logs/creative-directives.json` (local only — Drive copy not updated, see above)
- `app/dashboard/(protected)/tiktok/page.tsx` — new (gitignored, not committed)
- `app/api/dashboard/tiktok/post/route.ts` — new (gitignored, not committed)
- `components/dashboard/DashboardNav.tsx` — added TikTok nav link (gitignored, not committed)

**Open / follow-up:**
- Real video content needed to actually record the demo: four Veo-generated videos (`fri-am`, `fri-pm`, `sat-am`, `sat-pm`) are sitting in Drive's `Video Review/` folder awaiting Big D's approval — none have run through `resize-post.js`/`brand-video.js` into `posts/output/` yet, so the new TikTok dashboard page currently has nothing to list.
- Once a video is approved and lands in `posts/output/<slot>-youtube.mp4`, Big D needs to actually click through and record: TikTok's own auth/consent screen, the new `/dashboard/tiktok` page, and the result after clicking "Post to TikTok" — three separate MP4s (≤50MB each) per TikTok's submission requirements. Also still need to check TikTok's Content Sharing Guidelines page for UX compliance details before recording — not yet read.
- `creative-agent.js` fix is unverified against a real generated brief — confirm on the next real post once a product is assigned.
- Still open from before: `com.bsv.telegram-webhook` down (blocks Telegram approve/deny replies); fri-am/sat-am pipeline-state hold vs. standup "confirmed" discrepancy; Edition #1 still pending approval with no foot-care products.

## 2026-06-20 (later same day) — creative-agent.js fix verified live; video-gen.js dedup bug found the expensive way

**What happened:**
- Big D asked for a fresh video generated specifically to validate the `79964fd3` creative-agent.js fix, separate from the four pre-fix videos already sitting in Video Review.
- Confirmed via `read_log agent=media-director` that `gemini-bridge.js` is auto-chained from `media-director.js` (spawns it directly after brief generation, which in turn spawns `image-gen.js`) — no manual middle step needed, contrary to this session's earlier assumption. `run_media_director({day:'mon'})` was enough to drive the whole brief→prompt chain.
- Checked `get_pipeline_state` first — `mon`/`tue`/`wed`/`thu` were completely untouched (only fri/sat/sun had any slot history), so `mon` was picked specifically to avoid colliding with the four pending approvals.
- Ran `run_media_director({day:'mon'})`. Verified via `get_slot_brief` for both `mon-am` and `mon-pm` that the fix is working as intended in real output: full head-to-toe composition, product description explicitly anchored as "where the eye lands first" / "clearly the object of the shot," feet present but called out as incidental ("not competing with the wallet for attention"). This is the first real confirmation the fix holds.
- Ran `run_video_gen` to generate the actual clips. **Bug found:** it doesn't just pick up the day just generated — it scans every `*-flow-prompt.txt` sitting in Drive's "Ready to Post," and its only dedup guard checks whether `{slot}.mp4` already exists back in *Ready to Post* (not in *Video Review*, which is where it actually stages output pending approval). Since the four pre-fix videos (fri-am, sat-am, sun-am, sun-pm — not fri-pm/sat-pm as an earlier session summary had it; that detail was stale) were already staged to Video Review but never moved back to Ready to Post, their flow-prompts were still sitting there unconsumed. Result: one `run_video_gen` call generated **6** videos, not 2 — fri-am, mon-am, mon-pm, sat-am, sun-am, sun-pm, in that order, each staged to Video Review with its own Telegram approve/deny ping.
- Cost impact: 6 clips × ~7-8s × $0.15/sec ≈ $6-7 against a $25 balance (per `get_cost_state` at session start) — not damaging, but 4 of those 6 ($4-5) bought nothing useful: fri-am/sat-am/sun-am/sun-pm were already either pre-fix or already-pending content, just re-rendered.

**Decided / concluded:**
- `mon-am.mp4` (1950KB) and `mon-pm.mp4` (2067KB) are the real validation artifacts — confirmed staged to Video Review successfully.
- Flagged to Big D: deny the fri-am/sat-am/sun-am/sun-pm re-renders from this batch when their Telegram pings arrive — they're redundant with whatever was already in front of him for those slots, not new signal.
- **Real bug, not yet fixed:** `video-gen.js`'s dedup check (`alreadyInDrive` in the main loop) should check Video Review for an existing `{slot}.mp4`, not Ready to Post — or the flow-prompt should get deleted/archived from Ready to Post once consumed, win or lose. Either fix prevents this from happening again. Flagging here rather than fixing live mid-session since it touches the paid-generation path — wants Big D's sign-off on the approach first.

**Open / follow-up:**
- Fix `video-gen.js` dedup logic (check Video Review, or clean up consumed prompts) — not yet done, needs Big D's go-ahead on approach.
- Big D to deny the 4 redundant re-renders (fri-am, sat-am, sun-am, sun-pm) from this batch via Telegram once pings land.
- TikTok demo recording (task still open) now has real candidate footage once `mon-am`/`mon-pm` are approved and run through `resize-post.js`/`brand-video.js` into `posts/output/`.

## 2026-06-20 (same day, cont.) — telegram-webhook.js: video-gate approve/reject actually does something now

**What happened:**
- Tracing the dedup bug above led to a second, more serious finding: replying APPROVE or DENY to a video-gate Telegram alert did nothing useful at all. Root cause, confirmed by reading the code directly (not guessed): `video-gen.js`'s `addPendingItem` call nests the Drive path under `metadata.driveFile`, but every other gate type — and `telegram-webhook.js`'s generic APPROVE/REJECT/SKIP/EDIT handlers — read a top-level `item.driveFile`, which `telegram-queue.js`'s `addPendingItem` sets explicitly from `item.driveFile` (confirmed in `telegram-queue.js:45`). For video-gate items that field was simply `undefined`. `writeDecisionToDrive()` does `path.join(tmpDir, driveFile)` *outside* its own try/catch, so this threw — caught one level up by `processMessage`'s caller, so the bot didn't crash, but Big D got an "Error processing message" reply and the item stayed stuck in the queue.
- Deeper issue under that: even with the field-name fixed, the generic decision-file flow (`writeDecisionToDrive` → Drive `Inbox/{file}` → some later script's `readDecisionFromDrive`) has no consumer for `video-gate` at all — nothing was ever written to read that decision back and act on the actual mp4 sitting in `Video Review/`. `watch-drive.js` only watches `Ready to Post`, never `Video Review`. So the loop was open at both ends regardless of the field-name bug.
- Also: `DENY` was never a recognized command — only `FIX, APPROVE, REJECT, SKIP, LATER, EDIT` matched. video-gen.js's own Telegram message text ("Reply `approve` or `deny`") was promising a command the bot didn't understand.
- Fixed in `scripts/telegram-webhook.js` (no changes needed in `video-gen.js` — its existing `metadata.driveFile` is exactly what's needed): added a `video-gate`-specific branch alongside the existing `content-gate` special case, bypassing the broken/consumer-less decision-file round-trip entirely. APPROVE/FIX now calls a new `approveVideo()` helper that `rclone moveto`s the file straight from `Video Review/` into `Ready to Post/` — so it enters the normal `resize-post.js → brand-video.js → distribute.js` chain on the next 15-min `watch-drive.js` poll. REJECT now calls a new `rejectVideo()` helper that `rclone deletefile`s it from `Video Review/` outright — matching the behavior the Telegram message already promised. Added `DENY` as a recognized synonym for `REJECT`. Both new handlers return a clear error and leave the item in the queue (so Big D can just retry) if the rclone call itself fails, rather than silently dropping it. Also guarded `SKIP`/`EDIT` against the same crash for video-gate items (no decision-file write attempted, since nothing reads it).
- `node --check scripts/telegram-webhook.js` passed.

**Decided / concluded:**
- Real behavior change Big D should know before using it: REJECT/DENY on a video now **permanently deletes the mp4 from Drive**, not just dismisses a Telegram notification. This matches what the bot's own prompt text always claimed, but is new actual behavior.
- Still blocked on the separately-known issue: `com.bsv.telegram-webhook` (the inbound listener) is down, so none of this takes effect until it's restarted (`launchctl kickstart -k gui/$(id -u)/com.bsv.telegram-webhook`, or via Drive drag-and-drop in the meantime).
- Did not touch the `video-gen.js` dedup bug (logged separately above) in this pass — kept this fix scoped to the approval round-trip only, per what Big D asked to have fixed.

**Files / artifacts touched:**
- `scripts/telegram-webhook.js` (preview/full-site)

**Open / follow-up:**
- Restart `com.bsv.telegram-webhook` before this fix has any live effect.
- `video-gen.js` dedup bug (checks Ready to Post instead of Video Review for already-generated output) still open.
- Once restarted, confirm live: APPROVE on a real video-gate item actually lands the file in Ready to Post and flows through to `posts/output/`.

## 2026-06-20 — Dashboard "Video Review" page: approve/deny videos with no Telegram, no terminal, no Drive drag-and-drop

Big D asked for a TikTok approval/deny control on the dashboard, specifically so he could record himself using it for the TikTok Content Posting API demo video. He'd already said earlier in this session "im not running code" and declined to restart `com.bsv.telegram-webhook` by hand — so the Telegram fix above, while correct, isn't a path he wants to use. The dashboard (always-on `next dev` via launchd) is the one surface that's both no-code for him and already live.

**What happened:**
- Confirmed `/dashboard/tiktok` (existing page) only ever lists/posts already-finished `posts/output/*-youtube.mp4` — it had no way to get a video out of Drive's `Video Review` staging folder in the first place. That gap is what this closes.
- Extracted `approveVideo`/`rejectVideo` out of `telegram-webhook.js` into a new shared module, `scripts/video-gate-actions.js` — same `rclone moveto` (approve → `Ready to Post`) / `rclone deletefile` (deny) logic, now in one place instead of two copies that could drift. `telegram-webhook.js` now requires it instead of defining its own.
- Added `scripts/video-gate-action.js`, a thin CLI wrapper (`--approve "Video Review/x.mp4"` / `--deny "..."`) so the dashboard can shell out via `spawnSync` rather than `require()`-ing a CommonJS script into the Next.js bundle — matches the existing pattern `tiktok/post/route.ts` already uses for `tiktok-post.js`.
- New dashboard page `/dashboard/video-review` (`app/dashboard/(protected)/video-review/page.tsx`, gitignored) lists every pending `video-gate` item straight from `logs/telegram-pending.json` — the same queue Telegram reads — with an inline `<video>` preview per item (streamed live from Drive via a new `GET /api/dashboard/video-review/preview?id=...` route, no temp files) and APPROVE/DENY buttons.
- New API route `app/api/dashboard/video-review/route.ts` (gitignored): `GET` lists pending video-gate items, `POST {id, action}` looks up the item's `driveFile` server-side (never trusts a path from the client) and calls `video-gate-action.js`. On success it removes the item from `telegram-pending.json` — so approving/denying on the dashboard also clears it from Telegram's queue, and vice versa once the listener is back up. Added "Video Review" to the dashboard nav, between Product Queue and TikTok.
- `npx tsc --noEmit` passed clean across the whole project. `node --check` passed on both new scripts.
- Committed `scripts/telegram-webhook.js`, `scripts/video-gate-actions.js`, `scripts/video-gate-action.js` only (dashboard `app/`/`components/` files are gitignored by design — saving to disk is the deploy) — commit `39f04a77`, pushed to `preview/full-site`.

**Decided / concluded:**
- This is now the primary approve/deny surface — no terminal, no Telegram listener dependency. Drive drag-and-drop still works as a fallback; Telegram will work too once `com.bsv.telegram-webhook` is restarted, and both share the same underlying queue file so they can't go out of sync with the dashboard.
- DENY on the dashboard permanently deletes the mp4 from Drive, same real behavior as Telegram REJECT/DENY — same caution applies.

**Files / artifacts touched:**
- `scripts/video-gate-actions.js` (new, committed)
- `scripts/video-gate-action.js` (new, committed)
- `scripts/telegram-webhook.js` (refactored to use the shared module, committed)
- `app/api/dashboard/video-review/route.ts` (new, gitignored)
- `app/api/dashboard/video-review/preview/route.ts` (new, gitignored)
- `app/dashboard/(protected)/video-review/page.tsx` (new, gitignored)
- `components/dashboard/DashboardNav.tsx` (nav link added, gitignored)

**Open / follow-up:**
- mon-am.mp4 / mon-pm.mp4 (the post-fix videos) and the four stale duplicates (fri-am, sat-am, sun-am, sun-pm) are still sitting in `Video Review` — first real-world use of this page.
- `video-gen.js` dedup bug (still open, logged above) will keep regenerating unapproved videos on every `run_video_gen` call until fixed — not in scope for this pass.
- Big D wants to record the TikTok demo using this flow next.

## 2026-06-28 — Root-caused why cost alerts never fire: two fake Anthropic endpoints, always 404

Big D: "we ran out of tokens and it has been refreshed, but again cost is not showing up any alerts" — same complaint class as 2026-06-16, after two prior fixes (orphaned launchd job; eng-bot dedup) already landed for that incident.

**What happened:**
- `logs/cost-report.log` looked empty (0 bytes), suggesting the script wasn't running — same masking pattern as 6/16's `log-rotate.js` truncation. Checked the rotated `.log.1`/`.log.2` backups instead and found the script running fine, every cycle.
- Real finding, one layer deeper than either 6/16 fix: `fetchAnthropicUsage()`'s `/v1/usage` call and `fetchAnthropicBalance()`'s `/v1/billing/credit_balance` call both 404 every time (confirmed in the rotated logs: "Anthropic Usage API: 404", "Credit balance API: 404"). Confirmed via official docs (platform.claude.com/docs) that **neither endpoint exists** — there is no live/real-time balance API at all for a regular `ANTHROPIC_API_KEY`. Real cost data requires a separate **Admin API key** (`sk-ant-admin01-...`) hitting `/v1/organizations/cost_report` and `/v1/organizations/usage_report/messages`. Both calls were silently falling back to a static `.env` number and a hardcoded $0 burn, so the alert thresholds could never mathematically trigger — root cause of "no alert ever fires," not a regression, a design gap baked in since the original script was written.
- Asked Big D how to fix it; he chose **Admin key + real cost tracking**.

**Fix applied (`scripts/cost-report.js`):**
- Added `fetchCostReportTotal(startDate, endDate)` — calls the real `cost_report` endpoint (Admin-key-gated via `ANTHROPIC_ADMIN_API_KEY`; returns `null` immediately if the key isn't set), plus `sumCostReportTotal(data)`, a defensive parser that tries several plausible response shapes and explicitly returns `null` (never `0`) on anything unrecognized, logging the raw response for inspection. Deliberate: the original bug was a silent-fallback-to-fake-value, so the replacement must never repeat that pattern.
- Rewrote `fetchAnthropicBalance()` to stop calling the fake balance endpoint entirely. New model: balance = `ANTHROPIC_CREDIT_BALANCE` (last topup amount) minus real spend since `ANTHROPIC_CREDIT_TOPUP_DATE`, computed via `fetchCostReportTotal`. Falls back to the static topup number (old behavior) if either env var is missing or the API call fails — same graceful-degradation shape as before, just now backed by real data when available.
- `fetchBurnHistory()` and `summarise()` both try the real Cost Report API first, fall back to the old token-estimate path if it returns `null`.
- Added `balance_source` field to `logs/cost-state.json` (`'static env (no ANTHROPIC_ADMIN_API_KEY)'` / `'static env (no ANTHROPIC_CREDIT_TOPUP_DATE)'` / `'computed (topup − real spend via Cost Report API)'`) — so any future silent degradation back to fake/static is visible in the state file itself, not just in logs.
- **Unverified, flagged in code comments:** exact JSON field names for `cost_report` responses couldn't be confirmed — the API reference page is client-rendered and neither `web_fetch` nor Claude in Chrome (not connected) could render it. `sumCostReportTotal()` is defensive against this, but needs a live check against the real response shape once the Admin key is added.
- `node --check` passed. `run_diagnostic('cost-report')` ran clean end-to-end on the real machine, identical graceful-fallback behavior confirmed (no regression with the Admin key still absent).
- Committed `a3b0d861` (scoped to `scripts/cost-report.js` only, not bundled with unrelated pipeline churn already sitting in the tree), pushed to `preview/full-site` — confirmed via `origin/preview/full-site` log showing it at HEAD.

**Decided / concluded:**
- This is the third layer of the same incident class: 6/16 was "script not running," 6/17 was "eng-bot shouldn't diagnose its own billing outage," 6/28 is "the script runs but its only two data sources never worked, ever." All three are now closed for different reasons; this one needed a real credential, not just code.

**Open / follow-up — needs Big D, can't be done by Claude (never writes `.env`):**
- Add `ANTHROPIC_ADMIN_API_KEY=sk-ant-admin01-...` to `.env` — create via Anthropic Console → Settings → Organization → API Keys → Create Admin Key.
- Add `ANTHROPIC_CREDIT_TOPUP_DATE=<ISO date of most recent topup>` to `.env`.
- Going forward, keep `ANTHROPIC_CREDIT_BALANCE` set to the actual topup amount each time credit is added, paired with an updated `ANTHROPIC_CREDIT_TOPUP_DATE`.
- Once the Admin key is live, re-run `run_diagnostic('cost-report')` to see the real `cost_report` response and verify/adjust `sumCostReportTotal()`'s field-name assumptions against the live shape (flagged in code).

## 2026-06-28 (same day, cont.) — Admin key verified live; two real bugs found and fixed

Big D added `ANTHROPIC_ADMIN_API_KEY` to `.env` (confirmed present + correctly prefixed `sk-ant-admin01-` by checking the prefix only, never the full value). Re-ran `run_diagnostic('cost-report')` to verify the real response shape per the open follow-up above — surfaced two real bugs the first pass's defensive coding had not anticipated:

1. **`sumCostReportTotal()` returned `null` for legitimately-empty results.** Live response shape confirmed: `{"data":[{"starting_at":"...","ending_at":"...","results":[]}],"has_more":false,"next_page":null}` — the guessed `data[].results[]` shape was correct, but an empty `results: []` (meaning $0 spend that bucket — a perfectly valid response) was being treated as "shape not recognized" and returned `null` instead of `0`. This broke `fetchBurnHistory()` entirely — every per-day query came back empty (genuinely $0, most likely because the pipeline was credit-blocked those exact days per Big D's "ran out of tokens" report) and the parser's null-on-empty bug made all 3 days register as "unavailable" instead of "$0.00." Fixed: now tracks shape-recognition separately from the running total, so a well-formed-but-empty bucket correctly contributes $0.
2. **`fetchAnthropicBalance()`'s spend-since-topup call requested a future end date — would always 400.** It built `ending_at` from tomorrow's date (`Date.now() + 86400_000`). Confirmed live: the Cost Report API rejects any `ending_at` in the future with `400 — "ending date must be after starting date"` (a generic-sounding message for what's actually a future-date rejection). This was the core mechanism of the fix Big D asked for — it would have silently 400'd on every run and permanently fallen back to the static topup number, defeating the whole point. Fixed: now uses today's date as the end bound (same proven pattern Week/Month already use successfully), accepting the same minor, disclosed tradeoff — spend-since-topup lags by up to ~1 day (excludes today specifically) — rather than risk unverified sub-day timestamp behavior against the live API.
3. Also fixed the noisy log line this same root cause was producing for the "Today" window in `summarise()`: it requests `[today, tomorrow)`, which structurally always has a future `ending_at` until the day is over, so it was 400ing every single run. Now skipped intentionally — goes straight to the existing log-estimate fallback for that window only, with a log message naming the real reason ("Cost Report API has no data for the current, still-in-progress day") instead of the misleading "Admin key not set or call failed."

**Verified live (`run_diagnostic('cost-report')`, second pass):** no more 400s. `Burn history (3d): 2026-06-25=$0.0000, 2026-06-26=$0.0000, 2026-06-27=$0.0000` — correctly showing $0 instead of "unavailable." Week ($2.8548) and Month ($34.2325) real-$ totals unchanged and still working. `node --check` passed. Committed `23608784`, pushed to `preview/full-site` — confirmed via `origin/preview/full-site` log.

**Decided / concluded:**
- The Admin key path is now genuinely live and verified against real responses, not just defensively coded against guesses — this closes the "unverified field names" caveat from the first pass.
- Inner `results[].amount` field name is still technically unverified against a non-empty array (everything seen so far has been $0 buckets) — worth a final spot-check once a day shows real per-day spend, but low risk since the outer shape (the part that mattered for the two real bugs above) is now confirmed correct.
- Week/Month/balance-since-topup all share the same disclosed ~1-day lag (exclude today specifically) by design — a deliberate, safe tradeoff over guessing at sub-day timestamp granularity the API hasn't been confirmed to accept.

**Open / follow-up:**
- Big D still needs to add `ANTHROPIC_CREDIT_TOPUP_DATE` to `.env` for the computed-balance path to activate (currently still falling back to the static `$25.00` env snapshot, correctly logged as such).

## 2026-06-28 (same day, cont. 2) — Third bug found (same-day topup edge case); .env duplicate key flagged

Big D added `ANTHROPIC_CREDIT_TOPUP_DATE=2026-06-28` to `.env`, plus a new `ANTHROPIC_CREDIT_BALANCE=18.90` line — but the original `ANTHROPIC_CREDIT_BALANCE=25.00` line (added during the first pass) was never removed, so `.env` now has the same key defined twice (line 42 = 25.00, line 54 = 18.90). dotenv's parser takes the last occurrence in the file, so 18.90 is the value actually in effect — confirmed live in the diagnostic run below. Flagged to Big D to delete the stale line 42 himself (never written by Claude, per hard rule) before it causes confusion later. Also flagged as open: unclear whether 18.90 represents the topup amount itself or the Console's current balance already net of some of today's spend — matters because of the ~1-day lag tradeoff (see below); if today's pre-existing spend gets recorded by the Cost Report after the lag resolves, it would be subtracted a second time from 18.90, drifting the computed balance low. Needs Big D to confirm.

Re-ran `run_diagnostic('cost-report')` to verify the computed-balance path end to end now that both required `.env` vars are present — surfaced a third bug:

**`fetchAnthropicBalance()`'s spend-since-topup call 400'd when `topupDate` is today.** Same family as bug 2 from the prior entry (future `ending_at` rejected) but a different trigger: with `topupDate = 2026-06-28` and the end bound also `isoDate(new Date())` = `2026-06-28`, `starting_at === ending_at` — the API rejects equal dates too (`400 — "ending_at must be after starting_at"`), not just strictly-future ones. No completed day exists yet for a same-day topup to query. Fixed: added a guard — when `topupDate >= today`, skip the live call and return the static topup amount directly, logged as `"topup was today, 2026-06-28 — no elapsed day to query yet, assuming $0 spend since"`. This assumption is true at the instant of topup; real spend will be subtracted starting tomorrow once today has fully elapsed, same lag pattern as Week/Month/Today elsewhere in the script.

**Verified live (`run_diagnostic('cost-report')`, third pass):** no 400s anywhere in the run. `Credit balance: $18.90 (topup was today, 2026-06-28 — no elapsed day to query yet, assuming $0 spend since)`. `node --check` passed. Committed `cae35b14`, pushed to `preview/full-site` — confirmed via `origin/preview/full-site` log.

**Decided / concluded:**
- Three bugs found across two verification passes, all in the same family (the Cost Report API's date-range validation is stricter than assumed — rejects both future and equal `ending_at`, not just literal start>end ordering). Each was only found by running against the live API with a real Admin key, not by code review — reinforces that defensive parsing against guessed API shapes is not a substitute for live verification.
- The computed-balance mechanism Big D asked for is now live and bug-free for the cases exercised so far (no topup date, topup in the past, topup today). Will self-correct starting tomorrow once today's spend is a completed, queryable day.

**Open / follow-up:**
- Big D to delete the stale `ANTHROPIC_CREDIT_BALANCE=25.00` line (line 42) from `.env` and confirm whether `18.90` is the topup amount or current balance net of today's usage.
- Inner `results[].amount` field name still unverified against a non-empty result set — same caveat as before, still no day with real recorded spend observed.
- Spot-check `results[].amount` field name once a real (non-zero) day appears in burn history.

## 2026-06-28 (same day, cont. 3) — Dashboard "not updating" ruled out as a bug; creative-agent SCENE_BLOCK root-caused and fixed

**Dashboard:** Big D felt the ops dashboard wasn't updating. Checked the full chain: `overview`/`queue` pages both have `dynamic = 'force-dynamic'` + `revalidate = 0`; every `/api/dashboard/*` route uses `getServerSession` (forces dynamic automatically); `state-adapter.ts` does plain uncached `fs.readFileSync` on every call. No staleness anywhere server-side. Real gap: no client-side polling/SWR/`setInterval` on `overview`/`queue`/approvals/feed/cost — only `video-review` and `tiktok` pages have it. So data is fresh on load, it just never refreshes itself while a tab sits open. Asked Big D if he wanted auto-refresh added — **he said no, just tell him to refresh manually.** No dashboard code touched. Do not add polling here unless he raises it again himself.

**Creative imagery ("generalized leather, shoeless men, not saying anything about our products"):** Third time this exact complaint has surfaced (06-13, 06-20, 06-28) despite two prior `learn.js`-style corrections already targeting it. Recorded a third, sharper correction directly into `logs/creative-directives.json` (effective immediately — could not push the `BSV-Directive.md` mirror to Drive from the sandbox, no `rclone`; Big D needs to add that line to the Drive doc himself or run `learn.js` for the Drive half only, not the json half, to avoid a duplicate entry). But rather than stop at a third directive, traced why the first two didn't fully stick:

- `media-director.js`'s product-assignment chain (`assignProductToSlot` → `loadShelfProducts()` → `scripts/data/shelf-products.json`, falling back to the Sheet) is fine — the shelf file is populated (real products, not empty), ruling out "no product ever gets assigned" as the cause.
- Real root cause: `creative-agent.js`'s `SCENE_BLOCK` forced every brief — product assigned or not — to pick one of four hardcoded canonical scenes (TRANSITION/ATHLETE/CHEF/INTIMATE), each scene's own text built around generic furniture and explicitly "shoe coming off" as the literal anchor. The "product is the focus" instruction was a short qualifier layered on top of that, competing against much more vivid, specific, hardcoded scene language — so briefs kept reading as generic leather-chair/shoeless-men shots with the product mentioned in passing, even after two corrections asking for the opposite.

**Fix (`scripts/creative-agent.js`, commit `a6f2c450`):** `SCENE_BLOCK` → `buildSceneBlock(product)`. When no product is assigned, behavior is unchanged — still picks one of the four canonical scenes. When a product **is** assigned, the four scenes become mood/lighting reference only; the model is instructed to build a custom setting around that product's own category/narrative (mirror/sink for skincare, getting dressed for fragrance, etc.) instead of defaulting to the four scenes' furniture. Also made `imageBriefInstruction`'s "name the canonical scene" line and its REJECTED clause product-aware, and added an explicit rejection condition for "setting defaulting to a generic leather-chair/locker-room/kitchen/couch template with no real connection to this product's story."

Verified: `node --check` clean; isolated `buildSceneBlock()` eval against a real shelf product (Brickell face wash) confirms the product branch produces a mirror/sink-appropriate custom-scene instruction, and the no-product branch is byte-identical in behavior to the prior template. Committed + pushed to `preview/full-site`.

**Decided / concluded:**
- This complaint needed a structural prompt fix, not a third near-duplicate directive bullet — the generic scene templates were winning over the directive text by sheer specificity/vividness. Logged this reasoning so a future session doesn't repeat "just add another correction note" if the symptom resurfaces again.

**Open / follow-up:**
- Watch the next batch of generated briefs for product-assigned slots — confirm the custom-scene behavior holds up over multiple products/categories, not just the one tested locally.
- Big D: mirror the 06-28 correction text into `BSV-Directive.md` on Drive if you want other agents reading that doc to see it (sandbox has no `rclone`).

## 2026-06-28 (same day, cont. 4) — Git working-tree cleanup: 6 commits, tree now clean

Big D asked to clean up the large uncommitted/untracked pile flagged earlier this session. Investigated each category before touching anything, then committed in scoped batches (all pushed to `preview/full-site`):

1. **`10302a1e`** — 15 files that had **zero git history on any branch, ever**: `scripts/learn.js`, `edition-agent.js`, `push-to-main.js`, `push-preview.js`, `clear-git-lock.js`, `data/shelf-products.json` (the live product pool `media-director.js` rotates through), `config/com.bsv.edition-agent.plist`, `.github/workflows/main-push-alert.yml`, plus 7 utility/audit scripts (`_audit-foot-care-coverage.js`, `_audit-pending-foot-narratives.js`, `check-sheet-dupes.js`, `gen-crawl-images.js`, `generate-locker-image.js`, `resolve-spongelle-tier.js`, `update-spongelle-link.js`). Several of these are named directly in CLAUDE.md as the sanctioned tools (`push-to-main.js` especially) — they only existed on this machine until now. Scanned all of them for secret-shaped strings first (`sk-ant-`, `AIza`, `ya29.`, PEM headers, Slack tokens) — none found.
2. **Real finding inside that batch:** `.github/workflows/main-push-alert.yml` — a Telegram alert meant to fire on every push to `main` — has never actually been live, because `.github/` was never pushed to GitHub. There has been no server-side tripwire on `main` this whole time, only the `push_to_main` MCP tool's fast-forward-only git safety. Committing it is necessary but not sufficient: `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` still need to be added as **GitHub repo secrets** (Settings → Secrets → Actions on github.com/bigsolevibes/bigsolevibes) — separate from `.env` — before it'll actually send anything. Flagged to Big D, not yet done.
3. **`fb9a243a`** — gitignored `*.bak`, `*.tmp`, `tsconfig.tsbuildinfo`.
4. **`445e8073`** — found and fixed a real gitignore bug: `app/api/auth/[...nextauth]/` was never actually being ignored. Square brackets are a glob character class in gitignore syntax, so the literal directory name never matched — confirmed via `git check-ignore` returning exit 1 despite the rule's clear intent (and a comment claiming it was deliberate). It's been showing as untracked noise since whenever that line was first written. Escaped to `app/api/auth/\[...nextauth\]/`, re-verified with `git check-ignore` (now matches). Also gitignored `posts/output/` — the local pre-mirror staging copy CLAUDE.md describes as redundant with `public/posts/output/`, same category as `logs/`.
5. **`322e0b13`** — `BSV-Start-Here.md` had zero git history too — step 1 of the Pre-Session Protocol, read every session, was never backed up.
6. **`bd3a3935`** — one-time snapshot of accumulated pipeline-output drift: 28 new Bluesky image variants + 56 refreshed instagram/youtube/flow renders across all 14 slots, plus routine `org-chart.html`/`BSV-Directive.md`/`affiliate-overrides.json` regeneration. Root cause of the drift: `resize-post.js` currently has **zero** git/push logic in it (grepped, confirmed) despite CLAUDE.md's "Key Scripts" table still describing it as auto-pushing to `preview/full-site`. That doc line is stale. This commit just clears the existing backlog — it does not fix the underlying gap, so the same drift will reaccumulate on the next pipeline run.

**Verified:** `git status` clean after the final commit; all 6 commits pushed and confirmed present in `origin/preview/full-site`'s log.

**Decided / concluded:**
- Two real, previously-invisible bugs surfaced purely from doing the cleanup, not from being asked to look for them: the never-armed main-push Telegram alert, and the broken gitignore bracket pattern. Worth noting since neither would have been caught by reading CLAUDE.md alone — both required actually running `git check-ignore`/`git log --all` against the real working tree.

**Open / follow-up:**
- Big D: add `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` as GitHub repo secrets so `main-push-alert.yml` actually fires.
- ~~Decide whether `resize-post.js`'s auto-push should be restored...~~ — **resolved same day, see below.**

## 2026-06-28 (same day, cont. 5) — Correction: resize-post.js not pushing is by design, not a gap. bd3a3935 partially reverted.

Big D said "yes lets fix" to the open item above (restore resize-post.js's git push). Before writing that code, ran `git log --follow -- scripts/resize-post.js` to find the right insertion point and hook into the existing convention — and found the push logic wasn't missing by accident. **Commit `495addb5` (2026-05-27): "fix: remove git push from resize-post — Drive/R2 are authoritative."** Big D removed it on purpose, with a prior Claude session, a month ago. Reasoning holds up: Drive holds source assets, Cloudflare R2 serves the public Instagram URL, and `distribute.js` posts from local disk + R2 — git never needed to carry this binary media.

Also found `git-push-guard.js` has a fully-built but completely dead `safePushToPipeline()` function (targets a `media-cache` branch via throwaway worktree + cherry-pick, specifically so media commits never touch `preview/full-site` or trigger Cloudflare) — header comment says "Used by resize-post only," with real commit history on `origin/media-cache` through 2026-05-27, the same day it was unwired. Confirmed via grep across the whole repo: zero current callers. Dead code, not a missing wire-up worth restoring — would need testing from scratch and the simpler fix (don't track media in git at all) already works by design.

**So the earlier framing was wrong** — I called this "the underlying gap" in the prior entry; it's actually a deliberate architecture decision that CLAUDE.md's docs just hadn't caught up to. Corrected:
- CLAUDE.md's Key Scripts table and Known Issues section both updated to reflect that this is intentional, with the commit hash cited.
- This session's own `bd3a3935` commit (the "pipeline output snapshot," logged above) had re-added 84 of those media files to git, going directly against the May 27 decision — caught and partially reverted in `8eff212c`: `git rm --cached` on those same 84 files (kept on disk, just untracked again), plus extended `.gitignore` to cover `public/posts/output/` in addition to `posts/output/`. The other 3 files `bd3a3935` touched (`BSV-Directive.md`, `org-chart.html`, `affiliate-overrides.json`) were left committed — legitimate routine state syncs, unrelated to the media question.

**Decided / concluded:**
- "Drive/R2 are authoritative" for processed media is the standing policy — don't re-suggest restoring git push/tracking for `posts/output/` or `public/posts/output/` in future sessions.
- Worth the general lesson: before treating an absence of expected logic as a bug, check `git log --follow` on the file first. This is the second time this session that move surfaced the real story (first was the `[...nextauth]` gitignore bug, which actually *was* a bug — this one wasn't).

**Open / follow-up:**
- `safePushToPipeline()`/`media-cache` branch: confirmed dead code. No action taken — flagging only in case Big D wants it removed outright at some point (not done — no deletion without explicit say-so).
- `main-push-alert.yml` GitHub secrets still pending (see above, unchanged).

## 2026-06-28 (same day, cont. 6) — TikTok "approval button": not missing, just nothing flowing into it

Big D: "what happened to our tiktok approval button on the dashboard." Investigated rather than guessing:

- `app/dashboard/(protected)/tiktok/page.tsx` ("Post to TikTok" button) and `app/dashboard/(protected)/video-review/page.tsx` (APPROVE/DENY buttons, built 06-20 specifically for the TikTok demo recording — see that date's entry) both still exist on disk, code intact, nothing deleted. Both are gitignored by design (dashboard tree never goes through git/Cloudflare), so `git log` shows no history for either — expected, not a red flag.
- `com.bsv.dashboard` launchd job is up and healthy (PID 225, exit 0) — the dashboard itself isn't down.
- Root cause of the empty/missing-looking button: `posts/output/` currently has **zero `.mp4` files** — only image variants (`mon-am-bluesky.jpg` etc.). The TikTok page only lists `*-youtube.mp4` files, so with none present it correctly renders "No video ready yet," which reads as "the button is gone."
- Why no mp4s exist: confirmed via `logs/telegram-pending.json` (the same queue both Telegram and the Video Review dashboard page read) that **8 videos have been sitting unapproved in Drive's `Video Review` folder since 06-20**: `fri-am`, `fri-pm`, `mon-am`, `mon-pm`, `sat-am`, `sat-pm`, `sun-am`, `sun-pm`. None have been approved or denied in over a week, so none have moved to `Ready to Post` → none have run through `resize-post.js`/`brand-video.js` → none have landed in `posts/output/*-youtube.mp4`.
- Likely contributing factor: `com.bsv.telegram-webhook` (the other approve/deny path, via Telegram replies) is still down (confirmed again via `get_launchd_status` — last exit signal -15), and known per CLAUDE.md's Known Issues. The dashboard's own Video Review page was built as a no-Telegram-needed alternative path for exactly this scenario, but doesn't appear to have been used since the 06-20 test.
- Also reconfirmed: TikTok has never had a per-slot approve button in the main Approval Queue (`ApprovalQueue.tsx`, `lib/dashboard/types.ts`, `lib/dashboard/state-adapter.ts` — zero "tiktok" references in any of them) and is deliberately excluded from the automatic pipeline: `watch-drive.js`'s `SKIPPED_PLATFORMS = ['tiktok', 'youtube', 'twitter', 'facebook']` marks every slot's `tiktok` status `skipped`/`attempts:0` by design — TikTok posting is manual-only via the two dedicated dashboard pages above, never automatic.

**Decided / concluded:**
- No code is broken or missing — nothing fixed, nothing changed. Reported findings to Big D; the actual unblock is his call (approve/deny the 8 stuck videos via the dashboard's Video Review page, or restart `com.bsv.telegram-webhook` to use Telegram instead).

**Open / follow-up:**
- 8 videos awaiting approve/deny in Video Review since 06-20 (listed above) — Big D to action via `/dashboard/video-review`.
- `com.bsv.telegram-webhook` still down — `launchctl kickstart -k gui/$(id -u)/com.bsv.telegram-webhook` would restart it (no remote MCP path yet, per existing Known Issue).
- `logs/telegram-pending.json` has grown to 141KB / ~170 entries, many from early June (`eng` type) — likely never pruned after being actioned or going stale. Not touched this pass (no deletion without Big D's say-so), just flagging.

## 2026-06-28 (same day, cont. 7) — TikTok Direct Post audit requirements researched

Big D: "go to it" (research TikTok's Direct Post / `video.publish` audit requirements). Pulled TikTok's official Content Sharing Guidelines and App Review Guidelines directly rather than relying on secondhand summaries.

**Findings:**
- Submission needs: custom app name/icon not referencing TikTok, public website with visible Privacy Policy + ToS (already done, see 06-09 entry), correct redirect URI, a written explanation per scope, and 1–5 demo videos (≤50MB each) showing the live integration end-to-end in TikTok's sandbox — the domain shown in the video must match the registered website URL.
- The real gap is UX, not paperwork. Direct Post requires: a live `creator_info` lookup (show creator nickname, block posting if they can't post right now, check video duration against `max_video_post_duration_sec`), a Title field, a Privacy Status dropdown sourced from `privacy_level_options` with no default, ungated Allow Comment/Duet/Stitch checkboxes (off by default, greyed out if the creator disabled them), a Music Usage Confirmation consent line before the publish button, a Commercial Content Disclosure toggle (off by default, "Your Brand"/"Branded Content" options, branded content can't be paired with a private post), a content preview, and post-status polling. None of this exists in `tiktok-post.js`/`/dashboard/tiktok` — by design, since that code deliberately only uses the no-audit-needed inbox/draft endpoint.
- **Real conflict found:** TikTok's Watermark Guidelines explicitly forbid superimposing any brand logo/watermark on content posted via this API, citing content deletion/account suspension as the consequence. The `-youtube.mp4` file `tiktok-post.js` already uses (and any future Direct Post flow would reuse) has the BSV logo burned in via `brand-video.js`. This applies regardless of audit status — worth resolving before any further TikTok work.
- Reconfirmed unaudited-client interim limits: 5 users/24h cap, accounts must be private at post time, content posts `SELF_ONLY` until the account owner manually flips it public.

**Decided / concluded:** Pure research this pass — no code changed. Reported to Big D with the watermark conflict flagged as the standout finding; he hasn't yet said whether to build the Direct Post UI now or hold.

**Open / follow-up:**
- Decide whether to build the creator_info/title/privacy/disclosure UI now, and whether TikTok needs its own unbranded video render separate from the youtube-targeted one.
- Audit turnaround is typically 2–4 weeks with multiple feedback rounds once submitted — factor into any timeline.

## 2026-06-28 (same day, cont. 8) — Standup blocker alert was mostly false positives

An automated "CRITICAL: No bluesky/twitter image found in posts" blocker came through, bundled with warnings for backup-scripts, drive-sync, newsletter-agent, product-research, affiliate-scout, and telegram-webhook. Investigated each via live MCP tools instead of taking the alert at face value.

**Findings:**
- The CRITICAL item is a false alarm. `distribute.log` for `mon-pm` (posted ~50 min before the alert) shows `twitter: NOT FOUND` and `facebook: NOT FOUND` — exactly expected, since both sit in `PAUSED_PLATFORMS` and never get a rendered variant. Bluesky's image (`mon-pm-bluesky.jpg`) WAS found, and the post succeeded on both Instagram and Bluesky (`ok=2 failed=0`). Whatever generates these alerts appears to scan for "NOT FOUND" lines without checking which platforms are paused by design.
- The `drive-sync` warning cites a `2026/05/27` timestamp — a month-old log line. The live log shows drive-sync running cleanly every 5 minutes all night with zero errors. Stale, not current.
- `get_incident_status` itself returned two warnings as literal `undefined: undefined (NaNm ago)` — the same malformed-incident-data bug flagged on 06-07, still unfixed, and a likely contributor to noisy alerts like this one.
- `backup-scripts`'s cited error ("Service Accounts do not have storage quota") is a real, recognizable Google Drive API error (service accounts have 0 personal storage quota outside Shared Drives) — but it isn't in any current or rotated `backup-scripts*.log`, and there's no `com.bsv.backup-scripts` launchd job (it's installed under the older `com.bigsolevibes.backup-scripts` label, 3am daily, so `get_launchd_status` doesn't surface it). Couldn't confirm timing from here — flagged as plausible but unverified rather than chased further.
- `newsletter-agent`'s "KLAVIYO_FROM_EMAIL not set" is real and current — confirmed absent from `.env`.
- `telegram-webhook` "Poll error: fetch failed" matches the already-documented down state (exit signal -15) — not new.
- `affiliate-scout` (one brand homepage fetch failed) and `product-research` (one product search failed) are single-item flakiness in routine research loops, not pipeline blockers.

**Decided / concluded:** No code changed. Reported the one real, actionable item (KLAVIYO_FROM_EMAIL) to Big D and explained why the rest isn't.

**Open / follow-up:**
- Big D: add `KLAVIYO_FROM_EMAIL` to `.env`.
- The `undefined: undefined (NaNm ago)` incident-status bug (open since 06-07) is worth fixing — it's making genuine alerts harder to trust.
- backup-scripts' actual current health is unverified — worth a real check next time it's due to run (3am) rather than reasoning from absent logs.
- `commit_changes` timed out (`MCP error -32001`) on the first attempt to push this entry — same flakiness already seen on `run_diagnostic` earlier this session. Commit landed locally either way; preview/full-site had ~10 commits sitting unpushed to origin as a result (no impact — that branch doesn't trigger any deploy — but worth a clean push when the MCP server cooperates).

## 2026-06-28 (same day, cont. 9) — Found and fixed the actual dashboard-noise root cause

Big D: "well its noise on the dashboard... can it be cleared?" then "yes" to fixing the underlying generator + `get_incident_status`, rather than just clearing whatever was on screen. Traced the literal source instead of guessing — investigated `PAUSED_PLATFORMS`/timestamp-parsing theories first and ruled both out before finding the real cause.

**Root cause:** `lib/dashboard/state-adapter.ts`'s `getLatestStandup()` (feeds `BlockersPanel.tsx`'s WHAT/WHY/IMPACT/DECISION cards) reads the newest `logs/standup-*.txt` by filename sort. The retired standup generator (`sole-report-agent.js.retired`, numbered-section format `*8 — BLOCKERS*` with 🔴 CRITICAL / 🟡 WARNINGS / 🟢 resolved) wrote that file daily until `chief-of-staff.js` replaced it — but the replacement never wrote a local `logs/*.txt` copy, only a Drive upload (`.md`) and a `~/tmp/bsv-chief-of-staff/` local copy. Nothing has written `logs/standup-*.txt` since **2026-05-29**. The dashboard has been serving that exact one-month-old file as "today's blockers" the entire time — confirmed line-for-line: `🔴 distribute: No bluesky/twitter image found in .../posts` (the literal CRITICAL alert text) is line 60 of `logs/standup-2026-05-29.txt`, verbatim. Every other item in the prior entry's "false positive" batch (drive-sync, backup-scripts, affiliate-scout, product-research, telegram-webhook) is also sitting in that same frozen file.

**Fixes (committed `7f5edd2a`, pushed to `preview/full-site`):**
- `scripts/chief-of-staff.js` — now writes a local `logs/standup-${DATE}.txt` snapshot every run (revenue/posts/audience/agents + a `*BLOCKERS*` section, last, "No blockers." when clean) so `getLatestStandup()` always has today's real data going forward.
- `lib/dashboard/state-adapter.ts` (gitignored, local-only, not in the commit) — `getLatestStandup()` now returns `null` if the newest standup file's mtime is >36h old, instead of surfacing a frozen snapshot as current. Defense-in-depth so this exact failure mode (silent staleness, no error, just stale-forever) can't recur unnoticed if the writer ever breaks again.
- `scripts/mcp-server.js` `get_incident_status` — fixed the schema mismatch: it expected `{ts,agent,msg,level,resolved}` per entry, but `eng-bot.js`'s real `eng-seen.json` shape is `{baselineAt, hashes:{hash:firstSeenTimestamp}}` with no per-entry message/level/resolved data at all. That mismatch was the literal source of the `undefined: undefined (NaNm ago)` bug (open since 06-07). Rewrote it to report what's actually stored — tracked-signature count, baseline time, first-seen age per hash — rather than fabricating fields. This tool isn't what feeds the dashboard panel (confirmed separately), so it doesn't change what Big D sees on screen, but it was real breakage and approved to fix.
- Verified via `node --check` (both `.js` files), `tsc --noEmit` (clean, whole project), and standalone logic simulations of both the snapshot producer/consumer contract and the incident-status formatter — not via a live `chief-of-staff.js` run, since that has real side effects (Telegram sends, Claude API spend, Drive upload) inappropriate for verifying a file-write addition.

**Notable side-finding:** `lib/dashboard/`, `app/dashboard/`, `app/api/dashboard/`, `components/dashboard/`, `lib/auth.ts`, and `middleware.ts` are all deliberately gitignored as of `0d1607a4` (2026-06-03, "remove dashboard from repo + gitignore to prevent recurrence") — the dashboard is intentionally local-only and never deploys to Cloudflare Pages. This matches the existing memory note that Big D wants the dashboard as a real localhost app, not something deployed. Means: dashboard-side fixes (like the `state-adapter.ts` change above) never show up in `git status`/commits — that's correct, not a missed commit.

**Open / follow-up:**
- The `get_incident_status` fix won't be live in *this* MCP connection until it respawns (next session) — not a launchd service, just a subprocess the MCP client starts.
- Old stale files `logs/standup-2026-05-25.txt` through `2026-05-29.txt` are still on disk — harmless now that `getLatestStandup()` ignores anything >36h old, but flagged rather than deleted (no deletion without Big D's say-so).
- `BSV-Handoff-v5.md`/`update-handoff.js` also reads `logs/standup-*.txt` for its "Morning Standup" section — will start getting real daily data again now too, as a side benefit.
