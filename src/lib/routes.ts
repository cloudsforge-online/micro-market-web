/**
 * The route table, as data, in one place.
 *
 * Three files describe this app's addresses and all three have to agree:
 *
 *   1. `src/app.tsx`               — which component renders at each path,
 *   2. `src/components/shell.tsx`  — which of them the navigation offers,
 *   3. `nginx.conf`                — which of them are served the app shell at all.
 *
 * The third is the one that bites, and it bites late. nginx enumerates this app's real routes and
 * 404s everything else *on purpose*, so that a wrong address answers 404 rather than 200. The
 * price of that honesty is this list, in triplicate — so the navigation is DERIVED from here
 * rather than restated, and `test/routes.test.ts` reads `nginx.conf` and `app.tsx` and fails the
 * build when either has drifted. "Remember to update nginx.conf" is not a mechanism; a test is.
 *
 * This module deliberately imports nothing — not React, not the router — so the test that reads it
 * does not have to boot a browser to find out what the routes are.
 */

export interface MarketRoute {
  /** The top-level path segment, without a leading slash. `''` is the index route. */
  readonly path: string
  /** The navigation label, or null for a route that is reachable but not offered. */
  readonly label: string | null
  /** True when the route owns everything beneath it (`/listings/<uuid>`). */
  readonly wildcard: boolean
}

export const ROUTES: readonly MarketRoute[] = [
  // The index IS the browse page. A marketplace whose front door is anything else is a
  // marketplace with an extra click between a reader and the thing they came for.
  { path: '', label: 'Browse', wildcard: false },
  // Wildcard: `/listings/<uuid>` is one listing, and it is the address people paste at each other.
  // Not offered in the navigation, because the index already is the list of listings.
  { path: 'listings', label: null, wildcard: true },
  // Wildcard: `/collections/<uuid>` is one collection's listings.
  { path: 'collections', label: 'Collections', wildcard: true },
  // Creating a listing, and the seller's own listings including the drafts nobody else can see.
  { path: 'sell', label: 'Sell', wildcard: false },
  // Wildcard: `/orders/<uuid>` is one order, with its dispute path.
  { path: 'orders', label: 'Orders', wildcard: true },
  // What is charged and what is free, published. 15-monetisation-model.md §3.4: the take rate is
  // 250 bps of the sale, paid by the seller, and a reader is entitled to see it before listing.
  { path: 'fees', label: 'Fees', wildcard: false },
]

/** What the navigation renders, with the leading slash a `NavLink` wants. */
export const NAV: ReadonlyArray<{ to: string; label: string }> = ROUTES.filter(
  (route): route is MarketRoute & { label: string } => route.label !== null,
).map((route) => ({ to: `/${route.path}`, label: route.label }))

/** Every path nginx has to serve the shell for, excluding the index. */
export const NON_INDEX_PATHS: readonly string[] = ROUTES.filter((r) => r.path !== '').map(
  (r) => r.path,
)

/** The address of one listing. Built here so no page composes it by hand. */
export function listingPath(id: string): string {
  return `/listings/${encodeURIComponent(id)}`
}

/** The address of one collection's listings. */
export function collectionPath(id: string): string {
  return `/collections/${encodeURIComponent(id)}`
}

/** The address of one order. */
export function orderPath(id: string): string {
  return `/orders/${encodeURIComponent(id)}`
}
