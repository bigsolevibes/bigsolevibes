// Click-through redirect for shelf products, as a Cloudflare Pages Function
// (edge Worker), NOT a Next.js route. sync-shop.js points every "Get it on
// Amazon" link through here instead of straight to the affiliate URL, so we
// can count clicks per product for the dashboard (Big D, 2026-07-10: "can we
// also get a count of clicks on the shelf itself of each product?").
//
// Why a Pages Function and not app/api/go/[key]/route.ts: the site builds as
// a Next.js static export (output: 'export') for Cloudflare Pages — there is
// no server at runtime, so a route.ts handler that reads a query param and
// writes a log on every request can never actually execute in production. It
// silently broke every `next build` since it was added (Error: Page
// "/api/go/[key]" is missing "generateStaticParams()" so it cannot be used
// with "output: export" config), so Cloudflare kept serving whatever build
// predated it — main was effectively frozen from ~2026-07-10 until this was
// found and fixed 2026-09-01. Pages Functions run on Cloudflare's edge
// runtime *alongside* the static export (separate deploy mechanism, files
// under /functions instead of /app), so this is the actual fix, not a
// workaround: same behavior, running somewhere that can execute it.
//
// Click counts persist to a Cloudflare KV namespace (binding: SHELF_CLICKS_KV,
// set up in the Pages project's Settings -> Functions -> KV namespace
// bindings) since a Worker has no filesystem. scripts/sync-shelf-clicks.js
// pulls that KV data down into logs/shelf-clicks.json on a schedule so the
// existing local dashboard (lib/dashboard/state-adapter.ts) keeps working
// unchanged.
//
// `context: any` here matches the rest of this directory (see
// functions/api/subscribe.ts etc.) — this project doesn't have
// @cloudflare/workers-types installed, and tsconfig.json's include picks up
// everything under functions/ with strict mode on, so typing context as
// KVNamespace/PagesFunction would break the build the same way the old
// route.ts did, just with a TS error instead of a static-export error.
//
// This endpoint is public (it's on the live shop page), so two things matter:
// 1. It must never become an open redirect — only forward to domains we
//    actually use for affiliate links. Anything else falls back to /shop/.
// 2. The click count write is best-effort (context.waitUntil, fire-and-
//    forget) and never blocks or fails the redirect.

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

async function logClick(kv: any, key: string): Promise<void> {
  if (!kv) return // no KV bound yet — skip, never throw
  try {
    const current = await kv.get(key)
    const count = (current ? parseInt(current, 10) : 0) || 0
    await kv.put(key, String(count + 1))
  } catch {
    /* never block the redirect on a logging failure */
  }
}

export async function onRequestGet(context: any) {
  const url = new URL(context.request.url)
  const to = url.searchParams.get('to') ?? ''

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

  let key = context.params?.key ?? ''
  try {
    key = decodeURIComponent(key)
  } catch {
    /* use raw param if decode fails */
  }

  context.waitUntil(logClick(context.env?.SHELF_CLICKS_KV, key))

  return Response.redirect(destination, 302)
}
