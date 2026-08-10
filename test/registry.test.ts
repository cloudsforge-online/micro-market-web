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
import { existsSync, readFileSync } from 'node:fs'
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

/**
 * Where a micro-ui checkout is, in the order CI and a developer's machine put it.
 *
 * `link:../ui/packages/ui` is how this app consumes the design system, so the sibling checkout is
 * the normal case; the environment variable is for a CI job that puts it somewhere else.
 */
const UI_ROOT = [process.env['CLOUDSFORGE_UI_DIR'], fileURLToPath(new URL('../../ui', import.meta.url))]
  .filter((v): v is string => Boolean(v))
  .find((p) => existsSync(`${p}/packages/ui/src/ui.css`))

/*
 * THE SUB-NAV IS THE DESIGN SYSTEM'S NOW, AND THE LOCAL COPY IS GONE.
 *
 * Both directions, following `explorer-web/test/tokens.test.ts`'s "the shared form controls exist
 * and the local copies are gone": either half alone is true of a broken state. Shared rules
 * arriving while a private copy still sits beside them is exactly how ten copies of this strip came
 * to exist under six prefixes; the private copy going while nothing shared has arrived is an
 * unstyled row of links.
 *
 * What is asserted here is the TEXT of two stylesheets. The other half of the claim — that the
 * strip a reader actually sees is the shared one — is in `test/journeys.test.ts`, in a document,
 * because a source-text check goes green on a component nothing renders.
 */
test('the stylesheet declares none of the local sub-nav rules any more', () => {
  const rules = stripComments(read('src/styles.css'))
  for (const gone of [/\.mk-subnav\b/, /\.mk-subnav__link\.is-active\b/]) {
    assert.doesNotMatch(rules, gone, `src/styles.css still declares ${gone.source}`)
  }
  // `is-active` itself survives, and deliberately: `.mk-toggle .cf-btn.is-active` is the pressed
  // state of the Kind/Order toggle on Browse, which is a different control that was never part of
  // this strip. Asserting the bare word gone would fail a correct file, which is a test somebody
  // deletes — so the sub-nav's own spelling is what is named.
  assert.match(rules, /\.mk-toggle \.cf-btn\.is-active/, 'the toggle state is the one is-active left')
})

test('the page measure is the token the bar and the footer use, not a second number', () => {
  // Measured 2026-08-10: `.mk-main` and the deleted `.mk-subnav__inner` both set `78rem` — 1248px
  // against `var(--cf-max-w)`'s 1200px in `.cf-bar__inner` and `.cf-foot__inner` — so the strip and
  // the page content lined up with each other and neither lined up with the chrome.
  const rules = stripComments(read('src/styles.css'))
  assert.doesNotMatch(rules, /max-width:\s*78rem/, 'the 1248px measure is back')
  assert.match(rules, /max-width:\s*var\(--cf-max-w\)/, 'the page measure is not the shared token')
})

test('every font-size in the stylesheet is a step of the scale, or is parent-relative on purpose', () => {
  /*
   * The scale is 11 / 13 / 14 / 16 / 18 / 21 / 24 / 32 / 44px, and this file used to set 43 sizes
   * in absolute literals across 16 distinct values — 0.72, 0.75, 0.78, 0.8, 0.82, 0.85, 0.875,
   * 0.88, 0.9 … none of which moved when the design system raised the body step.
   *
   * The two survivors are `em`, and they are deliberate: `.mk-amount__code` and `.mk-amount__note`
   * size themselves against whatever the amount around them is set to, and `.mk-amount` is rendered
   * in card titles, table rows and offer rows at three different sizes. The scale has no relative
   * steps, so converting those two would be a behaviour change rather than a scale correction.
   */
  const rules = stripComments(read('src/styles.css'))
  const sizes = [...rules.matchAll(/font-size:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim())
  assert.ok(sizes.length >= 40, `found ${sizes.length} font-size declarations, so this cannot pass empty`)
  const strays = sizes.filter((v) => !/^var\(--cf-text-[a-z0-9]+\)$/.test(v) && !/^[0-9.]+em$/.test(v))
  assert.deepEqual(strays, [], `src/styles.css sets ${strays.join(', ')} rather than a step of the scale`)
})

if (UI_ROOT === undefined) {
  test('SKIPPED: no micro-ui checkout — CI checks one out and requires this to run', () => {
    assert.ok(true)
  })
} else {
  test('the shared sub-nav classes exist in ui.css, so this strip is not unstyled', () => {
    const ui = readFileSync(`${UI_ROOT}/packages/ui/src/ui.css`, 'utf8')
    const declared = new Set([...ui.matchAll(/\.(cf-[a-z0-9_-]+)/g)].map((m) => m[1] ?? ''))
    for (const present of [
      'cf-subnav',
      'cf-subnav__inner',
      'cf-subnav__link',
      'cf-subnav__link--current',
    ]) {
      assert.ok(declared.has(present), `.${present} is missing from ui.css`)
    }
  })
}

test('no source file names a CloudsForge hostname', () => {
  // A literal hostname is a second, unversioned copy of the surface registry, and the copy is the
  // one that will be wrong.
  for (const file of ['src/lib/hosts.ts', 'src/lib/market.ts', 'src/styles.css', 'index.html']) {
    assert.doesNotMatch(read(file), /cloudsforge\.online/, `${file} names a hostname`)
  }
})
