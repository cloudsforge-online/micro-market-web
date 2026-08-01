/**
 * The clock, and the thing a leading bid is not.
 *
 * Two properties are asserted here that a marketplace UI gets wrong by default:
 *
 *   * an auction whose close time has PASSED but whose listing is still `active` is not "closed" —
 *     `market` settles auctions by a sweep, so there is a real interval in which the clock has run
 *     out and the outcome does not exist yet. Rendering that as closed tells a bidder the result
 *     is in when it is not; rendering it as open invites a bid the service will refuse.
 *   * an auction with NO close time on the wire gets no invented one. `untilLabel` answers null
 *     for a passed instant rather than "0 min", so a closed auction can never read as live.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LEADING_BID_CAVEAT,
  LEADING_BID_LABEL,
  auctionClock,
  bidFloor,
  leadingBid,
} from '../src/lib/auction.ts'
import type { BidView, ListingView } from '../src/lib/market.ts'

const NOW = new Date('2026-08-01T12:00:00.000Z')

function listing(overrides: Partial<ListingView> = {}): ListingView {
  return {
    id: 'l1',
    sellerSubject: 'user:a',
    collectionId: null,
    assetKind: 'collectible',
    itemUrn: 'cf:worlds:item:1',
    quantity: '1',
    itemAssetCode: 'SHARD',
    pricingMode: 'auction',
    price: '1000',
    assetCode: 'SHARD',
    settlementMode: 'custodial',
    royaltyBps: 0,
    platformFeeBps: 250,
    auctionEndsAt: '2026-08-01T18:00:00.000Z',
    expiresAt: null,
    status: 'active',
    frozen: false,
    escrowed: true,
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function bid(overrides: Partial<BidView> = {}): BidView {
  return {
    id: 'b1',
    bidderSubject: 'user:b',
    amount: '1200',
    assetCode: 'SHARD',
    status: 'leading',
    placedAt: '2026-08-01T11:00:00.000Z',
    ...overrides,
  }
}

describe('auctionClock', () => {
  it('says nothing at all for a listing that is not an auction', () => {
    const clock = auctionClock(listing({ pricingMode: 'fixed' }), NOW)
    assert.equal(clock.phase, 'not_an_auction')
    assert.equal(clock.remaining, null)
    assert.equal(clock.note, '')
  })

  it('is open while the close time is in the future, with the time left', () => {
    const clock = auctionClock(listing(), NOW)
    assert.equal(clock.phase, 'open')
    assert.equal(clock.remaining, '6h 0 min')
    assert.equal(clock.endsAt, '2026-08-01T18:00:00.000Z')
  })

  it('warns that a late bid moves the close time', () => {
    // `bids.ts:250-261` extends `auction_ends_at` on a late bid, so the number on screen is a
    // value that changes. A page that presented it as fixed would say the auction had closed
    // while it was still taking bids.
    assert.match(auctionClock(listing(), NOW).note, /can move/i)
  })

  it('is CLOSING — not closed — once the time has passed but the listing is still active', () => {
    const clock = auctionClock(listing({ auctionEndsAt: '2026-08-01T11:00:00.000Z' }), NOW)
    assert.equal(clock.phase, 'closing')
    assert.equal(clock.remaining, null)
    assert.match(clock.note, /sweep|shortly/i)
  })

  it('is ended once the listing is no longer active', () => {
    for (const status of ['sold', 'cancelled', 'expired', 'settling'] as const) {
      const clock = auctionClock(listing({ status }), NOW)
      assert.equal(clock.phase, 'ended', status)
      assert.equal(clock.remaining, null)
    }
  })

  it('says it cannot tell you when an auction with no close time ends', () => {
    const clock = auctionClock(listing({ auctionEndsAt: null }), NOW)
    assert.equal(clock.phase, 'no_close_time')
    assert.equal(clock.remaining, null)
    assert.match(clock.note, /cannot tell you/i)
  })

  it('treats an unparseable close time as no close time, never as now', () => {
    const clock = auctionClock(listing({ auctionEndsAt: 'not-a-date' }), NOW)
    assert.equal(clock.phase, 'no_close_time')
  })

  it('NEVER renders "0 min", which reads as live', () => {
    const atTheWire = auctionClock(listing({ auctionEndsAt: NOW.toISOString() }), NOW)
    assert.equal(atTheWire.phase, 'closing')
    assert.equal(atTheWire.remaining, null)
  })

  it('rounds a sub-minute remainder up to 1 min rather than down to 0', () => {
    const clock = auctionClock(listing({ auctionEndsAt: '2026-08-01T12:00:30.000Z' }), NOW)
    assert.equal(clock.phase, 'open')
    assert.equal(clock.remaining, '1 min')
  })

  it('renders a multi-day remainder coarsely', () => {
    const clock = auctionClock(listing({ auctionEndsAt: '2026-08-05T16:00:00.000Z' }), NOW)
    assert.equal(clock.remaining, '4d 4h')
  })
})

describe('leadingBid', () => {
  it('finds the bid the service marked leading', () => {
    const bids = [bid({ id: 'b1', status: 'outbid' }), bid({ id: 'b2', status: 'leading' })]
    assert.equal(leadingBid(bids)?.id, 'b2')
  })

  it('answers null when there is no leader, rather than the newest bid', () => {
    // "Most recent" and "leading" are different facts, and an outbid bid presented as the leader
    // is a bidder told they are winning when they are not.
    assert.equal(leadingBid([bid({ status: 'outbid' })]), null)
    assert.equal(leadingBid([]), null)
  })
})

describe('bidFloor — what the service will actually accept', () => {
  it('is the starting price when there is no leader', () => {
    const floor = bidFloor(listing({ price: '1000' }), [])
    assert.equal(floor.minimum, 1000n)
    assert.equal(floor.basis, 'starting_price')
    assert.equal(floor.known, true)
  })

  it('is one above the leader once there is one — ties never displace', () => {
    const floor = bidFloor(listing({ price: '1000' }), [bid({ amount: '1200' })])
    assert.equal(floor.minimum, 1201n)
    assert.equal(floor.basis, 'above_leader')
  })

  it('reproduces the service’s own fallback of 1 for a listing with no price', () => {
    // `bids.ts:203` — `minimumBid(leader?.amount ?? null, listing.price ?? 1n)`. Smoothing this
    // over would offer a floor the service does not enforce, and produce a 409 nobody can explain.
    const floor = bidFloor(listing({ price: null }), [])
    assert.equal(floor.minimum, 1n)
    assert.equal(floor.known, false)
  })

  it('ignores an outbid bid when computing the floor', () => {
    const floor = bidFloor(listing({ price: '1000' }), [bid({ amount: '9999', status: 'outbid' })])
    assert.equal(floor.minimum, 1000n)
  })

  it('is exact past 2^53', () => {
    const floor = bidFloor(listing({ price: '1' }), [bid({ amount: '9007199254740993' })])
    assert.equal(floor.minimum, 9007199254740994n)
  })
})

describe('the words around a leading bid', () => {
  it('calls it a leading bid, never a price', () => {
    assert.equal(LEADING_BID_LABEL, 'Leading bid')
    assert.equal(/price/i.test(LEADING_BID_LABEL), false)
  })

  it('says the reserve exists and is not published', () => {
    // `server.ts:1190-1191` keeps the reserve off the wire; `orders.ts` checks it at close. So a
    // leading bid above every other bid may still not buy the item.
    assert.match(LEADING_BID_CAVEAT, /not a final price/i)
    assert.match(LEADING_BID_CAVEAT, /reserve/i)
    assert.match(LEADING_BID_CAVEAT, /not published/i)
  })
})
