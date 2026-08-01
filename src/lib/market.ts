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
 *     `market/src/server.ts:678` turned it into a 403. **Every listing creation returned 403.**
 *
 * Every path below carries the line of `market/src/server.ts` it is declared on, read out of
 * `buildRoutes()` (server.ts:485-1130), which is the only place a route is declared in that
 * service. `test/market.test.ts` asserts the REQUEST — path, method, query string, body, and
 * headers — for every call in this file, because a test that stubs `fetch` and checks the parsed
 * response passes just as happily against a path that does not exist.
 *
 * ── Two things about this service's shape, both easy to get wrong ─────────────────────────────
 *
 * 1. **EVERY MUTATING ROUTE REQUIRES `Idempotency-Key`** (server.ts:1152-1157). Not optional.
 *    A request without one is a 400 before anything else happens. See `idempotency.ts`.
 * 2. **A mutating route answers 201 on the first attempt and 200 with `replayed: true` on a
 *    replay** (server.ts:1168-1173). `replayed` is not an error; it is how a client tells "I
 *    created this" from "this already existed", and translating it into a failure is how a
 *    completed purchase gets reported to a customer as a broken one.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { api, type RequestOptions } from './api.ts'
import { idempotentHeaders } from './idempotency.ts'

/* ------------------------------------------------------------------ the domain, as it is sent */

/** `AssetKind` — `market/src/listings.ts:53-59`, and the set `server.ts:243-250` validates. */
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

/** `PricingMode` — `listings.ts:60`, validated at `server.ts:251`. */
export type PricingMode = 'fixed' | 'auction' | 'offers_only'
export const PRICING_MODES: readonly PricingMode[] = ['fixed', 'auction', 'offers_only']

/** `SettlementMode` — `listings.ts:61`, validated at `server.ts:252`. */
export type SettlementMode = 'custodial' | 'onchain'
export const SETTLEMENT_MODES: readonly SettlementMode[] = ['custodial', 'onchain']

/** `ListingStatus` — `listings.ts:62`. The browse route defaults to `active` (server.ts:624). */
export type ListingStatus = 'draft' | 'active' | 'settling' | 'sold' | 'cancelled' | 'expired'
export const LISTING_STATUSES: readonly ListingStatus[] = [
  'draft',
  'active',
  'settling',
  'sold',
  'cancelled',
  'expired',
]

/** `VerificationLevel` — `listings.ts:63`, validated at `server.ts:253-258`. */
export type VerificationLevel = 'unverified' | 'claimed' | 'verified' | 'flagged'

/** `IndicatorCode` — the closed set at `market/src/risk.ts:34-41`. */
export type IndicatorCode =
  | 'mint_authority_present'
  | 'ownership_not_renounced'
  | 'supply_concentrated'
  | 'recently_deployed'
  | 'deployer_wallet_exported'
  | 'few_holders'

/**
 * One listing, exactly as `listingWire` emits it — `market/src/server.ts:1178-1203`.
 *
 * Mirrored narrowly on purpose. **The reserve price is NOT on the wire** (server.ts:1190-1191:
 * "It is the seller's secret floor, and publishing it would tell every bidder exactly what to
 * bid"), and adding a `reservePrice` field here would produce `undefined` at runtime with no type
 * error at all — which is how a UI comes to render a seller's floor as blank rather than as
 * absent.
 *
 * `escrowed` is a boolean over two different facts: `escrowId !== null || onchainEscrowTx !== null`
 * (server.ts:1200). It says an escrow reference EXISTS. It does not say the chain confirmed it,
 * and `src/lib/escrow.ts` is where that distinction is kept.
 */
export interface ListingView {
  readonly id: string
  readonly sellerSubject: string
  readonly collectionId: string | null
  readonly assetKind: AssetKind
  readonly itemUrn: string
  /** Smallest units, decimal string. Never a JSON number — server.ts:1185-1187. */
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
  /** Frozen by a moderation case or by an open dispute — `market/src/moderation.ts:383`. */
  readonly frozen: boolean
  /** An escrow reference exists. NOT "the chain confirmed it". See `escrow.ts`. */
  readonly escrowed: boolean
  readonly createdAt: string
}

/** The royalty split as `GET /v1/listings/:id` returns it — `server.ts:643-646`. Bps, not amounts. */
export interface RoyaltySplitEntry {
  readonly subject: string
  readonly bps: number
}

export interface ListingDetail {
  readonly listing: ListingView
  readonly royalties: readonly RoyaltySplitEntry[]
}

/** `Verification` — `market/src/listings.ts:216-222`. `reviewedAt` is an ISO string on the wire. */
export interface VerificationView {
  readonly subjectUrn: string
  readonly level: VerificationLevel
  readonly evidence: Record<string, unknown>
  readonly reviewedBy: string | null
  readonly reviewedAt: string | null
}

