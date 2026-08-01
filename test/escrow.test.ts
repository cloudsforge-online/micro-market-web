/**
 * "We could not confirm" is not "not confirmed".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * This is the file the last defect earned. A client reported an upstream that did not answer as
 * an upstream that answered NO, and every on-chain escrow activation in the estate failed with a
 * false diagnosis. The two need opposite remedies — wait, versus go and post the escrow — so the
 * test asserts BOTH DIRECTIONS on every branch: the unknown case must not claim a negative, and
 * the negative case must not be softened into an unknown.
 *
 * The two flags are separate booleans on purpose. A single tri-state enum would let a careless
 * `!confirmed` collapse them again, and that is exactly the shape of the bug.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError } from '../src/lib/api.ts'
import { INDICATOR_COPY, diagnoseActivation, escrowKnowledge, riskKnowledge } from '../src/lib/escrow.ts'
import type { ListingView, RiskView } from '../src/lib/market.ts'

function listing(overrides: Partial<ListingView> = {}): ListingView {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    sellerSubject: 'user:a',
    collectionId: null,
    assetKind: 'game_item',
    itemUrn: 'cf:worlds:item:1',
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

describe('escrowKnowledge — what a listing actually says about its escrow', () => {
  it('says nothing is escrowed when nothing is', () => {
    const k = escrowKnowledge(listing({ escrowed: false }))
    assert.equal(k.state, 'none')
    assert.equal(k.known, true)
  })

  it('words the empty case differently for an on-chain listing', () => {
    const custodial = escrowKnowledge(listing({ escrowed: false, settlementMode: 'custodial' }))
    const onchain = escrowKnowledge(listing({ escrowed: false, settlementMode: 'onchain', status: 'draft' }))
    assert.notEqual(custodial.detail, onchain.detail)
    assert.match(onchain.detail, /on-chain escrow/)
  })

  it('calls a custodial escrow a LEDGER RESERVATION, never a balance', () => {
    // `market/src/escrow.ts:1-13` — market holds the reference; the ledger holds the value. A UI
    // that says "we are holding your funds" has made market a second ledger in the reader's head.
    const k = escrowKnowledge(listing({ settlementMode: 'custodial', escrowed: true }))
    assert.equal(k.state, 'ledger_reservation')
    assert.equal(k.known, true)
    assert.match(k.detail, /reservation/i)
    assert.match(k.detail, /Forge Market holds no balance/i)
  })

  it('says an ACTIVE on-chain listing had its escrow confirmed, because activation fails closed', () => {
    // server.ts:757-763 — a listing cannot reach `active` without `escrowStatus().confirmed`.
    const k = escrowKnowledge(listing({ settlementMode: 'onchain', status: 'active', escrowed: true }))
    assert.equal(k.state, 'onchain_confirmed_at_activation')
    assert.equal(k.known, true)
  })

  it('words that as a PAST observation, not a claim about now', () => {
    const k = escrowKnowledge(listing({ settlementMode: 'onchain', status: 'active', escrowed: true }))
    assert.match(k.detail, /not just now|when it was activated/i)
  })

  it('keeps the same conclusion once the listing has settled or sold', () => {
    for (const status of ['settling', 'sold'] as const) {
      const k = escrowKnowledge(listing({ settlementMode: 'onchain', status, escrowed: true }))
      assert.equal(k.state, 'onchain_confirmed_at_activation')
    }
  })

  it('marks an on-chain DRAFT with an escrow reference as NOT KNOWN', () => {
    const k = escrowKnowledge(listing({ settlementMode: 'onchain', status: 'draft', escrowed: true }))
    assert.equal(k.state, 'onchain_recorded_not_yet_live')
    assert.equal(k.known, false)
  })

  it('and says explicitly that this is not a claim of unconfirmed', () => {
    const k = escrowKnowledge(listing({ settlementMode: 'onchain', status: 'draft', escrowed: true }))
    assert.match(k.detail, /not saying it is unconfirmed/i)
    assert.match(k.detail, /nobody here has checked/i)
  })

  it('never uses the bare phrase "not confirmed" for a case it has not checked', () => {
    // The exact conflation. `not yet been through the confirmation check` is a statement about US;
    // `not confirmed` is a statement about the CHAIN, and only one of them is true here.
    const k = escrowKnowledge(listing({ settlementMode: 'onchain', status: 'draft', escrowed: true }))
    assert.equal(/\bis not confirmed\b/i.test(k.detail), false)
    assert.equal(/\bunconfirmed\b/i.test(k.title), false)
  })

  it('is exhaustive: every combination produces a case with a title and a detail', () => {
    for (const settlementMode of ['custodial', 'onchain'] as const) {
      for (const status of ['draft', 'active', 'settling', 'sold', 'cancelled', 'expired'] as const) {
        for (const escrowed of [true, false]) {
          const k = escrowKnowledge(listing({ settlementMode, status, escrowed }))
          assert.ok(k.title.length > 0, `${settlementMode}/${status}/${escrowed} has no title`)
          assert.ok(k.detail.length > 0)
          assert.equal(typeof k.known, 'boolean')
        }
      }
    }
  })
})

describe('diagnoseActivation — the branch the estate lost a release to', () => {
  const err = (status: number, message: string, code?: string) =>
    new ApiError(status, message, code, 'req-1')

  it('reads a 503 indexer_unavailable as UNKNOWN, never as a negative', () => {
    // server.ts:467-475 — "the on-chain escrow could not be confirmed; try again shortly".
    const d = diagnoseActivation(err(503, 'the on-chain escrow could not be confirmed', 'indexer_unavailable'))
    assert.equal(d.outcome, 'could_not_confirm')
    assert.equal(d.escrowIsUnknown, true)
    assert.equal(d.escrowIsUnconfirmed, false)
  })

  it('says so in words a seller cannot misread', () => {
    const d = diagnoseActivation(err(503, 'could not be confirmed', 'indexer_unavailable'))
    assert.match(d.message, /could not confirm/i)
    assert.match(d.message, /we do not know/i)
    assert.match(d.message, /Nothing was changed/i)
    // And the sentence that would send them to re-post an escrow that is already on the chain
    // must not appear.
    assert.equal(/your escrow is not confirmed/i.test(d.message), false)
  })

  it('reads a 409 with the escrow message as ACTUALLY NOT CONFIRMED', () => {
    // server.ts:762 — `new ListingStateError('the on-chain escrow is not confirmed yet')`.
    const d = diagnoseActivation(err(409, 'the on-chain escrow is not confirmed yet', 'state_conflict'))
    assert.equal(d.outcome, 'not_confirmed')
    assert.equal(d.escrowIsUnconfirmed, true)
    assert.equal(d.escrowIsUnknown, false)
  })

  it('tells the seller what to do about it, which is the opposite advice', () => {
    const d = diagnoseActivation(err(409, 'the on-chain escrow is not confirmed yet', 'state_conflict'))
    assert.match(d.message, /not confirmed yet/i)
    assert.match(d.message, /activate again/i)
  })

  it('never sets both flags, on any input', () => {
    const cases: unknown[] = [
      err(503, 'x', 'indexer_unavailable'),
      err(409, 'the on-chain escrow is not confirmed yet', 'state_conflict'),
      err(409, 'this listing is sold', 'state_conflict'),
      err(0, 'Cannot reach the server.'),
      err(400, 'onchainEscrowTx is required', 'bad_request'),
      err(500, 'internal', 'internal'),
      new Error('boom'),
      null,
      undefined,
    ]
    for (const input of cases) {
      const d = diagnoseActivation(input)
      assert.equal(
        d.escrowIsUnknown && d.escrowIsUnconfirmed,
        false,
        `both flags set for ${String(input)}`,
      )
    }
  })

  it('keeps a NETWORK failure separate from both: we did not even manage to ask', () => {
    const d = diagnoseActivation(err(0, 'Cannot reach the server. Check your connection and try again.'))
    assert.equal(d.outcome, 'could_not_ask')
    assert.equal(d.escrowIsUnknown, true)
    assert.equal(d.escrowIsUnconfirmed, false)
    assert.match(d.message, /nothing was checked/i)
  })

  it('reads a 409 that is NOT about the escrow as an ordinary state conflict', () => {
    const d = diagnoseActivation(err(409, 'this listing is already active', 'state_conflict'))
    assert.equal(d.outcome, 'other_conflict')
    assert.equal(d.escrowIsUnconfirmed, false)
    assert.equal(d.escrowIsUnknown, false)
  })

  it('treats a non-ApiError as unknown rather than as a refusal', () => {
    const d = diagnoseActivation(new Error('boom'))
    assert.equal(d.outcome, 'unknown_failure')
    assert.equal(d.escrowIsUnconfirmed, false)
    assert.equal(d.escrowIsUnknown, true)
  })

  it('carries the request id through, because that is what support runs on', () => {
    const d = diagnoseActivation(err(503, 'x', 'indexer_unavailable'))
    assert.equal(d.requestId, 'req-1')
  })

  it('treats any 503 as unknown even without the code, because a 503 is never an answer', () => {
    const d = diagnoseActivation(err(503, 'service unavailable'))
    assert.equal(d.escrowIsUnknown, true)
    assert.equal(d.escrowIsUnconfirmed, false)
  })
})

describe('riskKnowledge — the same distinction, one level out', () => {
  const risk = (overrides: Partial<RiskView> = {}): RiskView => ({
    verification: null,
    indicators: [],
    indicatorsAvailable: true,
    ...overrides,
  })

  it('reads indicatorsAvailable:false as NOT CHECKED, not as clean', () => {
    // server.ts:801-804 — "a broken indexer renders as a clean bill of health" is the failure.
    const k = riskKnowledge(risk({ indicatorsAvailable: false }))
    assert.equal(k.known, false)
    assert.match(k.note, /could not read the chain/i)
    assert.match(k.note, /not the same as finding none/i)
  })

  it('reads an empty list WITH availability as a real answer', () => {
    const k = riskKnowledge(risk({ indicatorsAvailable: true, indicators: [] }))
    assert.equal(k.known, true)
    assert.match(k.note, /none of the six indicators applied/i)
  })

  it('separates those two notes, so they cannot read the same', () => {
    const unchecked = riskKnowledge(risk({ indicatorsAvailable: false }))
    const clean = riskKnowledge(risk({ indicatorsAvailable: true, indicators: [] }))
    assert.notEqual(unchecked.note, clean.note)
    assert.notEqual(unchecked.known, clean.known)
  })

  it('treats a missing response as not checked', () => {
    assert.equal(riskKnowledge(null).known, false)
  })

  it('passes the indicators through when there are some', () => {
    const k = riskKnowledge(
      risk({
        indicatorsAvailable: true,
        indicators: [{ code: 'few_holders', present: true, detail: '9 holders' }],
      }),
    )
    assert.equal(k.known, true)
    assert.equal(k.indicators.length, 1)
    assert.match(k.note, /Facts, not a score/i)
  })

  it('has copy for every code in the service’s closed set (market/src/risk.ts:34-41)', () => {
    const codes = [
      'mint_authority_present',
      'ownership_not_renounced',
      'supply_concentrated',
      'recently_deployed',
      'deployer_wallet_exported',
      'few_holders',
    ]
    for (const code of codes) {
      assert.ok(INDICATOR_COPY[code], `no copy for ${code}`)
    }
    assert.equal(Object.keys(INDICATOR_COPY).length, codes.length, 'a code was added or invented')
  })

  it('renders no score, and offers nowhere to put one', () => {
    const k = riskKnowledge(risk({ indicators: [{ code: 'few_holders', present: true, detail: '9' }] }))
    assert.equal('score' in k, false)
    assert.equal('rating' in k, false)
  })
})
