require('dotenv').config()
// ─────────────────────────────────────────────────────────────────────────────
// lounge-reconcile.js — voice reconciliation + editorial gate for The Lounge
//
// Usage:
//   node scripts/lounge-reconcile.js --all
//   node scripts/lounge-reconcile.js --article the-upgrade-path
//
// Downloads each Drive article, reconciles voice against BSV-Memory.md and
// lounge-introduction.md, saves [slug]-DRAFT.md back to Drive, sends Telegram
// preview with Drive link, and queues an approval gate.
//
// On APPROVE via Telegram → chief-of-staff.js processTelegramInbox converts
// the DRAFT.md to an MDX file, commits, and pushes to preview/full-site.
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic        = require('@anthropic-ai/sdk').default
const { execSync }     = require('child_process')
const path             = require('path')
const fs               = require('fs')
const os               = require('os')
const { addPendingItem } = require('./telegram-queue')
const { sendTelegram }   = require('./telegram')

const ROOT          = path.join(__dirname, '..')
const LOG_FILE      = path.join(ROOT, 'logs', 'lounge-reconcile.log')
const TEMP_DIR      = path.join(os.homedir(), 'tmp', 'bsv-lounge-reconcile')
const REMOTE        = 'big sole vibes:Big Sole Vibes'
const LOUNGE_REMOTE = `${REMOTE}/The Lounge`

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n')
}

// ─── Article config ───────────────────────────────────────────────────────────
// All 9 Lounge articles. For articles 3-8, Drive file must exist before reconcile
// runs — see Step 1 rclone upload commands in session notes.

const ARTICLE_CONFIGS = [
  {
    slug:       'the-upgrade-path',
    title:      'The Upgrade Path, or: How a Man Came to Terms With His Bathroom Cabinet',
    chapter:    1,
    type:       'hub',
    driveFile:  'chapter-1-hub-the-upgrade-path.md',
    publishDate: '2026-05-26',
    excerpt:    'It began on an unremarkable Tuesday. The soap had been there for fifteen years. The reckoning arrives for every man eventually. This is what happens after.',
    tags:       ['skincare', 'routine', 'standard'],
    reconcileInstruction: `Full opening rewrite needed. The article currently opens on Tuesday morning rushing out the door. Rewrite the opening to match the tonal frame established in lounge-introduction.md: the man is in the evening, tired, standing at the mirror. He walks to the couch, drops into it, kicks his shoes off, closes his eyes — and finds himself in a dream. The forest. The path already underfoot. The soap reckoning happens inside the dream sequence, not as a literal Tuesday-morning event. The Romans section, the pH chemistry section, and the moisturizer card section all hold — do not change them. Only the entry point and the framing of the opening shift. The final line must remain: "The Romans, it should be noted, would have approved."`,
  },
  {
    slug:       'the-cleanser',
    title:      'The Bar of Soap and the Fifteen-Year Misunderstanding',
    chapter:    1,
    type:       'spoke',
    driveFile:  'chapter-1-spoke-1-the-cleanser.md',
    publishDate: '2026-05-26',
    excerpt:    'For fifteen years, the soap was the problem. The face was trying to tell him. Nobody explained the pH gap until now.',
    tags:       ['face wash', 'cleanser', 'skincare basics'],
    reconcileInstruction: `Light audit. Remove any instructional drift — if a sentence starts to read like a how-to guide rather than a chapter, pull it back to the man's perspective and experience. Keep the soap-watching-from-the-tub beat — that image is load-bearing. Ensure the close implies the next gap in the maintenance standard without naming it. The voice is The Barber: warm, technical, never condescending.`,
  },
  {
    slug:       'the-moisturizer',
    title:      'The Moisturizer, or: Eleven Days of Unnecessary Stubbornness',
    chapter:    1,
    type:       'spoke',
    driveFile:  'chapter-1-spoke-2-the-moisturizer.md',
    publishDate: '2026-06-02',
    excerpt:    "He resisted for eleven days. He'd been conditioned to believe moisturizer was not for him. The oil-change analogy was what finally got through.",
    tags:       ['moisturizer', 'skincare', 'maintenance'],
    reconcileInstruction: `Light audit. The eleven-days-of-stubbornness thread is right — keep it. The oil-change analogy is right — it reframes maintenance as something the man already respects, keep it. Check that the ending implies the next gap in the standard without spelling it out. Nothing should read like a product endorsement — it should read like a chapter about a man's resistance and what broke it.`,
  },
  {
    slug:       'the-label',
    title:      'The Label, or: What Sodium Tallowate Actually Means',
    chapter:    1,
    type:       'spoke',
    driveFile:  'chapter-1-spoke-3-the-label.md',
    publishDate: '2026-06-09',
    excerpt:    'He turned the bottle over and read sodium tallowate. That was the moment the soap stopped being a habit and became a question.',
    tags:       ['ingredients', 'product education', 'standard'],
    reconcileInstruction: `Light audit. The sodium tallowate moment is the hinge of the article — keep it. Check for anything that reads like a consumer report, ingredient glossary, or product comparison rather than a chapter. Every fact must serve the man's realization, not the reader's education. If a sentence feels like a product claim, rewrite it as a scene. The chapter closes Chapter 1 — the ending should feel like a door opening onto Chapter 2 without naming what's behind it.`,
  },
  {
    slug:       'the-one-bottle',
    title:      'The One Bottle, or: What Napoleon Had Right',
    chapter:    2,
    type:       'hub',
    driveFile:  'chapter-2-hub-the-one-bottle.md',
    publishDate: '2026-06-16',
    excerpt:    "Every man has one bottle of cologne he keeps coming back to. He just doesn't know why yet. Napoleon knew. The Romans knew. Now he does.",
    tags:       ['cologne', 'fragrance', 'standard'],
    reconcileInstruction: `Light audit. Napoleon and the Romans references are right — they establish the historical continuity and should remain. The parking lot scene is the chapter's visual anchor — keep it intact and specific. Check the opening and the close for enchanted forest consistency: the man is still in the same dream that began in the lounge-introduction.md. This is a different clearing, a different discovery — the framing should feel continuous with Chapter 1, not like a genre shift. Voice: The Lounge — warm, knowing, GQ editorial register.`,
  },
  {
    slug:       'top-notes-trap',
    title:      'The Top Notes Trap',
    chapter:    2,
    type:       'spoke',
    driveFile:  'chapter-2-spoke-1-top-notes-trap.md',
    publishDate: '2026-06-23',
    excerpt:    "The strip was a rumor. The bottle was a different conversation entirely. He learned the difference the wrong way — most men do.",
    tags:       ['fragrance', 'cologne testing', 'skin chemistry'],
    reconcileInstruction: `Lightest audit. This article was written when the voice was most locked — check only for drift. If any section starts to feel more like a buying guide than a chapter, pull it back toward the man's experience. The strip-was-a-rumor beat should remain the article's central image.`,
  },
  {
    slug:       'skin-chemistry',
    title:      'Skin Chemistry, or: The Conversation You Are Having Without Knowing It',
    chapter:    2,
    type:       'spoke',
    driveFile:  'chapter-2-spoke-2-skin-chemistry.md',
    publishDate: '2026-06-30',
    excerpt:    "Same bottle. Two men. The scent was completely different on each of them. He thought that was coincidence. It wasn't.",
    tags:       ['skin chemistry', 'fragrance', 'drydown'],
    reconcileInstruction: `Lightest audit. This article was written when the voice was most locked — check only for drift. If the Marcus-at-dinner scene is present, it should stay — that is the chapter's beating heart. No instructional drift. The science serves the story, not the other way around.`,
  },
  {
    slug:       'the-saturday-bottle',
    title:      'The Saturday Bottle',
    chapter:    2,
    type:       'spoke',
    driveFile:  'chapter-2-spoke-3-the-saturday-bottle.md',
    publishDate: '2026-07-07',
    excerpt:    "There's the bottle you wear to work. And then there's the bottle for Saturday. He had one. He was ready for the other.",
    tags:       ['fragrance wardrobe', 'lifestyle', 'standard'],
    reconcileInstruction: `Lightest audit. This article was written when the voice was most locked — check only for drift. The two-bottle distinction should be unmistakable at the close. If the ending implies Chapter 3 without naming what's in it, that is correct. Leave it there.`,
  },
]

