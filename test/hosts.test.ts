/**
 * Where this bundle talks to, and the fact that it decides at runtime.
 *
 * `resolveApiBase` is pure so this can be tested without a browser. What it must get right is the
 * SAME-ORIGIN case: in production nginx serves the bundle and `micro-market` serves `/v1` behind
 * one hostname, so the base is empty and requests stay relative. Deriving that from a build flag
 * would mean an image built for production and opened on localhost pointed at a host that is not
 * there — which is the property this whole repository has no `.env` in order to keep.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cloudsforgeHosts, type CloudsForgeHosts } from '@cloudsforge/ui'
import { APP_NAME, PRODUCT, resolveApiBase } from '../src/lib/hosts.ts'
import { installWindow, removeWindow } from './browser-stubs.ts'

function hostsFor(url: string): CloudsForgeHosts {
  installWindow(url)
  try {
    return cloudsforgeHosts()
  } finally {
    removeWindow()
  }
}

describe('the surface this app is', () => {
  it('is market, which is what marks the switcher entry current', () => {
    assert.equal(PRODUCT, 'market')
  })

  it('reports itself as market to the observability ingest', () => {
    assert.equal(APP_NAME, 'market')
  })
})

describe('resolveApiBase', () => {
  const hosts = { market: 'http://localhost:4007' } as unknown as CloudsForgeHosts

  it('goes relative when the page is served from the market origin', () => {
    assert.equal(resolveApiBase('http://localhost:4007', hosts, 'market'), '')
  })

  it('goes absolute when the page is somewhere else — Vite’s port under pnpm dev', () => {
    assert.equal(resolveApiBase('http://localhost:5187', hosts, 'market'), 'http://localhost:4007')
  })

  it('goes absolute when there is no page origin at all', () => {
    assert.equal(resolveApiBase('', hosts, 'market'), 'http://localhost:4007')
  })

  it('answers a base-path surface with its MOUNT, because `` would leave the mount', () => {
    // ── THIS ASSERTION USED TO EXPECT `''`, AND THAT WAS THE DEFECT WRITTEN DOWN ────────────────
    //
    // It was named "compares ORIGINS, so a surface with a base path still looks like itself", and
    // the origin comparison is right — a surface with a base path IS same-origin with itself, and
    // the absolute form would be wrong. What was wrong is what same-origin then answers.
    //
    // `''` means every request stays RELATIVE. From a page at `/app/anything` a relative
    // `/v1/titles` resolves to `/v1/titles` at the ORIGIN ROOT — outside the mount entirely. On
    // this estate that root belongs to micro-site, which answers its SPA shell for an unknown
    // path: 200, an HTML body where JSON was expected, every panel on the page in a failure state
    // and a completely healthy network tab.
    //
    // The mount is the answer. Asserted here as well as in `@cloudsforge/ui`'s own suite because
    // this is the seam this repository actually calls, and a delegation that stopped delegating
    // would pass every test in the other repository.
    const withPath = { market: 'https://market.example/app' } as unknown as CloudsForgeHosts
    assert.equal(resolveApiBase('https://market.example', withPath, 'market'), '/app')
  })

  it('does not treat a different port on the same host as the same origin', () => {
    assert.equal(
      resolveApiBase('http://localhost:5187', hosts, 'market'),
      'http://localhost:4007',
    )
  })
})

describe('the registry resolves this app at runtime', () => {
  it('gives market its own dev port on localhost, with the mount appended', () => {
    // `hostsFrom` composes every entry as origin + `basePath ?? ''`, so a path-mounted surface's
    // base URL carries the mount in EVERY environment — that is what makes one registry edit
    // re-point every link in the estate.
    //
    // In development it produces an address that is a LINK target and not an API base, and those
    // two now differ: `devPort` names the SERVICE (4007 is `micro-market`), the mount only exists
    // where a gateway puts it, and `apiBaseFor` drops it for a local target precisely because
    // nothing strips it there. See its comment in @cloudsforge/ui.
    assert.equal(hostsFor('http://localhost:5187/').market, 'http://localhost:4007/market')
  })

  it('gives market a subdomain on a real apex', () => {
    const resolved = hostsFor('https://market.cloudsforge.online/').market
    assert.match(resolved, /^https:\/\/market\./)
  })

  it('resolves the same bundle differently on two hosts, which is the whole point', () => {
    assert.notEqual(
      hostsFor('http://localhost:5187/').market,
      hostsFor('https://market.cloudsforge.online/').market,
    )
  })
})
