/**
 * The auction clock, and what a "current bid" is allowed to be called.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **A CURRENT BID IS NEVER A FINAL PRICE, AND AN AUCTION'S CLOSE TIME CAN MOVE.**
 *
 * Two facts from `market/src/bids.ts` that a marketplace UI gets wrong by default:
 *
 *   1. **Anti-sniping extends the close.** A bid landing inside the extension window pushes
 *      `auction_ends_at` out (`bids.ts:250-261`), and the new time comes back on the bid response
 *      as `auctionEndsAt` — and ONLY when it extended (`server.ts:886`). So the close time on
 *      screen is a value that changes, and a page that fetched it once and rendered it as fixed
 *      is a page that tells a bidder the auction has closed while it is still taking bids.
 *   2. **The reserve is secret and is checked at close.** `server.ts:1190-1191` keeps it off the
 *      wire entirely, and `orders.ts` checks it when the auction ends. So the leading bid may be
 *      above every other bid and still not buy the item. Calling it "the price" is a claim this
 *      app cannot make.
 *
 * `minimumBid` is `leader + 1` (`market/src/money.ts:230-232`) — strictly greater, ties never
 * displace — and the service returns that minimum on a `bid_too_low` 409 (`server.ts:413-427`)
 * so a bidder can re-bid without guessing.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { instant, untilLabel } from './format.ts'
import type { BidView, ListingView } from './market.ts'
import { minimumBid, parseAmountOrNull } from './money.ts'

export type AuctionPhase =
  /** Not an auction at all. */
  | 'not_an_auction'
  /** An auction listing with no close time on the wire — we cannot say when it ends. */
  | 'no_close_time'
  /** Open, and the close time is in the future. */
  | 'open'
  /** The close time has passed but the listing is still `active`: the closer has not run yet. */
  | 'closing'
  /** The listing is no longer active. */
  | 'ended'

export interface AuctionClock {
  readonly phase: AuctionPhase
  /** The close time as the service last told us. May move; see the header. */
  readonly endsAt: string | null
  /** `3d 4h` while open, `null` otherwise — never `0 min`, which reads as live. */
  readonly remaining: string | null
  /** The sentence beside the clock. Never implies a fixed deadline for an extendable auction. */
  readonly note: string
}

export function auctionClock(listing: ListingView, now: Date = new Date()): AuctionClock {
  if (listing.pricingMode !== 'auction') {
    return {
      phase: 'not_an_auction',
      endsAt: null,
      remaining: null,
      note: '',
    }
  }
  if (listing.status !== 'active') {
    return {
      phase: 'ended',
      endsAt: listing.auctionEndsAt,
      remaining: null,
      note: 'Bidding is closed.',
    }
  }
  const at = instant(listing.auctionEndsAt)
  if (at === null) {
    // Missing is missing. An auction with no close time on the wire is not an auction that closes
    // at midnight, and inventing one would be inventing the single number a bidder plans around.
    return {
      phase: 'no_close_time',
      endsAt: null,
      remaining: null,
      note: 'This auction has no close time recorded. We cannot tell you when bidding ends.',
    }
  }
  if (at.getTime() <= now.getTime()) {
    return {
      phase: 'closing',
      endsAt: listing.auctionEndsAt,
      remaining: null,
      note:
        'The close time has passed. The auction is settled by a sweep, so the outcome appears ' +
        'shortly rather than instantly.',
    }
  }
  return {
    phase: 'open',
    endsAt: listing.auctionEndsAt,
    remaining: untilLabel(listing.auctionEndsAt, now),
    note: 'A late bid extends the auction, so this time can move.',
  }
}

/** The leading bid, or `null`. `status` is the service's own word — `market/src/bids.ts`. */
export function leadingBid(bids: readonly BidView[]): BidView | null {
  return bids.find((bid) => bid.status === 'leading') ?? null
}

export interface BidFloor {
  /** The smallest bid the service will accept, in smallest units. */
  readonly minimum: bigint
  /** Whether that floor is the starting price or one above the current leader. */
  readonly basis: 'starting_price' | 'above_leader'
  /** `null` when the listing has no starting price and there is no leader — nothing to compute. */
  readonly known: boolean
}

/**
 * What a bidder must beat, computed the way the service computes it.
 *
 * `bids.ts:203` — `minimumBid(leader?.amount ?? null, listing.price ?? 1n)`. The listing's `price`
 * is the STARTING price for an auction, not a buy-now, and the service falls back to `1n` when
 * there is none. That fallback is reproduced rather than smoothed over: a form that offered a
 * different floor from the one the service enforces produces a 409 the bidder cannot explain.
 */
export function bidFloor(listing: ListingView, bids: readonly BidView[]): BidFloor {
  const leader = leadingBid(bids)
  return bidFloorFrom(listing, leader === null ? null : parseAmountOrNull(leader.amount))
}

/**
 * The same, when the caller already holds the leading amount.
 *
 * Separate rather than made to take a synthesised `BidView`: a component that had to build a fake
 * bid in order to ask a question about a real one is a component that will eventually get one of
 * the fake fields wrong and pass it somewhere that matters.
 */
export function bidFloorFrom(listing: ListingView, leaderAmount: bigint | null): BidFloor {
  const starting = parseAmountOrNull(listing.price) ?? 1n
  return {
    minimum: minimumBid(leaderAmount, starting),
    basis: leaderAmount === null ? 'starting_price' : 'above_leader',
    known: listing.price !== null || leaderAmount !== null,
  }
}

/**
 * The label for the leading amount.
 *
 * Deliberately not "price". `orders.ts` checks a secret reserve at close, so the leading bid is
 * what somebody has offered — not what the item will sell for, and not what it is worth.
 */
export const LEADING_BID_LABEL = 'Leading bid'

/** The caveat rendered beside it, every time it is rendered. */
export const LEADING_BID_CAVEAT =
  'A leading bid is not a final price. The seller may have set a reserve, which is not published ' +
  'and is checked when the auction closes.'
