/**
 * The registry is the single source of the accent and the host, and this app corrects neither.
 *
 * `micro-foresight-web` found that `micro-ui` had shipped its product accent as
 * `[data-product='foresight']` — missing the `cf-` prefix every other product carries — so the
 * rule matched nothing and the product rendered in the company ember. It looked entirely correct
 * while wearing the wrong colour, and seventy-five green tests in `micro-ui` could not see it. The
 * same commit gave that product another surface's dev port.
 *
 * Both are fixed upstream. This file asserts that Forge Market's own entry is right, so that if
 * either mistake is repeated for this product it fails here rather than in a screenshot.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { SURFACES } from '@cloudsforge/ui/surfaces'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

/**
 * Block and line comments removed, so a rule about code is not failed by its own explanation.
 *
 * The estate has already written this test the naive way once: `hub-web`'s nginx check grepped the
 * raw file, and `nginx.conf`'s header quotes the directive it forbids, so the guard failed a
 * correct config. Every text assertion in this repository strips prose first.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('index.html sets the documented product attribute, and no unprefixed second one', () => {
  const html = read('index.html')
  assert.match(html, /data-cf-product="market"/, 'the documented attribute must be set')
  assert.doesNotMatch(
    html,
    /\sdata-product="/,
    'the unprefixed attribute was a workaround for a selector micro-ui has since fixed',
  )
})

test('the registry gives market its own accent, and this app restates no hex of it', () => {
  const market = SURFACES.find((s) => s.key === 'market')
  assert.ok(market, 'market must be in the registry')
  assert.equal(market.accent, '#9b7bf0')
  // The accent reaches the page through `data-cf-product`, never through a literal. A hex in a
  // RULE is a colour that stops following the design system the day the design system moves —
  // comments are stripped first, because the stylesheet's header documents the accent and its
  // contrast ratio, and a grep over the raw file matches its own explanation.
  const rules = stripComments(read('src/styles.css'))
  assert.doesNotMatch(rules, /#9b7bf0/i, 'the accent is restated as a literal')
  assert.doesNotMatch(rules, /#12100f/i, 'the ground is restated as a literal')
  assert.match(rules, /var\(--cf-accent\)/, 'the accent must be used through its token')
})

test('the registry gives market its own dev port, so this app overrides nothing', () => {
  const market = SURFACES.find((s) => s.key === 'market')
  assert.ok(market)
  assert.equal(market.devPort, 4007)
  const clashes = SURFACES.filter((s) => s.devPort === market.devPort && s.key !== 'market')
  assert.deepEqual(
    clashes.map((s) => s.key),
    [],
    'two surfaces must not share a dev port',
  )
  // Comments are stripped first: `hosts.ts` DOCUMENTS the port it resolves to, and a grep over
  // the raw file matches its own explanation. The rule is about code — a literal port in a
  // statement would be a second, unversioned copy of the registry.
  assert.doesNotMatch(
    stripComments(read('src/lib/hosts.ts')),
    /localhost:\d+/,
    'a local port override would be a second, unversioned copy of the registry',
  )
})

test('market is in the switcher, which is what makes the bar mark it current', () => {
  const market = SURFACES.find((s) => s.key === 'market')
  assert.ok(market)
  assert.equal(market.inSwitcher, true)
  assert.equal(market.subdomain, 'market')
})

test('no source file names a CloudsForge hostname', () => {
  // A literal hostname is a second, unversioned copy of the surface registry, and the copy is the
  // one that will be wrong.
  for (const file of ['src/lib/hosts.ts', 'src/lib/market.ts', 'src/styles.css', 'index.html']) {
    assert.doesNotMatch(read(file), /cloudsforge\.online/, `${file} names a hostname`)
  }
})
