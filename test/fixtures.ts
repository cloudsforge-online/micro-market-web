/**
 * The responses the tier-1 scenarios are run against.
 *
 * Every shape here is the one `src/lib/market.ts` declares, and every field on it is one
 * `market/src/server.ts` emits. A fixture invented from the client's
 * imagination is how seven clients in this estate ended up written against surfaces that do not
 * exist (`.github/workflows/ci.yml`, "Every market route names the service that serves it"), so
 * these are built from the wire types rather than from prose.
 *
 * Doc 22 §4 names `micro-conformance` as the tier-2 stub source. There is no market corpus in it
 * today — `conformance/corpus/` holds mint, identity, trade, health, chain, game, entitlements and
 * wallet, and nothing for market — so these fixtures stand in, typed against the client's own
 * declarations so a drift between them and the service is a type error here rather than a silent
 * pass. That gap is recorded in `test/journeys.ts`.
 */
import type {
  BidView,
  ListingImageView,
  ListingDetail,
  ListingView,
  OfferView,
  OrderView,
  RiskView,
} from '../src/lib/market.ts'

export const LISTING_ID = '11111111-2222-3333-4444-555555555555'
export const ORDER_ID = '99999999-8888-7777-6666-555555555555'
export const SELLER = 'user:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
export const BUYER = 'user:ffffffff-1111-2222-3333-444444444444'

export function listing(over: Partial<ListingView> = {}): ListingView {
  return {
    id: LISTING_ID,
    sellerSubject: SELLER,
    collectionId: null,
    assetKind: 'token',
    itemUrn: 'urn:cf:token:hearth:testnet:0xabc',
    quantity: '1',
    itemAssetCode: 'CFT',
    pricingMode: 'fixed',
    price: '2500000000000000000',
    assetCode: 'CFG',
    settlementMode: 'custodial',
    royaltyBps: 500,
    platformFeeBps: 250,
    auctionEndsAt: null,
    expiresAt: null,
    status: 'active',
    frozen: false,
    escrowed: true,
    createdAt: '2026-07-01T09:00:00.000Z',
    ...over,
  }
}

export function detail(over: Partial<ListingView> = {}): ListingDetail {
  return { listing: listing(over), royalties: [{ subject: SELLER, bps: 500 }] }
}

/** Where a browser would reach micro-studio, on a deployment that has been told. */
export const STUDIO = 'https://studio.cloudsforge.test'

/**
 * One gallery entry, as `imageWire` emits it.
 *
 * `bytesUrl` defaults to an ABSOLUTE studio address, which is the state a configured deployment is
 * in. Pass `bytesUrl: null` for the state every deployment is actually in today — `STUDIO_PUBLIC_URL`
 * is unset, so the service answers null rather than a URL that would 404 against market's origin.
 */
export function image(over: Partial<ListingImageView> = {}): ListingImageView {
  const studioAssetId = over.studioAssetId ?? 'aaaaaaaa-0000-4000-8000-000000000001'
  return {
    studioAssetId,
    checksum: `sha256:${'a'.repeat(64)}`,
    position: 0,
    bytesUrl: `${STUDIO}/v1/assets/${studioAssetId}/bytes`,
    ...over,
  }
}

/** `GET /v1/images/config`, as a deployment that can accept uploads answers it. */
export function imageConfig(): {
  uploadUrl: string
  maxImagesPerListing: number
  acceptedMediaTypes: readonly string[]
} {
  return {
    uploadUrl: `${STUDIO}/v1/uploads`,
    // Ten, from `MAX_LISTING_IMAGES` in `market/src/listingimages.ts` — the constant the schema's
    // `listing_images_position_range` is written against.
    maxImagesPerListing: 10,
    acceptedMediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
  }
}

export function risk(over: Partial<RiskView> = {}): RiskView {
  return {
    verification: {
      subjectUrn: 'urn:cf:token:hearth:testnet:0xabc',
      level: 'verified',
      evidence: {},
      reviewedBy: 'operator:1',
      reviewedAt: '2026-07-02T09:00:00.000Z',
    },
    indicators: [],
    indicatorsAvailable: true,
    ...over,
  }
}

export function bid(over: Partial<BidView> = {}): BidView {
  return {
    id: 'bid-1',
    bidderSubject: BUYER,
    amount: '3000000000000000000',
    assetCode: 'CFG',
    status: 'leading',
    placedAt: '2026-07-03T09:00:00.000Z',
    ...over,
  }
}

export function offer(over: Partial<OfferView> = {}): OfferView {
  return {
    id: 'offer-1',
    listingId: LISTING_ID,
    offererSubject: BUYER,
    amount: '2000000000000000000',
    assetCode: 'CFG',
    status: 'open',
    expiresAt: null,
    createdAt: '2026-07-03T09:00:00.000Z',
    ...over,
  }
}

export function order(over: Partial<OrderView> = {}): OrderView {
  return {
    id: ORDER_ID,
    listingId: LISTING_ID,
    buyerSubject: BUYER,
    sellerSubject: SELLER,
    itemUrn: 'urn:cf:token:hearth:testnet:0xabc',
    quantity: '1',
    amount: '2500000000000000000',
    feeAmount: '62500000000000000',
    royaltyAmount: '125000000000000000',
    sellerProceeds: '2312500000000000000',
    assetCode: 'CFG',
    settlementMode: 'custodial',
    journalEntryId: 'journal-1',
    outboundTransactionId: null,
    source: 'purchase',
    proceedsState: 'held',
    payoutDueAt: '2026-07-11T09:00:00.000Z',
    settledAt: '2026-07-04T09:00:00.000Z',
    // The shares have to SUM to `royaltyAmount`. `src/pages/orders.tsx` renders an alert when
    // they do not, and an order fixture that did not balance put that alert on the page in every
    // scenario — which is how a fixture starts asserting itself instead of the product.
    royalties: [{ subject: SELLER, amount: '125000000000000000' }],
    ...over,
  }
}

/** The estate's error envelope — nested, as `errorReply()` builds it in every service. */
export function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } }
}

/** The two `cf.*` keys a signed-in browser holds. `src/lib/api.ts` reads exactly these. */
export const SIGNED_IN = {
  'cf.accessToken': 'access-token-stub',
  'cf.refreshToken': 'refresh-token-stub',
}

/** `GET /auth/me` as `identity/src/server.ts` returns it: the profile is nested. */
export const ME = {
  user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', handle: 'seller', roles: ['customer'] },
  session: { id: 'session-1' },
  organisations: [],
}
