/**
 * Every request this app makes to `micro-market`, and the line of its route table each one was
 * verified against.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE ADDING A CALL.
 *
 * This estate has now shipped SEVEN clients written against a surface somebody imagined rather
 * than the one the service registers. Three of them were inside `micro-market` itself. The two
 * that are written down in 18-build-status §3.3:
 *
 *   - `micro-wallet` called `POST /v1/quotes`; `micro-pricing` serves `/rates`.
 *   - `micro-market` called `POST /v1/decisions/market.listing`; `micro-policy` has NO `/v1`
 *     routes at all, takes the action in the body, and registers `market.listing.create`. The
 *     failure was reported as the moderation gate being BYPASSED; it was the opposite —
 *     `peerDecided` is true for any 4xx, so the 404 landed on the `deny` branch and
 *     `market/src/server.ts` turned it into a 403. **Every listing creation returned 403.**
 *
 * Every path below names `market/src/server.ts`, read out of `buildRoutes()`, which is the only
 * place a route is declared in that service. It names the FILE and not a line in it: a line names a
 * position in a file micro-market owns and is free to edit, and half the numbers this header used
 * to carry had already drifted onto unrelated code. `test/market.test.ts` asserts the REQUEST — path, method, query string, body, and
 * headers — for every call in this file, because a test that stubs `fetch` and checks the parsed
 * response passes just as happily against a path that does not exist.
 *
 * ── Two things about this service's shape, both easy to get wrong ─────────────────────────────
 *
 * 1. **EVERY MUTATING ROUTE REQUIRES `Idempotency-Key`** (server.ts). Not optional.
 *    A request without one is a 400 before anything else happens. See `idempotency.ts`.
 * 2. **A mutating route answers 201 on the first attempt and 200 with `replayed: true` on a
 *    replay** (server.ts). `replayed` is not an error; it is how a client tells "I
 *    created this" from "this already existed", and translating it into a failure is how a
 *    completed purchase gets reported to a customer as a broken one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { ApiError, api, type RequestOptions } from './api.ts'
import { idempotentHeaders } from './idempotency.ts'

/* ------------------------------------------------------------------ the domain, as it is sent */

/** `AssetKind` — `market/src/listings.ts`, and the set `server.ts` validates. */
export type AssetKind =
  | 'token'
  | 'game_item'
  | 'entitlement'
  | 'membership'
  | 'brand_asset'
  | 'collectible'

export const ASSET_KINDS: readonly AssetKind[] = [
  'token',
  'game_item',
  'entitlement',
  'membership',
  'brand_asset',
  'collectible',
]

/** `PricingMode` — `listings.ts`, validated at `server.ts`. */
export type PricingMode = 'fixed' | 'auction' | 'offers_only'
export const PRICING_MODES: readonly PricingMode[] = ['fixed', 'auction', 'offers_only']

/** `SettlementMode` — `listings.ts`, validated at `server.ts`. */
export type SettlementMode = 'custodial' | 'onchain'
export const SETTLEMENT_MODES: readonly SettlementMode[] = ['custodial', 'onchain']

