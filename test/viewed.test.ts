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
import { afterEach, describe, it } from 'node:test'
import { installWindow, removeWindow } from './browser-stubs.ts'
import { apiBase } from '../src/lib/hosts.ts'
import { setViewedNetwork, viewedNetwork } from '../src/lib/viewed.ts'

/** A real address on this surface, on the mainnet estate. */
const PAGE = 'https://market.cloudsforge.online/'
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
      assert.equal(apiBase(), '')
    })
  })

  it('re-points this page at the testnet estate WITHOUT navigating anywhere', () => {
    at(PAGE, () => {
      setViewedNetwork('testnet')
      assert.equal(viewedNetwork(), 'testnet')
      // `-testnet` on the API host, not a different path and not a different product. The web
      // hostname is retired and 302s to its mainnet sibling; `/v1` on it is exempt and still
      // answers from the testnet service, which is what makes this readable at all.
      assert.equal(apiBase(), 'https://market-testnet.cloudsforge.online')
    })
  })

  it('goes back to the serving estate when the reader switches back', () => {
    at(PAGE, () => {
      setViewedNetwork('testnet')
      setViewedNetwork('mainnet')
      assert.equal(viewedNetwork(), 'mainnet')
      assert.equal(apiBase(), '')
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