/** One computed risk indicator — `market/src/risk.ts:46-53`. */
export interface Indicator {
  readonly code: IndicatorCode
  /** True when the condition HOLDS. A false indicator is still shown: absence is information. */
  readonly present: boolean
  /** The number the condition was evaluated against, so a buyer can see the working. */
  readonly detail: string
}

/**
 * `GET /v1/listings/:id/risk` — `server.ts:790-814`.
 *
 * `indicatorsAvailable` is the whole point of this shape. server.ts:801-804: "Said explicitly
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

/** One bid, as `server.ts:851-858` emits it. */
export interface BidView {
  readonly id: string
  readonly bidderSubject: string
  readonly amount: string
  readonly assetCode: string
  readonly status: string
  readonly placedAt: string
}

/** One offer — `offerWire`, `server.ts:1232-1252`. */
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

/** One royalty payment on a settled order — `orderWire`, `server.ts:1225-1228`. */
export interface OrderRoyalty {
  readonly subject: string
  /** Smallest units, decimal string. */
  readonly amount: string
}

/**
 * One order — `orderWire`, `market/src/server.ts:1205-1230`.
 *
 * `amount`, `feeAmount`, `royaltyAmount` and `sellerProceeds` are a PARTITION: the last three sum
 * to the first, exactly, by construction (`market/src/money.ts:150-186`). `src/lib/money.ts`
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
  /** `held` until the dispute window runs — `market/src/orders.ts:109`. */
  readonly proceedsState: 'held' | 'released'
  readonly payoutDueAt: string | null
  readonly settledAt: string
  readonly royalties: readonly OrderRoyalty[]
}

/** One dispute — `disputeWire`, `server.ts:1254-1272`. */
export interface DisputeView {
  readonly id: string
  readonly orderId: string
  readonly raiserSubject: string
  readonly reason: string
  /** `DisputeState` — `market/src/moderation.ts:53`. */
  readonly state: 'open' | 'resolved_refunded' | 'resolved_upheld' | 'withdrawn'
  readonly resolutionEntryId: string | null
  readonly openedAt: string
}

/** One collection — `market/src/listings.ts:153-166`, returned unmapped by `server.ts:596-600`. */
export interface CollectionView {
  readonly id: string
  readonly ownerSubject: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly royalties: readonly RoyaltySplitEntry[]
}

/** Policy's verdict, echoed on a created listing — `server.ts:736`. */
export interface PolicyVerdict {
  readonly decision: string
  readonly reasons: readonly string[]
  /** True when policy was unreachable and the listing was allowed through and flagged. */
  readonly degraded: boolean
}

/* ------------------------------------------------------------------ reads */

/**
 * `GET /v1/collections` — **`market/src/server.ts:596`**.
 *
 * The only query parameter the route reads is `ownerSubject` (server.ts:597). Public: no bearer
 * token is attached, because a collection is a shopfront and a shopfront behind a login is not one.
 */
