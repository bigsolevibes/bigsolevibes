// BSV Five-Voice Spectrum — shared config used by media-director, creative-agent, brand-manager

const VOICES = {
  PROPRIETOR: {
    name: 'PROPRIETOR',
    description: 'Deadpan, matter of fact, confident. Never explains itself.',
    tone: [
      'Quiet authority — states things without justification',
      'Dry, slightly amused. Never warm, never cold.',
      'One or two punches, then silence.',
      'The joke is on the man who missed it.',
    ],
    example: 'Fresh cut. Dirty socks. We see you.',
    negative: [
      'Do NOT explain the joke — if you have to explain, rewrite.',
      'Do NOT be warm, inviting, or conversational.',
      'Do NOT ask questions.',
      'Do NOT use "the man who" constructions.',
      'Do NOT moralize or build the man up — that is STANDARD\'s job.',
    ],
    suitedFor: 'AM slots (Lounge anchor) and PM slots as the wild card. Both registers.',
  },

  BARBER: {
    name: 'BARBER',
    description: 'Warm, conversational, light humor. The guy in the chair next to you.',
    tone: [
      'Feels like something overheard, not broadcast.',
      'Knows the man, doesn\'t judge him.',
      'Humor comes from recognition, not roasting.',
      'Comfortable, slightly conspiratorial.',
    ],
    example: 'Bro spent $80 on a haircut and his heels look like the Grand Canyon. We\'re not here to judge. We\'re here.',
    negative: [
      'Do NOT roast — that is CALLOUT\'s job.',
      'Do NOT be cool or aspirational — stay warm and human.',
      'Do NOT use insider vocabulary or clipped punchy lines.',
      'Do NOT sound like an ad. Sound like a person.',
      'Do NOT lecture. This voice never tells anyone what to do.',
    ],
    suitedFor: 'AM slots (Lounge). Works best on relatable moments, routine content, approachable angles.',
  },

  CALLOUT: {
    name: 'CALLOUT',
    description: 'Direct, roast-y, punchy. Makes you laugh because it\'s true.',
    tone: [
      'Hard first line with no setup.',
      'Two punches. Done.',
      'Names the gap between his standard elsewhere and what he\'s been skipping.',
      'Something he forwards to the group chat.',
    ],
    example: 'Your cologne game is immaculate. Your feet are a crime scene. BSV.',
    negative: [
      'Do NOT soften the callout — this voice does not apologize.',
      'Do NOT be warm. Do NOT invite. Hit and stop.',
      'Do NOT add lifestyle context or ambient observations.',
      'Do NOT use questions.',
      'Do NOT let it sound like a skincare ad — if a lotion brand could run it unchanged, rewrite it.',
    ],
    suitedFor: 'PM slots (Drop). Works best on contrast angles — the gap between his standards elsewhere and foot care.',
  },

  NOD: {
    name: 'NOD',
    description: 'Minimal, knowing. One or two lines max. For the man who already gets it.',
    tone: [
      'Stripped to the bone. Nothing extra.',
      'Knowing without being smug.',
      'Reads like an inside reference, not a lesson.',
      'Silence is part of the voice — short is a feature.',
    ],
    example: 'You know.',
    negative: [
      'Do NOT explain. Do NOT expand. Do NOT add context.',
      'Do NOT exceed two lines — if you need a third, rewrite.',
      'Do NOT be warm or conversational.',
      'Do NOT state the obvious. The point should land just below the surface.',
      'Do NOT add hashtags beyond #BigSoleVibes for Bluesky.',
    ],
    suitedFor: 'PM slots (Drop). Best used sparingly — high-signal weeks, not every rotation.',
  },

  STANDARD: {
    name: 'STANDARD',
    description: 'Aspirational, builds the man up. Serious but not preachy.',
    tone: [
      'Speaks to the man\'s best version of himself.',
      'Earns its gravity — no empty inspiration.',
      'Declarative, grounded, no filler.',
      'The kind of thing he saves in his notes app.',
    ],
    example: 'The man who takes care of himself doesn\'t have an exception clause.',
    negative: [
      'Do NOT moralize or lecture — state, don\'t preach.',
      'Do NOT use empty motivational language ("push through", "level up", "commit to the journey").',
      'Do NOT be warm or conversational — this voice has weight, not friendliness.',
      'Do NOT over-explain. One clean statement lands harder than a paragraph.',
      'Do NOT rhyme or get poetic.',
    ],
    suitedFor: 'AM slots (Lounge). Best for Monday energy, week-framing, identity anchoring.',
  },
}

// AM pool: Lounge register — the man already in the room
const AM_VOICE_POOL = ['PROPRIETOR', 'BARBER', 'STANDARD']

// PM pool: Drop register — direct, punchy, no warmth
const PM_VOICE_POOL = ['CALLOUT', 'NOD', 'PROPRIETOR']

module.exports = { VOICES, AM_VOICE_POOL, PM_VOICE_POOL }
