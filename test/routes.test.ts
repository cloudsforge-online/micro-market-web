/**
 * The three descriptions of this app's addresses, checked against each other.
 *
 *   1. `src/lib/routes.ts` — the declaration, from which the navigation is derived.
 *   2. `src/app.tsx`       — which component renders at each path.
 *   3. `nginx.conf`        — which addresses are served the app shell at all.
 *
 * The third is what makes this test worth having. nginx enumerates the real routes and 404s
 * everything else on purpose, so a route added to the router and not to nginx works perfectly
 * under `pnpm dev` and 404s on the first hard refresh in production. That failure survives review
 * because nothing about the diff looks wrong.
 *
 * `app.tsx` is read as TEXT rather than imported: importing would pull in React, the router and
 * every page, and this suite deliberately has no DOM.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  NAV,
  NON_INDEX_PATHS,
  ROUTES,
  collectionPath,
  listingPath,
  orderPath,
} from '../src/lib/routes.ts'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const appSource = read('src/app.tsx')
const nginx = read('nginx.conf')

/**
 * nginx.conf with its comments stripped.
 *
 * The file's own header QUOTES the directive it forbids, in order to explain why the routes are
 * enumerated by hand, so a grep over the raw text matches the warning and fails a correct file.
 * The rule is about DIRECTIVES; strip the prose before checking it.
 */
const directives = nginx
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/** The alternation inside nginx's enumerated `location ~ ^/(…)` block. */
function nginxPaths(): string[] {
  const match = /location\s+~\s+\^\/\(([^)]+)\)/.exec(directives)
  assert.ok(match, 'nginx.conf has no enumerated route block')
  return (match[1] ?? '').split('|').map((p) => p.trim())
}

describe('the route declaration', () => {
  it('is not empty, so this whole file cannot pass for the wrong reason', () => {
    assert.ok(ROUTES.length >= 5, `expected the route table, found ${ROUTES.length} entries`)
  })

  it('has exactly one index route', () => {
    assert.equal(ROUTES.filter((r) => r.path === '').length, 1)
  })

  it('declares no duplicate path', () => {
    const paths = ROUTES.map((r) => r.path)
    assert.equal(new Set(paths).size, paths.length)
  })

  it('declares no path with a slash: these are TOP-LEVEL segments', () => {
    // nginx matches on the first segment and everything under it. A declaration of
    // `listings/detail` would produce a location block that does not mean what it says.
    for (const route of ROUTES) {
      assert.ok(!route.path.includes('/'), `${route.path} is not a top-level segment`)
    }
  })

  it('marks the three routes that own everything beneath them', () => {
    // `/listings/<uuid>`, `/collections/<uuid>` and `/orders/<uuid>` are addresses people paste.
    const wildcards = ROUTES.filter((r) => r.wildcard).map((r) => r.path)
    assert.deepEqual(wildcards.sort(), ['collections', 'listings', 'orders'])
  })

  it('makes the index the browse page, so the front door is the market', () => {
    assert.equal(ROUTES[0]?.path, '')
    assert.equal(ROUTES[0]?.label, 'Browse')
  })
})

describe('the navigation', () => {
  it('is derived from the declaration rather than restated', () => {
    const labelled = ROUTES.filter((r) => r.label !== null)
    assert.equal(NAV.length, labelled.length)
    assert.deepEqual(
      NAV.map((n) => n.to),
      labelled.map((r) => `/${r.path}`),
    )
  })

  it('points the first entry at the index', () => {
    assert.equal(NAV[0]?.to, '/')
  })

  it('does not offer /listings, because the index already IS the list of listings', () => {
    assert.ok(!NAV.some((n) => n.to === '/listings'))
  })

  it('offers the fees page, because a rate a seller cannot read is a rate they find out about', () => {
    assert.ok(NAV.some((n) => n.to === '/fees'))
  })
})

