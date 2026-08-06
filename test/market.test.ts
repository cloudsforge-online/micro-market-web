/**
 * THE REQUEST, not the response.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Every existing suite in this estate stubs `fetch` and asserts what came back. That is exactly
 * the shape of test that let SEVEN client defects ship, three of them inside `micro-market`:
 *
 *   - `micro-wallet` called `POST /v1/quotes`. `micro-pricing` serves `/rates`.
 *   - `micro-market` called `POST /v1/decisions/market.listing`. `micro-policy` has **no `/v1`
 *     routes at all**, takes the action in the body, and registers `market.listing.create`. Every
 *     listing creation returned 403.
 *
 * Both suites were green. A stub answers whatever it is told to answer, no matter what path it was
 * asked for — so a test that checks the parsed body proves the parser and nothing else.
 *
 * So this file asserts the OUTGOING call: the exact URL, the method, the query string, the body,
 * and the headers — including `Idempotency-Key`, which `micro-market` requires on every mutating
 * route (`server.ts`) and without which the request is a 400 before anything happens.
 * Each describe block names the route it exercises and the file that declares it,
 * `market/src/server.ts` — `buildRoutes()`, never a line number in it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'
import { ApiError, __resetAuth, setTokens } from '../src/lib/api.ts'
import {
  ASSET_KINDS,
  LISTING_STATUSES,
  PRICING_MODES,
  SETTLEMENT_MODES,
  acceptOffer,
  activateListing,
  attachListingImage,
  bidMinimum,
  buyListing,
  cancelListing,
  createCollection,
  createListing,
  detachListingImage,
  getImageConfig,
  getListing,
  getListingRisk,
  getOrder,
  getVerification,
  listBids,
  listCollections,
  listListings,
  listOffers,
  listOrders,
  makeOffer,
  openDispute,
  placeBid,
  setListingGallery,
  withdrawOffer,
} from '../src/lib/market.ts'

/**
 * The service's base under `pnpm dev`: the page is on Vite's port and the service on its own, so
 * the request is absolute and cross-origin. `devPort: 4007`, `ui/packages/ui/src/surfaces.ts`.
 */
const BASE = 'http://localhost:4007'

/** A well-formed key. `SAFE_IDEMPOTENCY_KEY` at `market/src/server.ts`. */
const KEY = 'market-web:test:0123456789'
const UUID = '11111111-2222-3333-4444-555555555555'

let fetchStub: FetchStub

/** The one call made, as a parsed URL. Fails loudly if zero or several were made. */
function onlyCall(): {
  url: URL
  method: string
  headers: Record<string, string>
  body: string | undefined
} {
  assert.equal(fetchStub.calls.length, 1, `expected exactly one request, saw ${fetchStub.calls.length}`)
  const call = fetchStub.calls[0]
  assert.ok(call)
  return { url: new URL(call.url), method: call.method, headers: call.headers, body: call.body }
}

/** The body, parsed. Fails if there was none — a route that reads a body must be sent one. */
function bodyOf(): Record<string, unknown> {
  const call = onlyCall()
  assert.ok(call.body !== undefined, 'expected a request body')
  return JSON.parse(call.body) as Record<string, unknown>
}

beforeEach(() => {
  installWindow('http://localhost:5187/')
  installStorage()
  __resetAuth()
  fetchStub = installFetch(() => json(200, {}))
})

afterEach(() => {
  fetchStub.restore()
  removeStorage()
  removeWindow()
  __resetAuth()
})

/* ------------------------------------------------------------------ the shape of the surface */

describe('the surface itself', () => {
  it('puts /v1 on every path, because this service does', async () => {
    // The inverse of the foresight defect: micro-foresight registers BARE paths and a client that
    // added /v1 broke. micro-market registers /v1 on everything (server.ts), so a client
    // that dropped it would break the same way in the other direction.
    await listListings()
    assert.ok(onlyCall().url.pathname.startsWith('/v1/'))
  })

  it('addresses the market service, not another surface, under pnpm dev', async () => {
    await listListings()
    assert.equal(onlyCall().url.origin, BASE)
  })

  it('goes relative when the page is served from the market origin', async () => {
    removeWindow()
    installWindow('https://market.cloudsforge.online/')
    await listListings()
    assert.equal(onlyCall().url.origin, 'https://market.cloudsforge.online')
  })
})

