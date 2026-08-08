/**
 * **No asset code is ever typed into a page as a default, and the create-listing form proves it
 * both ways: by what it renders, and by what its source is allowed to contain.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS FOR
 *
 * `src/pages/sell.tsx` opened every create-listing form with
 *
 *     const [assetCode, setAssetCode] = useState('SHARD')
 *     const [itemAssetCode, setItemAssetCode] = useState('SHARD')
 *
 * and rendered both as the visible value of a text input. SHARD was retired on 2026-08-04 —
 * `RETIRED_ASSETS = Object.freeze(['SHARD'])`, `contracts/packages/chain/src/index.ts`, whose
 * `assertIssuable` throws for a retired code on any write path — so a seller who did not edit the
 * field got a listing denominated in an asset nothing may newly be denominated in. It is
 * `cloudsforge-online/micro-org` #227 §2, and it is the THIRD retired-asset reference to reach a
 * user surface (#15, #182).
 *
 * The fix is in `src/lib/market.ts`: `UNCHOSEN_ASSET_CODE`, an empty string, and the argument for
 * why an empty required field beats a different typed code. **This file is the half that keeps it
 * fixed.** The property the old code lacked is not "SHARD is gone" — a grep for SHARD would go
 * green the moment somebody typed `'EMBER'` in its place, and would say nothing at all the day
 * EMBER is wound down. The property is:
 *
 *     NO ASSET CODE IS A DEFAULT ON THIS SURFACE. NOT THIS ONE, NOT THE NEXT ONE.
 *
 * ── Why the source is read rather than only the DOM ────────────────────────────────────────────
 *
 * The rendered assertion below is the one that describes what a seller sees, and it is the real
 * test. It is not sufficient on its own: it pins the two fields that exist today, and the defect
 * arrives as a THIRD field, or as the same edit made in `browse.tsx`'s filters. The source check
 * is a grep for the shape of the mistake across every page, which is the only check that catches
 * "somebody added one line in a hurry" on the pull request — the same argument
 * `test/no-build-time-config.test.ts` makes for greping for `VITE_`.
 *
 * ── Comments are stripped first, and that is load-bearing here ─────────────────────────────────
 *
 * `sell.tsx` and `lib/market.ts` both EXPLAIN this rule in prose, and both name SHARD while doing
 * it, because a rule whose reason is not written down is a rule the next person deletes. A grep
 * over the raw files would match those explanations and fail correct code. The estate has walked
 * into this twice already — `hub-web`'s nginx check and this repository's own float check, which
 * matched `src/lib/money.ts`'s documentation of the functions it forbids — so `stripComments` is
 * copied from `test/registry.test.ts` rather than reinvented.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { UNCHOSEN_ASSET_CODE, assetCodeChosen } from '../src/lib/market.ts'
import { ASSET_DECIMALS } from '../src/lib/money.ts'
import { SellPage } from '../src/pages/sell.tsx'

const root = fileURLToPath(new URL('..', import.meta.url))
const ORIGIN = 'https://market.cloudsforge.online'

/** Block and line comments removed, so a rule about code is not failed by its own explanation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function pageSources(): Array<{ name: string; code: string }> {
  const dir = join(root, 'src', 'pages')
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.tsx') || entry.endsWith('.ts'))
    .map((entry) => ({
      name: relative(root, join(dir, entry)),
      code: stripComments(readFileSync(join(dir, entry), 'utf8')),
    }))
}

/**
 * Every asset code this bundle can name.
 *
 * `ASSET_DECIMALS` (`src/lib/money.ts`) is the one table of asset codes this repository owns, it
 * is cited to `contracts/packages/chain/src/index.ts`, and it deliberately still contains the
 * retired `SHARD` — because 114 live SHARD accounts are still supervised and `decimals: 0` is the
 * only thing that says a stored `250` means 250 Shards and not 250 wei. That makes it exactly the
 * right list to forbid as DEFAULTS while continuing to RENDER: retired means nothing new may be
 * denominated in it, not that it may not be displayed. Reading and writing are different rules and
 * this is the line between them.
 */
const NAMEABLE_ASSET_CODES = Object.keys(ASSET_DECIMALS)

/**
 * The shape of an asset code, for the ones this bundle cannot name.
 *
 * `ASSET_DECIMALS` does not list DOGE, LTC or ETC — they are in `ON_CHAIN_ASSETS` and this bundle
 * has never needed their decimals — so a check bound only to that table would miss
 * `useState('DOGE')`. This catches any bare screaming-case literal used as a React initial value,
 * which is the shape the defect had. Lowercase initialisers are untouched: `useState('ember')` for
 * a chain name and `useState<AssetKind>('game_item')` are not asset codes and are not defaults
 * that can go stale on a retirement.
 */