describe('the router', () => {
  it('has a <Route> for every declared path', () => {
    for (const route of ROUTES) {
      if (route.path === '') {
        assert.match(appSource, /<Route\s+index/, 'no index route in app.tsx')
        continue
      }
      const expected = route.wildcard ? `path="${route.path}/*"` : `path="${route.path}"`
      assert.ok(appSource.includes(expected), `app.tsx has no ${expected}`)
    }
  })

  it('declares no <Route path=…> that the declaration does not know about', () => {
    const declared = new Set(NON_INDEX_PATHS)
    for (const match of appSource.matchAll(/path="([^"]+)"/g)) {
      const path = (match[1] ?? '').replace(/\/\*$/, '')
      if (path === '*') continue
      assert.ok(declared.has(path), `app.tsx routes ${path}, which lib/routes.ts does not declare`)
    }
  })

  it('keeps the catch-all, which is what renders the honest 404 page', () => {
    assert.ok(appSource.includes('path="*"'))
    assert.ok(appSource.includes('NotFoundPage'))
  })

  it('puts NO gate on browsing: a catalogue behind a sign-in is not a catalogue', () => {
    // The index, listings and collections must be reachable without an account. A gate added to a
    // browse page by habit would make every listing unlinkable.
    const gated = appSource.slice(appSource.indexOf('<ProtectedRoute'))
    for (const open of ['<Route index', 'path="listings/*"', 'path="collections/*"']) {
      assert.ok(appSource.includes(open), `${open} is missing`)
      assert.equal(gated.includes(open), false, `${open} sits after the first gate`)
    }
  })

  it('DOES gate the two routes that cannot render without a session', () => {
    // `GET /v1/orders` derives the subject from the token (market/src/server.ts). Without one
    // there is nothing to show but a wall of failures.
    for (const path of ['sell', 'orders/*']) {
      const at = appSource.indexOf(`path="${path}"`)
      assert.ok(at > 0, `${path} is not routed`)
      const following = appSource.slice(at, at + 300)
      assert.ok(following.includes('<ProtectedRoute'), `${path} is not behind a session gate`)
    }
  })
})

describe('nginx', () => {
  it('enumerates every declared path', () => {
    const served = new Set(nginxPaths())
    for (const path of NON_INDEX_PATHS) {
      assert.ok(served.has(path), `nginx.conf does not serve /${path}; it will 404 on a hard refresh`)
    }
  })

  it('enumerates nothing the app does not route', () => {
    // The other direction: a stale entry serves the shell with a 200 for an address that renders
    // the not-found page, which is the exact dishonesty the enumeration exists to prevent.
    const declared = new Set(NON_INDEX_PATHS)
    for (const path of nginxPaths()) {
      assert.ok(declared.has(path), `nginx.conf serves /${path}, which this app does not route`)
    }
  })

  it('serves the index explicitly', () => {
    assert.match(nginx, /location\s+=\s+\/\s*\{/)
  })

  it('never falls back to index.html with a 200 for an unknown path', () => {
    assert.equal(
      /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/.test(directives),
      false,
      'the catch-all falls back to the shell with a 200',
    )
    assert.ok(directives.includes('error_page 404 /index.html'))
    // …and the comment that explains the rule is still there, since it is the only reason anybody
    // reading this file later will understand why the routes are enumerated by hand.
    assert.match(nginx, /404, not 200/)
  })

  it('does not let a missing asset fall through to the shell', () => {
    // A JavaScript request answered with HTML fails with a syntax error naming the wrong file.
    assert.match(directives, /location\s+\/assets\/\s*\{[\s\S]*?try_files\s+\$uri\s+=404;/)
  })

  it('restates the security headers in every block that sets Cache-Control', () => {
    // nginx's `add_header` is all-or-nothing per level: a location declaring ANY add_header
    // inherits NONE from its parent. Missing this stripped nosniff from every hashed script in
    // every frontend cut from the template.
    const blocks = directives.match(/location[^{]*\{[^}]*Cache-Control[^}]*\}/g) ?? []
    assert.ok(blocks.length >= 3, `expected the cache-controlled blocks, found ${blocks.length}`)
    for (const block of blocks) {
      assert.match(block, /X-Content-Type-Options/, `a block sets Cache-Control without nosniff`)
      assert.match(block, /X-Frame-Options/)
      assert.match(block, /Referrer-Policy/)
    }
  })

  it('serves the deep link CI probes, and 404s one it does not own', () => {
    // The workflow asserts a REAL route returns 200 and an unknown one 404s.
    const block = new RegExp(`^/(${nginxPaths().join('|')})(/|$)`)
    assert.ok(block.test('/listings/11111111-2222-3333-4444-555555555555'))
    assert.ok(block.test('/orders/11111111-2222-3333-4444-555555555555'))
    assert.ok(block.test('/fees'))
    assert.equal(block.test('/nope/not/a/route'), false)
  })

  it('sets the frame-ancestors header this surface needs', () => {
    // A Buy button reached through somebody else's iframe is a clickjacking surface for a request
    // that moves money.
    assert.match(directives, /X-Frame-Options.*SAMEORIGIN/)
  })

  it('never caches the shell, which is the file that names the hashed bundle', () => {
    assert.match(directives, /location\s+=\s+\/\s*\{[\s\S]*?Cache-Control\s+"no-store"/)
  })
})

describe('the path builders', () => {
  it('build the addresses nginx serves', () => {
    assert.equal(listingPath('abc'), '/listings/abc')
    assert.equal(collectionPath('abc'), '/collections/abc')
    assert.equal(orderPath('abc'), '/orders/abc')
  })

  it('escape a segment that would otherwise change the path', () => {
    assert.equal(listingPath('../fees'), '/listings/..%2Ffees')
    assert.equal(orderPath('a/b'), '/orders/a%2Fb')
  })
})