/* ------------------------------------------------------------------ collections */

describe('GET /v1/collections — market/src/server.ts', () => {
  it('asks for /v1/collections', async () => {
    await listCollections()
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/collections')
  })

  it('sends ownerSubject, which is the only parameter the route reads (server.ts)', async () => {
    await listCollections({ ownerSubject: 'user:abc' })
    const call = onlyCall()
    assert.equal(call.url.searchParams.get('ownerSubject'), 'user:abc')
    assert.deepEqual([...call.url.searchParams.keys()], ['ownerSubject'])
  })

  it('sends no query string at all when there is no owner', async () => {
    await listCollections()
    assert.deepEqual([...onlyCall().url.searchParams.keys()], [])
  })

  it('attaches no bearer token: a shopfront behind a login is not a shopfront', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await listCollections()
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

describe('POST /v1/collections — market/src/server.ts', () => {
  it('posts to /v1/collections with the four fields the route reads (server.ts)', async () => {
    await createCollection(KEY, { slug: 'kin', name: 'Kin', description: 'A set' })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/collections')
    assert.deepEqual(JSON.parse(call.body ?? '{}'), {
      slug: 'kin',
      name: 'Kin',
      description: 'A set',
    })
  })

  it('sends the idempotency key even though this route is not wrapped', async () => {
    // server.ts does NOT call withIdempotentRoute. The key costs nothing and is the habit that
    // keeps a mutating call from ever going without one.
    await createCollection(KEY, { slug: 'kin', name: 'Kin' })
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })

  it('sends the royalties array when there is one', async () => {
    await createCollection(KEY, {
      slug: 'kin',
      name: 'Kin',
      royalties: [{ subject: 'user:a', bps: 10_000 }],
    })
    assert.deepEqual(bodyOf()['royalties'], [{ subject: 'user:a', bps: 10_000 }])
  })

  it('carries the bearer token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await createCollection(KEY, { slug: 'kin', name: 'Kin' })
    assert.equal(onlyCall().headers['authorization'], 'Bearer access-1')
  })
})

/* ------------------------------------------------------------------ listings */

describe('GET /v1/listings — market/src/server.ts', () => {
  it('asks for /v1/listings', async () => {
    await listListings()
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/listings')
  })

  it('sends nothing at all when nothing is filtered', async () => {
    // `status` defaults to `active` INSIDE the route (server.ts). Sending it explicitly would
    // be sending a value the route would have chosen anyway; sending it EMPTY would be a status no
    // row has, and the browse page would render as an empty market.
    await listListings()
    assert.deepEqual([...onlyCall().url.searchParams.keys()], [])
  })

  it('sends exactly the four parameters the route reads', async () => {
    await listListings({
      status: 'sold',
      assetKind: 'token',
      sellerSubject: 'user:a',
      collectionId: UUID,
    })
    const call = onlyCall()
    assert.deepEqual([...call.url.searchParams.keys()].sort(), [
      'assetKind',
      'collectionId',
      'sellerSubject',
      'status',
    ])
    assert.equal(call.url.searchParams.get('status'), 'sold')
    assert.equal(call.url.searchParams.get('assetKind'), 'token')
    assert.equal(call.url.searchParams.get('sellerSubject'), 'user:a')
    assert.equal(call.url.searchParams.get('collectionId'), UUID)
  })

  it('NEVER sends a limit: the route does not read one (server.ts)', async () => {
    // `listListings` accepts a limit (listings.ts) but the route never passes one, so a
    // `limit=` here would be silently ignored — worse than a 400, because the client would believe
    // it had asked. There is no way to express one through this function at all.
    await listListings({ status: 'active' })
    assert.equal(onlyCall().url.searchParams.has('limit'), false)
  })

  it('NEVER sends a text query: this service has no search route', async () => {
    await listListings({ status: 'active' })
    const params = [...onlyCall().url.searchParams.keys()]
    for (const invented of ['q', 'query', 'search', 'text']) {
      assert.equal(params.includes(invented), false, `sent an invented ${invented} parameter`)
    }
  })

  it('refuses a status the route would answer with an empty market', async () => {
    await assert.rejects(
      () => listListings({ status: 'nonsense' as never }),
      /unknown listing status/,
    )
    assert.equal(fetchStub.calls.length, 0)
  })

  it('refuses an asset kind outside the set at server.ts', async () => {
    await assert.rejects(() => listListings({ assetKind: 'weapon' as never }), /unknown asset kind/)
    assert.equal(fetchStub.calls.length, 0)
  })

  it('accepts every status the domain declares (listings.ts)', () => {
    assert.deepEqual([...LISTING_STATUSES].sort(), [
      'active',
      'cancelled',
      'draft',
      'expired',
      'settling',
      'sold',
    ])
  })

  it('accepts every asset kind the route validates (server.ts)', () => {
    assert.deepEqual([...ASSET_KINDS].sort(), [
      'brand_asset',
      'collectible',
      'entitlement',
      'game_item',
      'membership',
      'token',
    ])
  })

  it('knows the three pricing modes and the two settlement modes', () => {
    assert.deepEqual([...PRICING_MODES].sort(), ['auction', 'fixed', 'offers_only'])
    assert.deepEqual([...SETTLEMENT_MODES].sort(), ['custodial', 'onchain'])
  })

  it('browses without a token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await listListings()
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

describe('GET /v1/listings/:id — market/src/server.ts', () => {
  it('puts the id in the path, not the query string', async () => {
    await getListing(UUID)
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}`)
    assert.deepEqual([...call.url.searchParams.keys()], [])
  })

  it('escapes an id that would otherwise change the path', async () => {
    await getListing('../orders')
    // `itemIdOf` (server.ts) rejects anything that is not a uuid, but a path that
    // TRAVERSED would reach a different route entirely before that check ran.
    assert.equal(onlyCall().url.pathname, '/v1/listings/..%2Forders')
  })

  it('is public', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await getListing(UUID)
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

describe('POST /v1/listings — market/src/server.ts', () => {
  const minimal = {
    assetKind: 'game_item' as const,
    pricingMode: 'fixed' as const,
    settlementMode: 'custodial' as const,
    itemUrn: 'cf:worlds:item:1',
    itemAssetCode: 'SHARD',
    assetCode: 'SHARD',
    price: '1000',
  }

  it('posts to /v1/listings', async () => {
    await createListing(KEY, minimal)
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/listings')
  })

  it('requires the Idempotency-Key header the route demands', async () => {
    await createListing(KEY, minimal)
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })

  it('refuses a malformed key before it costs a round trip', async () => {
    // server.ts — 8 to 200 characters of [A-Za-z0-9_:.-]. A key with a space is a 400.
    await assert.rejects(() => createListing('short', minimal), /idempotency key/)
    await assert.rejects(() => createListing('has a space!!', minimal), /idempotency key/)
    assert.equal(fetchStub.calls.length, 0)
  })

  it('sends the amount as a decimal STRING, never a JSON number', async () => {
    // `parseAmount` (money.ts) refuses anything that is not a string of digits, so a
    // number here is a 400 — and, before that, a price above 2^53 would already be wrong.
    await createListing(KEY, minimal)
    assert.equal(typeof bodyOf()['price'], 'string')
    assert.equal(bodyOf()['price'], '1000')
  })

  it('sends no platformFeeBps: the route snapshots its own (server.ts)', async () => {
    await createListing(KEY, minimal)
    assert.equal('platformFeeBps' in bodyOf(), false)
  })

  it('sends no disputeWindowMs: the route sets it from settlement mode (server.ts)', async () => {
    await createListing(KEY, minimal)
    assert.equal('disputeWindowMs' in bodyOf(), false)
  })

  it('sends the royalty recipients when there are any', async () => {
    await createListing(KEY, {
      ...minimal,
      royaltyBps: 500,
      royaltyRecipients: [{ subject: 'user:a', bps: 10_000 }],
    })
    const body = bodyOf()
    assert.equal(body['royaltyBps'], 500)
    assert.deepEqual(body['royaltyRecipients'], [{ subject: 'user:a', bps: 10_000 }])
  })

  it('sends a null price for an offers-only listing rather than omitting it', async () => {
    // server.ts reads `undefined` and `null` identically, but null is the explicit
    // statement "there is no price", which is what an offers_only listing means.
    await createListing(KEY, { ...minimal, pricingMode: 'offers_only', price: null })
    assert.equal(bodyOf()['price'], null)
  })

  it('carries the bearer token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await createListing(KEY, minimal)
    assert.equal(onlyCall().headers['authorization'], 'Bearer access-1')
  })
})

describe('POST /v1/listings/:id/activate — market/src/server.ts', () => {
  it('posts to the activate path under the listing', async () => {
    await activateListing(KEY, UUID, { onchainEscrowTx: '0xabc' })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/activate`)
  })

  it('sends onchainEscrowTx and chain for an on-chain listing (server.ts)', async () => {
    await activateListing(KEY, UUID, { onchainEscrowTx: '0xabc', chain: 'ember' })
    assert.deepEqual(bodyOf(), { onchainEscrowTx: '0xabc', chain: 'ember' })
  })

  it('sends an EMPTY body for a custodial listing, because the route reads none', async () => {
    // server.ts only enters the escrow branch for `settlementMode === 'onchain'`. A field the
    // route ignores is a field a seller will believe did something.
    await activateListing(KEY, UUID)
    assert.deepEqual(bodyOf(), {})
  })

  it('carries the idempotency key', async () => {
    await activateListing(KEY, UUID)
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })
})

describe('DELETE /v1/listings/:id — market/src/server.ts', () => {
  it('sends DELETE to the listing itself', async () => {
    await cancelListing(KEY, UUID)
    const call = onlyCall()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}`)
  })

  it('sends no body: the reason is fixed by the service (server.ts)', async () => {
    await cancelListing(KEY, UUID)
    assert.equal(onlyCall().body, undefined)
  })

  it('sets no content-type, because there is no content', async () => {
    await cancelListing(KEY, UUID)
    assert.equal('content-type' in onlyCall().headers, false)
  })
})

describe('GET /v1/listings/:id/risk — market/src/server.ts', () => {
  it('asks for the risk path under the listing', async () => {
    await getListingRisk(UUID)
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/risk`)
  })

  it('is public: indicators a buyer can check are indicators a buyer can read', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await getListingRisk(UUID)
    assert.equal('authorization' in onlyCall().headers, false)
  })

  it('reads a 200 with indicatorsAvailable:false as an answer, not an error', async () => {
    // The route FAILS OPEN (server.ts): an unreachable indexer is a 200. A client that
    // only checked the status learns nothing, which is why escrow.ts reads the flag.
    fetchStub.restore()
    fetchStub = installFetch(() => json(200, { verification: null, indicators: [], indicatorsAvailable: false }))
    const risk = await getListingRisk(UUID)
    assert.equal(risk.indicatorsAvailable, false)
  })
})

