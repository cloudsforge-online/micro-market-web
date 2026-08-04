/**
 * Money, in `bigint`, from the wire to the screen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **A SALE IS A PARTITION OF THE PRICE, AND THIS FILE IS WHERE THE UI EITHER KEEPS THAT OR
 * BREAKS IT.**
 *
 * `market/src/money.ts:150-186` divides a price into the platform fee, the royalty and the
 * seller's proceeds, and defines the proceeds as the REMAINDER so that
 * `fee + royalty + proceeds === price` exactly, for every price and every pair of rates. It
 * asserts that on every split (`assertPartition`, money.ts:195-212) rather than trusting it.
 *
 * A frontend that recomputes any of those three with a float, or renders them rounded
 * independently, is the place that arithmetic stops being true — and it is the place a seller
 * actually reads it. So:
 *
 *   * Amounts arrive as decimal STRINGS of smallest units (`market/src/server.ts:1185-1189`,
 *     `1213-1218`: "Every amount a decimal STRING. A JSON number is an IEEE 754 double") and are
 *     parsed to `bigint` here, once.
 *   * `splitSale` below is a port of the service's, remainder-defined and largest-remainder
 *     allocated, so the previewed split on the create-listing screen is the split that will be
 *     posted.
 *   * `checkPartition` is exported so a component can prove the numbers it is about to render
 *     add up, and say so on screen. The UI shows the sum, it does not merely believe it.
 *
 * There is no `Number()`, no `parseFloat` and no `toFixed` anywhere in this file, and CI greps for
 * the last two across `src/`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Basis points. 10,000 = 100%. `market/src/money.ts:31`. */
export const BPS_SCALE = 10_000n

/**
 * How many smallest units make one unit of each asset.
 *
 * From `contracts/packages/chain/src/index.ts:49-121` (the `CHAINS` record) and
 * `contracts/packages/money/src/index.ts:69` for USD. Restated rather than imported because this
 * bundle does not depend on `@cloudsforge/contracts` — and restated with its source cited, so the
 * day a decimal changes there is one grep that finds this copy.
 *
 * A `TOKEN:<address>` asset is deliberately ABSENT. Its decimals are chosen at deploy time and
 * nothing in this bundle knows them (`contracts/packages/money/src/index.ts:82-93` refuses to
 * guess), so an amount in one is rendered in smallest units and labelled as such. Guessing 18
 * would show a whole token as a thousandth of one.
 */
export const ASSET_DECIMALS: Readonly<Record<string, number>> = Object.freeze({
  EMBER: 18,
  ETH: 18,
  SOL: 9,
  BTC: 8,
  XRP: 6,
  USD: 2,
  // One Shard is one US cent, and it is an integer: `contracts/packages/chain/src/index.ts:264`,
  // inside the `CHAINS.SHARD` spec at :260-266. The old citation here was `:112-120`, which today
  // is an unrelated explorer-link type — SHARD was retired in place on 2026-08-04 (`RETIRED_ASSETS`,
  // ibid. :58) and the spec moved down the file.
  //
  // The ZERO IS STILL CORRECT AND MUST STAY. Retired is not removed: 121 accounts still hold real
  // Shard liability, and the contract package says of this very field that "`decimals: 0` in
  // particular is load-bearing, because it is the only thing that says a stored `250` means 250
  // Shards and not 250 wei" (ibid. :255-259). Deleting the row to "finish the migration" would
  // rescale every stored Shard amount by 10¹⁸ silently.
  SHARD: 0,
})

export class AmountError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'AmountError'
  }
}

/**
 * A decimal string of smallest units, parsed strictly. Mirrors `market/src/money.ts:222-227`.
 *
 * The same regular expression, on purpose: an input this refuses is an input the service would
 * have refused, and catching it here saves a round trip and shows the reader why. Anything else —
 * a minus sign, an exponent, a decimal point, 79 digits — is rejected rather than coerced.
 */
export function parseAmount(value: unknown, field = 'amount'): bigint {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) {
    throw new AmountError(`${field} must be a decimal string of up to 78 digits`)
  }
  return BigInt(value)
}

/** `parseAmount` that answers `null` instead of throwing. For an optional field on the wire. */
export function parseAmountOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined) return null
  try {
    return parseAmount(value)
  } catch {
    return null
  }
}

/**
 * `amount × bps / 10000`, rounded DOWN. `market/src/money.ts:47-53`.
 *
 * Down, always, and in the platform's disfavour on purpose: rounding a fee up takes a unit from a
 * customer that no rate entitles the platform to.
 */
export function bpsOf(amount: bigint, bps: number): bigint {
  if (amount < 0n) throw new AmountError(`an amount may not be negative, got ${amount}`)
  if (!Number.isInteger(bps) || bps < 0 || bps > Number(BPS_SCALE)) {
    throw new AmountError(`basis points must be a whole number in 0..10000, got ${bps}`)
  }
  return (amount * BigInt(bps)) / BPS_SCALE
}