/**
 * **The asset code a new listing starts as: nothing.** There is no default, and this constant is
 * the name of that hole rather than a value standing in for one.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THERE IS NO DEFAULT, WRITTEN OUT BECAUSE THE OBVIOUS EDIT IS TO PUT ONE BACK
 *
 * `src/pages/sell.tsx` opened every create-listing form with `useState('SHARD')` — for the price
 * asset and for the item asset — and rendered both as the visible value of a text input. SHARD was
 * retired on 2026-08-04 (`RETIRED_ASSETS = Object.freeze(['SHARD'])`,
 * `contracts/packages/chain/src/index.ts`; the sibling `assertIssuable` throws for exactly this
 * reason: "a retired asset arriving on a write path is a configuration error"). So the default
 * offered every seller a listing denominated in an asset nothing may newly be denominated in, and
 * a seller who did not edit the field got one. That is `cloudsforge-online/micro-org` #227 §2, and
 * it is the THIRD retired-asset reference to reach a user surface — #15 and #182 were the others.
 *
 * The obvious repair is `useState('EMBER')`. It is refused here, and there are three reasons, in
 * increasing order of how much they matter.
 *
 *   1. It is the same edit that produced the defect. A typed asset code goes stale in silence:
 *      the code that was right the day it was typed is the code that is wrong the day it is
 *      retired, and nothing in this repository would notice — which is precisely what happened.
 *
 *   2. **There is no list here to derive it from, and the ones nearby are the wrong set.** This
 *      bundle depends on `@cloudsforge/ui`, react and react-router and nothing else — no
 *      `@cloudsforge/contracts-*`, deliberately (`src/lib/money.ts` restates the decimals it needs
 *      "rather than imported because this bundle does not depend on `@cloudsforge/contracts`").
 *      Even with the dependency, `contracts/packages/chain`'s `ON_CHAIN_ASSETS` is NOT the set this
 *      field accepts: `market/src/server.ts` types it `LedgerAssetCode`, which is
 *      `AssetCode | 'USD' | TokenAssetCode` (`contracts/packages/money/src/index.ts`), and a
 *      `TOKEN:<address>` code is unbounded — `src/lib/money.ts` handles exactly that case and
 *      refuses to guess its decimals. A `<select>` built from the chain assets would quietly stop
 *      a seller listing in a token the market really does take. An enumerated control over a set
 *      that is not the accepted set is a plausible screen over nothing.
 *
 *   3. **Nothing tells this page which asset this seller should be paid in.** `micro-market`
 *      registers no assets route — the 23 routes it serves are enumerated in `.github/workflows/
 *      ci.yml`, and none of them answers "what may I denominate in" — and `market/src/server.ts`
 *      validates the field with `requireString` alone, so the service itself has no list either.
 *      The seller's own past listings are not an answer: those are exactly where the retired code
 *      still lives.
 *
 * So the honest default is the absence of one, and the seller is made to choose. `micro-org` #227
 * records what was already right and must not change with it: `src/components/money.tsx` renders
 * whatever `assetCode` the server sent, and `src/lib/money.ts` keeps `SHARD: 0` because 114 live
 * SHARD accounts are still supervised. Retired means "nothing new may be denominated in it", not
 * "unknown" — reading and writing are different rules, and only the WRITE path is wrong here.
 *
 * `test/sell-form.test.ts` binds this: it fails if any asset code this bundle can name is typed
 * into a page as a `useState` initialiser again.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const UNCHOSEN_ASSET_CODE = ''

/**
 * Has the seller actually chosen an asset code?
 *
 * Trimmed, because `requireString` in `market/src/server.ts` trims before it checks
 * (`typeof value !== 'string' || value.trim().length === 0` → 400 `assetCode is required`). A form
 * that let a space through would send a request the service refuses, and the reader would be shown
 * a 400 for a field that looks filled in.
 */
export function assetCodeChosen(code: string): boolean {
  return code.trim() !== ''
}

/** `ListingStatus` — `listings.ts`. The browse route defaults to `active` (server.ts). */
export type ListingStatus = 'draft' | 'active' | 'settling' | 'sold' | 'cancelled' | 'expired'
export const LISTING_STATUSES: readonly ListingStatus[] = [
  'draft',
  'active',
  'settling',
  'sold',
  'cancelled',
  'expired',
]

/** `VerificationLevel` — `listings.ts`, validated at `server.ts`. */
export type VerificationLevel = 'unverified' | 'claimed' | 'verified' | 'flagged'

/** `IndicatorCode` — the closed set at `market/src/risk.ts`. */
export type IndicatorCode =
  | 'mint_authority_present'
  | 'ownership_not_renounced'
  | 'supply_concentrated'
  | 'recently_deployed'
  | 'deployer_wallet_exported'
  | 'few_holders'

/**
 * One listing, exactly as `listingWire` emits it — `market/src/server.ts`.
 *
 * Mirrored narrowly on purpose. **The reserve price is NOT on the wire** (server.ts:
 * "It is the seller's secret floor, and publishing it would tell every bidder exactly what to
 * bid"), and adding a `reservePrice` field here would produce `undefined` at runtime with no type
 * error at all — which is how a UI comes to render a seller's floor as blank rather than as
 * absent.
 *
 * `escrowed` is a boolean over two different facts: `escrowId !== null || onchainEscrowTx !== null`
 * (server.ts). It says an escrow reference EXISTS. It does not say the chain confirmed it,
 * and `src/lib/escrow.ts` is where that distinction is kept.
 */
export interface ListingView {
  readonly id: string
  readonly sellerSubject: string
  readonly collectionId: string | null
  readonly assetKind: AssetKind
  readonly itemUrn: string
  /** Smallest units, decimal string. Never a JSON number — server.ts. */
  readonly quantity: string
  readonly itemAssetCode: string
  readonly pricingMode: PricingMode
  /** `null` for an `offers_only` listing, and for an auction with no starting price. */
  readonly price: string | null
  readonly assetCode: string
  readonly settlementMode: SettlementMode
  readonly royaltyBps: number
  readonly platformFeeBps: number
  readonly auctionEndsAt: string | null
  readonly expiresAt: string | null
  readonly status: ListingStatus
  /** Frozen by a moderation case or by an open dispute — `market/src/moderation.ts`. */
  readonly frozen: boolean
  /** An escrow reference exists. NOT "the chain confirmed it". See `escrow.ts`. */
  readonly escrowed: boolean
  readonly createdAt: string
  /**
   * The gallery, in position order, on BOTH listing reads.
   *
   * Optional on this type rather than required, because it arrives from a service that may be older
   * than this bundle: a browse response from a market without galleries has no `images` key at all,
   * and a required field would type that as an array while it is `undefined` at runtime — which is
   * `.map` on undefined at the top of a page. Every reader takes `?? []`.
   */
  readonly images?: readonly ListingImageView[]
}

