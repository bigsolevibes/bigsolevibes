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

const { VOICE } = require('./brand-copy')

const PALETTE = {
  AMBER: '#C17D2E',
  NAVY:  '#0D1B2A',
}

// The brand's tone — identical across image, video, blog, and any other
// prose (edition stories, product narratives). Sourced from brand-copy.js
// (added 2026-07-16) so this paragraph has exactly one home instead of the
// three independent copies it used to have (here, edition-agent.js,
// product-research.js).
const BRAND_TONE = VOICE

// The core fix, stated once: a person is a possibility, never a requirement.
// This is the exact doctrine that had to be independently re-fixed in
// gemini-bridge.js (2026-07-13), video-gen.js (2026-07-01), and blog-agent.js
// (2026-07-16) because each file carried its own copy.
//
// Shortened 2026-07-22 as part of the fix for Imagen's 480-token input
// limit (ai.google.dev/gemini-api/docs/models/imagen) — a real prompt
// (BSV_VISUAL_PREAMBLE + a live brief) measured at ~1400 estimated tokens,
// ~3x the limit, with this doctrine's old wording alone accounting for
// roughly 900 of those tokens before Imagen ever saw the actual per-post
// assignment. This is fallback-only text (the assignment always wins on
// conflict — see precedence() below), so it doesn't need the same narrative
// weight as content that's actually supposed to win; conciseness here is a
// straight improvement for every consumer (image, video, blog), not an
// image-specific tradeoff.
const PERSON_OPTIONAL = `A person is optional, never required — pick based on what the story needs. The scene poses a question, it doesn't answer one.`

// The other half of the same recurring bug: a generic fallback setting
// (leather chair, dark wood study) winning over whatever setting the actual
// assignment describes.
const NO_DEFAULT_SETTING = `No default leather chair or dark wood study — use the setting the assignment actually describes.`

// Added 2026-07-28. Per Big D's standing visual philosophy (image poses a
// question, never answers it — no product-application shots of any body
// part), confirmed as a real, current failure by image-gen.js's post-render
// QA: 2 of 3 flagged images in the 48h before this fix showed a hand
// touching/holding/reaching for the product, despite the brief never asking
// for that. Before this, "no product-application gesture" existed only as
// an example inside image-gen.js's post-hoc vision-check prompt (line ~253)
// and in memory — never as fixed text in the actual brief-generation
// template that creates the prompt Imagen reads. It was left to whichever
// model wrote that day's brief remembering to restate it, which is exactly
// why it kept lapsing. Scoped to IMAGE prompts only — video's own brief
// intentionally requires the product stay visible in motion (held, set
// down) since a static object can't demonstrate motion otherwise, so this
// constant should not be wired into any video-brief instruction.
const NO_APPLICATION_GESTURE = `Product at rest by default — no hand touches, holds up, or applies it. It sits in frame on its own, or a hand may be withdrawing/set it down and pull away, but never mid-application or mid-hold. If the story genuinely requires the product be held, that has to be an explicit, deliberate choice stated plainly up front — never an implicit or ambiguous gesture.`

// Present across image and video (blog images don't feature it since blog
// images are static product/scene compositions, not a moving foot-cameo beat)
// — kept as its own export so image/video can compose it in, and so it never
// needs re-copying by hand for a future medium.
const FOOT_CAMEO = `Foot cameo (only if a person's already in frame): a bare foot may enter softly at the edge as the quiet punchline; bring it to sharp, lit focus only when foot care is the featured product.`

// Builds the shared precedence statement. `assignmentLabel` is how the
// consumer refers to its own per-post content ("the assignment below",
// "the VIDEO BRIEF below", "this post's argument") — the actual wording is
// medium-specific, but the STRUCTURE (assignment wins, this doctrine is
// fallback-only) must stay identical everywhere.
function precedence(assignmentLabel) {
  const lower = assignmentLabel.charAt(0).toLowerCase() + assignmentLabel.slice(1)
  return `PRECEDENCE: ${lower} wins on conflict (setting, person, product role) — these are fallbacks only.`
}

module.exports = { PALETTE, BRAND_TONE, PERSON_OPTIONAL, NO_DEFAULT_SETTING, NO_APPLICATION_GESTURE, FOOT_CAMEO, precedence }