/**
 * Split `total` between weighted recipients so the shares sum to `total` EXACTLY.
 *
 * Largest remainder (Hamilton), tie-broken by index — a port of `market/src/money.ts:68-113`.
 * Flooring each share independently loses up to N−1 units, and on the screen that is a royalty
 * table whose rows do not add up to the royalty above them.
 */
export function allocate(total: bigint, weights: readonly number[]): bigint[] {
  if (total < 0n) throw new AmountError(`a total may not be negative, got ${total}`)
  for (const weight of weights) {
    if (!Number.isInteger(weight) || weight < 0) {
      throw new AmountError(`a weight must be a non-negative whole number, got ${weight}`)
    }
  }
  const shares = weights.map(() => 0n)
  const sum = weights.reduce((acc, weight) => acc + BigInt(weight), 0n)
  if (sum === 0n || total === 0n) return shares

  const remainders: Array<{ index: number; remainder: bigint }> = []
  let distributed = 0n
  for (const [index, weight] of weights.entries()) {
    const numerator = total * BigInt(weight)
    const share = numerator / sum
    shares[index] = share
    distributed += share
    remainders.push({ index, remainder: numerator % sum })
  }

  let leftover = total - distributed
  // Descending by remainder, ascending by index on a tie. The index comparison is written out
  // rather than relying on sort stability, exactly as the service does.
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )
  for (const entry of remainders) {
    if (leftover <= 0n) break
    // A recipient with a zero weight is entitled to nothing and is never handed a dust unit.
    if (weights[entry.index] === 0) continue
    shares[entry.index] = (shares[entry.index] ?? 0n) + 1n
    leftover -= 1n
  }
  if (leftover !== 0n) {
    throw new AmountError(`allocation left ${leftover} unassigned; this is a bug in allocate()`)
  }
  return shares
}

export interface RoyaltyRecipient {
  /** A ledger account subject — `user:<id>`, `community:<id>`, `organisation:<id>`. */
  readonly subject: string
  /** This recipient's share OF THE ROYALTY, in basis points of the royalty, not of the price. */
  readonly bps: number
}

export interface RoyaltyShare {
  readonly subject: string
  readonly amount: bigint
}

export interface SaleTerms {
  readonly price: bigint
  readonly platformFeeBps: number
  readonly royaltyBps: number
  readonly royaltyRecipients: readonly RoyaltyRecipient[]
}

export interface SaleSplit {
  readonly price: bigint
  readonly platformFee: bigint
  readonly royaltyTotal: bigint
  /** The remainder. Never negative, and the reason the three always sum to the price. */
  readonly sellerProceeds: bigint
  readonly royaltyShares: readonly RoyaltyShare[]
}

/**
 * Divide a sale price into the platform's fee, the royalty, and what the seller is left with.
 *
 * A port of `market/src/money.ts:150-186`, including its two refusals: a fee plus a royalty at or
 * above 100% leaves the seller nothing, and a non-zero royalty with no recipients is an entry
 * that cannot balance. Both are refused HERE, before a create-listing form can submit them,
 * because the alternative is a 400 whose message the reader has to translate back into the field
 * they got wrong.
 */
export function splitSale(terms: SaleTerms): SaleSplit {
  if (terms.price <= 0n) throw new AmountError(`a sale price must be positive, got ${terms.price}`)
  if (terms.platformFeeBps + terms.royaltyBps >= Number(BPS_SCALE)) {
    throw new AmountError(
      `a platform fee of ${terms.platformFeeBps} bps and a royalty of ${terms.royaltyBps} bps ` +
        `would leave the seller nothing`,
    )
  }
  const platformFee = bpsOf(terms.price, terms.platformFeeBps)
  const royaltyTotal = bpsOf(terms.price, terms.royaltyBps)
  const sellerProceeds = terms.price - platformFee - royaltyTotal

  const recipients = terms.royaltyRecipients
  if (royaltyTotal > 0n && recipients.length === 0) {
    throw new AmountError('a non-zero royalty needs at least one recipient')
  }
  const shares = allocate(
    royaltyTotal,
    recipients.map((recipient) => recipient.bps),
  )
  const split: SaleSplit = {
    price: terms.price,
    platformFee,
    royaltyTotal,
    sellerProceeds,
    royaltyShares: recipients.map((recipient, index) => ({
      subject: recipient.subject,
      amount: shares[index] ?? 0n,
    })),
  }
  const problem = checkPartition(split)
  if (problem) throw new AmountError(problem)
  return split
}

/**
 * The invariant, as a question rather than an exception.
 *
 * `market/src/money.ts:195-212` throws, because an unbalanced entry must never reach the ledger.
 * Here it RETURNS the sentence instead, so a component that is rendering numbers the service
 * computed can check them and say what is wrong on screen. A frontend that threw would show a
 * blank page for an order whose figures a support conversation is about to need.
 *
 * `null` means the split adds up.
 */
