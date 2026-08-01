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

  it('compares ORIGINS, so a surface with a base path still looks like itself', () => {
    const withPath = { market: 'https://market.example/app' } as unknown as CloudsForgeHosts
    assert.equal(resolveApiBase('https://market.example', withPath, 'market'), '')
  })

  it('does not treat a different port on the same host as the same origin', () => {
    assert.equal(
      resolveApiBase('http://localhost:5187', hosts, 'market'),
      'http://localhost:4007',
    )
  })
})

describe('the registry resolves this app at runtime', () => {
  it('gives market its own dev port on localhost', () => {
    assert.equal(hostsFor('http://localhost:5187/').market, 'http://localhost:4007')
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