// ─── Drive helpers ────────────────────────────────────────────────────────────

function downloadFromDrive(remotePath, localDir) {
  try {
    execSync(`rclone copy "${remotePath}" "${localDir}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
    })
    return true
  } catch {
    return false
  }
}

function uploadToDrive(localPath, remotePath) {
  execSync(`rclone copyto "${localPath}" "${remotePath}"`, {
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
  })
}

function loadDriveFile(filename) {
  const ok = downloadFromDrive(`${LOUNGE_REMOTE}/${filename}`, TEMP_DIR)
  if (!ok) return null
  const p = path.join(TEMP_DIR, filename)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

function loadRootFile(filename) {
  try {
    execSync(`rclone copy "${REMOTE}/${filename}" "${TEMP_DIR}/"`, {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
    })
    const p = path.join(TEMP_DIR, filename)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch { return null }
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

async function reconcileArticle(config, client, memory, loungeIntro) {
  log(`Reconciling: ${config.slug}`)

  const original = loadDriveFile(config.driveFile)
  if (!original) {
    log(`  SKIP: ${config.driveFile} not found on Drive — upload it first`)
    return null
  }
  log(`  Original: ${original.length} chars`)

  const systemPrompt = `You are the editorial voice reconciler for The Lounge — BSV's long-form content.

Your job: apply the reconcile instruction to the article. Output the full reconciled article.

## Voice Standard (BSV-Memory.md)
${memory || '(not available — apply Proprietor voice: warm, considered, GQ editorial register)'}

## Tonal Frame (lounge-introduction.md)
${loungeIntro || '(not available — maintain enchanted forest / dream logic continuity)'}

## Output Format
Start with # [Article Title] on the first line.
Then the article body. No metadata block. No commentary before or after.
Keep all ## section headings and internal structure unless the instruction requires changes.
Keep all product links exactly as they appear in the original.
Output nothing but the article.`

  const userPrompt = `Apply this reconcile instruction to the article below.

## Reconcile Instruction
${config.reconcileInstruction}

## Original Article
${original}

Output the full reconciled article now.`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const reconciled = msg.content[0].text.trim()
  log(`  Reconciled: ${reconciled.length} chars, tokens: ${msg.usage?.output_tokens ?? '?'}`)

  // Save DRAFT.md to Drive Lounge folder
  const draftFilename = `${config.slug}-DRAFT.md`
  const localDraft    = path.join(TEMP_DIR, draftFilename)
  fs.writeFileSync(localDraft, reconciled)
  uploadToDrive(localDraft, `${LOUNGE_REMOTE}/${draftFilename}`)
  log(`  Saved: Drive/The Lounge/${draftFilename}`)

  return reconciled
}

// ─── Telegram gate ────────────────────────────────────────────────────────────

function preview200(text) {
  const plain = text.replace(/^#[^\n]*\n/, '').replace(/^[*_].*[*_]$/gm, '').trim()
  const words = plain.split(/\s+/)
  return words.slice(0, 40).join(' ') + (words.length > 40 ? '…' : '')
}

async function sendApprovalRequest(config, reconciled) {
  const draftFilename = `${config.slug}-DRAFT.md`
  const typeLabel     = config.type === 'hub' ? 'Hub' : `Spoke`
  const previewText   = preview200(reconciled)

  const msg = [
    `📖 *LOUNGE DRAFT READY*`,
    `*${config.title}*`,
    `Chapter ${config.chapter} — ${typeLabel}`,
    ``,
    `*Preview:*`,
    previewText,
    ``,
    `*Drive:* The Lounge/${draftFilename}`,
    `*Publish date:* ${config.publishDate}`,
    ``,
    `Reply *APPROVE* to schedule or send edit notes.`,
  ].join('\n')

  await sendTelegram(msg)
  log(`  Telegram sent: approval request for ${config.slug}`)

  addPendingItem({
    id:              `lounge-draft-${config.slug}`,
    type:            'lounge-draft',
    driveFile:       draftFilename,
    sentAt:          new Date().toISOString(),
    remindAfter:     null,
    metadata: {
      slug:        config.slug,
      title:       config.title,
      chapter:     config.chapter,
      articleType: config.type,
      publishDate: config.publishDate,
      excerpt:     config.excerpt,
      tags:        config.tags,
    },
    originalMessage: msg,
  })
  log(`  Queued: lounge-draft-${config.slug} in telegram-pending.json`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async function run() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  log('━━━ lounge-reconcile start ━━━')

  const articleArg = process.argv.indexOf('--article')
  const allFlag    = process.argv.includes('--all')

  if (!allFlag && articleArg === -1) {
    log('Usage: node scripts/lounge-reconcile.js --all | --article [slug]')
    process.exit(1)
  }

  // Filter to requested articles
  let targets = ARTICLE_CONFIGS
  if (articleArg !== -1) {
    const slug = process.argv[articleArg + 1]
    targets = ARTICLE_CONFIGS.filter(c => c.slug === slug)
    if (!targets.length) {
      log(`ERROR: unknown slug "${slug}". Valid slugs: ${ARTICLE_CONFIGS.map(c => c.slug).join(', ')}`)
      process.exit(1)
    }
  }

  log(`Articles: ${targets.map(c => c.slug).join(', ')}`)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { log('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }

  const client = new Anthropic({ apiKey })

  log('Loading voice standard (BSV-Memory.md)...')
  const memory = loadRootFile('BSV-Memory.md')
  log(`Memory: ${memory ? memory.length + ' chars' : 'not found'}`)

  log('Loading tonal frame (lounge-introduction.md)...')
  const loungeIntro = loadDriveFile('lounge-introduction.md')
  log(`Lounge intro: ${loungeIntro ? loungeIntro.length + ' chars' : 'not found'}`)

  const results = []
  for (const config of targets) {
    try {
      const reconciled = await reconcileArticle(config, client, memory, loungeIntro)
      if (reconciled) {
        await sendApprovalRequest(config, reconciled)
        results.push({ slug: config.slug, ok: true })
      } else {
        results.push({ slug: config.slug, ok: false, reason: 'Drive file missing' })
      }
    } catch (err) {
      log(`ERROR: ${config.slug} — ${err.message}`)
      results.push({ slug: config.slug, ok: false, reason: err.message })
    }
  }

  const succeeded = results.filter(r => r.ok).length
  const skipped   = results.filter(r => !r.ok).length
  log(`━━━ lounge-reconcile complete: ${succeeded} reconciled, ${skipped} skipped ━━━`)

  if (skipped > 0) {
    const missing = results.filter(r => !r.ok).map(r => `${r.slug} (${r.reason})`).join(', ')
    await sendTelegram(`⚠️ lounge-reconcile: ${skipped} article(s) skipped — ${missing}`)
  }
})()