/* ------------------------------------------------------------------ buying */

describe('POST /v1/listings/:id/buy — market/src/server.ts', () => {
  it('posts to the buy path with the amount only (server.ts)', async () => {
    await buyListing(KEY, UUID, { amount: '1000' })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/buy`)
    assert.deepEqual(JSON.parse(call.body ?? '{}'), { amount: '1000' })
  })

  it('sends no buyer subject: the route takes it from the token (server.ts)', async () => {
    await buyListing(KEY, UUID, { amount: '1000' })
    const body = bodyOf()
    assert.equal('buyerSubject' in body, false)
    assert.equal('buyer' in body, false)
  })

  it('carries the idempotency key, which is what stops a double click charging twice', async () => {
    await buyListing(KEY, UUID, { amount: '1000' })
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })

  it('sends the same key twice for one intent, so a retry replays', async () => {
    await buyListing(KEY, UUID, { amount: '1000' })
    await buyListing(KEY, UUID, { amount: '1000' })
    assert.equal(fetchStub.calls.length, 2)
    assert.equal(fetchStub.calls[0]?.headers['idempotency-key'], KEY)
    assert.equal(fetchStub.calls[1]?.headers['idempotency-key'], KEY)
  })
})

describe('GET /v1/listings/:id/bids — market/src/server.ts', () => {
  it('asks for the bids path with no parameters', async () => {
    await listBids(UUID)
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/bids`)
    assert.deepEqual([...call.url.searchParams.keys()], [])
  })

  it('is public: who is bidding what IS the auction', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    await listBids(UUID)
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

describe('POST /v1/listings/:id/bids — market/src/server.ts', () => {
  it('posts the amount, and only the amount (server.ts)', async () => {
    await placeBid(KEY, UUID, { amount: '1200' })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/bids`)
    assert.deepEqual(JSON.parse(call.body ?? '{}'), { amount: '1200' })
  })

  it('carries the idempotency key', async () => {
    await placeBid(KEY, UUID, { amount: '1200' })
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })
})

describe('the bid_too_low refusal — market/src/server.ts', () => {
  it('reads `minimum` off the parsed body rather than out of the sentence', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() =>
      json(409, {
        error: {
          code: 'bid_too_low',
          message: 'a bid must beat 1200',
          minimum: '1201',
          requestId: 'req-1',
        },
      }),
    )
    const err = await placeBid(KEY, UUID, { amount: '1200' }).catch((e: unknown) => e)
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 409)
    assert.equal(err.code, 'bid_too_low')
    // The message contains 1200, the minimum is 1201. A regex over the prose would find the wrong
    // one — which a bidder would then type and be refused again.
    assert.equal(bidMinimum(err), '1201')
  })

  it('answers null when the field is absent rather than guessing', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() =>
      json(409, { error: { code: 'bid_too_low', message: 'too low', requestId: 'req-1' } }),
    )
    const err = await placeBid(KEY, UUID, { amount: '1' }).catch((e: unknown) => e)
    assert.equal(bidMinimum(err), null)
  })

  it('answers null when the field is not a decimal string', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() =>
      json(409, { error: { code: 'bid_too_low', message: 'too low', minimum: 1201 } }),
    )
    const err = await placeBid(KEY, UUID, { amount: '1' }).catch((e: unknown) => e)
    assert.equal(bidMinimum(err), null, 'a JSON number is not an amount')
  })

  it('answers null for any other refusal', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() => json(409, { error: { code: 'state_conflict', message: 'sold' } }))
    const err = await placeBid(KEY, UUID, { amount: '1' }).catch((e: unknown) => e)
    assert.equal(bidMinimum(err), null)
  })

  it('answers null for something that is not an ApiError at all', () => {
    assert.equal(bidMinimum(new Error('boom')), null)
    assert.equal(bidMinimum(null), null)
  })
})

/* ------------------------------------------------------------------ offers */

describe('GET /v1/listings/:id/offers — market/src/server.ts', () => {
  it('asks for the offers path with no parameters', async () => {
    await listOffers(UUID)
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/offers`)
    assert.deepEqual([...call.url.searchParams.keys()], [])
  })
})

describe('POST /v1/listings/:id/offers — market/src/server.ts', () => {
  it('posts the amount', async () => {
    await makeOffer(KEY, UUID, { amount: '900' })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/offers`)
    assert.deepEqual(JSON.parse(call.body ?? '{}'), { amount: '900' })
  })

  it('OMITS expiresAt rather than sending an empty string', async () => {
    // `readDate` (server.ts) refuses anything that is not a valid ISO 8601 string, so
    // `expiresAt: ''` is a 400 — and an absent field is the documented way to say "no expiry".
    await makeOffer(KEY, UUID, { amount: '900', expiresAt: '' })
    assert.equal('expiresAt' in bodyOf(), false)
  })

  it('sends expiresAt when there is one', async () => {
    await makeOffer(KEY, UUID, { amount: '900', expiresAt: '2026-09-01T00:00:00.000Z' })
    assert.equal(bodyOf()['expiresAt'], '2026-09-01T00:00:00.000Z')
  })

  it('carries the idempotency key', async () => {
    await makeOffer(KEY, UUID, { amount: '900' })
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })
})

describe('DELETE /v1/offers/:id — market/src/server.ts', () => {
  it('sends DELETE to the offer, NOT to a path under the listing', async () => {
    // The offer routes are top-level: /v1/offers/:id, not /v1/listings/:id/offers/:id.
    await withdrawOffer(KEY, UUID)
    const call = onlyCall()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url.pathname, `/v1/offers/${UUID}`)
    assert.equal(call.url.pathname.includes('/listings/'), false)
  })

  it('sends no body: `to: withdrawn` is fixed by the service (server.ts)', async () => {
    await withdrawOffer(KEY, UUID)
    assert.equal(onlyCall().body, undefined)
  })
})

describe('the listing image routes — market/src/server.ts, the listing-images section', () => {
  const ASSET = 'aaaaaaaa-1111-4111-8111-111111111111'
  const CHECKSUM = `sha256:${'a'.repeat(64)}`

  it('reads the image config without a token, because it is configuration and not data', async () => {
    await getImageConfig()
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/images/config')
    // No Authorization: the sell page must be able to tell a signed-out visitor whether images
    // work on this deployment at all.
    assert.equal(call.headers['authorization'], undefined)
  })

  it('attaches by REFERENCE — an asset id and a checksum, never bytes', async () => {
    await attachListingImage(KEY, UUID, { studioAssetId: ASSET, checksum: CHECKSUM })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/images`)
    // The bytes went to micro-studio. This service holds a reference and authorises it; a body
    // here carrying anything image-shaped would mean the estate had grown a second media service.
    assert.deepEqual(bodyOf(), { studioAssetId: ASSET, checksum: CHECKSUM })
  })

  it('sends the checksum in studio’s exact spelling, because the column checks the shape', async () => {
    await attachListingImage(KEY, UUID, { studioAssetId: ASSET, checksum: CHECKSUM })
    // `listing_images_checksum_shape` is `^sha256:[0-9a-f]{64}$`. A bare digest or an uppercase one
    // is a 400 — and, worse, would compare unequal to studio’s own row for the same bytes for ever.
    assert.match(String(bodyOf()['checksum']), /^sha256:[0-9a-f]{64}$/)
  })

  it('carries an Idempotency-Key on the attach, which the service requires', async () => {
    await attachListingImage(KEY, UUID, { studioAssetId: ASSET, checksum: CHECKSUM })
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })

  it('detaches at the asset under the listing, and sends no body', async () => {
    await detachListingImage(KEY, UUID, ASSET)
    const call = onlyCall()
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/images/${ASSET}`)
    assert.equal(call.body, undefined)
  })

  it('reorders with a PUT of the WHOLE gallery, in array order', async () => {
    const second = 'bbbbbbbb-2222-4222-8222-222222222222'
    await setListingGallery(KEY, UUID, [
      { studioAssetId: second, checksum: CHECKSUM },
      { studioAssetId: ASSET, checksum: CHECKSUM },
    ])
    const call = onlyCall()
    assert.equal(call.method, 'PUT')
    assert.equal(call.url.pathname, `/v1/listings/${UUID}/images`)
    // Position is the INDEX. There is no `position` field, and sending one would be sending a field
    // the route does not read.
    const images = bodyOf()['images'] as Record<string, unknown>[]
    assert.deepEqual(images.map((image) => image['studioAssetId']), [second, ASSET])
    assert.equal(Object.hasOwn(images[0] ?? {}, 'position'), false)
  })
})

describe('POST /v1/offers/:id/accept — market/src/server.ts', () => {
  it('posts to the accept path under the offer', async () => {
    await acceptOffer(KEY, UUID)
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/offers/${UUID}/accept`)
  })

  it('sends NO amount: it settles at the offer’s amount, not the listing’s price', async () => {
    // server.ts passes `offer.amount`. An `amount` here would be a field the route ignores —
    // and the fingerprint is taken over `{ offerId }` alone (server.ts), so it would not even
    // change the idempotency behaviour.
    await acceptOffer(KEY, UUID)
    assert.equal(onlyCall().body, undefined)
  })

  it('carries the idempotency key', async () => {
    await acceptOffer(KEY, UUID)
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })
})

