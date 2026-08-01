/**
 * The arithmetic, proved rather than assumed.
 *
 * `src/lib/money.ts` is a port of `market/src/money.ts`, and a port is exactly the kind of code
 * that drifts silently: it goes on compiling and producing plausible numbers. So the invariant is
 * tested the way the service tests it — over a range, not on one example — and the two rounding
 * decisions that make it hold are tested by name:
 *
 *   * the fee and the royalty round DOWN, in the platform's disfavour,
 *   * the seller's proceeds are the REMAINDER, so the three always sum to the price.
 *
 * The formatting tests exist for a different reason: an amount rendered in the wrong scale looks
 * completely fine, and there is nothing on the screen to catch it.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ASSET_DECIMALS,
  AmountError,
  BPS_SCALE,
  allocate,
  bpsOf,
  checkPartition,
  formatBps,
  formatMoney,
  formatUnits,
  formatWireMoney,
  minimumBid,
  parseAmount,
  parseAmountOrNull,
  splitSale,
} from '../src/lib/money.ts'

describe('parseAmount — market/src/money.ts:222-227', () => {
  it('parses a decimal string of smallest units', () => {
    assert.equal(parseAmount('0'), 0n)
    assert.equal(parseAmount('1000'), 1000n)
    assert.equal(parseAmount('9007199254740993'), 9007199254740993n)
  })

  it('keeps a value past 2^53 exactly, which a JSON number cannot', () => {
    const big = '123456789012345678901234567890'
    assert.equal(parseAmount(big).toString(), big)
  })

  it('accepts up to 78 digits and refuses 79', () => {
    assert.equal(parseAmount('9'.repeat(78)).toString(), '9'.repeat(78))
    assert.throws(() => parseAmount('9'.repeat(79)), AmountError)
  })

  it('refuses a JSON number, because an amount is never one', () => {
    assert.throws(() => parseAmount(1000 as unknown), AmountError)
  })

  it('refuses a negative, a decimal point, an exponent and whitespace', () => {
    for (const bad of ['-1', '1.5', '1e3', ' 1', '1 ', '', '0x10', '+1']) {
      assert.throws(() => parseAmount(bad), AmountError, `accepted ${JSON.stringify(bad)}`)
    }
  })

  it('names the field it refused, so a form can point at it', () => {
    assert.throws(() => parseAmount('x', 'reservePrice'), /reservePrice must be a decimal string/)
  })

  it('parseAmountOrNull answers null instead of throwing', () => {
    assert.equal(parseAmountOrNull(null), null)
    assert.equal(parseAmountOrNull(undefined), null)
    assert.equal(parseAmountOrNull('nope'), null)
    assert.equal(parseAmountOrNull('12'), 12n)
  })
})

describe('bpsOf — market/src/money.ts:47-53', () => {
  it('rounds DOWN, in the platform’s disfavour', () => {
    // 1001 × 250 / 10000 = 25.025. Rounding up would take a unit no rate entitles us to.
    assert.equal(bpsOf(1001n, 250), 25n)
    assert.equal(bpsOf(1n, 9999), 0n)
  })

  it('is exact at the ends', () => {
    assert.equal(bpsOf(1000n, 0), 0n)
    assert.equal(bpsOf(1000n, 10_000), 1000n)
    assert.equal(BPS_SCALE, 10_000n)
  })

  it('refuses a negative amount and a rate outside 0..10000', () => {
    assert.throws(() => bpsOf(-1n, 100), AmountError)
    assert.throws(() => bpsOf(100n, -1), AmountError)
    assert.throws(() => bpsOf(100n, 10_001), AmountError)
    assert.throws(() => bpsOf(100n, 2.5), AmountError)
  })

  it('is exact for an 18-decimal amount, where a float would not be', () => {
    const wei = 1_000_000_000_000_000_001n
    assert.equal(bpsOf(wei, 250), 25_000_000_000_000_000n)
  })
})

describe('allocate — largest remainder, market/src/money.ts:68-113', () => {
  it('sums to the total exactly, where flooring each share would not', () => {
    // 10 across three equal recipients: 3 + 3 + 3 = 9 by flooring. One unit would be lost.
    const shares = allocate(10n, [1, 1, 1])
    assert.equal(shares.reduce((a, b) => a + b, 0n), 10n)
    assert.deepEqual(shares, [4n, 3n, 3n])
  })

  it('breaks a tie by index, so two replicas produce byte-identical postings', () => {
    assert.deepEqual(allocate(1n, [1, 1]), [1n, 0n])
    assert.deepEqual(allocate(2n, [1, 1, 1]), [1n, 1n, 0n])
  })

  it('never hands a dust unit to a recipient entitled to nothing', () => {
    const shares = allocate(5n, [0, 1])
    assert.deepEqual(shares, [0n, 5n])
  })

  it('answers zeroes for a zero total or zero weights', () => {
    assert.deepEqual(allocate(0n, [1, 2]), [0n, 0n])
    assert.deepEqual(allocate(10n, [0, 0]), [0n, 0n])
    assert.deepEqual(allocate(10n, []), [])
  })

  it('sums exactly across a range of totals and weightings', () => {
    const weightings = [[1, 1], [1, 2], [3, 3, 4], [1, 1, 1, 1, 1, 1, 1], [9999, 1]]
    for (const weights of weightings) {
      for (let total = 0n; total <= 500n; total += 7n) {
        const shares = allocate(total, weights)
        assert.equal(
          shares.reduce((a, b) => a + b, 0n),
          total,
          `total ${total} across ${weights.join('/')}`,
        )
      }
    }
  })

  it('refuses a negative total or a fractional weight', () => {
    assert.throws(() => allocate(-1n, [1]), AmountError)
    assert.throws(() => allocate(1n, [1.5]), AmountError)
    assert.throws(() => allocate(1n, [-1]), AmountError)
  })
})

describe('splitSale — the partition, market/src/money.ts:150-186', () => {
  const terms = (price: bigint, feeBps = 250, royaltyBps = 750) => ({
    price,
    platformFeeBps: feeBps,
    royaltyBps,
    royaltyRecipients: royaltyBps > 0 ? [{ subject: 'user:a', bps: 10_000 }] : [],
  })

  it('adds up to the price on the example the service documents', () => {
    const split = splitSale(terms(1000n))
    assert.equal(split.platformFee, 25n)
    assert.equal(split.royaltyTotal, 75n)
    assert.equal(split.sellerProceeds, 900n)
    assert.equal(split.platformFee + split.royaltyTotal + split.sellerProceeds, 1000n)
  })

  it('adds up on 1001, where three independent floors lose a unit', () => {
    // The case in the service's own header: 25 + 75 + 900 = 1000, and one Shard would be gone.
    const split = splitSale(terms(1001n))
    assert.equal(split.platformFee, 25n)
    assert.equal(split.royaltyTotal, 75n)
    assert.equal(split.sellerProceeds, 901n, 'the seller absorbs the dust')
    assert.equal(split.platformFee + split.royaltyTotal + split.sellerProceeds, 1001n)
  })

  it('adds up for every price in a range and several rate pairs', () => {
    for (const [feeBps, royaltyBps] of [[250, 750], [0, 0], [1, 1], [4999, 5000], [9998, 1]]) {
      for (let price = 1n; price <= 400n; price += 1n) {
        const split = splitSale(terms(price, feeBps, royaltyBps))
        assert.equal(
          split.platformFee + split.royaltyTotal + split.sellerProceeds,
          price,
          `price ${price} at ${feeBps}/${royaltyBps}`,
        )
        assert.equal(checkPartition(split), null)
      }
    }
  })

  it('splits the royalty between recipients so their shares sum to it exactly', () => {
    const split = splitSale({
      price: 1000n,
      platformFeeBps: 250,
      royaltyBps: 750,
      royaltyRecipients: [
        { subject: 'user:a', bps: 3333 },
        { subject: 'user:b', bps: 3333 },
        { subject: 'user:c', bps: 3334 },
      ],
    })
    const paid = split.royaltyShares.reduce((acc, s) => acc + s.amount, 0n)
    assert.equal(paid, split.royaltyTotal)
    assert.equal(paid, 75n)
  })

  it('refuses a price of zero or less: there is nothing to divide', () => {
    assert.throws(() => splitSale(terms(0n)), AmountError)
    assert.throws(() => splitSale(terms(-1n)), AmountError)
  })

  it('refuses rates that would leave the seller nothing', () => {
    assert.throws(
      () => splitSale({ price: 1000n, platformFeeBps: 5000, royaltyBps: 5000, royaltyRecipients: [] }),
      /would leave the seller nothing/,
    )
  })

  it('refuses a royalty with nobody to pay', () => {
    assert.throws(
      () => splitSale({ price: 1000n, platformFeeBps: 0, royaltyBps: 750, royaltyRecipients: [] }),
      /needs at least one recipient/,
    )
  })

  it('allows a zero royalty with no recipients', () => {
    const split = splitSale({ price: 1000n, platformFeeBps: 250, royaltyBps: 0, royaltyRecipients: [] })
    assert.equal(split.royaltyTotal, 0n)
    assert.equal(split.sellerProceeds, 975n)
  })
})

describe('checkPartition — the assertion, returned rather than thrown', () => {
  const sound = {
    price: 1000n,
    platformFee: 25n,
    royaltyTotal: 75n,
    sellerProceeds: 900n,
    royaltyShares: [{ subject: 'user:a', amount: 75n }],
  }

  it('answers null when the parts add up', () => {
    assert.equal(checkPartition(sound), null)
  })

  it('names a sum that does not reach the price', () => {
    const problem = checkPartition({ ...sound, sellerProceeds: 899n })
    assert.match(problem ?? '', /does not sum to the price/)
    assert.match(problem ?? '', /999/)
    assert.match(problem ?? '', /1000/)
  })

  it('names negative proceeds', () => {
    const problem = checkPartition({
      price: 100n,
      platformFee: 60n,
      royaltyTotal: 60n,
      sellerProceeds: -20n,
      royaltyShares: [{ subject: 'user:a', amount: 60n }],
    })
    assert.match(problem ?? '', /does not sum to the price|negative/)
  })

  it('names royalty shares that do not sum to the royalty', () => {
    const problem = checkPartition({ ...sound, royaltyShares: [{ subject: 'user:a', amount: 74n }] })
    assert.match(problem ?? '', /royalty shares sum to 74/)
  })

  it('RETURNS the problem rather than throwing, so a page can render it', () => {
    // A frontend that threw here would blank the screen — and take the request id the user needs
    // to report the fault with it.
    assert.doesNotThrow(() => checkPartition({ ...sound, sellerProceeds: 0n }))
  })
})

describe('minimumBid — market/src/money.ts:230-232', () => {
  it('is the starting price when there is no leader', () => {
    assert.equal(minimumBid(null, 1000n), 1000n)
  })

  it('is one above the leader: ties never displace', () => {
    assert.equal(minimumBid(1000n, 500n), 1001n)
    assert.equal(minimumBid(0n, 500n), 1n)
  })
})

describe('formatUnits', () => {
  it('renders zero decimals as a whole number', () => {
    assert.equal(formatUnits(1000n, 0), '1,000')
    assert.equal(formatUnits(0n, 0), '0')
  })

  it('renders an 18-decimal amount exactly, with no float anywhere', () => {
    assert.equal(formatUnits(1_500_000_000_000_000_000n, 18), '1.5')
    assert.equal(formatUnits(1n, 18), '0.000000000000000001')
  })

  it('keeps both minor digits for a two-decimal asset', () => {
    // `1.50 USD` must not become `1.5 USD`.
    assert.equal(formatUnits(150n, 2), '1.50')
    assert.equal(formatUnits(100n, 2), '1.00')
    assert.equal(formatUnits(1n, 2), '0.01')
  })

  it('trims trailing zeroes above two decimals, because eighteen is unscannable', () => {
    assert.equal(formatUnits(2_000_000_000_000_000_000n, 18), '2')
    assert.equal(formatUnits(2_100_000_000_000_000_000n, 18), '2.1')
  })

  it('groups the integer half in threes and never the fraction', () => {
    assert.equal(formatUnits(1_234_567n, 0), '1,234,567')
    assert.equal(formatUnits(123n, 0), '123')
    assert.equal(formatUnits(1234n, 0), '1,234')
    assert.equal(formatUnits(1_000_000_000_000_000_000_000n, 18), '1,000')
  })

  it('renders a negative with its sign, and groups it correctly', () => {
    assert.equal(formatUnits(-1_234n, 0), '-1,234')
  })

  it('refuses implausible decimals rather than producing nonsense', () => {
    assert.throws(() => formatUnits(1n, -1), AmountError)
    assert.throws(() => formatUnits(1n, 37), AmountError)
    assert.throws(() => formatUnits(1n, 1.5), AmountError)
  })
})

describe('formatMoney — the unit is never optional', () => {
  it('carries the asset code', () => {
    const rendered = formatMoney(1000n, 'SHARD')
    assert.equal(rendered.text, '1,000')
    assert.equal(rendered.assetCode, 'SHARD')
    assert.equal(rendered.exactUnits, true)
  })

  it('knows the decimals the contracts package declares', () => {
    assert.equal(ASSET_DECIMALS['SHARD'], 0)
    assert.equal(ASSET_DECIMALS['EMBER'], 18)
    assert.equal(ASSET_DECIMALS['BTC'], 8)
    assert.equal(ASSET_DECIMALS['SOL'], 9)
    assert.equal(ASSET_DECIMALS['XRP'], 6)
    assert.equal(ASSET_DECIMALS['USD'], 2)
  })

  it('does NOT guess the decimals of a TOKEN: asset', () => {
    // `contracts/packages/money/src/index.ts:82-93` refuses to guess, because decimals are chosen
    // at deploy time. Guessing 18 would show a whole token as a thousandth of one, and nothing
    // about the screen would look wrong.
    const rendered = formatMoney(1_000_000_000_000_000_000n, 'TOKEN:0xabc')
    assert.equal(rendered.exactUnits, false)
    assert.equal(rendered.text, '1,000,000,000,000,000,000')
    assert.equal(rendered.assetCode, 'TOKEN:0xabc')
  })

  it('treats an asset code it has never seen the same way — as unknown, not as 18', () => {
    assert.equal(formatMoney(5n, 'DOGE').exactUnits, false)
  })

  it('keeps the sign on an unknown asset: a reversal must not read as a credit', () => {
    assert.equal(formatMoney(-1234n, 'TOKEN:0xabc').text, '-1,234')
    assert.equal(formatMoney(-1234n, 'SHARD').text, '-1,234')
  })

  it('groups an unknown asset’s smallest units, so a long integer stays scannable', () => {
    assert.equal(formatMoney(1_234_567n, 'TOKEN:0xabc').text, '1,234,567')
  })

  it('formatWireMoney answers null for an unreadable amount rather than zero', () => {
    assert.equal(formatWireMoney(null, 'SHARD'), null)
    assert.equal(formatWireMoney('not-a-number', 'SHARD'), null)
    assert.equal(formatWireMoney('12', 'SHARD')?.text, '12')
  })
})

describe('formatBps — integer arithmetic, not a percentage of a float', () => {
  it('renders whole percentages without a decimal point', () => {
    assert.equal(formatBps(0), '0%')
    assert.equal(formatBps(100), '1%')
    assert.equal(formatBps(10_000), '100%')
  })

  it('renders the estate’s take rate as 2.5%', () => {
    assert.equal(formatBps(250), '2.5%')
  })

  it('renders a single basis point without rounding it away', () => {
    assert.equal(formatBps(1), '0.01%')
    assert.equal(formatBps(1234), '12.34%')
  })

  it('answers an em dash for a value that is not a rate', () => {
    assert.equal(formatBps(-1), '—')
    assert.equal(formatBps(2.5), '—')
    assert.equal(formatBps(Number.NaN), '—')
  })
})
