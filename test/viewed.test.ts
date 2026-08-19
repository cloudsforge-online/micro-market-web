/**
 * Pressing Testnet re-reads THIS page from the testnet estate, without going anywhere.
 *
 *     "i see basically that in every page when you press testnet it take you to network page
 *      testet and if you switch product its reset to mainnet"
 *
 * The report that made this a defect in every bundle rather than in three of them (micro-org#459).
 * What this file pins is the one thing the reader can see: the base URL this app reads from
 * follows the SWITCHER, not the address bar, and it goes back when they switch back.
 *
 * No DOM. `lib/viewed.ts` holds the choice in module memory and `lib/hosts.ts` consults it per
 * request, so a stub window at a hostname is the entire environment this needs.
 *
 * The state is a MODULE's, so it outlives the test that set it — hence the reset in `afterEach`,
 * performed through the public setter with a window installed, because `setViewedNetwork`
 * normalises its argument against the hostname's own network.
 */
import assert from 'node:assert/strict'
import { BASE } from '../src/lib/routes.ts'
import { afterEach, describe, it } from 'node:test'
import { installWindow, removeWindow } from './browser-stubs.ts'
import { apiBase } from '../src/lib/hosts.ts'
import { setViewedNetwork, viewedNetwork } from '../src/lib/viewed.ts'

/** A real address on this surface, on the mainnet estate. */
// The page is at `<apex>/market` since wave 3. `market.cloudsforge.online` is a 301 now and the
// registry cannot read an environment out of it, so a fixture there would default to mainnet.
const PAGE = 'https://cloudsforge.online/market'
/** A development address: no sibling estate exists, so nothing here can point anywhere. */
const DEV = 'http://localhost:5173/'

/** Run `body` with a window at `url`, and take the window away again whatever happens. */
function at<T>(url: string, body: () => T): T {
  installWindow(url)
  try {
    return body()
  } finally {
    removeWindow()
  }
}

describe('the in-place network view', () => {
  afterEach(() => at(PAGE, () => setViewedNetwork('mainnet')))

  it('starts on the network the hostname names, and says so', () => {
    at(PAGE, () => {
      assert.equal(viewedNetwork(), 'mainnet')
      // ── `''` WAS THE ANSWER UNTIL WAVE 3, AND IT IS THE DEFECT THIS SURFACE MOVED INTO ────────
      //
      // Same-network reads stay RELATIVE, which is still true — but relative to the MOUNT, not to
      // the origin. `''` means the bundle issues `/v1/listings` from a page at `/market/anything`,
      // and that resolves at the apex ROOT, which is micro-site's. micro-site answers its SPA
      // shell: 200, an HTML body where JSON was expected, every panel in a failure state and a
      // completely healthy network tab.
      assert.equal(apiBase(), BASE)
    })
  })

  it('re-points this page at the testnet estate WITHOUT navigating anywhere', () => {
    at(PAGE, () => {
      setViewedNetwork('testnet')
      assert.equal(viewedNetwork(), 'testnet')
      // `-testnet` on the API host, not a different path and not a different product. The web
      // hostname is retired and 302s to its mainnet sibling; `/v1` on it is exempt and still
      // answers from the testnet service, which is what makes this readable at all.
      // The testnet ESTATE, with the mount carried through: `viewedHosts()` re-points the origin
      // and leaves the path alone, and the testnet gateway strips `/market` exactly as the mainnet
      // one does. Dropping it here would be the dev-only rule applied where a gateway exists.
      assert.equal(apiBase(), 'https://testnet.cloudsforge.online/market')
    })
  })

  it('goes back to the serving estate when the reader switches back', () => {
    at(PAGE, () => {
      setViewedNetwork('testnet')
      setViewedNetwork('mainnet')
      assert.equal(viewedNetwork(), 'mainnet')
      // ── `''` WAS THE ANSWER UNTIL WAVE 3, AND IT IS THE DEFECT THIS SURFACE MOVED INTO ────────
      //
      // Same-network reads stay RELATIVE, which is still true — but relative to the MOUNT, not to
      // the origin. `''` means the bundle issues `/v1/listings` from a page at `/market/anything`,
      // and that resolves at the apex ROOT, which is micro-site's. micro-site answers its SPA
      // shell: 200, an HTML body where JSON was expected, every panel in a failure state and a
      // completely healthy network tab.
      assert.equal(apiBase(), BASE)
    })
  })

  it('changes nothing on a development host, which has no sibling estate to view', () => {
    at(DEV, () => {
      const before = apiBase()
      setViewedNetwork('testnet')
      // `NetworkSwitcher` hides itself off-registry, so no click can even produce this; the
      // assertion is that a stray `?net=` or a stale module state cannot point a local stack at
      // the live testnet estate either.
      assert.equal(apiBase(), before)
    })
  })
})
