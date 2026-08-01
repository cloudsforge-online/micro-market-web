/**
 * What is actually KNOWN about a listing's escrow, and what is merely not known.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **"WE COULD NOT CONFIRM" IS NOT "NOT CONFIRMED".**
 *
 * This file exists because the estate has just spent a release on the difference. The most recent
 * client defect made *every on-chain escrow activation* fail with a false diagnosis: an upstream
 * that did not answer was reported as an upstream that answered no. The two need opposite
 * remedies — wait and retry versus go and post the escrow — so a UI that renders them as one
 * sentence sends every seller down the wrong path.
 *
 * The service is careful about this in three separate places, and this module is the fourth:
 *
 *   1. `market/src/server.ts:756-763` — activation of an `onchain` listing FAILS CLOSED. An
 *      unconfirmed escrow is a 409; it is never "list it anyway", because that is a listing for
 *      an item the seller can still transfer.
 *   2. `market/src/server.ts:467-475` — an unreachable indexer is a **503 `indexer_unavailable`**,
 *      whose message is "the on-chain escrow could not be confirmed", not "is not confirmed".
 *   3. `market/src/server.ts:801-804` — the risk route puts `indicatorsAvailable` on the wire
 *      explicitly, "or a broken indexer renders as a clean bill of health".
 *
 * ── And the second thing this module refuses to blur ──────────────────────────────────────────
 *
 * **AN ESCROW IS A REFERENCE TO A `micro-ledger` RESERVATION. IT IS NEVER A BALANCE.**
 * `market/src/escrow.ts:1-13`: `hold_entry_id` is the journal entry that moved value from
 * `available` to `reserved`; market never adds anything up, and "if `amount` ever starts being
 * decremented in place, market has become a second ledger". So no screen in this app renders an
 * escrow as an amount held by Forge Market. It renders it as a reservation that exists, in the
 * ledger, with the entry that made it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { ApiError } from './api.ts'
import type { ListingView, RiskView } from './market.ts'

/**
 * What this app can honestly say about a listing's escrow.
 *
 * Five cases, not two, because collapsing them is the defect. Each carries the sentence to render
 * and — for the ones that are not knowledge — an explicit `known: false`.
 */
export type EscrowKnowledge =
  | {
      readonly state: 'none'
      readonly known: true
      readonly title: 'No escrow yet'
      readonly detail: string
    }
  | {
      readonly state: 'ledger_reservation'
      readonly known: true
      readonly title: 'Reserved in the ledger'
      readonly detail: string
    }
  | {
      readonly state: 'onchain_confirmed_at_activation'
      readonly known: true
      readonly title: 'On-chain escrow confirmed'
      readonly detail: string
    }
  | {
      readonly state: 'onchain_recorded_not_yet_live'
      readonly known: false
      readonly title: 'Escrow recorded, not yet confirmed here'
      readonly detail: string
    }

/**
 * Read a listing's escrow honestly.
 *
 * The wire gives two facts and no more: `settlementMode` and `escrowed`, the latter being
 * `escrowId !== null || onchainEscrowTx !== null` (`market/src/server.ts:1200`). It does NOT
 * carry a confirmation flag, so the only sound inference about the chain is the one the service's
 * own fail-closed rule licenses:
 *
 *   an `onchain` listing reached `active` **only** by passing `escrowStatus().confirmed`
 *   (`server.ts:757-763`). So `active` + `onchain` + `escrowed` means the escrow WAS confirmed,
 *   at activation.
 *
 * That is a statement about a past observation and is worded as one. It is not a claim that the
 * escrow is confirmed *now* — this app has not asked, and could not: there is no read route on
 * `micro-market` that re-checks it.
 */
export function escrowKnowledge(listing: ListingView): EscrowKnowledge {
  if (!listing.escrowed) {
    return {
      state: 'none',
      known: true,
      title: 'No escrow yet',
      detail:
        listing.settlementMode === 'onchain'
          ? 'The seller has not recorded an on-chain escrow for this item.'
          : 'Nothing is reserved against this listing yet.',
    }
  }
  if (listing.settlementMode === 'custodial') {
    return {
      state: 'ledger_reservation',
      known: true,
      title: 'Reserved in the ledger',
      detail:
        'The item is held by a reservation in Forge Ledger — a journal entry that moved it from ' +
        'available to reserved. Forge Market holds no balance of its own; it holds the reference.',
    }
  }
  if (listing.status === 'active' || listing.status === 'settling' || listing.status === 'sold') {
    return {
      state: 'onchain_confirmed_at_activation',
      known: true,
      title: 'On-chain escrow confirmed',
      detail:
        'This listing could only go live after the escrow transaction was confirmed on chain. ' +
        'That was checked when it was activated, not just now.',
    }
  }
  return {
    state: 'onchain_recorded_not_yet_live',
    known: false,
    title: 'Escrow recorded, not yet confirmed here',
    detail:
      'An escrow transaction is recorded against this listing, but it has not been through the ' +
      'confirmation check that activation performs. We are not saying it is unconfirmed — we are ' +
      'saying nobody here has checked.',
  }
}

