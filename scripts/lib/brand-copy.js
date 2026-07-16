// scripts/lib/brand-copy.js — canonical BSV tagline + voice, used by any
// script that writes text on Big D's behalf, and by lib/visual-doctrine.js
// (the visual tone is the same brand voice, applied to image/video instead
// of prose).
//
// Added 2026-07-16, same session and same reasoning as visual-doctrine.js
// and agent-health.js. Before this file, the tagline ("Nothing goes on this
// shelf that hasn't earned its place.") was hardcoded independently in
// edition-agent.js, product-development.js, update-handoff.js, and
// sync-shop.js, and the voice paragraph ("deadpan, confident, slightly
// amused...") was hardcoded independently in visual-doctrine.js,
// edition-agent.js, and product-research.js. Per Big D, generalizing past
// the visual-doctrine fix: "if its creative or something that is perhaps
// due to change and consistent across multiple avenues we should be
// calling in a single file, not hard coding into each individual."
//
// Domain ownership: this file owns the tagline and voice text. If either
// ever changes, it changes here once — not in four files, one of which you
// find six weeks later.

const TAGLINE = `Nothing goes on this shelf that hasn't earned its place.`

// The exact paragraph used to set tone for anything generating BSV prose
// (edition stories, product narratives, positioning docs) and, via
// visual-doctrine.js's BRAND_TONE, anything generating BSV imagery.
const VOICE = `The brand is deadpan, confident, slightly amused. Not brooding. Not aspirational. When a man appears in frame, he has already made up his mind — caught mid-thought, not mid-pose. Think Monty Python seriousness applied to a very specific grooming gap. The humor is in the recognition, not the joke.`

module.exports = { TAGLINE, VOICE }
