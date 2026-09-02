require('dotenv').config()
const { getValidAccessToken } = require('./ebay-auth')

// ─────────────────────────────────────────────────────────────────────────────
// ebay-account-setup.js — one-time (idempotent) eBay seller account setup,
// required before ebay-list-publish.js can create/publish any listing.
//
// eBay's Inventory API refuses to publish an offer unless the seller account
// already has: (1) opted into Business Policies, (2) a merchant inventory
// location, and (3) fulfillment/payment/return policies referenced by ID on
// every offer. This script creates all of that once per environment.
//
// Business terms baked in here per Big D's decisions (2026-09-01):
//   - Returns: 30 days, buyer pays return shipping
//   - Shipping: advertised as free to the buyer (flat-rate, $0) — actual
//     shipping cost is meant to be baked into the item's suggested price,
//     not charged separately. USPS Ground Advantage, 1 business day handling.
//   - Payment: standard Managed Payments, no immediate-payment requirement.
//
// Merchant location: SANDBOX ONLY uses a placeholder US address below — it's
// fine for testing (Sandbox never ships anything real), but before this is
// ever run with --env prod, replace SANDBOX_PLACEHOLDER_ADDRESS with Big D's
// actual ship-from address (needed for real shipping cost/label accuracy).
//
// Usage: node scripts/ebay-account-setup.js [--env sandbox|prod]
// Idempotent: checks for each existing policy/location by name/key first,
// skips creation if already there. Safe to re-run.
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(flag) { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null }
const env = getArg('--env') || 'sandbox'

const API_BASE = env === 'prod' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
const MARKETPLACE_ID = 'EBAY_US'

const MERCHANT_LOCATION_KEY = 'bsv-resale-main'
const FULFILLMENT_POLICY_NAME = 'BSV Resale — Free Flat Rate'
const PAYMENT_POLICY_NAME = 'BSV Resale — Standard'
const RETURN_POLICY_NAME = 'BSV Resale — 30 Day Buyer Pays Return'

const SANDBOX_PLACEHOLDER_ADDRESS = {
  addressLine1: '123 Main St',
  city: 'Austin',
  stateOrProvince: 'TX',
  postalCode: '78701',
  country: 'US',
}

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }

