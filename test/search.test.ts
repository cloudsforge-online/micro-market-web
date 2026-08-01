/**
 * Filtering, sorting, and saying which of the two you got.
 *
 * The rule this file protects: `micro-market` has no text search and no pagination, so a search
 * box here filters what one request returned. That is useful and it is not "search the market",
 * and the difference is the gap between a buyer who narrows their filters and one who concludes
 * an item is not for sale.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ListingView } from '../src/lib/market.ts'
import { PAGE_CAP, filterListings, searchScopeNote, sortListings } from '../src/lib/search.ts'

function listing(overrides: Partial<ListingView> = {}): ListingView {
  return {
    id: 'l1',
    sellerSubject: 'user:a',
    collectionId: null,
    assetKind: 'game_item',
    itemUrn: 'cf:worlds:item:sword',
    quantity: '1',
    itemAssetCode: 'SHARD',
    pricingMode: 'fixed',
    price: '1000',
    assetCode: 'SHARD',
    settlementMode: 'custodial',
    royaltyBps: 0,
    platformFeeBps: 250,
    auctionEndsAt: null,
    expiresAt: null,
    status: 'active',
    frozen: false,
    escrowed: true,
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('filterListings', () => {
  const all = [
    listing({ id: 'a', itemUrn: 'cf:worlds:item:sword' }),
    listing({ id: 'b', itemUrn: 'cf:worlds:item:shield', assetCode: 'EMBER' }),
    listing({ id: 'c', itemUrn: 'cf:kindred:kin:frost', assetKind: 'collectible' }),
  ]

  it('returns everything for an empty query', () => {
    assert.equal(filterListings(all, '').length, 3)
    assert.equal(filterListings(all, '   ').length, 3)
  })

  it('matches the item URN', () => {
    assert.deepEqual(filterListings(all, 'sword').map((l) => l.id), ['a'])
  })

  it('matches the asset code', () => {
    assert.deepEqual(filterListings(all, 'ember').map((l) => l.id), ['b'])
  })

  it('matches the asset kind', () => {
    assert.deepEqual(filterListings(all, 'collectible').map((l) => l.id), ['c'])
  })

  it('is case-insensitive', () => {
    assert.equal(filterListings(all, 'SWORD').length, 1)
  })

  it('ANDs the terms, so typing more narrows', () => {
    // An OR would make the result set grow as a reader typed, which is the opposite of what
    // typing another word means.
    assert.equal(filterListings(all, 'worlds sword').length, 1)
    assert.equal(filterListings(all, 'worlds frost').length, 0)
  })

  it('answers an empty list when nothing matches, rather than everything', () => {
    assert.deepEqual(filterListings(all, 'zzz'), [])
  })

  it('does not mutate the input', () => {
    const before = all.map((l) => l.id)
    filterListings(all, 'sword')
    assert.deepEqual(all.map((l) => l.id), before)
  })
})

describe('sortListings', () => {
  const priced = [
    listing({ id: 'cheap', price: '10' }),
    listing({ id: 'dear', price: '10000000000000000000000' }),
    listing({ id: 'unpriced', price: null, pricingMode: 'offers_only' }),
    listing({ id: 'mid', price: '500' }),
  ]

  it('orders low to high with a bigint comparison, so a huge price is not a float', () => {
    assert.deepEqual(
      sortListings(priced, 'price_low').map((l) => l.id),
      ['cheap', 'mid', 'dear', 'unpriced'],
    )
  })

  it('orders high to low', () => {
    assert.deepEqual(
      sortListings(priced, 'price_high').map((l) => l.id).slice(0, 3),
      ['dear', 'mid', 'cheap'],
    )
  })

  it('puts an unpriced listing LAST in both directions — it is not a price of zero', () => {
    assert.equal(sortListings(priced, 'price_low').at(-1)?.id, 'unpriced')
    assert.equal(sortListings(priced, 'price_high').at(-1)?.id, 'unpriced')
  })

  it('orders by close time, with the undated last', () => {
    const dated = [
      listing({ id: 'late', auctionEndsAt: '2026-09-01T00:00:00.000Z' }),
      listing({ id: 'none' }),
      listing({ id: 'soon', auctionEndsAt: '2026-08-02T00:00:00.000Z' }),
    ]
    assert.deepEqual(
      sortListings(dated, 'ending_soonest').map((l) => l.id),
      ['soon', 'late', 'none'],
    )
  })

  it('falls back to the expiry when there is no auction close', () => {
    const dated = [
      listing({ id: 'later', expiresAt: '2026-09-01T00:00:00.000Z' }),
      listing({ id: 'sooner', expiresAt: '2026-08-02T00:00:00.000Z' }),
    ]
    assert.deepEqual(
      sortListings(dated, 'ending_soonest').map((l) => l.id),
      ['sooner', 'later'],
    )
  })

  it('orders newest first, matching the route’s own order (listings.ts:711)', () => {
    const byDate = [
      listing({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z' }),
      listing({ id: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]
    assert.deepEqual(
      sortListings(byDate, 'newest').map((l) => l.id),
      ['new', 'old'],
    )
  })

  it('does not mutate the input array', () => {
    const before = priced.map((l) => l.id)
    sortListings(priced, 'price_low')
    assert.deepEqual(priced.map((l) => l.id), before)
  })

  it('handles an empty list and a single item', () => {
    assert.deepEqual(sortListings([], 'price_low'), [])
    assert.equal(sortListings([listing()], 'price_high').length, 1)
  })
})

describe('searchScopeNote — saying what was actually searched', () => {
  it('reports the count with no query', () => {
    assert.match(searchScopeNote(10, 10, ''), /10 listings loaded/)
  })

  it('warns when the page is at the route’s cap, because there may be more', () => {
    // `listings.ts:702` defaults the limit to 50 and the route passes none, so a full page means
    // there is no way to see the rest — which a reader has to be told.
    const note = searchScopeNote(PAGE_CAP, PAGE_CAP, '')
    assert.match(note, /most this page can request/i)
    assert.match(note, /narrow the filters/i)
  })

  it('does not warn below the cap', () => {
    assert.equal(/most this page can request/i.test(searchScopeNote(4, 4, '')), false)
  })

  it('says a query filters this page rather than the whole market', () => {
    const note = searchScopeNote(2, 30, 'sword')
    assert.match(note, /2 of 30 listings loaded/)
    assert.match(note, /rather than searching the whole market/i)
    assert.match(note, /no text-search route/i)
  })

  it('quotes the trimmed query, so surrounding whitespace does not appear on screen', () => {
    assert.match(searchScopeNote(1, 2, '  sword  '), /“sword”/)
  })

  it('gets the singular right for one listing', () => {
    assert.match(searchScopeNote(1, 1, ''), /1 listing loaded/)
    assert.equal(/1 listings/.test(searchScopeNote(1, 1, '')), false)
  })

  it('knows the cap the service actually enforces', () => {
    assert.equal(PAGE_CAP, 50)
  })
})