const SCREAMING_INITIALISER = /useState[^(]*\(\s*'([A-Z][A-Z0-9:._-]+)'/g

describe('the create-listing form pre-fills no asset code', () => {
  it('finds the pages to check', () => {
    // A grep over an empty list passes for the wrong reason, which is the one way this test could
    // stop protecting anything without saying so.
    const pages = pageSources()
    assert.ok(pages.length >= 5, `expected the pages, found ${pages.length}`)
    assert.ok(
      pages.some((p) => p.name.endsWith('sell.tsx')),
      'sell.tsx is the page this rule is about and it was not read',
    )
    assert.ok(NAMEABLE_ASSET_CODES.length >= 6, 'ASSET_DECIMALS is empty; this check reads nothing')
    assert.ok(
      NAMEABLE_ASSET_CODES.includes('SHARD'),
      'SHARD left ASSET_DECIMALS. It must stay — the ledger still supervises Shard balances and ' +
        'this test is what stops it coming back as a DEFAULT rather than as a rendering.',
    )
  })

  it('the unchosen code is empty, and an empty code is not a choice', () => {
    // Bound rather than assumed: everything below is only a guard if the constant it guards really
    // is the absence of a code. A future edit that made it `'EMBER'` would otherwise pass the
    // source checks — the literal would be here, not in a page — and re-ship the defect.
    assert.equal(UNCHOSEN_ASSET_CODE, '')
    assert.equal(assetCodeChosen(UNCHOSEN_ASSET_CODE), false)
    assert.equal(assetCodeChosen('   '), false, 'whitespace is a 400 from requireString, not a code')
    assert.equal(assetCodeChosen(' EMBER '), true)
  })

  for (const code of NAMEABLE_ASSET_CODES) {
    it(`no page initialises state with ${code}`, () => {
      for (const { name, code: source } of pageSources()) {
        assert.equal(
          source.includes(`useState('${code}')`),
          false,
          `${name} opens a field pre-filled with ${code}. Nothing on this surface may default to ` +
            `an asset code: see UNCHOSEN_ASSET_CODE in src/lib/market.ts, and micro-org #227.`,
        )
      }
    })
  }

  it('no page initialises state with anything shaped like an asset code', () => {
    for (const { name, code } of pageSources()) {
      const found = [...code.matchAll(SCREAMING_INITIALISER)].map((m) => m[1])
      assert.deepEqual(
        found,
        [],
        `${name} initialises state with ${found.join(', ')}. If that is an asset code it is a ` +
          `default that goes stale the day the asset is retired — the defect micro-org #227 §2 ` +
          `describes. If it is not, it still has to be a named constant rather than a literal.`,
      )
    }
  })

  it('both asset fields open blank, and the form will not save until they are filled', async () => {
    await withScreen(
      page(),
      {
        url: `${ORIGIN}/sell`,
        storage: fx.SIGNED_IN,
        routes: {
          'GET /auth/me': { body: fx.ME },
          'GET /v1/listings': { body: { listings: [] } },
        },
      },
      async (s) => {
        await s.settle(20)

        const pay = fieldByLabel(s, /which asset buyers pay in/i)
        const carries = fieldByLabel(s, /asset code the item itself carries/i)
        assert.equal(valueOf(pay), '', 'the price asset opened pre-filled')
        assert.equal(valueOf(carries), '', 'the item asset opened pre-filled')
        // A placeholder is read as a suggestion, and a suggestion is a default with a lighter
        // colour. Neither field may carry one.
        assert.equal(pay.getAttribute('placeholder'), null)
        assert.equal(carries.getAttribute('placeholder'), null)

        // The hole is named on screen rather than left as two blank boxes over a dead button.
        assert.match(s.text(), /deliberately blank/i, 'nothing on the page explains the blanks')

        // Fill everything EXCEPT the asset codes: the button must still refuse.
        const boxes = s.allByRole('textbox')
        const urn = boxes[0]
        assert.ok(urn, 'the form rendered no fields at all')
        await s.type(urn, 'urn:cf:token:hearth:testnet:0xfeedface')
        await s.type(fieldByLabel(s, /asking price|bidding opens/i), '2500000000000000000')
        const save = s.byRole('button', /save this as a draft/i)
        assert.equal(
          (save as unknown as { disabled?: boolean }).disabled,
          true,
          'the form offered to save a listing with no asset code. market/src/server.ts answers ' +
            'that with a 400 the seller then has to translate back into the box they left empty.',
        )

        // No amount is rendered without its unit while the price asset is unchosen — the rule
        // src/components/money.tsx exists to keep.
        assert.equal(
          s.document.querySelectorAll('.mk-breakdown').length,
          0,
          'a money breakdown rendered before an asset code was chosen, so every figure in it ' +
            'was printed with an empty unit beside it',
        )

        await s.type(pay, 'EMBER')
        await s.type(carries, 'EMBER')
        assert.equal(
          (s.byRole('button', /save this as a draft/i) as unknown as { disabled?: boolean }).disabled,
          false,
          'the form still refuses to save once both asset codes are filled in',
        )
        assert.equal(
          s.document.querySelectorAll('.mk-breakdown').length,
          1,
          'the preview did not appear once the price asset was chosen',
        )
      },
    )
  })
})

/* ── helpers ────────────────────────────────────────────────────────────────────────────────── */

function page() {
  return h(MemoryRouter, { initialEntries: ['/sell'] }, h(AuthProvider, null, h(SellPage)))
}

/** The input inside the `<label>` whose text matches. The form labels by wrapping. */
function fieldByLabel(s: Screen, want: RegExp): Element {
  for (const el of s.allByRole('textbox')) {
    const label = el.closest('label')
    if (label && want.test(label.textContent ?? '')) return el
  }
  throw new Error(`no field labelled ${want}`)
}

function valueOf(el: Element): string {
  return (el as unknown as { value?: string }).value ?? ''
}