/**
 * One image in a listing's gallery — `imageWire`, `market/src/server.ts`.
 *
 * ── Two fields that are easy to read as more than they are ────────────────────────────────────
 *
 * **`bytesUrl` is nullable, and null is the normal case today.** The service composes it from
 * `STUDIO_PUBLIC_URL`, and when that is unset it answers `null` rather than the relative
 * `/v1/assets/<id>/bytes` that studio's own responses carry — because a relative path would resolve
 * against the page's origin, ask `micro-market` for the bytes, and 404 with nothing to explain it.
 * There is no public studio hostname in the estate at the time of writing (no router in
 * `deploy/gateway/dynamic/`, no `studio` entry in the surface registry), so a client that assumed a
 * string here would render a broken image on every listing. `<Gallery>` says so out loud instead.
 *
 * **`checksum` is a RECORDED content address and nothing else.** It is `sha256:<64 lowercase hex>`,
 * the spelling studio and tessera both use, and it is on the wire so an operator can ask studio
 * about those exact bytes. It is NOT evidence: market never fetches the asset and never recomputes
 * the digest (`market/src/listingimages.ts` says so at length), and there is no chain behind it —
 * Hearth has no Registry of Authorship contract, so studio's own `anchor.state` is `'unanchored'`
 * on every asset that exists. Nothing in this app may render it as "verified", "attested",
 * "anchored" or "on-chain". A tick that always appears is worse than no tick.
 */
export interface ListingImageView {
  readonly studioAssetId: string
  readonly checksum: string
  /** Dense and zero-based; the service keeps `0 … n-1` with no gaps. */
  readonly position: number
  /** Absolute, or `null` when this deployment has not been told where a browser reaches studio. */
  readonly bytesUrl: string | null
}

/** The royalty split as `GET /v1/listings/:id` returns it — `server.ts`. Bps, not amounts. */
export interface RoyaltySplitEntry {
  readonly subject: string
  readonly bps: number
}

export interface ListingDetail {
  readonly listing: ListingView
  readonly royalties: readonly RoyaltySplitEntry[]
  /**
   * The gallery, alongside the listing rather than behind a call of its own.
   *
   * It is on the detail response AND on each listing in the browse response, so a card can show a
   * picture without a second round trip. Same reason it is optional here as on `ListingView`.
   */
  readonly images?: readonly ListingImageView[]
}

/** `Verification` — `market/src/listings.ts`. `reviewedAt` is an ISO string on the wire. */
export interface VerificationView {
  readonly subjectUrn: string
  readonly level: VerificationLevel
  readonly evidence: Record<string, unknown>
  readonly reviewedBy: string | null
  readonly reviewedAt: string | null
}

/** One computed risk indicator — `market/src/risk.ts`. */
export interface Indicator {
  readonly code: IndicatorCode
  /** True when the condition HOLDS. A false indicator is still shown: absence is information. */
  readonly present: boolean
  /** The number the condition was evaluated against, so a buyer can see the working. */
  readonly detail: string
}

/**
 * `GET /v1/listings/:id/risk` — `server.ts`.
 *
 * `indicatorsAvailable` is the whole point of this shape. server.ts: "Said explicitly
 * rather than inferred from an empty array. 'We have no indicators' and 'we could not fetch them'
 * must not look the same to a client, or a broken indexer renders as a clean bill of health."
 *
 * The route fails OPEN — it answers 200 with `indicatorsAvailable: false` when the indexer is
 * unreachable — so a client that only checks the status code learns nothing.
 */
export interface RiskView {
  readonly verification: VerificationView | null
  readonly indicators: readonly Indicator[]
  readonly indicatorsAvailable: boolean
}

/** One bid, as `server.ts` emits it. */
export interface BidView {
  readonly id: string
  readonly bidderSubject: string
  readonly amount: string
  readonly assetCode: string
  readonly status: string
  readonly placedAt: string
}

/** One offer — `offerWire`, `server.ts`. */
export interface OfferView {
  readonly id: string
  readonly listingId: string
  readonly offererSubject: string
  readonly amount: string
  readonly assetCode: string
  readonly status: string
  readonly expiresAt: string | null
  readonly createdAt: string
}

