import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'

// Click-through redirect for shelf products. sync-shop.js points every
// "Get it on Amazon" link through here instead of straight to the affiliate
// URL, so we can count clicks per product for the dashboard (Big D, 2026-07-10:
// "can we also get a count of clicks on the shelf itself of each product?").
//
// This endpoint is public (it's on the live shop page), so two things matter:
// 1. It must never become an open redirect — only forward to domains we
//    actually use for affiliate links. Anything else falls back to /shop/.
// 2. The click log write is best-effort and never blocks the redirect.

const PIPELINE_ROOT = process.env.PIPELINE_ROOT ?? process.cwd()
const CLICKS_FILE = path.join(PIPELINE_ROOT, 'logs', 'shelf-clicks.json')

const ALLOWED_HOSTS = [
  'amazon.com',
  'dpbolvw.net', 'anrdoezrs.net', 'jdoqocy.com', 'tkqlhce.com', 'kqzyfj.com', // CJ affiliate redirect domains
  'impact.com',
  'flexoffers.com',
  'spongelle.com', // direct affiliate override, see scripts/data/affiliate-overrides.json
]

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
}

function logClick(key: string) {
  try {
    let counts: Record<string, number> = {}
    try {
      counts = JSON.parse(fs.readFileSync(CLICKS_FILE, 'utf8'))
    } catch {
      /* file doesn't exist yet — start fresh */
    }
    counts[key] = (counts[key] ?? 0) + 1
    fs.mkdirSync(path.dirname(CLICKS_FILE), { recursive: true })
    fs.writeFileSync(CLICKS_FILE, JSON.stringify(counts, null, 2))
  } catch {
    /* never block the redirect on a logging failure */
  }
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const to = req.nextUrl.searchParams.get('to') ?? ''

  let dest: URL | null = null
  try {
    dest = new URL(to)
  } catch {
    dest = null
  }

  const safe =
    dest !== null &&
    (dest.protocol === 'https:' || dest.protocol === 'http:') &&
    isAllowedHost(dest.hostname)

  const destination = safe ? (dest as URL).toString() : '/shop/'

  let key = params.key
  try {
    key = decodeURIComponent(params.key)
  } catch {
    /* use raw param if decode fails */
  }
  logClick(key)

  return Response.redirect(destination, 302)
}
