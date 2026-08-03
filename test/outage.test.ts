/**
 * A read that failed is not an answer, and this file is where that stops being said twice.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `src/lib/resource.ts:14-20` states the rule and gets it right: **FAILURE OUTRANKS EMPTINESS.**
 * "A request that threw has told us nothing about whether data exists, so reporting 'nothing here'
 * for a timeout is how an outage reads as a quiet week."
 *
 * Every page on this surface routes its four states through `useResource` — and then reaches past
 * it. `resource.data?.x ?? []` appears nine times in `src/pages`, and seven of them are inside a
 * `state === 'ok'` branch where the fallback can never fire. Two are not, and both turn a failed
 * upstream into a confident sentence:
 *
 *   `listing.tsx:128`  `const allBids = bids.data?.bids ?? []`
 *   `collections.tsx:115`  `collections.data?.collections.find(...) ?? null`
 *
 * The estate has met this before: `hasAnswer(t) ? t.data : []` made wallet panels say "There is no
 * balance to send" during an outage. The three scenarios below are this surface's version, and one
 * of them costs a bidder money rather than merely misleading them.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { CollectionsPage } from '../src/pages/collections.tsx'
import { ListingPage } from '../src/pages/listing.tsx'

const ORIGIN = 'https://market.cloudsforge.online'

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element) as ReactElement)

const AUCTION = {
  pricingMode: 'auction' as const,
  auctionEndsAt: '2099-01-01T00:00:00.000Z',
  price: '1000000000000000000',
}

/** An auction listing whose four reads are healthy except the bids, which 500. */
function bidsDown(): Routes {
  return {
    [`GET /v1/listings/${fx.LISTING_ID}/risk`]: { body: fx.risk() },
    [`GET /v1/listings/${fx.LISTING_ID}/offers`]: { body: { offers: [] } },
    [`GET /v1/listings/${fx.LISTING_ID}/bids`]: {
      status: 500,
      body: fx.error('internal', 'the bids could not be read'),
      requestId: 'req-bids-down',
    },
    [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail(AUCTION) },
  }
}

const listingAt = () => page(h(ListingPage), `/listings/${fx.LISTING_ID}`)

/** The section a control sits in, so an assertion is about that panel and not the whole page. */
function panelOf(el: Element): Element {
  const section = el.closest('section')
  assert.ok(section, 'the control is not inside a section')
  return section
}

