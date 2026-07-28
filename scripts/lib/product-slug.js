// scripts/lib/product-slug.js — single source of truth for turning a
// product's Sheet "Product Name" into the URL-safe slug used as that
// product's anchor id on the live shop page.
//
// Added 2026-07-28. Before this, sync-shop.js computed this exact transform
// twice inline (buildProductCard()'s cardId0 for the scene-image filename
// lookup, and cardId for the <article id="..."> itself) — same regex,
// copy-pasted, no shared home. creative-agent.js needed the identical slug
// to build a direct per-product CTA link (bigsolevibes.com/shop/#slug)
// instead of the bare /shop/ index every caption was linking to regardless
// of which product was actually featured — see BSV-BigC-Audit-Log.md
// 2026-07-28 ("the post gap": links present, but generic, so an interested
// reader had to hunt through 15+ products instead of landing on the one
// being talked about). Extracting this here means both files can never
// drift apart on how a product's slug is derived — same failure pattern
// already fixed for shared doctrine text in visual-doctrine.js and agent
// health logic in agent-health.js.
//
// Deterministic and stateless: same Product Name in, same slug out, no
// uniqueness suffix or dedup — matches the shop page's actual current
// behavior exactly (verified against public/shop/index.html's real
// id="dior-sauvage-edp-3-4oz" / id="baxter-of-california-safety-razor-and-
// shave-brush-set" attributes).
function slugifyProductName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

module.exports = { slugifyProductName }