export function checkPartition(split: SaleSplit): string | null {
  const total = split.platformFee + split.royaltyTotal + split.sellerProceeds
  if (total !== split.price) {
    return (
      `the split does not sum to the price: ${split.platformFee} + ${split.royaltyTotal} + ` +
      `${split.sellerProceeds} = ${total}, expected ${split.price}`
    )
  }
  if (split.sellerProceeds < 0n) {
    return `the seller's proceeds are negative: ${split.sellerProceeds}`
  }
  const paid = split.royaltyShares.reduce((acc, share) => acc + share.amount, 0n)
  if (paid !== split.royaltyTotal) {
    return `the royalty shares sum to ${paid} but the royalty is ${split.royaltyTotal}`
  }
  return null
}

/** The minimum a bid must reach to displace `current`. `market/src/money.ts:230-232`. */
export function minimumBid(current: bigint | null, startingPrice: bigint): bigint {
  return current === null ? startingPrice : current + 1n
}

/* ------------------------------------------------------------------ rendering */

/**
 * An amount in its asset's own units, as a string. Never a `Number`.
 *
 * The integer and fractional halves are produced by `bigint` division and remainder, so an EMBER
 * amount with eighteen decimals is exact. Trailing zeroes in the fraction are trimmed, because a
 * price of `1.500000000000000000` is a column nobody can scan — but a trailing zero that is the
 * ONLY fractional digit is kept for a two-decimal asset, so `1.50 USD` does not become `1.5 USD`.
 */
export function formatUnits(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AmountError(`implausible decimals: ${decimals}`)
  }
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const divisor = 10n ** BigInt(decimals)
  const whole = magnitude / divisor
  const sign = negative ? '-' : ''
  if (decimals === 0) return `${sign}${group(whole)}`
  const fraction = (magnitude % divisor).toString().padStart(decimals, '0')
  // Two decimal places are a currency's minor unit and are kept; anything beyond that is trimmed.
  const minimum = decimals <= 2 ? decimals : 0
  const trimmed = fraction.replace(/0+$/, '').padEnd(minimum, '0')
  return trimmed === '' ? `${sign}${group(whole)}` : `${sign}${group(whole)}.${trimmed}`
}

/** Thousands separators on the integer half only. String work, never arithmetic on a Number. */
function group(whole: bigint): string {
  const digits = whole.toString()
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i
    out += digits[i]
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ','
  }
  return out
}

/** What `formatMoney` produces: the number, its unit, and whether the unit is the real one. */
export interface RenderedAmount {
  /** The figure, already in `unit`. */
  readonly text: string
  /** `SHARD`, `EMBER`, or `TOKEN:0x…` — always the asset code the service sent. */
  readonly assetCode: string
  /**
   * True when this bundle knows the asset's decimals and `text` is therefore in whole units.
   * False when it does not, and `text` is in SMALLEST units — which the caller must say out loud.
   */
  readonly exactUnits: boolean
}

/**
 * An amount with its asset code, ready to render.
 *
 * For an asset whose decimals are unknown — every `TOKEN:` asset — this returns the smallest-unit
 * integer with `exactUnits: false`, and the caller labels it "smallest units". It does NOT guess
 * eighteen: an amount shown in the wrong scale is worse than an amount shown awkwardly, because
 * nothing about it looks wrong.
 */
export function formatMoney(amount: bigint, assetCode: string): RenderedAmount {
  const decimals = ASSET_DECIMALS[assetCode]
  // `formatUnits(_, 0)` is the smallest-unit rendering, and it keeps the sign. Doing the grouping
  // by hand here would have dropped a minus, which turns a reversal into a credit on screen.
  if (decimals === undefined) {
    return { text: formatUnits(amount, 0), assetCode, exactUnits: false }
  }
  return { text: formatUnits(amount, decimals), assetCode, exactUnits: true }
}

/** The same, straight from the wire's decimal string. `null` in — or unparseable — `null` out. */
export function formatWireMoney(value: unknown, assetCode: string): RenderedAmount | null {
  const amount = parseAmountOrNull(value)
  return amount === null ? null : formatMoney(amount, assetCode)
}

/**
 * Basis points as a percentage, by integer arithmetic.
 *
 * `250` → `2.5%`, `10000` → `100%`, `1` → `0.01%`. A rate is an integer count of basis points, so
 * this is genuinely integer work and not a money value being coerced through a float.
 */
export function formatBps(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) return '—'
  const whole = Math.trunc(bps / 100)
  const hundredths = bps % 100
  if (hundredths === 0) return `${whole}%`
  const padded = String(hundredths).padStart(2, '0')
  return `${whole}.${padded.replace(/0$/, '')}%`
}
