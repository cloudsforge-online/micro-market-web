/**
 * The money breakdown of a sale, arranged so a reader can SEE it add up.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `market/src/money.ts` proves that `fee + royalty + proceeds === price` exactly, for every price
 * and every pair of rates, and asserts it on every split rather than trusting it. The screen is
 * the last place that arithmetic exists, and it is the only place a seller ever reads it.
 *
 * So a breakdown here is not three formatted numbers next to a fourth. It is:
 *
 *   * the parts, each as a `bigint` from the wire,
 *   * their SUM, computed here in `bigint`,
 *   * and `balances`, which is that sum compared against the price.
 *
 * The component renders the sum row. If a future service change, a rounding fix or a wire bug
 * ever made the three stop adding up, this page says so on screen instead of showing three
 * plausible numbers — because three plausible numbers is what a seller would believe.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { OrderView, RoyaltySplitEntry } from './market.ts'
import {
  allocate,
  bpsOf,
  checkPartition,
  parseAmount,
  parseAmountOrNull,
  type SaleSplit,
} from './money.ts'

export interface BreakdownRow {
  readonly label: string
  readonly amount: bigint
  /** A sub-row: one royalty recipient inside the royalty total. */
  readonly nested: boolean
  /** The rate this row was computed from, in basis points, where there is one. */
  readonly bps: number | null
}

export interface Breakdown {
  readonly assetCode: string
  readonly price: bigint
  readonly rows: readonly BreakdownRow[]
  /** The three top-level parts, added up here. */
  readonly sum: bigint
  /** True when `sum === price`. Rendered, not assumed. */
  readonly balances: boolean
  /** The royalty recipients' shares, added up here. */
  readonly royaltySum: bigint
  /** True when the recipients' shares sum to the royalty total. */
  readonly royaltyBalances: boolean
  /** Non-null when something does not add up — the sentence to show. */
  readonly problem: string | null
}

/**
 * The breakdown of a SETTLED order, from the amounts the service actually posted.
 *
 * These are not recomputed from the rates. `orderWire` (`market/src/server.ts`) carries
 * `feeAmount`, `royaltyAmount` and `sellerProceeds` as the figures that went into the ledger
 * entry, and the per-recipient `royalties` array (1225-1228) as what each was paid. Recomputing
 * them from bps would produce numbers that *should* match and would silently diverge if the
 * service's rounding ever changed — and the whole point of this screen is to show what happened,
 * not what would happen.
 */
export function orderBreakdown(order: OrderView): Breakdown {
  const price = parseAmount(order.amount, 'amount')
  const fee = parseAmount(order.feeAmount, 'feeAmount')
  const royalty = parseAmount(order.royaltyAmount, 'royaltyAmount')
  const proceeds = parseAmount(order.sellerProceeds, 'sellerProceeds')

  const shares = order.royalties.map((share) => ({
    subject: share.subject,
    amount: parseAmount(share.amount, 'royalty share'),
  }))

  const rows: BreakdownRow[] = [
    { label: 'Platform fee', amount: fee, nested: false, bps: null },
    { label: 'Royalty', amount: royalty, nested: false, bps: null },
    ...shares.map((share) => ({
      label: share.subject,
      amount: share.amount,
      nested: true,
      bps: null,
    })),
    { label: 'Seller receives', amount: proceeds, nested: false, bps: null },
  ]

  const split: SaleSplit = {
    price,
    platformFee: fee,
    royaltyTotal: royalty,
    sellerProceeds: proceeds,
    royaltyShares: shares,
  }
  return assemble(order.assetCode, split, rows)
}

/**
 * The breakdown a seller is shown BEFORE they list: what a sale at this price would pay out.
 *
 * Computed with the same remainder-defined arithmetic as the service (`splitSale`,
 * `market/src/money.ts`) so the preview is the posting. `platformFeeBps` comes from the
 * listing rather than from this app: the service snapshots it from its own environment at
 * creation (`server.ts`) and never reads it from the body, so it is a fact about the listing
 * and not a number this bundle is entitled to choose.
 */
export function previewBreakdown(input: {
  price: bigint
  assetCode: string
  platformFeeBps: number
  royaltyBps: number
  royaltyRecipients: readonly RoyaltySplitEntry[]
}): Breakdown {
  const fee = bpsOf(input.price, input.platformFeeBps)
  const royalty = bpsOf(input.price, input.royaltyBps)
  const proceeds = input.price - fee - royalty
  const allocated = allocate(
    royalty,
    input.royaltyRecipients.map((r) => r.bps),
  )
  const shares = input.royaltyRecipients.map((recipient, index) => ({
    subject: recipient.subject,
    amount: allocated[index] ?? 0n,
  }))

  const rows: BreakdownRow[] = [
    { label: 'Platform fee', amount: fee, nested: false, bps: input.platformFeeBps },
    { label: 'Royalty', amount: royalty, nested: false, bps: input.royaltyBps },
    ...shares.map((share, index) => ({
      label: share.subject,
      amount: share.amount,
      nested: true,
      bps: input.royaltyRecipients[index]?.bps ?? null,
    })),
    { label: 'You receive', amount: proceeds, nested: false, bps: null },
  ]

  return assemble(
    input.assetCode,
    { price: input.price, platformFee: fee, royaltyTotal: royalty, sellerProceeds: proceeds, royaltyShares: shares },
    rows,
  )
}

function assemble(assetCode: string, split: SaleSplit, rows: readonly BreakdownRow[]): Breakdown {
  const sum = split.platformFee + split.royaltyTotal + split.sellerProceeds
  const royaltySum = split.royaltyShares.reduce((acc, share) => acc + share.amount, 0n)
  return {
    assetCode,
    price: split.price,
    rows,
    sum,
    balances: sum === split.price,
    royaltySum,
    royaltyBalances: royaltySum === split.royaltyTotal,
    problem: checkPartition(split),
  }
}

/**
 * A breakdown from an order, or `null` when the wire could not be parsed.
 *
 * The order page needs a page rather than a stack trace: an amount that fails `parseAmount` is a
 * service or proxy fault, and the right response is to render the rest of the order and say this
 * part could not be read — not to throw away the whole screen, which is where the request id the
 * user needs to report it was going to be shown.
 */
export function orderBreakdownOrNull(order: OrderView): Breakdown | null {
  for (const value of [order.amount, order.feeAmount, order.royaltyAmount, order.sellerProceeds]) {
    if (parseAmountOrNull(value) === null) return null
  }
  for (const share of order.royalties) {
    if (parseAmountOrNull(share.amount) === null) return null
  }
  return orderBreakdown(order)
}
