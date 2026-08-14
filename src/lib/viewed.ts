/**
 * The network the reader is VIEWING — in-app network context (micro-org#459, the combined view).
 *
 *     "i see basically that in every page when you press testnet it take you to network page
 *      testet and if you switch product its reset to mainnet"
 *
 * That report is why this file exists in THIS bundle rather than only in the three that had one.
 * Under the combined view the `-testnet` WEB hostnames are retired, so a frontend that cannot
 * re-point its own reads has nowhere to send a reader who presses Testnet; the escape route it was
 * given instead — leave for Forge Network on testnet — answered a different question than the one
 * the reader asked, and leaving from a page that could not view for one that could is exactly how
 * the next product link went back to mainnet. Every bundle views now, so there is nothing to
 * escape from and nothing to reset.
 *
 * The whole argument lives on `createNetworkView` in `@cloudsforge/ui/network-view`, once, instead
 * of nineteen times: nothing is persisted (module memory, per tab, which is what leaves the
 * estate's no-stored-network invariant intact), the default is the hostname's own network, the
 * viewed network is always on screen because the bar's switcher shows it and the amber band
 * follows it, and `?net=` is what carries a choice across a product switch because every surface
 * is its own origin.
 *
 * Construct it ONCE, here, at module scope. A second instance would read `?net=` again and then
 * hold its own independent answer, and the two would disagree the moment the reader clicks.
 *
 * `deploy/scripts/surface-routes.py` check 10 reads this file BY PATH. It is the witness that
 * `viewsAnyNetwork: true` on this surface's registry row is a claim about a bundle rather than a
 * line in a table, and that row is what earns this origin its place in the gateway's
 * cross-environment CORS grant. Deleting this file without clearing the row would leave a
 * credentialed cross-origin allowance that nothing performs.
 */

import { createNetworkView } from '@cloudsforge/ui/network-view'

export type { ViewedNetwork } from '@cloudsforge/ui/network-view'

export const { viewedNetwork, setViewedNetwork, viewedApiOrigin, viewedSurfaceUrl, viewedHosts } =
  createNetworkView()