/* ------------------------------------------------------------------ orders and disputes */

describe('GET /v1/orders — market/src/server.ts', () => {
  it('asks for /v1/orders with the role', async () => {
    await listOrders({ role: 'seller' })
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/orders')
    assert.equal(call.url.searchParams.get('role'), 'seller')
    assert.deepEqual([...call.url.searchParams.keys()], ['role'])
  })

  it('sends `buyer` as a literal rather than relying on the route’s fallback', async () => {
    // server.ts reads `=== 'seller' ? 'seller' : 'buyer'`, so ANY other string means buyer.
    // Sending the literal makes the request say what it means.
    await listOrders({ role: 'buyer' })
    assert.equal(onlyCall().url.searchParams.get('role'), 'buyer')
  })

  it('refuses a role that would silently become `buyer`', async () => {
    await assert.rejects(() => listOrders({ role: 'admin' as never }), /role must be/)
    assert.equal(fetchStub.calls.length, 0)
  })

  it('sends no subject: the route derives it from the token (server.ts)', async () => {
    await listOrders({ role: 'buyer' })
    const params = [...onlyCall().url.searchParams.keys()]
    assert.equal(params.includes('buyerSubject'), false)
    assert.equal(params.includes('subject'), false)
  })

  it('carries the bearer token, because there is nothing to return without one', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await listOrders({ role: 'buyer' })
    assert.equal(onlyCall().headers['authorization'], 'Bearer access-1')
  })
})

