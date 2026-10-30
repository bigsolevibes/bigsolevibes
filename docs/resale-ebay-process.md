# BSV Resale: eBay listing process

Canonical copy: the "BSV Resale Shop" Claude project doc `claude/ebay-listing-process.md`. This file mirrors it for Claude Code sessions.

**Flow:** Big D uploads photos → Claude writes the listing → eBay **Sandbox** post → Big D approves → **live** eBay.

1. **Folders.** The chat must have these attached (+ › Add folder): `~/claude/bigsolevibes-web` and Drive `My Drive/Big Sole Vibes`.
2. **Photos.** They land in Drive at `Resale Inbox/<pair>/`. Convert HEIC to JPG in the device shell with `convert x.HEIC -auto-orient -quality 90 x.JPG`. Then move the HEICs into `heic-originals/`, or the listing gets duplicate photos.
3. **Listing.** Claude reviews the photos and comps, then writes a row in the BSV Resale Listings sheet.
   - Size goes in as `US Men's 9`.
   - Drive Folder is `big sole vibes:Big Sole Vibes/Resale Inbox/<pair>`.
   - Status is `Draft`.
4. **Sandbox.** Set Status to `Reviewed`, then run bsv MCP `run_diagnostic` with script `ebay-list-publish-live`. That gives a sandbox URL and sets Status to `Posted`.
5. **Live.** Only after Big D's explicit go in the current chat: set Status back to `Reviewed`, then run `run_diagnostic` with script `ebay-list-publish-live-prod`. Afterwards, move the folder to `Resale Inbox/Processed/`.

**Why MCP and not the device shell:** the device shell (Linux VM) has no rclone and no route to eBay. `run_diagnostic` runs on the Mac.

**Gotchas:**
- If Drive sync stalls, restart the Google Drive app.
- "Resource deadlock avoided" means the file isn't downloaded yet. Wait and retry.
- `ebay-lister.js` (auto-drafting) needs Anthropic API credit.