/** One royalty payment on a settled order — `orderWire`, `server.ts`. */
export interface OrderRoyalty {
  readonly subject: string
  /** Smallest units, decimal string. */
  readonly amount: string
}

/**
 * One order — `orderWire`, `market/src/server.ts`.
 *
 * `amount`, `feeAmount`, `royaltyAmount` and `sellerProceeds` are a PARTITION: the last three sum
 * to the first, exactly, by construction (`market/src/money.ts`). `src/lib/money.ts`
 * checks that here rather than assuming it, and the order page shows the sum.
 *
 * There is no dispute field on this shape. See `disputeReadableBy` below.
 */
export interface OrderView {
  readonly id: string
  readonly listingId: string
  readonly buyerSubject: string
  readonly sellerSubject: string
  readonly itemUrn: string
  readonly quantity: string
  readonly amount: string
  readonly feeAmount: string
  readonly royaltyAmount: string
  readonly sellerProceeds: string
  readonly assetCode: string
  readonly settlementMode: SettlementMode
  readonly journalEntryId: string | null
  readonly outboundTransactionId: string | null
  readonly source: 'purchase' | 'auction' | 'offer'
  /** `held` until the dispute window runs — `market/src/orders.ts`. */
  readonly proceedsState: 'held' | 'released'
  readonly payoutDueAt: string | null
  readonly settledAt: string
  readonly royalties: readonly OrderRoyalty[]
}

/** One dispute — `disputeWire`, `server.ts`. */
export interface DisputeView {
  readonly id: string
  readonly orderId: string
  readonly raiserSubject: string
  readonly reason: string
  /** `DisputeState` — `market/src/moderation.ts`. */
  readonly state: 'open' | 'resolved_refunded' | 'resolved_upheld' | 'withdrawn'
  readonly resolutionEntryId: string | null
  readonly openedAt: string
}

/** One collection — `market/src/listings.ts`, returned unmapped by `server.ts`. */
export interface CollectionView {
  readonly id: string
  readonly ownerSubject: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly royalties: readonly RoyaltySplitEntry[]
}

/** Policy's verdict, echoed on a created listing — `server.ts`. */
export interface PolicyVerdict {
  readonly decision: string
  readonly reasons: readonly string[]
  /** True when policy was unreachable and the listing was allowed through and flagged. */
  readonly degraded: boolean
}

/* ------------------------------------------------------------------ reads */

/**
 * `GET /v1/collections` — **`market/src/server.ts`**.
 *
 * The only query parameter the route reads is `ownerSubject` (server.ts). Public: no bearer
 * token is attached, because a collection is a shopfront and a shopfront behind a login is not one.
 */
export async function listCollections(
  query: { ownerSubject?: string } = {},
  opts: RequestOptions = {},
): Promise<{ collections: readonly CollectionView[] }> {
  return api('/v1/collections', {
    auth: false,
    ...opts,
    ...(query.ownerSubject ? { query: { ownerSubject: query.ownerSubject } } : {}),
  })
}

/**
 * `GET /v1/listings` — **`market/src/server.ts`**.
 *
 * The route reads exactly four parameters, and nothing else: `status` (server.ts),
 * `assetKind` (620), `sellerSubject` (626) and `collectionId` (629).
 *
 * **There is no `limit` and no `q`.** `listListings` accepts a limit (`listings.ts`) but the
 * ROUTE never passes one, so the page size is the function's default of 50 and a `limit=` on the
 * query string would be silently ignored — which is worse than a 400, because the client would
 * believe it had asked. Text search is done in this bundle over what the route returned; see
 * `search.ts`, which says so on screen rather than implying the whole market was searched.
 *
 * `status` is OMITTED rather than sent empty when it is not wanted: `server.ts` reads
 * `status ?? 'active'`, so an empty string becomes a status no row has and the browse page would
 * render as an empty market.
 */
export async function listListings(
  query: {
    status?: ListingStatus
    assetKind?: AssetKind
    sellerSubject?: string
    collectionId?: string
  } = {},
  opts: RequestOptions = {},
): Promise<{ listings: readonly ListingView[] }> {
  if (query.status !== undefined && !LISTING_STATUSES.includes(query.status)) {
    throw new RangeError(`unknown listing status: ${query.status}`)
  }
  if (query.assetKind !== undefined && !ASSET_KINDS.includes(query.assetKind)) {
    throw new RangeError(`unknown asset kind: ${query.assetKind}`)
  }
  return api('/v1/listings', {
    auth: false,
    ...opts,
    query: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.assetKind ? { assetKind: query.assetKind } : {}),
      ...(query.sellerSubject ? { sellerSubject: query.sellerSubject } : {}),
      ...(query.collectionId ? { collectionId: query.collectionId } : {}),
    },
  })
}