describe('GET /v1/orders/:id — market/src/server.ts', () => {
  it('puts the id in the path', async () => {
    await getOrder(UUID)
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, `/v1/orders/${UUID}`)
  })

  it('carries the bearer token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await getOrder(UUID)
    assert.equal(onlyCall().headers['authorization'], 'Bearer access-1')
  })

  it('lets a 404 stay a 404 — "not yours" and "does not exist" are one answer', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() => json(404, { error: { code: 'not_found', message: 'no such order' } }))
    const err = await getOrder(UUID).catch((e: unknown) => e)
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 404)
    assert.equal(err.code, 'not_found')
  })
})

describe('POST /v1/orders/:id/disputes — market/src/server.ts', () => {
  it('posts to the disputes path under the order', async () => {
    await openDispute(KEY, UUID, { reason: 'never arrived' })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, `/v1/orders/${UUID}/disputes`)
  })

  it('sends the reason, and only the reason (server.ts)', async () => {
    await openDispute(KEY, UUID, { reason: 'never arrived' })
    assert.deepEqual(bodyOf(), { reason: 'never arrived' })
  })

  it('carries the idempotency key — the fix for two disputes from one click', async () => {
    // server.ts: `openDispute` is a plain INSERT with no natural-key uniqueness, so an
    // unwrapped retry opened TWO disputes on one order and froze the listing twice.
    await openDispute(KEY, UUID, { reason: 'never arrived' })
    assert.equal(onlyCall().headers['idempotency-key'], KEY)
  })

  it('sends no raiser subject: the route takes it from the token (server.ts)', async () => {
    await openDispute(KEY, UUID, { reason: 'x' })
    assert.equal('raiserSubject' in bodyOf(), false)
  })
})

