/**
 * THE SHARED CHROME RENDERS HERE, AND ITS HOOKS ACTUALLY RUN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A TEST WHOSE SUBJECT IS ANOTHER REPOSITORY'S COMPONENT
 *
 * It is not asserting what `@cloudsforge/ui` draws — micro-ui owns that. It is asserting a fact
 * about THIS repository's test process: that `@cloudsforge/ui` and this app end up sharing ONE
 * React. They do not by default. `link:../ui/packages/ui` symlinks the design system's working
 * tree, that tree has its own `react` (a devDependency it genuinely needs to test itself), and
 * Node resolves a bare specifier from the importing file's REALPATH — so the design system's
 * components reach the second copy, share no dispatcher with ours, and the first hook they call
 * throws `Cannot read properties of null (reading 'useState')`.
 *
 * `--import @cloudsforge/ui/test-loader` in the `test` script is what collapses the two. This file
 * is what notices when it stops. Delete the flag and these tests are the first to go red.
 *
 * Publishing `dist` did NOT make that unnecessary, though eight repositories predicted it would:
 * `dist/index.js` has the same realpath as `src/index.tsx`, so it finds the same second copy. What
 * publishing `dist` did fix was the OTHER workaround — the classic JSX transform, and the
 * `globalThis.React` that used to sit in `test/dom.ts`.
 *
 * ── Why it clicks rather than only mounting ───────────────────────────────────────────────────
 *
 * A mount that does not throw is weak evidence: `CloudsForgeLogo` renders perfectly well with two
 * Reacts in the process, because it calls no hook — that was measured. The dropdowns are the ones
 * that break, so each is OPENED, which requires `useState` to hold a value across a re-render and
 * `useId` to have produced the id `aria-controls` names. A second dispatcher cannot fake that.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountMenu, CloudsForgeBar, ProductSwitcher } from '@cloudsforge/ui'
import { createElement as h } from 'react'
import { PRODUCT } from '../src/lib/hosts.ts'
import { withScreen, type Screen } from './dom.ts'

/**
 * `allowEmpty` because the subject is a strip of chrome, not a page: the bar's own text is well
 * under the 40 characters `assertMounted` requires of a mounted app. Every test below then asserts
 * on named elements instead, which is a stricter check than the length heuristic it waives.
 */
const CHROME = { allowEmpty: true } as const

/** The dropdown triggers, which is how they are found without hard-coding this surface's label. */
const triggers = (s: Screen): Element[] => [...s.document.querySelectorAll('[aria-haspopup="menu"]')]

test('the company bar renders, signed out', async () => {
  await withScreen(h(CloudsForgeBar, { current: PRODUCT, account: { signedIn: false } }), CHROME, async (s) => {
    assert.ok(s.document.querySelector('[role="banner"]'), 'CloudsForgeBar rendered no banner')
    s.byRole('link', 'CloudsForge home')
    s.byRole('button', 'Sign in')
    assert.equal(triggers(s).length, 1, 'signed out, the switcher is the only dropdown')
    s.clean('the bar, signed out')
  })
})

test('the product switcher opens, which means its useState held', async () => {
  await withScreen(h(CloudsForgeBar, { current: PRODUCT, account: { signedIn: false } }), CHROME, async (s) => {
    const trigger = triggers(s)[0] as Element
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(s.document.querySelector('[role="menu"]'), null, 'the menu is closed to begin with')

    await s.click(trigger)

    assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'the click did not reach state')
    const menu = s.document.querySelector('[role="menu"][aria-label="CloudsForge products"]')
    assert.ok(menu, 'the switcher opened no menu')
    assert.ok(
      menu.querySelectorAll('[role="menuitem"]').length > 1,
      'an open switcher with fewer than two products is not a switcher',
    )
    // `aria-controls` names the menu by an id from `useId`, which is the other hook in play.
    assert.equal(menu.getAttribute('id'), trigger.getAttribute('aria-controls'))
    s.clean('opening the product switcher')
  })
})

test('the account menu opens for a signed-in viewer, and offers sign out', async () => {
  const account = { signedIn: true, handle: 'ada' }
  await withScreen(h(CloudsForgeBar, { current: PRODUCT, account }), CHROME, async (s) => {
    const trigger = triggers(s)[1] as Element
    assert.match(s.textOf(trigger), /ada/, 'the second dropdown is not the account menu')

    await s.click(trigger)

    const menu = s.document.querySelector('[role="menu"][aria-label="Account"]')
    assert.ok(menu, 'the account menu opened nothing')
    assert.match(s.textOf(menu), /Sign out/)
    s.clean('opening the account menu')
  })
})

test('ProductSwitcher and AccountMenu also render standing alone', async () => {
  // Named directly, not only through the bar: these are the two components measured to throw
  // without deduplication, and a test that reached them only via a parent would stop covering
  // them the day the bar stopped composing them.
  await withScreen(h(ProductSwitcher, { current: PRODUCT }), CHROME, async (s) => {
    assert.equal(triggers(s).length, 1)
    s.clean('ProductSwitcher alone')
  })
  await withScreen(h(AccountMenu, { account: { signedIn: false } }), CHROME, async (s) => {
    s.byRole('button', 'Sign in')
    s.clean('AccountMenu alone')
  })
})