/**
 * `GET /v1/listings/:id` — **`market/src/server.ts`**.
 *
 * Returns the listing AND its royalty split in basis points (server.ts). Public.
 */
export async function getListing(id: string, opts: RequestOptions = {}): Promise<ListingDetail> {
  return api(`/v1/listings/${encodeURIComponent(id)}`, { auth: false, ...opts })
}

/**
 * `GET /v1/listings/:id/risk` — **`market/src/server.ts`**.
 *
 * FAILS OPEN by design: an unreachable indexer answers 200 with `indicatorsAvailable: false`
 * (server.ts), never a 5xx. A caller must read that flag; the status code says nothing.
 */
export async function getListingRisk(id: string, opts: RequestOptions = {}): Promise<RiskView> {
  return api(`/v1/listings/${encodeURIComponent(id)}/risk`, { auth: false, ...opts })
}

/**
 * `GET /v1/listings/:id/bids` — **`market/src/server.ts`**.
 *
 * Public, and unauthenticated: who is bidding what is the auction. The route takes no query
 * parameters at all.
 */
export async function listBids(
  listingId: string,
  opts: RequestOptions = {},
): Promise<{ bids: readonly BidView[] }> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/bids`, { auth: false, ...opts })
}

/** `GET /v1/listings/:id/offers` — **`market/src/server.ts`**. Public; no query parameters. */
export async function listOffers(
  listingId: string,
  opts: RequestOptions = {},
): Promise<{ offers: readonly OfferView[] }> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/offers`, { auth: false, ...opts })
}

/**
 * `GET /v1/images/config` — **`market/src/server.ts`**, the `/v1/images/config` route.
 *
 * Where a browser sends image bytes, and how many images a listing may hold. Public and
 * unauthenticated, because it is configuration rather than data: the sell page has to be able to
 * tell a signed-out visitor whether images work on this deployment at all.
 *
 * **`uploadUrl: null` is the answer today**, and a caller must render that state rather than a
 * control that cannot work. The value comes from `STUDIO_PUBLIC_URL` in the service's environment;
 * there is no public studio hostname in the estate yet, so it is unset. This app cannot compose one
 * itself — `@cloudsforge/ui`'s registry has no `studio` key, and a hostname invented here would be
 * one nothing serves.
 */
export async function getImageConfig(opts: RequestOptions = {}): Promise<{
  uploadUrl: string | null
  maxImagesPerListing: number
  acceptedMediaTypes: readonly string[]
}> {
  return api('/v1/images/config', { auth: false, ...opts })
}

/**
 * `POST /v1/listings/:id/images` — **`market/src/server.ts`**, the listing-images section.
 *
 * Attaches an asset ALREADY UPLOADED to micro-studio; the bytes never pass through market. Body:
 * `studioAssetId` and `checksum`, both required, the checksum in studio's exact spelling
 * (`sha256:<64 lowercase hex>`) or the service answers 400.
 *
 * Wrapped in `withIdempotentRoute`, so it answers 201 the first time and 200 with `replayed: true`
 * on a retry of the same key — never an error. Only the listing's seller may call it, and anyone
 * else gets **404**, not 403: "exists but is not yours" as a distinct status is an oracle for who is
 * selling what. A listing that is `sold`, `settling`, `cancelled` or `expired` answers 409 — its
 * photographs are part of the record of what was sold.
 *
 * The image is appended to the end of the gallery. There is no `position` field; use
 * `setListingGallery` to order them.
 */
export async function attachListingImage(
  key: string,
  listingId: string,
  body: { studioAssetId: string; checksum: string },
  opts: RequestOptions = {},
): Promise<{ image: ListingImageView; images: readonly ListingImageView[] } & Replayable> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/images`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * `DELETE /v1/listings/:id/images/:assetId` — **`market/src/server.ts`**.
 *
 * Unsays a reference. The asset itself is NOT deleted: studio owns it, and the user may be showing
 * it on another listing.
 *
 * Detaching something that is not attached answers 200 with `detached: false` rather than 404 — the
 * caller asked for a gallery without that image and that is the gallery they have, so a retried
 * DELETE does not report a failure for work that succeeded. The key is still sent, as everywhere
 * else on this surface.
 */
export async function detachListingImage(
  key: string,
  listingId: string,
  studioAssetId: string,
  opts: RequestOptions = {},
): Promise<{ detached: boolean; images: readonly ListingImageView[] }> {
  return api(
    `/v1/listings/${encodeURIComponent(listingId)}/images/${encodeURIComponent(studioAssetId)}`,
    { method: 'DELETE', headers: idempotentHeaders(key), ...opts },
  )
}

/**
 * `PUT /v1/listings/:id/images` — **`market/src/server.ts`**.
 *
 * The COMPLETE gallery, in the order it should render: an entry not already attached is attached,
 * an attached asset left out is detached, and the array index becomes the position. That is why it
 * is a PUT and why it needs no idempotency wrapper — the same body twice leaves the same gallery.
 *
 * There is deliberately no "move image 3 to position 1" call to use instead: two clients issuing two
 * moves against one gallery produce an ordering neither asked for.
 */
export async function setListingGallery(
  key: string,
  listingId: string,
  images: readonly { studioAssetId: string; checksum: string }[],
  opts: RequestOptions = {},
): Promise<{ images: readonly ListingImageView[] }> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/images`, {
    method: 'PUT',
    headers: idempotentHeaders(key),
    body: { images },
    ...opts,
  })
}

