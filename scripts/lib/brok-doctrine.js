// lib/brok-doctrine.js — the BSV reset doctrine (2026-11-05, per Big D).
//
// One product (Spongelle Men's Super Buffer), one recurring character (Brok),
// one story shape (barbarian → reckoning → fix → fairy tale), Monty Python tone.
// Source of truth: the "BSV Reset — One Product, One Story" doc.
//
// Domain ownership: this is CONTENT doctrine, consumed by creative-agent.js
// (the content owner). media-director.js only reads ACTIVE to decide whether
// to schedule Brok episodes instead of the old chapter/persona/product rotation.
// Nothing downstream (gemini-bridge, image-gen, distribute) should copy this text.
//
// To return to the old system: set ACTIVE = false. Nothing old was deleted.

const fs   = require('fs')
const path = require('path')

const ACTIVE = true

const ROOT          = path.join(__dirname, '..', '..')
const EPISODES_FILE = path.join(ROOT, 'logs', 'brok-episodes.json')

// The link lives in affiliate-overrides.json — read it from there, never copy it.
function loadProduct() {
  let link = 'https://spongelle.com/SFGCP6TP'
  try {
    const o = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'affiliate-overrides.json'), 'utf8'))
    link = o['Spongelle Men Super Buffer']?.affiliate_url || link
  } catch {}
  return {
    name:     "Spongelle Men's Super Buffer",
    short:    'the Super Buffer',
    link,
    discount: '30% off through our link',
    siteUrl:  'https://bigsolevibes.com',
  }
}

const NARRATOR_VOICE = {
  name: 'NARRATOR',
  description: 'Grave, theatrical narrator, like a nature-documentary host who has seen too much. Mock-solemn. Addresses the heavens, the audience and occasionally Brok.',
  // Same shape as the old VOICES entries so shared helpers in creative-agent don't break.
  tone:      ['Mock-solemn, theatrical', 'Absurd escalation, delivered straight-faced', 'Short sentences that land like verdicts'],
  example:   'Brok took off his sandals at brunch. The patio was evacuated. Why are men so barbaric?',
  negative:  ['Never gross-out', 'Never mean to the reader', 'Never explains the joke'],
  suitedFor: 'Every Brok episode',
}

const DOCTRINE = `# BSV — THE BROK DOCTRINE (this replaces every prior chapter, persona, voice, world and product instruction)

## What BSV is right now
A premium men's brand that is in on the joke. One belief: men have been barbarians about their feet for far too long, and it is time to stop. Every piece of content is a short, absurd morality tale that ends with a civilized man.

## The one product
{{PRODUCT}}. Every episode ends with it. Never mention or promote any other product. The call to action always carries the reader's discount: {{DISCOUNT}}.

## The hero: Brok
A caveman dropped into modern life. He means well — proud, oblivious, and his feet are a public hazard. He barely speaks; the world reacts to him (people flee, dogs leave the room, waiters faint). Each episode civilizes him a little; next episode he faces a new problem.
VISUAL SPEC (keep him recognizable every time): broad, hairy, wild dark hair and beard, heavy brow, a fur pelt worn under one ill-fitting modern garment (a blazer, a polo, a too-small apron), dignified posture he has not earned.

## The narrator
A grave, theatrical voice. Recurring line: "Why are men so barbaric?" Underneath it: don't be a caveman.

## The four beats — mandatory, in this order
1. THE BARBARIAN — Brok's foot crime, shown through other people's reactions. Never through close-ups of his feet.
2. THE RECKONING — a social moment forces the issue (a date, brunch, a pedicure, her parents' "shoes off" sign, sandal season, the gym).
3. THE FIX — the Super Buffer, as the punchline. A reveal, never a demo or a how-to.
4. THE FAIRY TALE — an absurd, over-the-top happily-ever-after (knighted, a choir sings, a framed photo on a wall of fame).

## Tone
- Monty Python energy: absurd escalation, mock-solemn narration, sudden pomp (trumpets, knights, courts, choirs, scrolls).
- Funny first, but premium. The joke is on men's habits — never gross-out, never mean to the reader. We laugh WITH the guy who has been there.
- No real people, no quoting Monty Python or anyone else. The style is ours.
- Aspirational close, every time.

## Problem palette (reference, not a rotation — pick, combine or invent)
cracked heels, rough calluses, sandal season, winter-wrecked "hooves" after months in boots, gym-shoe funk, the shoes-off moment at someone's house, pedicure shame, beach reveal, the first date that goes barefoot, hotel-pool flip-flops, yoga class, the airport security tray.

## Image rules
- Illustrated, full-figure scene: Brok, the crowd, the setting. The image POSES THE QUESTION — it captures the reckoning moment mid-reaction, so a scroller asks "what did he do?"
- No close-ups of feet. No product being applied, held or demonstrated.
- No written words anywhere in the scene — no signs, labels, menus or banners (image models garble text). Tell it with faces and staging.
- The product normally does NOT appear in the image. If the beat is the fairy tale, it may rest on a velvet cushion or pedestal, untouched, like a holy relic.

## Caption rules
- INSTAGRAM: open on the absurd moment (never on the product). 2–4 short lines of story, then "Why are men so barbaric?", then the CTA with the discount and "link in bio". Max 3 hashtags plus #BigSoleVibes.
- BLUESKY: 2–3 lines, the funniest beat plus the CTA with the discount and {{SITE}}. No hashtags.
- Every caption names the Super Buffer exactly once, in the fix or the CTA.`

function loadRecentEpisodes(n = 8) {
  try {
    const list = JSON.parse(fs.readFileSync(EPISODES_FILE, 'utf8'))
    return Array.isArray(list) ? list.slice(-n) : []
  } catch { return [] }
}

function recordEpisode(entry) {
  let list = []
  try { list = JSON.parse(fs.readFileSync(EPISODES_FILE, 'utf8')) } catch {}
  if (!Array.isArray(list)) list = []
  list.push(entry)
  fs.writeFileSync(EPISODES_FILE, JSON.stringify(list.slice(-60), null, 2))
}

function buildDoctrine() {
  const p = loadProduct()
  return DOCTRINE
    .replace('{{PRODUCT}}', p.name)
    .replace('{{DISCOUNT}}', p.discount)
    .replace('{{SITE}}', p.siteUrl)
}

module.exports = { ACTIVE, NARRATOR_VOICE, loadProduct, buildDoctrine, loadRecentEpisodes, recordEpisode }
