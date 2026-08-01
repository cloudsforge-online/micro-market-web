/**
 * Times, stamps, and the refusal to invent one.
 *
 * The rule under test: a figure with no observation time renders WITHOUT one. Every function here
 * answers `null` for a missing or unparseable instant, and no caller may substitute "just now" —
 * because a missing observation and an old one are different facts, and only one of them means the
 * number beside it was ever true.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ASSET_KIND_COPY,
  LISTING_STATUS_COPY,
  PRICING_MODE_COPY,
  SETTLEMENT_MODE_COPY,
  ageLabel,
  asOfStamp,
  instant,
  shortRef,
  shortSubject,
  untilLabel,
  utcDate,
  utcDateTime,
  utcTime,
} from '../src/lib/format.ts'

const NOW = new Date('2026-08-01T12:00:00.000Z')
const ISO = '2026-08-01T09:22:00.000Z'

describe('instant', () => {
  it('parses an ISO string', () => {
    assert.equal(instant(ISO)?.toISOString(), ISO)
  })

  it('answers null for missing, empty and unparseable input', () => {
    for (const bad of [null, undefined, '', 'not-a-date', 'tomorrow']) {
      assert.equal(instant(bad), null, `parsed ${JSON.stringify(bad)}`)
    }
  })
})

describe('utcTime / utcDate / utcDateTime', () => {
  it('renders in UTC with a fixed locale, so two readers agree', () => {
    // A close time in the viewer's own zone makes two people reading one auction disagree about
    // when it shuts, which is the one thing a close time exists to settle.
    assert.equal(utcTime(ISO), '09:22')
    assert.equal(utcDate(ISO), '01 Aug 2026')
    assert.equal(utcDateTime(ISO), '01 Aug 2026, 09:22 UTC')
  })

  it('uses a 24-hour clock, so 13:00 is never 1:00', () => {
    assert.equal(utcTime('2026-08-01T13:05:00.000Z'), '13:05')
    assert.equal(utcTime('2026-08-01T00:05:00.000Z'), '00:05')
  })

  it('answers null rather than a string that looks like a time', () => {
    for (const bad of [null, undefined, '', 'nope']) {
      assert.equal(utcTime(bad), null)
      assert.equal(utcDate(bad), null)
      assert.equal(utcDateTime(bad), null)
    }
  })
})

describe('asOfStamp', () => {
  it('reads as an observation, not as now', () => {
    assert.equal(asOfStamp(ISO), 'as of 09:22 UTC')
  })

  it('answers null when there is nothing observed, so a caller writes "not observed"', () => {
    assert.equal(asOfStamp(null), null)
    assert.equal(asOfStamp('nonsense'), null)
  })
})

describe('ageLabel', () => {
  it('rounds through seconds, minutes, hours and days', () => {
    assert.equal(ageLabel('2026-08-01T11:59:58.000Z', NOW), 'just now')
    assert.equal(ageLabel('2026-08-01T11:59:30.000Z', NOW), '30s ago')
    assert.equal(ageLabel('2026-08-01T11:30:00.000Z', NOW), '30 min ago')
    assert.equal(ageLabel('2026-08-01T06:00:00.000Z', NOW), '6h ago')
    assert.equal(ageLabel('2026-07-25T12:00:00.000Z', NOW), '7d ago')
  })

  it('answers null for a FUTURE instant rather than a negative age', () => {
    // A future stamp is a clock disagreement between this browser and the service. "In 3 minutes"
    // beside a bid would be worse than nothing.
    assert.equal(ageLabel('2026-08-01T12:00:01.000Z', NOW), null)
  })

  it('answers null for a missing or unparseable instant', () => {
    assert.equal(ageLabel(null, NOW), null)
    assert.equal(ageLabel('nope', NOW), null)
  })
})

describe('untilLabel', () => {
  it('is minutes below an hour, hours and minutes below two days, then days and hours', () => {
    assert.equal(untilLabel('2026-08-01T12:09:00.000Z', NOW), '9 min')
    assert.equal(untilLabel('2026-08-01T18:30:00.000Z', NOW), '6h 30 min')
    assert.equal(untilLabel('2026-08-05T16:00:00.000Z', NOW), '4d 4h')
  })

  it('never renders 0 min: a sub-minute remainder is at least 1', () => {
    assert.equal(untilLabel('2026-08-01T12:00:30.000Z', NOW), '1 min')
  })

  it('answers null once the instant has passed, so a closed auction cannot read as live', () => {
    assert.equal(untilLabel('2026-08-01T12:00:00.000Z', NOW), null)
    assert.equal(untilLabel('2026-08-01T11:00:00.000Z', NOW), null)
  })

  it('answers null for a missing instant rather than an invented deadline', () => {
    assert.equal(untilLabel(null, NOW), null)
    assert.equal(untilLabel('nope', NOW), null)
  })
})

describe('shortSubject — the prefix is never dropped', () => {
  it('keeps the kind and the tail', () => {
    // `user:` and `community:` are different kinds of party, and a truncation that hides which one
    // is a truncation that hides who is being paid.
    assert.equal(shortSubject('user:0123456789abcdef'), 'user:…abcdef')
    assert.equal(shortSubject('community:0123456789abcdef'), 'community:…abcdef')
  })

  it('leaves a short subject alone', () => {
    assert.equal(shortSubject('user:abc'), 'user:abc')
  })

  it('handles a subject with no prefix', () => {
    assert.equal(shortSubject('0123456789abcdef'), '…abcdef')
    assert.equal(shortSubject('abc'), 'abc')
  })

  it('answers null for nothing', () => {
    assert.equal(shortSubject(null), null)
    assert.equal(shortSubject(''), null)
  })
})

describe('shortRef — both ends kept', () => {
  it('keeps the head and the tail, so two different refs cannot look identical', () => {
    assert.equal(shortRef('0xabcdef0123456789abcdef'), '0xabcdef01…abcdef')
  })

  it('leaves a short reference alone', () => {
    assert.equal(shortRef('0xabc'), '0xabc')
  })

  it('answers null for nothing', () => {
    assert.equal(shortRef(undefined), null)
  })
})

describe('the copy tables', () => {
  it('has a word for every listing status the domain declares (listings.ts:62)', () => {
    for (const status of ['draft', 'active', 'settling', 'sold', 'cancelled', 'expired']) {
      assert.ok(LISTING_STATUS_COPY[status], `no copy for ${status}`)
    }
  })

  it('has a word for every asset kind (listings.ts:53-59)', () => {
    for (const kind of ['token', 'game_item', 'entitlement', 'membership', 'brand_asset', 'collectible']) {
      assert.ok(ASSET_KIND_COPY[kind], `no copy for ${kind}`)
    }
  })

  it('has a word for every pricing and settlement mode', () => {
    for (const mode of ['fixed', 'auction', 'offers_only']) {
      assert.ok(PRICING_MODE_COPY[mode])
    }
    for (const mode of ['custodial', 'onchain']) {
      assert.ok(SETTLEMENT_MODE_COPY[mode])
    }
  })

  it('never puts a raw enum on screen', () => {
    // `game_item` and `offers_only` are schema, not English.
    assert.equal(ASSET_KIND_COPY['game_item'], 'Game item')
    assert.equal(PRICING_MODE_COPY['offers_only'], 'Offers only')
  })

  it('says where a sale settles rather than naming the mode', () => {
    assert.match(SETTLEMENT_MODE_COPY['custodial'] ?? '', /Forge Ledger/)
    assert.match(SETTLEMENT_MODE_COPY['onchain'] ?? '', /on chain/)
  })
})