/**
 * `GET /v1/orders` — **`market/src/server.ts`**.
 *
 * Authenticated: the route derives the subject from the token (server.ts) and never takes one
 * from the caller. The only query parameter is `role`, and `server.ts` reads it as
 * `=== 'seller' ? 'seller' : 'buyer'` — so anything that is not exactly `seller` means buyer.
 * This function therefore sends one of exactly two strings and refuses anything else, rather than
 * letting a typo quietly return the wrong side of somebody's trades.
 */
export async function listOrders(
  query: { role: 'buyer' | 'seller' },
  opts: RequestOptions = {},
): Promise<{ orders: readonly OrderView[] }> {
  if (query.role !== 'buyer' && query.role !== 'seller') {
    throw new RangeError(`role must be "buyer" or "seller", got ${String(query.role)}`)
  }
  return api('/v1/orders', { ...opts, query: { role: query.role } })
}

/**
 * `GET /v1/orders/:id` — **`market/src/server.ts`**.
 *
 * Authenticated. An order that is not yours answers 404 rather than 403, on purpose
 * (server.ts): "'Does not exist' and 'is not yours' are the same answer", because a
 * distinct 403 would be an oracle for who bought what.
 */
export async function getOrder(id: string, opts: RequestOptions = {}): Promise<{ order: OrderView }> {
  return api(`/v1/orders/${encodeURIComponent(id)}`, opts)
}

/**
 * `GET /v1/verifications/:urn` — **`market/src/server.ts`**.
 *
 * The URN is a path SEGMENT and is percent-encoded here; `server.ts` decodes it. An
 * unencoded `cf:market:item:…` would still work, but an item URN containing a slash would split
 * into two segments and match no route at all.
 *
 * Answers `{ verification: null }` for a subject nobody has reviewed — which is a different fact
 * from `unverified`, and the UI keeps them apart.
 */
export async function getVerification(
  subjectUrn: string,
  opts: RequestOptions = {},
): Promise<{ verification: VerificationView | null }> {
  return api(`/v1/verifications/${encodeURIComponent(subjectUrn)}`, { auth: false, ...opts })
}

/* ------------------------------------------------------------------ writes */

/** What every mutating route adds to its response — `server.ts`. */
export interface Replayable {
  /** True when this key had already been used for this exact body, and the stored result came back. */
  readonly replayed: boolean
}

/**
 * `POST /v1/listings` — **`market/src/server.ts`**.
 *
 * The body fields the route actually reads, in the order it reads them: `assetKind` (661),
 * `pricingMode` (662), `settlementMode` (663), `price` (664-666), `itemUrn` (673/688),
 * `assetCode` (675/697), `sellerWalletId` (685), `collectionId` (686), `quantity` (689),
 * `itemAssetCode` (690), `reservePrice` (693-696), `royaltyBps` (699), `auctionEndsAt` (703),
 * `expiresAt` (704) and `royaltyRecipients` (705-707).
 *
 * **`platformFeeBps` and `disputeWindowMs` are NOT read from the body** (701-702): both are
 * snapshotted from the service's environment. A form that offered them would be offering a
 * control that does nothing.
 *
 * Amounts cross as decimal STRINGS. `parseAmount` (money.ts) rejects anything else, so a
 * number here is a 400 and never a rounded price.
 */