export function listCollections(
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
 * `GET /v1/listings` — **`market/src/server.ts:618`**.
 *
 * The route reads exactly four parameters, and nothing else: `status` (server.ts:619),
 * `assetKind` (620), `sellerSubject` (626) and `collectionId` (629).
 *
 * **There is no `limit` and no `q`.** `listListings` accepts a limit (`listings.ts:702`) but the
 * ROUTE never passes one, so the page size is the function's default of 50 and a `limit=` on the
 * query string would be silently ignored — which is worse than a 400, because the client would
 * believe it had asked. Text search is done in this bundle over what the route returned; see
 * `search.ts`, which says so on screen rather than implying the whole market was searched.
 *
 * `status` is OMITTED rather than sent empty when it is not wanted: `server.ts:624` reads
 * `status ?? 'active'`, so an empty string becomes a status no row has and the browse page would
 * render as an empty market.
 */
export function listListings(
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
 * `GET /v1/listings/:id` — **`market/src/server.ts:636`**.
 *
 * Returns the listing AND its royalty split in basis points (server.ts:641-647). Public.
 */
export function getListing(id: string, opts: RequestOptions = {}): Promise<ListingDetail> {
  return api(`/v1/listings/${encodeURIComponent(id)}`, { auth: false, ...opts })
}

/**
 * `GET /v1/listings/:id/risk` — **`market/src/server.ts:790`**.
 *
 * FAILS OPEN by design: an unreachable indexer answers 200 with `indicatorsAvailable: false`
 * (server.ts:807-813), never a 5xx. A caller must read that flag; the status code says nothing.
 */
export function getListingRisk(id: string, opts: RequestOptions = {}): Promise<RiskView> {
  return api(`/v1/listings/${encodeURIComponent(id)}/risk`, { auth: false, ...opts })
}

/**
 * `GET /v1/listings/:id/bids` — **`market/src/server.ts:846`**.
 *
 * Public, and unauthenticated: who is bidding what is the auction. The route takes no query
 * parameters at all.
 */
export function listBids(
  listingId: string,
  opts: RequestOptions = {},
): Promise<{ bids: readonly BidView[] }> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/bids`, { auth: false, ...opts })
}

/** `GET /v1/listings/:id/offers` — **`market/src/server.ts:893`**. Public; no query parameters. */
export function listOffers(
  listingId: string,
  opts: RequestOptions = {},
): Promise<{ offers: readonly OfferView[] }> {
  return api(`/v1/listings/${encodeURIComponent(listingId)}/offers`, { auth: false, ...opts })
}

/**
 * `GET /v1/orders` — **`market/src/server.ts:969`**.
 *
 * Authenticated: the route derives the subject from the token (server.ts:972) and never takes one
 * from the caller. The only query parameter is `role`, and `server.ts:973` reads it as
 * `=== 'seller' ? 'seller' : 'buyer'` — so anything that is not exactly `seller` means buyer.
 * This function therefore sends one of exactly two strings and refuses anything else, rather than
 * letting a typo quietly return the wrong side of somebody's trades.
 */
export function listOrders(
  query: { role: 'buyer' | 'seller' },
  opts: RequestOptions = {},
): Promise<{ orders: readonly OrderView[] }> {
  if (query.role !== 'buyer' && query.role !== 'seller') {
    throw new RangeError(`role must be "buyer" or "seller", got ${String(query.role)}`)
  }
  return api('/v1/orders', { ...opts, query: { role: query.role } })
}

/**
 * `GET /v1/orders/:id` — **`market/src/server.ts:980`**.
 *
 * Authenticated. An order that is not yours answers 404 rather than 403, on purpose
 * (server.ts:986-989): "'Does not exist' and 'is not yours' are the same answer", because a
 * distinct 403 would be an oracle for who bought what.
 */
export function getOrder(id: string, opts: RequestOptions = {}): Promise<{ order: OrderView }> {
  return api(`/v1/orders/${encodeURIComponent(id)}`, opts)
}

/**
 * `GET /v1/verifications/:urn` — **`market/src/server.ts:1106`**.
 *
 * The URN is a path SEGMENT and is percent-encoded here; `server.ts:1109` decodes it. An
 * unencoded `cf:market:item:…` would still work, but an item URN containing a slash would split
 * into two segments and match no route at all.
 *
 * Answers `{ verification: null }` for a subject nobody has reviewed — which is a different fact
 * from `unverified`, and the UI keeps them apart.
 */
export function getVerification(
  subjectUrn: string,
  opts: RequestOptions = {},
): Promise<{ verification: VerificationView | null }> {
  return api(`/v1/verifications/${encodeURIComponent(subjectUrn)}`, { auth: false, ...opts })
}

/* ------------------------------------------------------------------ writes */

/** What every mutating route adds to its response — `server.ts:1172`. */
export interface Replayable {
  /** True when this key had already been used for this exact body, and the stored result came back. */
  readonly replayed: boolean
}

/**
 * `POST /v1/listings` — **`market/src/server.ts:651`**.
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
 * Amounts cross as decimal STRINGS. `parseAmount` (money.ts:222) rejects anything else, so a
 * number here is a 400 and never a rounded price.
 */
export function createListing(
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
 * `POST /v1/listings/:id/activate` — **`market/src/server.ts:742`**.
 *
 * For an `onchain` listing the route REQUIRES `onchainEscrowTx` (server.ts:755) and reads an
 * optional `chain`, defaulting to `ember` (server.ts:758). For a `custodial` one it reads neither
 * and this client sends neither: a field the route does not read is a field a reader will believe
 * did something.
 *
 * **It fails CLOSED** (server.ts:756-763). Two failures come back and they mean opposite things:
 *
 *   * 409 `state_conflict` "the on-chain escrow is not confirmed yet" — the indexer answered, and
 *     the answer was no.
 *   * 503 `indexer_unavailable` — the indexer did not answer. We do not know.
 *
 * `escrow.ts` is where that distinction is turned into a sentence, and it is the exact conflation
 * that made every on-chain activation fail with a false diagnosis.
 */
export function activateListing(
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
 * `DELETE /v1/listings/:id` — **`market/src/server.ts:776`**.
 *
 * Withdraws the seller's own listing. The reason is fixed by the service ("withdrawn by the
 * seller", server.ts:782) and is NOT read from a body, so none is sent.
 *
 * This route is not wrapped in `withIdempotentRoute`, and does not need to be: cancelling twice
 * cancels once. The key is still sent — it costs nothing and it is the one habit that keeps a
 * mutating call from ever going without one.
 */
export function cancelListing(
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
 * `POST /v1/listings/:id/buy` — **`market/src/server.ts:818`**.
 *
 * The only body field read is `amount` (server.ts:829), as a decimal string. The buyer's subject
 * comes from the token, never from the body.
 *
 * A 402 `payment_refused` is not an error in this service's sense — server.ts:428-433: "the ledger
 * looked at the request and said the money is not there. That is an answer about the customer's
 * balance, not a fault in this service." The UI says so.
 */
export function buyListing(
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
 * `POST /v1/listings/:id/bids` — **`market/src/server.ts:863`**.
 *
 * Body: `amount` only (server.ts:873). The response carries `outbid` — the id of the bid this one
 * displaced, or null — and `auctionEndsAt`, which is non-null only when the bid EXTENDED the
 * auction (server.ts:885-886). A client that showed that field as "the close time" would show
 * `null` as "no close time" on every bid that did not extend.
 *
 * A bid that does not beat the leader is a 409 `bid_too_low` carrying `minimum` as a string
 * (server.ts:413-427), so the UI can offer the next legal bid without a second round trip.
 */
export function placeBid(
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
 * `POST /v1/listings/:id/offers` — **`market/src/server.ts:898`**.
 *
 * Body: `amount` (server.ts:908) and an optional `expiresAt` ISO string (909). `readDate`
 * (server.ts:1348-1354) refuses anything that is not a valid ISO 8601 string, so an empty string
 * is a 400 — this client omits the field instead.
 */
export function makeOffer(
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
 * `DELETE /v1/offers/:id` — **`market/src/server.ts:917`**.
 *
 * The offerer withdraws their own offer. `to: 'withdrawn'` is fixed by the service
 * (server.ts:922), not a body field, so nothing is sent.
 */
export function withdrawOffer(
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
 * `POST /v1/offers/:id/accept` — **`market/src/server.ts:931`**.
 *
 * The SELLER accepts. It takes no body at all: the amount settled is the OFFER's, not the
 * listing's price (server.ts:930, 948), and there is nothing for a caller to supply. Sending an
 * `amount` here would be sending a field that is ignored — and the fingerprint is taken over
 * `{ offerId }` only (server.ts:943), so it would not even change the idempotency behaviour.
 */
export function acceptOffer(
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
 * `POST /v1/orders/:id/disputes` — **`market/src/server.ts:993`**.
 *
 * Body: `reason` only (server.ts:1008), and it must be a non-empty string (`requireString`,
 * server.ts:1321-1327). Only the buyer or the seller may raise one — a third party's complaint is
 * a moderation case, which is a different table with no power to move money
 * (`market/src/moderation.ts:366-373`).
 *
 * Wrapped in `withIdempotentRoute` as of `market@4df8518`; before that a double-clicked button
 * opened TWO disputes on one order and froze the listing twice (server.ts:998-1003).
 */
export function openDispute(
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
 * `POST /v1/collections` — **`market/src/server.ts:602`**.
 *
 * Body: `slug`, `name`, optional `description`, optional `royalties` (server.ts:606-612). The
 * owner is the token's subject, never a body field.
 *
 * This route is NOT wrapped in `withIdempotentRoute` (compare server.ts:682) — a retry creates a
 * second collection. The key is sent anyway so that the day the service wraps it, this client is
 * already correct; today it is simply ignored.
 */
export function createCollection(
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

/* ------------------------------------------------------------------ what this surface cannot do */

/**
 * Whether a party to an order can READ the state of a dispute on it.
 *
 * They cannot, and this constant exists so that the fact is stated once and rendered rather than
 * silently worked around.
 *
 * `GET /v1/disputes` (server.ts:1015) calls `requireOperator` (1017), and `orderWire`
 * (server.ts:1205-1230) carries no dispute field. So `micro-market` today has **no route by which
 * the buyer or the seller can read back a dispute they raised**. What they can see is the effect:
 * the order's `proceedsState` stays `held` (`orders.ts:109`) and the listing behind it goes
 * `frozen` (`moderation.ts:383`).
 *
 * The order page therefore shows those two facts and says plainly that the dispute's own state is
 * not readable here — rather than inventing a status, or leaving a reader to conclude from an
 * empty screen that nothing happened. Reported to the service's owner; not worked around by
 * re-POSTing under the old key, which would be a write dressed up as a read.
 */
export const DISPUTE_STATE_IS_OPERATOR_ONLY = true