describe('a failed bids read is never rendered as “there are no bids”', () => {
  it('the bid form does not state a minimum it could not compute', async () => {
    // THE ONE THAT COSTS MONEY. `bidFloorFrom` is a faithful port of `market/src/bids.ts:203` —
    // `minimumBid(leader?.amount ?? null, listing.price ?? 1n)` — and it is fed `leaderAmount`,
    // which came from `bids.data?.bids ?? []`. With the bids read down that array is empty, the
    // floor comes out as the STARTING price, and the form tells the bidder in plain words that
    // this is "the smallest bid this auction will take".
    //
    // It is not. If there is a leading bid the service's floor is one unit above it, and the
    // bidder is being sent to a `bid_too_low` 409 by a sentence this page had no basis for. The
    // page already knows the read failed — the panel above says so — and the form is the one place
    // that acts on it.
    await withScreen(
      listingAt(),
      { url: `${ORIGIN}/listings/${fx.LISTING_ID}`, routes: bidsDown() },
      async (s) => {
        const form = panelOf(s.byRole('button', 'Bid'))
        assert.doesNotMatch(
          s.textOf(form),
          /smallest bid this auction will take is/i,
          'the bid form named a minimum computed from a bids read that returned 500. A bidder ' +
            'who takes it is refused with bid_too_low, and nothing on the form told them the ' +
            'figure was a guess.',
        )
        assert.match(
          s.textOf(form),
          /could not read the bids/i,
          'the form neither states the floor honestly nor says why it cannot',
        )
      },
    )
  })

  it('the money-split panel does not announce that there are no bids', async () => {
    // `preview` is null because `leaderAmount` is null because the bids array is the empty one the
    // `?? []` invented. The panel then says "There is no price to split yet ... Once there is a
    // bid, this shows exactly how that amount divides" — a statement about the auction's contents,
    // made from a request that failed.
    await withScreen(
      listingAt(),
      { url: `${ORIGIN}/listings/${fx.LISTING_ID}`, routes: bidsDown() },
      async (s) => {
        assert.doesNotMatch(
          s.text(),
          /there is no price to split yet/i,
          'a 500 from the bids route was rendered as "there is no price to split yet" — an ' +
            'outage reading as a quiet auction (src/lib/resource.ts:14-20)',
        )
        assert.doesNotMatch(
          s.text(),
          /once there is a bid/i,
          '"once there is a bid" asserts there is not one; the request that would have said so failed',
        )
        // And the leading-bid row itself, which has said this correctly since it was written.
        // Asserted here so the three sentences that depend on `bidsFailed` fail together rather
        // than one of them being quietly reverted.
        assert.doesNotMatch(
          s.text(),
          /no bids yet/i,
          'the leading-bid row rendered a 500 as "No bids yet"',
        )
      },
    )
  })

  it('with the bids healthy it still says the ordinary thing', async () => {
    // The counterweight. A guard that fires on a healthy read is a guard somebody deletes, so the
    // no-bids-yet sentence must survive an auction that genuinely has no bids.
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: { ...bidsDown(), [`GET /v1/listings/${fx.LISTING_ID}/bids`]: { body: { bids: [] } } },
      },
      async (s) => {
        assert.match(s.text(), /there is no price to split yet/i)
        assert.match(
          s.textOf(panelOf(s.byRole('button', 'Bid'))),
          /smallest bid this auction will take is/i,
          'an auction whose bids read fine must still be told what to beat',
        )
      },
    )
  })
})

describe('a collection whose details have not arrived yet is not reported as unreadable', () => {
  it('says nothing about a failure while the read is still in flight', async () => {
    // `collections.data` is null for the whole of the first request, and `CollectionDetail` reads
    // it directly rather than through `collections.state`. So the "we could not read this
    // collection's own details" sentence is on screen at first paint for EVERY collection, every
    // time, including the ones that load perfectly a moment later.
    await withScreen(
      page(h(CollectionsPage), '/collections/col-1'),
      {
        url: `${ORIGIN}/collections/col-1`,
        routes: {
          'GET /v1/collections': {
            delayMs: 40,
            body: {
              collections: [
                {
                  id: 'col-1',
                  slug: 'relics',
                  name: 'Relics',
                  description: 'Old things from the first age.',
                  ownerSubject: fx.SELLER,
                  royalties: [],
                  createdAt: '2026-07-01T09:00:00.000Z',
                },
              ],
            },
          },
          'GET /v1/listings': { body: { listings: [] }, delayMs: 40 },
        },
      },
      async (s) => {
        assert.doesNotMatch(
          s.text(),
          /could not read this collection/i,
          'the page announced a failure before the request it describes had answered. A read in ' +
            'flight is not a read that failed — src/lib/resource.ts:14-20.',
        )
        await s.settle(80)
        assert.match(s.text(), /Old things from the first age/, 'the collection never rendered')
      },
    )
  })

  it('still says so when the read really does fail', async () => {
    await withScreen(
      page(h(CollectionsPage), '/collections/col-1'),
      {
        url: `${ORIGIN}/collections/col-1`,
        routes: {
          'GET /v1/collections': { status: 500, body: fx.error('internal', 'no collections') },
          'GET /v1/listings': { body: { listings: [] } },
        },
      },
      async (s) => {
        assert.match(
          s.text(),
          /could not read this collection/i,
          'a genuinely failed collection read must still be named, or the fix has traded one ' +
            'silence for another',
        )
      },
    )
  })
})
