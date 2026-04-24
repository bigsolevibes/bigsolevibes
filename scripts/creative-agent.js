require('dotenv').config()
const Anthropic = require('@anthropic-ai/sdk').default
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dayIndex = args.indexOf('--day')
const themeIndex = args.indexOf('--theme')

if (dayIndex === -1 || themeIndex === -1) {
  console.error('Usage: node scripts/creative-agent.js --day <number> --theme "<theme>"')
  process.exit(1)
}

const day = args[dayIndex + 1]
const theme = args[themeIndex + 1]

if (!day || !theme) {
  console.error('Both --day and --theme values are required.')
  process.exit(1)
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not found. Add it to your .env file.')
  process.exit(1)
}

const client = new Anthropic()

const systemPrompt = `You are the Creative Director for Big Sole Vibes — a premium men's foot care brand. Voice: Premium Barbershop meets Dark Humor. Tagline: Your feet work hard. Start acting like it.
Colors: Midnight #0D1B2A, Bourbon #C17D2E, Cream #F5ECD7.
The Proprietor speaks in statements, never questions. Deadpan, confident, slightly amused. Never preachy. This is The Lounge.`

const userPrompt = `Generate a complete Day ${day} content brief with theme ${theme}.
Include:
- IMAGE BRIEF: Scene description for Gemini (atmospheric, dark, warm lighting, Lounge aesthetic)
- COPY: On-image text — Line 1 (Cream) and Line 2 (Bourbon italic)
- INSTAGRAM/FACEBOOK: Full caption with hashtags
- X: Punchy 2-3 line version
- TIKTOK: Hook line for typewriter effect + caption
- YOUTUBE: Community post caption
Keep every caption in the Proprietor voice.`

const outputDir = path.join(__dirname, '..', 'posts', 'briefs')
fs.mkdirSync(outputDir, { recursive: true })

const outputPath = path.join(outputDir, `day-${day}-brief.txt`)

;(async () => {
  console.log(`Generating Day ${day} brief — theme: "${theme}"...\n`)

  const stream = client.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  let fullText = ''

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      process.stdout.write(event.delta.text)
      fullText += event.delta.text
    }
  }

  console.log('\n')

  const header = `DAY ${day} CONTENT BRIEF — THEME: ${theme.toUpperCase()}\n${'='.repeat(60)}\n\n`
  fs.writeFileSync(outputPath, header + fullText)
  console.log(`Saved to ${outputPath}`)
})()
