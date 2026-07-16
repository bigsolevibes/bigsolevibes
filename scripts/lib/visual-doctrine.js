// scripts/lib/visual-doctrine.js — the single, shared source of BSV's visual
// fallback philosophy, used by every script that builds an image or video
// prompt (gemini-bridge.js, video-gen.js, blog-agent.js, and any future one).
//
// Added 2026-07-16. Why this exists — Big D, after the fourth time the same
// bug turned up in a fourth file: "we shouldnt have direction in each file or
// agent...it should be its own single file or agent that they are linked to...
// we could of solved this a long time ago." He's right. Before this file, the
// exact same doctrine (person is optional not required, don't default to a
// leather chair / dark wood study, the brief/argument is authoritative over
// any fallback) was independently copy-pasted into gemini-bridge.js,
// video-gen.js, and blog-agent.js — and each copy had to be found and fixed
// separately as the same symptom kept resurfacing (57d3ce86, e00d20de,
// 07072f8a, 2026-07-01, 2026-07-13, 2026-07-16 — see BSV-BigC-Audit-Log.md).
// A fix to one copy never reached the others, which is exactly why this kept
// costing multiple investigations to catch.
//
// Everything here is FALLBACK CONTEXT ONLY — every consumer must still frame
// its own precedence statement making the actual per-post assignment/brief
// authoritative over this doctrine when they conflict. This file describes
// defaults for when the assignment doesn't specify otherwise, not a rule
// layered on top of it.
//
// Domain ownership: this file owns the shared fallback doctrine text. No
// other script should hardcode its own copy of any paragraph below — if the
// doctrine needs to change, it changes here once, for every medium at once.

const PALETTE = {
  AMBER: '#C17D2E',
  NAVY:  '#0D1B2A',
}

// The brand's tone — identical across image, video, and blog. Shared verbatim
// on purpose so "what does BSV sound/feel like" can't drift between media.
const BRAND_TONE = `The brand is deadpan, confident, slightly amused. Not brooding. Not aspirational. When a man appears in frame, he has already made up his mind — caught mid-thought, not mid-pose. Think Monty Python seriousness applied to a very specific grooming gap. The humor is in the recognition, not the joke.`

// The core fix, stated once: a person is a possibility, never a requirement.
// This is the exact doctrine that had to be independently re-fixed in
// gemini-bridge.js (2026-07-13), video-gen.js (2026-07-01), and blog-agent.js
// (2026-07-16) because each file carried its own copy.
const PERSON_OPTIONAL = `A person is a possibility in the scene, never a requirement — the product and the story are what has to be there. Don't default to a full figure just because that's been the habit, and don't ban one either. Whatever you choose, the scene poses a question — it does not answer one.`

// The other half of the same recurring bug: a generic fallback setting
// (leather chair, dark wood study) winning over whatever setting the actual
// assignment describes.
const NO_DEFAULT_SETTING = `Do not substitute a leather chair, dark wood study, or any other generic environment as a default — use the actual setting the assignment/brief describes. Dark wood, leather, low light is one recurring BSV environment, not the only one.`

// Present across image and video (blog images don't feature it since blog
// images are static product/scene compositions, not a moving foot-cameo beat)
// — kept as its own export so image/video can compose it in, and so it never
// needs re-copying by hand for a future medium.
const FOOT_CAMEO = `A bare foot may enter the frame naturally — edge of shot, soft focus, corner — as the quiet punchline. When foot care is the featured product, bring the foot to center frame, sharp focus, fully lit. This is never a reason to add a person who wasn't otherwise called for.`

// Builds the shared precedence statement. `assignmentLabel` is how the
// consumer refers to its own per-post content ("the assignment below",
// "the VIDEO BRIEF below", "this post's argument") — the actual wording is
// medium-specific, but the STRUCTURE (assignment wins, this doctrine is
// fallback-only) must stay identical everywhere.
function precedence(assignmentLabel) {
  const lower = assignmentLabel.charAt(0).toLowerCase() + assignmentLabel.slice(1)
  return `PRECEDENCE: ${assignmentLabel} is written for this specific product and story. If anything in it conflicts with the defaults in this doctrine — including whether a person appears at all, the product's role in the scene, or the setting described — ${lower} wins. Everything here is a fallback for when it doesn't specify otherwise, not a rule layered on top of it. The setting described in ${lower} (bathroom counter, locker room, kitchen, office, outdoors, wherever it says) must be the setting shown. ${NO_DEFAULT_SETTING}`
}

module.exports = { PALETTE, BRAND_TONE, PERSON_OPTIONAL, NO_DEFAULT_SETTING, FOOT_CAMEO, precedence }
