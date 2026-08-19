/**
 * Where this app talks to, resolved at runtime.
 *
 * `cloudsforgeHosts()` reads `window.location.hostname` on every call, so the same bundle
 * addresses `http://localhost:4007` when served from localhost and `https://market.<apex>` when
 * served from the apex. Nothing here reads a build-time constant; see the note in vite.config.ts.
 */
import { apiBaseFor, cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'
import { viewedHosts } from './viewed.ts'

/**
 * The surface this application IS.
 *
 * It selects the switcher entry marked current, and it names this app's own API host.
 * `ui/packages/ui/src/surfaces.ts` registers `market` as a product with `inSwitcher: true`,
 * accent `#9b7bf0` and `devPort: 4007`.
 */
export const PRODUCT: SurfaceKey = 'market'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'market'

/**
 * The base URL for this app's OWN API.
 *
 * ── IT IS `@cloudsforge/ui`'s NOW, AND THIS REPOSITORY HAD ONE OF SIXTEEN COPIES ────────────────
 *
 * The body used to live here, and in fifteen other frontends, eleven of them byte-identical. It
 * is a derivation from the registry, and the estate has been bitten three times by a second copy
 * of a registry derivation — most recently `rpcUrl()` in exchange-web, which hand-rolled the apex
 * from the hostname and returned null the day its surface became a folder.
 *
 * The behaviour is unchanged in the case this surface is in today and changes in exactly one way
 * for the case it is moving to. Same origin used to answer `''`, so requests stayed RELATIVE —
 * correct while `micro-market` and this bundle shared `market.<apex>`, and wrong once the bundle
 * is `<apex>/market`: a relative `/v1/titles` then resolves at the APEX ROOT, which is
 * micro-site's, and micro-site answers its SPA shell. 200, HTML body, JSON expected, every panel
 * on the page in a failure state with a healthy network tab.
 *
 * `apiBaseFor` answers the surface's own MOUNT instead. See its comment in `@cloudsforge/ui` for
 * the argument and the seven tests, including a property test over the whole registry.
 *
 * Re-exported rather than deleted because `test/hosts.test.ts` and `lib/api.ts` both name it, and
 * a rename across those for no behavioural reason is churn a reviewer has to read past.
 */
export const resolveApiBase = apiBaseFor

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/**
 * This app's API base, resolved now. Call it per request; never cache it in a module constant.
 *
 * `viewedHosts()` rather than `cloudsforgeHosts()` is the whole of the in-place network view at
 * this layer (micro-org#459). It returns the map it was given, unchanged, until the reader picks
 * the other network in the bar, and the sibling estate's origins after that — so this line is a
 * no-op in development, in a preview deployment and for every reader who never touches the
 * switcher. The `-testnet` WEB hostnames are retired and 302 to their mainnet siblings, but `/v1`
 * on them is not: that path still answers from the testnet services, which is what makes reading
 * the other network from this page possible at all. See `lib/viewed.ts`.
 */
export function apiBase(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return resolveApiBase(origin, viewedHosts(), PRODUCT)
}

/** The page origin, or a stable placeholder when there is no document (tests, prerender). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}