/**
 * Why an activation did not succeed.
 *
 * **This is the distinction the whole file is for.** `micro-market` answers the two cases with
 * two different codes, and they are not interchangeable:
 *
 *   * `indexer_unavailable` (503, `server.ts:467-475`) — the chain index did not answer. We know
 *     nothing about the escrow. The remedy is to wait.
 *   * `state_conflict` (409) carrying the escrow message (`server.ts:762`) — the chain index
 *     answered, and the escrow is not confirmed. The remedy is to post it, or wait for the chain.
 *
 * Anything else is neither, and is never reported as either. A network failure (`ApiError` with
 * status 0, `api.ts`) means the request never reached the service at all, which is a third thing
 * again: we did not even manage to ask.
 */
export type ActivationOutcome =
  | 'could_not_confirm'
  | 'not_confirmed'
  | 'could_not_ask'
  | 'other_conflict'
  | 'unknown_failure'

export interface ActivationDiagnosis {
  readonly outcome: ActivationOutcome
  /** What the seller is told. Never asserts a fact this app does not have. */
  readonly message: string
  /** True only when the service actually told us the escrow is not confirmed. */
  readonly escrowIsUnconfirmed: boolean
  /** True when the answer is that we do not know — the case that must never read as a negative. */
  readonly escrowIsUnknown: boolean
  readonly requestId: string | undefined
}

/** The 409 message the activate route raises for an unconfirmed escrow — `server.ts:762`. */
const NOT_CONFIRMED = /escrow is not confirmed/i

export function diagnoseActivation(err: unknown): ActivationDiagnosis {
  if (!(err instanceof ApiError)) {
    return {
      outcome: 'unknown_failure',
      message: 'Activation failed for a reason this page did not recognise.',
      escrowIsUnconfirmed: false,
      escrowIsUnknown: true,
      requestId: undefined,
    }
  }
  if (err.status === 0) {
    return {
      outcome: 'could_not_ask',
      message:
        'We could not reach Forge Market, so nothing was checked and nothing was changed. ' +
        'Your listing is exactly as it was.',
      escrowIsUnconfirmed: false,
      escrowIsUnknown: true,
      requestId: err.requestId,
    }
  }
  if (err.code === 'indexer_unavailable' || err.status === 503) {
    return {
      outcome: 'could_not_confirm',
      // The wording matters as much as the branch. "Could not confirm" and "not confirmed" are
      // different sentences about different worlds, and only one of them says the seller did
      // something wrong.
      message:
        'We could not confirm the on-chain escrow: the chain index did not answer. This is not a ' +
        'statement that your escrow is missing — it is a statement that we do not know. Nothing ' +
        'was changed. Try again shortly.',
      escrowIsUnconfirmed: false,
      escrowIsUnknown: true,
      requestId: err.requestId,
    }
  }
  if (err.status === 409 && NOT_CONFIRMED.test(err.message)) {
    return {
      outcome: 'not_confirmed',
      message:
        'The chain index answered, and the escrow transaction is not confirmed yet. Once it has ' +
        'enough confirmations, activate again.',
      escrowIsUnconfirmed: true,
      escrowIsUnknown: false,
      requestId: err.requestId,
    }
  }
  if (err.status === 409) {
    return {
      outcome: 'other_conflict',
      message: err.message,
      escrowIsUnconfirmed: false,
      escrowIsUnknown: false,
      requestId: err.requestId,
    }
  }
  return {
    outcome: 'unknown_failure',
    message: err.message,
    escrowIsUnconfirmed: false,
    escrowIsUnknown: true,
    requestId: err.requestId,
  }
}

/* ------------------------------------------------------------------ risk indicators */

/**
 * The same distinction, one level out: indicators we have, versus indicators we could not fetch.
 *
 * `GET /v1/listings/:id/risk` fails OPEN and answers 200 either way (`server.ts:790-814`), so the
 * status code carries none of this. `indicatorsAvailable` does, and a caller that ignores it
 * renders a broken indexer as a clean bill of health — which is exactly the sentence the service
 * wrote next to that field.
 */
export type RiskKnowledge =
  | { readonly known: false; readonly indicators: readonly []; readonly note: string }
  | {
      readonly known: true
      readonly indicators: RiskView['indicators']
      readonly note: string
    }

export function riskKnowledge(risk: RiskView | null): RiskKnowledge {
  if (risk === null || !risk.indicatorsAvailable) {
    return {
      known: false,
      indicators: [],
      note:
        'We could not read the chain for this item, so there are no indicators to show. That is ' +
        'not the same as finding none.',
    }
  }
  if (risk.indicators.length === 0) {
    return {
      known: true,
      indicators: risk.indicators,
      note: 'We read the chain for this item and none of the six indicators applied.',
    }
  }
  return {
    known: true,
    indicators: risk.indicators,
    note: 'Read from the chain when this page loaded. Facts, not a score.',
  }
}

/** The sentence for each indicator code — `market/src/risk.ts:34-41` is the closed set. */
export const INDICATOR_COPY: Readonly<Record<string, string>> = Object.freeze({
  mint_authority_present: 'The mint authority is still held, so more of this token can be created.',
  ownership_not_renounced: 'Contract ownership has not been renounced.',
  supply_concentrated: 'A single holder controls a large share of the supply.',
  recently_deployed: 'The contract was deployed recently and has little history.',
  deployer_wallet_exported: 'The deployer wallet has been exported from custody.',
  few_holders: 'There are few holders, so a handful of wallets are the market.',
})
