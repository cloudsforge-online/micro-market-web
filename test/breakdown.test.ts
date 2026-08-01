/**
 * The breakdown a seller reads, and the sum it is rendered with.
 *
 * A settled order's parts are NOT recomputed from the rates here — they are the figures that went
 * into the ledger entry (`market/src/server.ts:1214-1217`). Recomputing them would produce numbers
 * that *should* match, and would diverge silently the day the service's rounding changed. So the
 * test proves two different things:
 *
 *   1. `orderBreakdown` reads what was posted and adds it up honestly, including when it does NOT
 *      add up — because that is a fault worth showing rather than an exception worth throwing.
 *   2. `previewBreakdown` computes with the service's own arithmetic, so a preview is a promise.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { orderBreakdown, orderBreakdownOrNull, previewBreakdown } from '../src/lib/breakdown.ts'
import type { OrderView } from '../src/lib/market.ts'

function order(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: 'o1',
    listingId: 'l1',
    buyerSubject: 'user:b',
    sellerSubject: 'user:s',
    itemUrn: 'cf:worlds:item:1',
    quantity: '1',
    amount: '1000',
    feeAmount: '25',
    royaltyAmount: '75',
    sellerProceeds: '900',
    assetCode: 'SHARD',
    settlementMode: 'custodial',
    journalEntryId: 'j1',
    outboundTransactionId: null,
    source: 'purchase',
    proceedsState: 'held',
    payoutDueAt: '2026-08-08T10:00:00.000Z',
    settledAt: '2026-08-01T10:00:00.000Z',
    royalties: [{ subject: 'user:c', amount: '75' }],
    ...overrides,
  }
}

describe('orderBreakdown — what was posted, added up', () => {
  it('sums the three parts to the price', () => {
    const b = orderBreakdown(order())
    assert.equal(b.price, 1000n)
    assert.equal(b.sum, 1000n)
    assert.equal(b.balances, true)
    assert.equal(b.problem, null)
  })

  it('lists the fee, the royalty, each recipient, and the seller', () => {
    const b = orderBreakdown(order())
    assert.deepEqual(
      b.rows.map((r) => r.label),
      ['Platform fee', 'Royalty', 'user:c', 'Seller receives'],
    )
  })

  it('marks the per-recipient rows as nested, so a reader does not add them twice', () => {
    const b = orderBreakdown(order())
    assert.deepEqual(
      b.rows.map((r) => r.nested),
      [false, false, true, false],
    )
  })

  it('adds up the recipients’ shares separately, and checks them against the royalty', () => {
    const b = orderBreakdown(
      order({
        royaltyAmount: '75',
        royalties: [
          { subject: 'user:c', amount: '38' },
          { subject: 'user:d', amount: '37' },
        ],
      }),
    )
    assert.equal(b.royaltySum, 75n)
    assert.equal(b.royaltyBalances, true)
  })

  it('REPORTS a split that does not add up rather than hiding it', () => {
    const b = orderBreakdown(order({ sellerProceeds: '899' }))
    assert.equal(b.balances, false)
    assert.equal(b.sum, 999n)
    assert.match(b.problem ?? '', /does not sum to the price/)
  })

  it('reports royalty shares that do not sum to the royalty', () => {
    const b = orderBreakdown(order({ royalties: [{ subject: 'user:c', amount: '70' }] }))
    assert.equal(b.royaltyBalances, false)
    assert.equal(b.royaltySum, 70n)
    assert.match(b.problem ?? '', /royalty shares sum to 70/)
  })

  it('handles an order with no royalty at all', () => {
    const b = orderBreakdown(order({ royaltyAmount: '0', sellerProceeds: '975', royalties: [] }))
    assert.equal(b.balances, true)
    assert.equal(b.royaltyBalances, true)
    assert.deepEqual(
      b.rows.map((r) => r.label),
      ['Platform fee', 'Royalty', 'Seller receives'],
    )
  })

  it('is exact for an 18-decimal amount', () => {
    const b = orderBreakdown(
      order({
        assetCode: 'EMBER',
        amount: '1000000000000000001',
        feeAmount: '25000000000000000',
        royaltyAmount: '75000000000000000',
        sellerProceeds: '900000000000000001',
        royalties: [{ subject: 'user:c', amount: '75000000000000000' }],
      }),
    )
    assert.equal(b.balances, true)
    assert.equal(b.sum, 1_000_000_000_000_000_001n)
  })

  it('carries the asset code, so no row renders without its unit', () => {
    assert.equal(orderBreakdown(order({ assetCode: 'EMBER' })).assetCode, 'EMBER')
  })
})

describe('orderBreakdownOrNull — a bad amount must not blank the page', () => {
  it('answers a breakdown for a readable order', () => {
    assert.notEqual(orderBreakdownOrNull(order()), null)
  })

  it('answers null rather than throwing when an amount is unreadable', () => {
    // The request id the user needs to report the fault is on that page. Throwing takes it away.
    assert.equal(orderBreakdownOrNull(order({ feeAmount: 'oops' })), null)
    assert.equal(orderBreakdownOrNull(order({ amount: '1.5' })), null)
    assert.equal(orderBreakdownOrNull(order({ sellerProceeds: '-1' })), null)
  })

  it('answers null when a royalty share is unreadable', () => {
    assert.equal(orderBreakdownOrNull(order({ royalties: [{ subject: 'x', amount: 'nope' }] })), null)
  })
})

describe('previewBreakdown — the preview is the posting', () => {
  it('computes the same split the service would', () => {
    const b = previewBreakdown({
      price: 1000n,
      assetCode: 'SHARD',
      platformFeeBps: 250,
      royaltyBps: 750,
      royaltyRecipients: [{ subject: 'user:a', bps: 10_000 }],
    })
    assert.equal(b.rows[0]?.amount, 25n)
    assert.equal(b.rows[1]?.amount, 75n)
    assert.equal(b.balances, true)
    assert.equal(b.sum, 1000n)
  })

  it('gives the seller the dust, exactly as the service does', () => {
    const b = previewBreakdown({
      price: 1001n,
      assetCode: 'SHARD',
      platformFeeBps: 250,
      royaltyBps: 750,
      royaltyRecipients: [{ subject: 'user:a', bps: 10_000 }],
    })
    const proceeds = b.rows.find((r) => r.label === 'You receive')
    assert.equal(proceeds?.amount, 901n)
    assert.equal(b.balances, true)
  })

  it('splits a royalty across recipients so the rows sum to the royalty', () => {
    const b = previewBreakdown({
      price: 1000n,
      assetCode: 'SHARD',
      platformFeeBps: 0,
      royaltyBps: 100,
      royaltyRecipients: [
        { subject: 'user:a', bps: 3333 },
        { subject: 'user:b', bps: 3333 },
        { subject: 'user:c', bps: 3334 },
      ],
    })
    assert.equal(b.royaltySum, 10n)
    assert.equal(b.royaltyBalances, true)
    assert.equal(b.balances, true)
  })

  it('carries the rate on each top-level row, so a reader can check the arithmetic', () => {
    const b = previewBreakdown({
      price: 1000n,
      assetCode: 'SHARD',
      platformFeeBps: 250,
      royaltyBps: 750,
      royaltyRecipients: [{ subject: 'user:a', bps: 10_000 }],
    })
    assert.equal(b.rows[0]?.bps, 250)
    assert.equal(b.rows[1]?.bps, 750)
    assert.equal(b.rows.find((r) => r.label === 'You receive')?.bps, null)
  })

  it('balances for every price in a range', () => {
    for (let price = 1n; price <= 300n; price += 1n) {
      const b = previewBreakdown({
        price,
        assetCode: 'SHARD',
        platformFeeBps: 250,
        royaltyBps: 750,
        royaltyRecipients: [{ subject: 'user:a', bps: 10_000 }],
      })
      assert.equal(b.balances, true, `price ${price} did not balance`)
      assert.equal(b.royaltyBalances, true)
    }
  })

  it('works with no royalty and no recipients', () => {
    const b = previewBreakdown({
      price: 1000n,
      assetCode: 'SHARD',
      platformFeeBps: 250,
      royaltyBps: 0,
      royaltyRecipients: [],
    })
    assert.equal(b.balances, true)
    assert.equal(b.rows.find((r) => r.label === 'You receive')?.amount, 975n)
  })
})