export async function createListing(
  key: string,
  body: {
    assetKind: AssetKind
    pricingMode: PricingMode
    settlementMode: SettlementMode
    itemUrn: string
    itemAssetCode: string
    assetCode: string
    /** Decimal string of smallest units, or null for `offers_only`. */
    price?: string | null
    quantity?: string
    reservePrice?: string | null
    royaltyBps?: number
    royaltyRecipients?: readonly { subject: string; bps: number }[]
    collectionId?: string | null
    sellerWalletId?: string | null
    auctionEndsAt?: string | null
    expiresAt?: string | null
  },
  opts: RequestOptions = {},
): Promise<{ listing: ListingView; policy: PolicyVerdict } & Replayable> {
  return api('/v1/listings', {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * `POST /v1/listings/:id/activate` — **`market/src/server.ts`**.
 *
 * For an `onchain` listing the route REQUIRES `onchainEscrowTx` (server.ts) and reads an
 * optional `chain`, defaulting to `ember` (server.ts). For a `custodial` one it reads neither
 * and this client sends neither: a field the route does not read is a field a reader will believe
 * did something.
 *
 * **It fails CLOSED** (server.ts). Two failures come back and they mean opposite things:
 *
 *   * 409 `state_conflict` "the on-chain escrow is not confirmed yet" — the indexer answered, and
 *     the answer was no.
 *   * 503 `indexer_unavailable` — the indexer did not answer. We do not know.
 *
 * `escrow.ts` is where that distinction is turned into a sentence, and it is the exact conflation
 * that made every on-chain activation fail with a false diagnosis.
 */
export async function activateListing(
  key: string,
  id: string,
  body: { onchainEscrowTx?: string; chain?: string } = {},
  opts: RequestOptions = {},
): Promise<{ listing: ListingView }> {
  return api(`/v1/listings/${encodeURIComponent(id)}/activate`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * `DELETE /v1/listings/:id` — **`market/src/server.ts`**.
 *
 * Withdraws the seller's own listing. The reason is fixed by the service ("withdrawn by the
 * seller", server.ts) and is NOT read from a body, so none is sent.
 *
 * This route is not wrapped in `withIdempotentRoute`, and does not need to be: cancelling twice
 * cancels once. The key is still sent — it costs nothing and it is the one habit that keeps a
 * mutating call from ever going without one.
 */
export async function cancelListing(
  key: string,
  id: string,
  opts: RequestOptions = {},
): Promise<{ listing: ListingView }> {
  return api(`/v1/listings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: idempotentHeaders(key),
    ...opts,
  })
}

/**
 * `POST /v1/listings/:id/buy` — **`market/src/server.ts`**.
 *
 * The only body field read is `amount` (server.ts), as a decimal string. The buyer's subject
 * comes from the token, never from the body.
 *
 * A 402 `payment_refused` is not an error in this service's sense — server.ts: "the ledger
 * looked at the request and said the money is not there. That is an answer about the customer's
 * balance, not a fault in this service." The UI says so.
 */
export async function buyListing(
  key: string,
  listingId: string,
  body: { amount: string },
  opts: RequestOptions = {},
): Promise<{ order: OrderView } & Replayable> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/buy`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * `POST /v1/listings/:id/bids` — **`market/src/server.ts`**.
 *
 * Body: `amount` only (server.ts). The response carries `outbid` — the id of the bid this one
 * displaced, or null — and `auctionEndsAt`, which is non-null only when the bid EXTENDED the
 * auction (server.ts). A client that showed that field as "the close time" would show
 * `null` as "no close time" on every bid that did not extend.
 *
 * A bid that does not beat the leader is a 409 `bid_too_low` carrying `minimum` as a string
 * (server.ts), so the UI can offer the next legal bid without a second round trip.
 */
export async function placeBid(
  key: string,
  listingId: string,
  body: { amount: string },
  opts: RequestOptions = {},
): Promise<
  {
    bid: { id: string; amount: string; assetCode: string; status: string }
    /** The bid this one displaced, or null. */
    outbid: string | null
    /** Non-null ONLY when this bid extended the auction. Not the listing's close time. */
    auctionEndsAt: string | null
  } & Replayable
> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/bids`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * `POST /v1/listings/:id/offers` — **`market/src/server.ts`**.
 *
 * Body: `amount` (server.ts) and an optional `expiresAt` ISO string (909). `readDate`
 * (server.ts) refuses anything that is not a valid ISO 8601 string, so an empty string
 * is a 400 — this client omits the field instead.
 */
export async function makeOffer(
  key: string,
  listingId: string,
  body: { amount: string; expiresAt?: string },
  opts: RequestOptions = {},
): Promise<{ offer: OfferView } & Replayable> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/offers`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    body: {
      amount: body.amount,
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
    },
    ...opts,
  })
}

/**
 * `DELETE /v1/offers/:id` — **`market/src/server.ts`**.
 *
 * The offerer withdraws their own offer. `to: 'withdrawn'` is fixed by the service
 * (server.ts), not a body field, so nothing is sent.
 */
export async function withdrawOffer(
  key: string,
  offerId: string,
  opts: RequestOptions = {},
): Promise<{ offer: OfferView }> {
  return api(`/v1/offers/${encodeURIComponent(offerId)}`, {
    method: 'DELETE',
    headers: idempotentHeaders(key),
    ...opts,
  })
}

/**
 * `POST /v1/offers/:id/accept` — **`market/src/server.ts`**.
 *
 * The SELLER accepts. It takes no body at all: the amount settled is the OFFER's, not the
 * listing's price (server.ts, 948), and there is nothing for a caller to supply. Sending an
 * `amount` here would be sending a field that is ignored — and the fingerprint is taken over
 * `{ offerId }` only (server.ts), so it would not even change the idempotency behaviour.
 */
export async function acceptOffer(
  key: string,
  offerId: string,
  opts: RequestOptions = {},
): Promise<{ order: OrderView } & Replayable> {
  return api(`/v1/offers/${encodeURIComponent(offerId)}/accept`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    ...opts,
  })
}

/**
 * `POST /v1/orders/:id/disputes` — **`market/src/server.ts`**.
 *
 * Body: `reason` only (server.ts), and it must be a non-empty string (`requireString`,
 * server.ts). Only the buyer or the seller may raise one — a third party's complaint is
 * a moderation case, which is a different table with no power to move money
 * (`market/src/moderation.ts`).
 *
 * Wrapped in `withIdempotentRoute` as of `market@4df8518`; before that a double-clicked button
 * opened TWO disputes on one order and froze the listing twice (server.ts).
 */
export async function openDispute(
  key: string,
  orderId: string,
  body: { reason: string },
  opts: RequestOptions = {},
): Promise<{ dispute: DisputeView } & Replayable> {
  return api(`/v1/orders/${encodeURIComponent(orderId)}/disputes`, {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * `POST /v1/collections` — **`market/src/server.ts`**.
 *
 * Body: `slug`, `name`, optional `description`, optional `royalties` (server.ts). The
 * owner is the token's subject, never a body field.
 *
 * This route is NOT wrapped in `withIdempotentRoute` (compare server.ts) — a retry creates a
 * second collection. The key is sent anyway so that the day the service wraps it, this client is
 * already correct; today it is simply ignored.
 */
export async function createCollection(
  key: string,
  body: {
    slug: string
    name: string
    description?: string
    royalties?: readonly { subject: string; bps: number }[]
  },
  opts: RequestOptions = {},
): Promise<{ collection: CollectionView }> {
  return api('/v1/collections', {
    method: 'POST',
    headers: idempotentHeaders(key),
    body,
    ...opts,
  })
}

/**
 * The `minimum` a `bid_too_low` refusal carries.
 *
 * `market/src/server.ts` answers a bid that does not beat the leader with a 409 whose body
 * is `{ error: { code: 'bid_too_low', message, minimum, requestId } }`, where `minimum` is "a
 * string: an amount is never a JSON number". It is there so a client can offer the next legal bid
 * without a second round trip.
 *
 * Read from the parsed body rather than scraped out of the sentence. A regular expression over
 * English prose would find whichever number happened to be first, and a bidder shown a wrong
 * minimum types it and is refused again — with no way to tell that the app, not the auction, was
 * the problem.
 *
 * `null` when the field is absent or is not a decimal string. Missing is missing.
 */
export function bidMinimum(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== 'bid_too_low') return null
  const body = err.body
  if (typeof body !== 'object' || body === null) return null
  const envelope = (body as { error?: unknown }).error
  if (typeof envelope !== 'object' || envelope === null) return null
  const minimum = (envelope as { minimum?: unknown }).minimum
  return typeof minimum === 'string' && /^\d{1,78}$/.test(minimum) ? minimum : null
}

/* ------------------------------------------------------------------ what this surface cannot do */

/**
 * Whether a party to an order can READ the state of a dispute on it.
 *
 * They cannot, and this constant exists so that the fact is stated once and rendered rather than
 * silently worked around.
 *
 * `GET /v1/disputes` (server.ts) calls `requireOperator` (1017), and `orderWire`
 * (server.ts) carries no dispute field. So `micro-market` today has **no route by which
 * the buyer or the seller can read back a dispute they raised**. What they can see is the effect:
 * the order's `proceedsState` stays `held` (`orders.ts`) and the listing behind it goes
 * `frozen` (`moderation.ts`).
 *
 * The order page therefore shows those two facts and says plainly that the dispute's own state is
 * not readable here — rather than inventing a status, or leaving a reader to conclude from an
 * empty screen that nothing happened. Reported to the service's owner; not worked around by
 * re-POSTing under the old key, which would be a write dressed up as a read.
 */
export const DISPUTE_STATE_IS_OPERATOR_ONLY = true