async function ebayFetch(token, method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE_ID,
      'Accept-Language': 'en-US',
      'Content-Language': 'en-US',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

async function ensureOptedIn(token) {
  const res = await ebayFetch(token, 'POST', '/sell/account/v1/program/opt_in', {
    programType: 'SELLING_POLICY_MANAGEMENT',
  })
  // eBay returns 204 on success, or an error if already opted in — both are fine outcomes.
  if (res.ok) {
    log('Opted into Business Policies (Selling Policy Management).')
  } else {
    const alreadyIn = JSON.stringify(res.data || '').includes('already opted in') || res.status === 400 || res.status === 409
    log(`Opt-in call returned HTTP ${res.status} — ${alreadyIn ? 'likely already opted in, continuing' : 'unexpected, see detail below'}: ${JSON.stringify(res.data)}`)
  }
}

async function ensureLocation(token) {
  const check = await ebayFetch(token, 'GET', `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`)
  if (check.ok) {
    log(`Merchant location "${MERCHANT_LOCATION_KEY}" already exists.`)
    return MERCHANT_LOCATION_KEY
  }
  const res = await ebayFetch(token, 'POST', `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`, {
    location: { address: SANDBOX_PLACEHOLDER_ADDRESS },
    name: 'BSV Resale',
    merchantLocationStatus: 'ENABLED',
    locationTypes: ['WAREHOUSE'],
  })
  if (!res.ok) throw new Error(`createInventoryLocation failed: HTTP ${res.status} ${JSON.stringify(res.data)}`)
  log(`Created merchant location "${MERCHANT_LOCATION_KEY}".`)
  return MERCHANT_LOCATION_KEY
}

async function findPolicyIdByName(token, resource, listField, name) {
  const res = await ebayFetch(token, 'GET', `/sell/account/v1/${resource}?marketplace_id=${MARKETPLACE_ID}`)
  if (!res.ok) return null
  const list = res.data?.[listField] || []
  const match = list.find(p => p.name === name)
  return match ? match[`${resource}Id`] : null
}

async function ensureFulfillmentPolicy(token) {
  const existingId = await findPolicyIdByName(token, 'fulfillment_policy', 'fulfillmentPolicies', FULFILLMENT_POLICY_NAME)
  if (existingId) { log(`Fulfillment policy already exists (${existingId}).`); return existingId }

  const res = await ebayFetch(token, 'POST', '/sell/account/v1/fulfillment_policy', {
    name: FULFILLMENT_POLICY_NAME,
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES', default: true }],
    handlingTime: { value: 1, unit: 'DAY' },
    shippingOptions: [{
      optionType: 'DOMESTIC',
      costType: 'FLAT_RATE',
      shippingServices: [{
        sortOrder: 1,
        shippingCarrierCode: 'USPS',
        shippingServiceCode: 'USPSParcel',
        shippingCost: { value: '0.00', currency: 'USD' },
        freeShipping: true,
      }],
    }],
  })
  if (!res.ok) throw new Error(`createFulfillmentPolicy failed: HTTP ${res.status} ${JSON.stringify(res.data)}`)
  log(`Created fulfillment policy (${res.data.fulfillmentPolicyId}).`)
  return res.data.fulfillmentPolicyId
}

async function ensurePaymentPolicy(token) {
  const existingId = await findPolicyIdByName(token, 'payment_policy', 'paymentPolicies', PAYMENT_POLICY_NAME)
  if (existingId) { log(`Payment policy already exists (${existingId}).`); return existingId }

  const res = await ebayFetch(token, 'POST', '/sell/account/v1/payment_policy', {
    name: PAYMENT_POLICY_NAME,
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES', default: true }],
    immediatePay: false,
  })
  if (!res.ok) throw new Error(`createPaymentPolicy failed: HTTP ${res.status} ${JSON.stringify(res.data)}`)
  log(`Created payment policy (${res.data.paymentPolicyId}).`)
  return res.data.paymentPolicyId
}

async function ensureReturnPolicy(token) {
  const existingId = await findPolicyIdByName(token, 'return_policy', 'returnPolicies', RETURN_POLICY_NAME)
  if (existingId) { log(`Return policy already exists (${existingId}).`); return existingId }

  const res = await ebayFetch(token, 'POST', '/sell/account/v1/return_policy', {
    name: RETURN_POLICY_NAME,
    marketplaceId: MARKETPLACE_ID,
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES', default: true }],
    returnsAccepted: true,
    returnPeriod: { value: 30, unit: 'DAY' },
    returnShippingCostPayer: 'BUYER',
    refundMethod: 'MONEY_BACK',
  })
  if (!res.ok) throw new Error(`createReturnPolicy failed: HTTP ${res.status} ${JSON.stringify(res.data)}`)
  log(`Created return policy (${res.data.returnPolicyId}).`)
  return res.data.returnPolicyId
}

async function main() {
  const token = await getValidAccessToken(env)
  log(`Setting up eBay ${env} seller account...`)

  await ensureOptedIn(token)
  const locationKey = await ensureLocation(token)
  const fulfillmentPolicyId = await ensureFulfillmentPolicy(token)
  const paymentPolicyId = await ensurePaymentPolicy(token)
  const returnPolicyId = await ensureReturnPolicy(token)

  console.log('\n✓ Setup complete. Save these for ebay-list-publish.js:')
  console.log(JSON.stringify({ locationKey, fulfillmentPolicyId, paymentPolicyId, returnPolicyId }, null, 2))
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`)
  process.exit(1)
})