/* ------------------------------------------------------------------ verification */

describe('GET /v1/verifications/:urn — market/src/server.ts', () => {
  it('percent-encodes the URN into one path segment', async () => {
    await getVerification('cf:market:item:abc')
    assert.equal(onlyCall().url.pathname, '/v1/verifications/cf%3Amarket%3Aitem%3Aabc')
  })

  it('encodes a slash, which would otherwise split into two segments and match no route', async () => {
    await getVerification('cf:market:item:a/b')
    const path = onlyCall().url.pathname
    assert.equal(path, '/v1/verifications/cf%3Amarket%3Aitem%3Aa%2Fb')
    assert.equal(path.split('/').length, 4)
  })

  it('is public', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    await getVerification('cf:market:item:abc')
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

/* ------------------------------------------------------------------ what is never called */

describe('the operator-only routes are never called from this surface', () => {
  /**
   * `GET /v1/disputes` (server.ts), `POST /v1/disputes/:id/resolve` (1025),
   * `GET|POST /v1/moderation/cases` (1051, 1064), `POST /v1/moderation/cases/:id/resolve` (1086)
   * and `PUT /v1/verifications/:urn` (1112) all call `requireOperator`. This is a buyer-and-seller
   * surface: calling any of them would be building a 403 into a page and then explaining it.
   */
  const forbidden = [
    '/v1/disputes',
    '/v1/moderation/cases',
    '/v1/events',
  ]

  it('exports no function that reaches an operator route', async () => {
    const client = await import('../src/lib/market.ts')
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/lib/market.ts', import.meta.url), 'utf8'),
    )
    assert.ok(Object.keys(client).length > 10, 'the client should export its calls')
    for (const path of forbidden) {
      // The path may be NAMED in a comment explaining why it is not called; what must not exist is
      // a call that builds it. Every call in this file goes through `api('<literal>')`.
      assert.equal(
        source.includes(`api('${path}'`),
        false,
        `${path} is an operator route and must not be called from this surface`,
      )
      assert.equal(source.includes(`api(\`${path}`), false, `${path} must not be called`)
    }
  })
})
