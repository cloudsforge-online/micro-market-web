/**
 * Times, and the observation stamps that go beside every figure on this surface.
 *
 * ── Rule one of this estate: every figure carries its observation time ─────────────────────────
 *
 * A price on a marketplace is a claim about now. A bid is a claim about a moment that has almost
 * certainly passed by the time it is read, and an auction's leader is a number whose whole meaning
 * is when it was true. So every figure this app renders is rendered beside the instant it came
 * from — `placedAt` on a bid (`market/src/server.ts:857`), `settledAt` on an order (1222),
 * `createdAt` on a listing (1201) — and where there is no instant, `stamp()` answers `null` and
 * the caller writes "not observed" rather than "just now".
 *
 * ── Times are UTC, with a fixed locale ─────────────────────────────────────────────────────────
 *
 * The same instant must read identically on a seller's machine, in CI, and in the screenshot a
 * buyer attaches when they say an auction closed early. An auction close rendered in the viewer's
 * own zone makes two people reading one listing disagree about when it shuts, which is the one
 * thing a close time exists to settle.
 */

/** A parsed instant, or `null`. The one place a date string is trusted. */
export function instant(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

/** `14:22` UTC. `null` for anything unparseable — never a fallback string that looks like a time. */
export function utcTime(iso: string | null | undefined): string | null {
  const at = instant(iso)
  if (at === null) return null
  return at.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `14 Mar 2026` UTC. */
export function utcDate(iso: string | null | undefined): string | null {
  const at = instant(iso)
  if (at === null) return null
  return at.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** `14 Mar 2026, 14:22 UTC` — the form a close time and a payout deadline are written in. */
export function utcDateTime(iso: string | null | undefined): string | null {
  const date = utcDate(iso)
  const time = utcTime(iso)
  if (date === null || time === null) return null
  return `${date}, ${time} UTC`
}

/**
 * The stamp beside an observed figure: `as of 14:22 UTC`.
 *
 * `null` when there is no instant. The caller renders "not observed" rather than a time, because
 * a missing observation and an old one are different facts and only one of them means the number
 * above it was ever true.
 */
export function asOfStamp(iso: string | null | undefined): string | null {
  const time = utcTime(iso)
  return time === null ? null : `as of ${time} UTC`
}

/**
 * How long ago, in words. `null` for a missing or future instant.
 *
 * A future stamp is a clock disagreement between this browser and the service, not a negative
 * age, and rendering "in 3 minutes" beside a bid would be worse than rendering nothing.
 */
export function ageLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = instant(iso)
  if (at === null) return null
  const ms = now.getTime() - at.getTime()
  if (ms < 0) return null
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return seconds < 5 ? 'just now' : `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * How long until an instant: `3d 4h`, `12h 30 min`, `9 min`, or `null` once it has passed.
 *
 * Coarse above an hour and to the minute below it. An auction closing in three days does not need
 * a seconds counter; one closing in nine minutes does need to be unmistakably soon. `null` rather
 * than a negative or a zero, so a closed auction cannot render as "0 min" and look live.
 */
export function untilLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = instant(iso)
  if (at === null) return null
  const ms = at.getTime() - now.getTime()
  if (ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/**
 * A subject — `user:0f1e…`, `community:abc`, `service:market` — shortened for a row.
 *
 * The PREFIX is always kept, because `user:` and `community:` are different kinds of party and a
 * truncation that hides which one is a truncation that hides who is being paid. The tail is kept
 * too: it is what a reader actually compares against the id they hold.
 */
export function shortSubject(subject: string | null | undefined, tail = 6): string | null {
  if (!subject) return null
  const colon = subject.indexOf(':')
  if (colon < 0) return subject.length > tail + 2 ? `…${subject.slice(-tail)}` : subject
  const kind = subject.slice(0, colon + 1)
  const id = subject.slice(colon + 1)
  if (id.length <= tail + 2) return subject
  return `${kind}…${id.slice(-tail)}`
}

/** An item URN or a transaction hash, shortened with both ends kept. */
export function shortRef(text: string | null | undefined, head = 10, tail = 6): string | null {
  if (!text) return null
  if (text.length <= head + tail + 1) return text
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

/** The words a status is written in. A raw enum on screen is a leak of the schema. */
export const LISTING_STATUS_COPY: Readonly<Record<string, string>> = Object.freeze({
  draft: 'Draft',
  active: 'Live',
  settling: 'Settling',
  sold: 'Sold',
  cancelled: 'Withdrawn',
  expired: 'Expired',
})

export const ASSET_KIND_COPY: Readonly<Record<string, string>> = Object.freeze({
  token: 'Token',
  game_item: 'Game item',
  entitlement: 'Entitlement',
  membership: 'Membership',
  brand_asset: 'Brand asset',
  collectible: 'Collectible',
})

export const PRICING_MODE_COPY: Readonly<Record<string, string>> = Object.freeze({
  fixed: 'Fixed price',
  auction: 'Auction',
  offers_only: 'Offers only',
})

export const SETTLEMENT_MODE_COPY: Readonly<Record<string, string>> = Object.freeze({
  custodial: 'Settles in Forge Ledger',
  onchain: 'Settles on chain',
})
