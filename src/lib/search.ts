/**
 * Search, and the honest limit of it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **`micro-market` HAS NO TEXT SEARCH, AND THIS FILE DOES NOT PRETEND OTHERWISE.**
 *
 * `GET /v1/listings` (`market/src/server.ts:618-634`) reads exactly four query parameters —
 * `status`, `assetKind`, `sellerSubject`, `collectionId` — and nothing else. There is no `q`, no
 * `search`, no `text`. `listListings` also accepts a `limit` (`listings.ts:702`) that the route
 * never passes, so the answer is capped at that function's default of **50** and there is no way
 * to ask for the next page.
 *
 * So the search box on the browse page filters the listings the route returned. That is a real
 * and useful thing — it is how you find the one item in a page of fifty — and it is NOT "search
 * the market". The page says which of the two it is doing, with the count, because a filter that
 * silently searches a fraction of the catalogue is how a buyer concludes an item is not for sale.
 *
 * Inventing `?q=` here would be the eighth instance of this estate's most expensive defect.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { ListingView } from './market.ts'
import { parseAmountOrNull } from './money.ts'

/** Fields a query is matched against. The URN and the asset codes are what a reader can see. */
function haystack(listing: ListingView): string {
  return [listing.itemUrn, listing.assetCode, listing.itemAssetCode, listing.assetKind]
    .join(' ')
    .toLowerCase()
}

/**
 * Filter listings by a free-text query.
 *
 * Every whitespace-separated term must match somewhere — AND, not OR. A reader typing two words
 * is narrowing; an OR would widen, and the second word would make the result set grow, which is
 * the opposite of what typing more means.
 *
 * An empty or whitespace-only query returns the input unchanged rather than nothing: a search box
 * a user has clicked into but not typed in must not empty the page.
 */
export function filterListings(
  listings: readonly ListingView[],
  query: string,
): readonly ListingView[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return listings
  return listings.filter((listing) => {
    const text = haystack(listing)
    return terms.every((term) => text.includes(term))
  })
}

export type SortKey = 'newest' | 'price_low' | 'price_high' | 'ending_soonest'

export const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'price_low', label: 'Price: low to high' },
  { key: 'price_high', label: 'Price: high to low' },
  { key: 'ending_soonest', label: 'Ending soonest' },
]

/**
 * Sort listings, with the unpriced and the undated pushed to the end rather than treated as zero.
 *
 * A listing with `price: null` is an `offers_only` listing (`server.ts:1189`), and sorting it as
 * if it cost nothing would put every "make me an offer" at the top of "cheapest first". Missing is
 * missing. The comparison is `bigint`, so a price larger than 2^53 orders correctly.
 */
export function sortListings(
  listings: readonly ListingView[],
  key: SortKey,
): readonly ListingView[] {
  const copy = [...listings]
  switch (key) {
    case 'price_low':
    case 'price_high': {
      const direction = key === 'price_low' ? 1 : -1
      return copy.sort((a, b) => {
        const left = parseAmountOrNull(a.price)
        const right = parseAmountOrNull(b.price)
        if (left === null && right === null) return 0
        // Unpriced last in BOTH directions: it is not a small price or a large one, it is absent.
        if (left === null) return 1
        if (right === null) return -1
        if (left === right) return 0
        return left < right ? -direction : direction
      })
    }
    case 'ending_soonest':
      return copy.sort((a, b) => {
        const left = a.auctionEndsAt ?? a.expiresAt
        const right = b.auctionEndsAt ?? b.expiresAt
        if (!left && !right) return 0
        if (!left) return 1
        if (!right) return -1
        return left < right ? -1 : left > right ? 1 : 0
      })
    case 'newest':
    default:
      // The route already orders by `created_at desc` (`listings.ts:711`); restated so that a
      // reader switching back from another sort gets the same order they started with.
      return copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }
}

/**
 * The sentence under the search box.
 *
 * It names what was actually searched. `total` is what the route returned — capped at 50 by
 * `listings.ts:702` with no way to ask for more — and saying so is the difference between a
 * reader who knows to narrow the filters and one who concludes the item is gone.
 */
export function searchScopeNote(shown: number, total: number, query: string): string {
  const searched = `${total} listing${total === 1 ? '' : 's'} loaded`
  if (query.trim() === '') {
    return total >= PAGE_CAP
      ? `Showing ${searched}. That is the most this page can request — narrow the filters to see different ones.`
      : `Showing ${searched}.`
  }
  return (
    `${shown} of ${searched} match “${query.trim()}”. ` +
    'This filters what is on this page rather than searching the whole market — Forge Market has ' +
    'no text-search route.'
  )
}

/** `listListings`' own default, and the route's effective page size — `market/src/listings.ts:702`. */
export const PAGE_CAP = 50
