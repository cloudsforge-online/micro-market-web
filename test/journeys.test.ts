/**
 * The browser journeys of `docs/ecosystem/22-browser-journeys.md`, tiers 1 and 2, for this surface.
 *
 * Doc 22 §2.2 puts T1 and T2 in the frontend repository and T3 in `micro-beacon`. §4 says what
 * each tier may assume is running: T1 assumes nothing but a browser and stubbed responses, T2
 * assumes this bundle and one API. Nothing below assumes anything else.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RULE. Doc 22 §3: **a browser scenario may never assert a business rule.**
 *
 * The reason is an incident (14 §11): a game client withheld four SKUs from its UI while the
 * payment routes stayed live and chargeable, and a client-side test of the hidden catalogue would
 * have passed, green, against the defect — because hiding them WAS the entire control.
 *
 * So every scenario below asserts one of exactly three things (§3.1): what a human can see
 * relative to what the API returned in the SAME run, what the client SENT, or where the browser
 * ended up. Where an outcome depends on a rule the server enforces, `test/journeys.ts` carries an
 * `ownedBy` path to the server-side test that owns it, and the meta-test at the bottom of this
 * file fails the suite if one is missing.
 *
 * The corollary this file obeys: several scenarios end in a refusal. In every case the assertion
 * is on the SENTENCE THE USER IS SHOWN, never on the refusal itself.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each `it` is named with its doc 22 id. `SCENARIOS` in `test/journeys.ts` is the catalogue, the
 * blocked ones carry their blocker, and the last describe block asserts the two agree.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { HUB_MINE_PATH, NOT_PAID_CLAUSE } from '@cloudsforge/ui'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { DOC22_IDS, SCENARIOS } from './journeys.ts'
import { App } from '../src/app.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import { hosts } from '../src/lib/hosts.ts'
import { ROUTES } from '../src/lib/routes.ts'
import { formatMoney } from '../src/lib/money.ts'
import { BrowsePage } from '../src/pages/browse.tsx'
import { CollectionsPage } from '../src/pages/collections.tsx'
import { FeesPage } from '../src/pages/fees.tsx'
import { ListingPage } from '../src/pages/listing.tsx'
import { OrdersPage } from '../src/pages/orders.tsx'
import { SellPage } from '../src/pages/sell.tsx'

const ORIGIN = 'https://market.cloudsforge.online'
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

/** A page under a router at `path`, with the session context every page may reach for. */
function page(element: ReactElement, path: string): ReactElement {
  return h(
    MemoryRouter,
    { initialEntries: [path] },
    h(AuthProvider, null, element) as ReactElement,
  )
}

/** The listing page's four reads, all healthy. Individual scenarios override one at a time. */
function listingRoutes(over: Routes = {}): Routes {
  return {
    [`GET /v1/listings/${fx.LISTING_ID}/risk`]: { body: fx.risk() },
    [`GET /v1/listings/${fx.LISTING_ID}/bids`]: { body: { bids: [] } },
    [`GET /v1/listings/${fx.LISTING_ID}/offers`]: { body: { offers: [] } },
    [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail() },
    ...over,
  }
}

const listingAt = (path = `/listings/${fx.LISTING_ID}`) => page(h(ListingPage), path)

/**
 * The sell page's three reads.
 *
 * `/sell` asks for its drafts and its live listings as two separate requests — `status=draft` and
 * `status=active` (`src/pages/sell.tsx`) — so the stub answers them from the query rather
 * than returning one body to both, which would render the same listing in both panels and let a
 * scenario pass against a page that had confused them.
 */
function sellRoutes(drafts: readonly unknown[] = [fx.listing({ status: 'draft' })]): Routes {
  return {
    'GET /auth/me': { body: fx.ME },
    // The gallery editor on each draft asks where a browser reaches micro-studio. Answered as a
    // deployment that HAS an address, because an unmatched route throws in this harness and every
    // sell scenario would then be asserting against a page showing an image-service error it was
    // not written to be about.
    'GET /v1/images/config': { body: fx.imageConfig() },
    'GET /v1/listings': (w) => ({
      body: { listings: /status=draft/.test(w.path) ? drafts : [] },
    }),
  }
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.5 Group E — Forge Market
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-MKT — Forge Market', () => {
  /**
   * ── WHERE DOC 22 IS WRONG ABOUT THIS SURFACE ─────────────────────────────────────────────────
   *
   * BJ-MKT-01's row reads: "the filter set offered is exactly the four the route reads, and there
   * is **no search box** — the route reads no text query, and a box that filtered fifty rows
   * client-side would imply an index that is not there (`market-web/src/pages/browse.tsx`)".
   *
   * The citation is right and the conclusion drawn from it is not. `browse.tsx` says: "the
   * route reads four filters and no text query and no page size, so a search box here filters
   * fifty listings rather than searching a catalogue. `searchScopeNote` says which, every time."
   * That is not "there is no box". There IS one — `<form role="search">` at `browse.tsx`, an
   * `<input type="search">` labelled "Filter these listings" — and the countermeasure against the
   * implied index is a sentence rendered beside every result count
   * (`src/lib/search.ts`): "This filters what is on this page rather than searching the
   * whole market — Forge Market has no text-search route."
   *
   * Asserting doc 22's literal wording would fail correct code, and a guard that fails on correct
   * code is a guard somebody deletes — the trap this repository's own `nginx.conf` header and its
   * "Money is never a float" CI step both record having already been caught by. So the scenario
   * is implemented against the property the citation actually supports: the box exists, and it
   * never renders a filtered count without saying what was filtered.
   */
  it('BJ-MKT-01 ★ T2: one card per listing, four filters, and the box says what it filtered', async () => {
    const listings = [
      fx.listing({ id: 'aaaaaaaa-0000-0000-0000-000000000001', itemUrn: 'urn:cf:item:one' }),
      fx.listing({ id: 'aaaaaaaa-0000-0000-0000-000000000002', itemUrn: 'urn:cf:item:two' }),
      fx.listing({ id: 'aaaaaaaa-0000-0000-0000-000000000003', itemUrn: 'urn:cf:item:three' }),
    ]
    await withScreen(
      page(h(BrowsePage), '/'),
      { url: `${ORIGIN}/`, routes: { 'GET /v1/listings': { body: { listings } } } },
      async (s) => {
        // Presentation RELATIVE TO WHAT THE API RETURNED IN THIS SAME RUN (doc 22 §3.1). Not
        // "three cards" — one per element of the response, whatever the response held.
        for (const l of listings) assert.ok(s.text().includes(l.itemUrn), `${l.itemUrn} has no row`)

        // The request carried none of the parameters the route would silently ignore. `limit` and
        // `q` are not read (`src/lib/market.ts`), and a client that sent one would believe
        // it had asked for something it did not get.
        const sent = s.api.matching('GET /v1/listings')[0]
        assert.ok(sent, 'the browse page made no request')
        const query = new URL(sent.url, ORIGIN).searchParams
        for (const forbidden of ['q', 'limit', 'page', 'search']) {
          assert.equal(query.get(forbidden), null, `the browse request carried ${forbidden}=`)
        }

        // The box exists, and the moment it narrows anything it says over what.
        const box = s.allByRole('textbox').find((el) => el.getAttribute('type') === 'search')
        assert.ok(box, 'the filter box is gone; searchScopeNote has nothing to qualify')
        await s.type(box, 'urn:cf:item:two')
        assert.match(
          s.text(),
          /filters what is on this page rather than searching the whole market/i,
          'the filter narrowed the list without saying the market was not searched — which is ' +
            'the "index that is not there" doc 22 BJ-MKT-01 is really about',
        )
        assert.ok(s.text().includes('urn:cf:item:two'))

        // The Kind filter is one of the four the route reads, so changing it asks the route
        // again rather than re-slicing what is already here. A control that looks like it filters
        // and does not is worse than no control.
        const kind = s.allByRole('combobox')[0]
        assert.ok(kind, 'the Kind filter is gone')
        await s.type(kind, 'game_item')
        const asked = s.api.matching('GET /v1/listings')
        assert.equal(
          asked.length,
          2,
          'changing the Kind filter issued no request — the select re-rendered the page and ' +
            'nothing was re-asked',
        )
        assert.match(asked[1]?.path ?? '', /assetKind=game_item/)

        s.clean('BJ-MKT-01')
      },
    )
  })

  it('BJ-MKT-11 T2: the seller’s own drafts render on /sell', async () => {
    const draft = fx.listing({ status: 'draft', itemUrn: 'urn:cf:token:hearth:testnet:0xdraft' })
    await withScreen(
      page(h(SellPage), '/sell'),
      { url: `${ORIGIN}/sell`, storage: fx.SIGNED_IN, routes: sellRoutes([draft]) },
      async (s) => {
        await s.settle(20)
        // The request is scoped to the signed-in seller's ledger subject — `user:<id>`, composed
        // in `src/lib/auth.tsx` from the id identity returned. A page that asked without it, or
        // spelled it `user-<id>`, gets an empty market and looks exactly like a seller with
        // nothing listed.
        const asked = s.api.matching('GET /v1/listings')
        assert.ok(asked.length >= 2, `the sell page asked ${asked.length} times, expected 2`)
        for (const call of asked) {
          assert.match(
            call.path,
            /sellerSubject=user%3Aaaaaaaaa/,
            'a sell-page read went out without the seller subject',
          )
        }
        assert.ok(
          s.text().includes(draft.itemUrn),
          'the seller’s own draft is not on their own page. Doc 22 BJ-MKT-11: the draft rows ' +
            'render on /sell and are absent from an anonymous /.',
        )
      },
    )
  })

  it('BJ-MKT-11 T2: an anonymous browse never asks for drafts', async () => {
    await withScreen(
      page(h(BrowsePage), '/'),
      { url: `${ORIGIN}/`, routes: { 'GET /v1/listings': { body: { listings: [fx.listing()] } } } },
      async (s) => {
        const asked = s.api.matching('GET /v1/listings')[0]
        assert.ok(asked)
        // `status` is OMITTED so the route's own default of `active` applies (server.ts).
        // Asking for drafts here would be showing sellers' unpublished work to buyers, and
        // sending `status=` empty would ask for a status no row has.
        assert.doesNotMatch(asked.path, /status=/)
        assert.doesNotMatch(asked.path, /sellerSubject=/)
        assert.equal(asked.headers.authorization, undefined)
      },
    )
  })

  it('BJ-MKT-02 ★ T1: the risk call fails; the listing still renders and is still buyable', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}/risk`]: {
            status: 503,
            body: fx.error('upstream_unavailable', 'the risk service did not answer'),
            requestId: 'req-risk-fail',
          },
        }),
      },
      async (s) => {
        // The listing itself is on screen.
        assert.ok(s.text().includes('urn:cf:token:hearth:testnet:0xabc'))
        // Still buyable: the control exists. Doc 22 BJ-MKT-02 — "the listing still renders and is
        // still buyable".
        assert.ok(s.queryByRole('button', 'Buy it now'), 'the Buy control was withdrawn by an unrelated failure')
        // And the page NAMES what is missing rather than showing less and saying nothing.
        assert.match(
          s.text(),
          /could not reach the chain/i,
          'the risk panel failed silently — the reader is not told the chain facts are missing',
        )
        assert.match(
          s.text(),
          /do not read the gap as reassurance/i,
          'a missing risk answer must not read as a clean one',
        )
      },
    )
  })

  it('BJ-MKT-03 ★ T1: the breakdown precedes the button, and the total submitted is the total shown', async () => {
    const detail = fx.detail()
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`POST /v1/listings/${fx.LISTING_ID}/buy`]: {
            status: 201,
            body: { order: fx.order(), replayed: false },
          },
        }),
      },
      async (s) => {
        // Doc 22: "platform fee and royalty split in bps are on screen BEFORE confirmation".
        s.before('How the money would divide', 'Take it', 'the split has to be readable before the commit')
        assert.match(s.text(), /platform fee[^%]{0,40}2\.5\s?%/i, 'the platform fee rate is not on screen')
        assert.match(s.text(), /royalty[^%]{0,40}5\s?%/i, 'the royalty split is not on screen')

        // The number the reader sees, formatted from the response's own string.
        const shown = formatMoney(BigInt(detail.listing.price ?? '0'), detail.listing.assetCode)
        assert.ok(s.text().includes(shown.text), `the price ${shown.text} is not rendered`)

        await s.click(s.byRole('button', 'Buy it now'))

        // …and the number the client SENT. Byte-identical to the response's own string, which is
        // what closes the loop: the same bigint produced the rendered text and the request body.
        const posted = s.api.matching(`POST /v1/listings/${fx.LISTING_ID}/buy`)
        assert.equal(posted.length, 1)
        assert.equal(
          (posted[0]?.json as { amount?: string } | undefined)?.amount,
          detail.listing.price,
          'the amount submitted is not the amount the page displayed',
        )
      },
    )
  })

  it('BJ-MKT-04 ★ T1: double-click Buy sends one key and makes one order', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`POST /v1/listings/${fx.LISTING_ID}/buy`]: (_w, n) => ({
            status: n === 1 ? 201 : 200,
            body: { order: fx.order(), replayed: n > 1 },
            delayMs: 5,
          }),
        }),
      },
      async (s) => {
        const buy = s.byRole('button', 'Buy it now')
        // Both presses land before the first response — which is the hazard. `clickNoFlush` is
        // deliberate: awaiting between them would test a case a double-click never produces.
        s.clickNoFlush(buy)
        s.clickNoFlush(buy)
        await s.settle(30)

        const posted = s.api.matching(`POST /v1/listings/${fx.LISTING_ID}/buy`)
        assert.ok(posted.length >= 1, 'the Buy button sent nothing')
        // The assertion doc 22 makes: ONE key across every attempt of one intent. Whether the
        // button also guards itself with `busy` is this app's business; the key is the contract,
        // and `market/src/server.ts` collapses the duplicates on the strength of it.
        const keys = new Set(posted.map((p) => p.headers['idempotency-key']))
        assert.equal(
          keys.size,
          1,
          `two clicks on one intent sent ${keys.size} idempotency keys: ${[...keys].join(', ')}. ` +
            `A key minted per fetch means two clicks are two orders — src/lib/idempotency.ts.`,
        )
        assert.match([...keys][0] ?? '', /^market-web:buy:/)
      },
    )
  })

  it('BJ-MKT-05 T1: a replay reads back the first order and is not rendered as an error', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`POST /v1/listings/${fx.LISTING_ID}/buy`]: {
            status: 200,
            body: { order: fx.order(), replayed: true },
          },
        }),
      },
      async (s) => {
        await s.click(s.byRole('button', 'Buy it now'))
        const outcome = s.document.querySelector('[role="status"], [role="alert"]')
        assert.ok(outcome, 'pressing Buy produced no outcome message at all')
        assert.equal(
          outcome.getAttribute('role'),
          'status',
          'a replay was announced as an alert — `replayed: true` is the service doing its job',
        )
        assert.match(s.textOf(outcome), /you have not been charged twice/i)
      },
    )
  })

  it('BJ-MKT-06 T1: a 409 idempotency_key_reused IS an error, because it is this client’s bug', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`POST /v1/listings/${fx.LISTING_ID}/buy`]: {
            status: 409,
            body: fx.error(
              'idempotency_key_reused',
              'that idempotency key was used with a different request body',
            ),
            requestId: 'req-reused-01',
          },
        }),
      },
      async (s) => {
        await s.click(s.byRole('button', 'Buy it now'))
        const alert = s.document.querySelector('[role="alert"]')
        assert.ok(alert, 'a reused key was not announced as an alert')
        assert.match(s.textOf(alert), /different request body/i)
        // BJ-ADV-23 in miniature: the id to quote is on screen.
        assert.match(s.textOf(alert), /req-reused-01/)
      },
    )
  })

  it('BJ-MKT-07 T1: after a settled purchase the intent is renewed, so nothing re-arms against it', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`POST /v1/listings/${fx.LISTING_ID}/buy`]: {
            status: 201,
            body: { order: fx.order(), replayed: false },
          },
        }),
      },
      async (s) => {
        const buy = s.byRole('button', 'Buy it now')
        await s.click(buy)
        // The order is settled and the page offers the way onward.
        assert.ok(s.queryByRole('link', 'Open the order'), 'a settled purchase offers no route to the order')

        // Pressing again is a NEW intent, not a re-arm of the settled one. That is the property
        // that makes a back-button harmless here: there is no second step holding the old key.
        await s.click(s.byRole('button', 'Buy it now'))
        const posted = s.api.matching(`POST /v1/listings/${fx.LISTING_ID}/buy`)
        assert.equal(posted.length, 2)
        assert.notEqual(
          posted[0]?.headers['idempotency-key'],
          posted[1]?.headers['idempotency-key'],
          'a second purchase reused the settled intent’s key, which the service would replay — ' +
            'the buyer would be shown an order they did not just make',
        )
      },
    )
  })

  it('BJ-MKT-09 ★ T1: activation with the indexer unavailable says we could not confirm', async () => {
    await withScreen(
      page(h(SellPage), '/sell'),
      {
        url: `${ORIGIN}/sell`,
        storage: fx.SIGNED_IN,
        routes: {
          ...sellRoutes(),
          [`POST /v1/listings/${fx.LISTING_ID}/activate`]: {
            status: 503,
            body: fx.error('indexer_unavailable', 'the chain index did not answer'),
            requestId: 'req-503-01',
          },
        },
      },
      async (s) => {
        await s.settle(20)
        await s.click(s.byRole('button', 'Activate'))
        const text = s.text()
        assert.match(text, /could not confirm/i)
        assert.match(
          text,
          /it is a statement that we do not know/i,
          '"could not confirm" and "not confirmed" are different sentences about different worlds',
        )
        assert.match(text, /nothing was changed/i)
      },
    )
  })

  it('BJ-MKT-10 ★ T1: a 409 state_conflict is a different sentence, tone and action', async () => {
    const said = async (reply: { status: number; body: unknown }): Promise<string> => {
      let captured = ''
      await withScreen(
        page(h(SellPage), '/sell'),
        {
          url: `${ORIGIN}/sell`,
          storage: fx.SIGNED_IN,
          routes: { ...sellRoutes(), [`POST /v1/listings/${fx.LISTING_ID}/activate`]: reply },
        },
        async (s) => {
          await s.settle(20)
          await s.click(s.byRole('button', 'Activate'))
          captured = s.text()
        },
      )
      return captured
    }

    const unavailable = await said({
      status: 503,
      body: fx.error('indexer_unavailable', 'the chain index did not answer'),
    })
    const conflict = await said({
      status: 409,
      // The service's own sentence, not an invented one: `market/src/server.ts` composes
      // exactly this, and `src/lib/escrow.ts` matches on it. A fixture that paraphrased would
      // take the `other_conflict` branch and this scenario would assert the wrong screen.
      body: fx.error(
        'state_conflict',
        'the on-chain escrow is not confirmed yet (2 of 6 confirmations)',
      ),
    })

    assert.match(conflict, /the chain index answered/i)
    assert.match(conflict, /not confirmed yet/i)
    assert.match(conflict, /activate again/i)
    assert.ok(
      !/it is a statement that we do not know/i.test(conflict),
      'the 409 borrowed the 503’s wording. The estate has already spent a release on a client ' +
        'that reported the two as one.',
    )
    assert.notEqual(unavailable, conflict, 'the two activation failures render identically')
  })

  it('BJ-MKT-12 T1: a raised dispute names the two visible facts and invents no status', async () => {
    await withScreen(
      page(h(OrdersPage), `/orders/${fx.ORDER_ID}`),
      {
        url: `${ORIGIN}/orders/${fx.ORDER_ID}`,
        storage: fx.SIGNED_IN,
        routes: {
          'GET /auth/me': { body: fx.ME },
          [`GET /v1/orders/${fx.ORDER_ID}`]: { body: { order: fx.order() } },
          [`POST /v1/orders/${fx.ORDER_ID}/disputes`]: {
            status: 201,
            body: {
              dispute: {
                id: 'dispute-1',
                orderId: fx.ORDER_ID,
                raiserSubject: fx.BUYER,
                reason: 'not_as_described',
                state: 'open',
                openedAt: '2026-07-05T09:00:00.000Z',
              },
              replayed: false,
            },
          },
        },
      },
      async (s) => {
        const reason = s.allByRole('combobox')[0] ?? s.allByRole('textbox')[0]
        if (reason) await s.type(reason, 'not_as_described')
        await s.click(s.byRole('button', /flag this sale/i))
        const text = s.text()
        // The two facts that ARE visible to the parties.
        assert.match(text, /proceeds/i)
        assert.match(text, /frozen/i)
        // And the honest limit. `GET /v1/disputes` requires an operator (server.ts), so this
        // surface cannot read the dispute's state back and must not imply that it can.
        assert.match(
          text,
          /will not be able to follow it on this page/i,
          'the page invented a dispute status. GET /v1/disputes needs an operator ' +
            '(market/src/server.ts), so this surface cannot read one back.',
        )
      },
    )
  })

  it('BJ-MKT-13 T1: re-opening the orders page issues no write', async () => {
    const routes: Routes = {
      'GET /auth/me': { body: fx.ME },
      [`GET /v1/orders/${fx.ORDER_ID}`]: { body: { order: fx.order() } },
    }
    await withScreen(
      page(h(OrdersPage), `/orders/${fx.ORDER_ID}`),
      { url: `${ORIGIN}/orders/${fx.ORDER_ID}`, storage: fx.SIGNED_IN, routes },
      async (s) => {
        // No stub for POST is registered at all, so a write would throw rather than be silently
        // absorbed — the harness refuses unrouted requests for exactly this reason.
        const writes = s.api.wire.filter((w) => w.method !== 'GET')
        assert.deepEqual(
          writes.map((w) => `${w.method} ${w.path}`),
          [],
          'opening an order wrote something. A re-POST under the old key to scrape the stored ' +
            'response is a write dressed up as a read — src/pages/orders.tsx.',
        )
      },
    )
  })

  it('BJ-MKT-14 T2: the collections index renders anonymously', async () => {
    await withScreen(
      page(h(CollectionsPage), '/collections'),
      {
        url: `${ORIGIN}/collections`,
        routes: {
          'GET /v1/collections': {
            body: {
              collections: [
                {
                  id: 'c-1',
                  ownerSubject: fx.SELLER,
                  slug: 'first-drop',
                  name: 'First drop',
                  description: 'The first set.',
                  royalties: [{ subject: fx.SELLER, bps: 500 }],
                },
              ],
            },
          },
          'GET /v1/listings': { body: { listings: [fx.listing()] } },
        },
      },
      async (s) => {
        assert.ok(s.text().length > 40)
        // No credential went out. A shopfront nobody can link to cannot do the one job it has.
        for (const w of s.api.wire) {
          assert.equal(
            w.headers.authorization,
            undefined,
            `${w.path} carried an Authorization header on an anonymous read`,
          )
        }
      },
    )
  })

  it('BJ-MKT-15 T1: the fees page makes no request and cannot fail', async () => {
    await withScreen(page(h(FeesPage), '/fees'), { url: `${ORIGIN}/fees`, routes: {} }, async (s) => {
      assert.deepEqual(
        s.api.wire.map((w) => `${w.method} ${w.path}`),
        [],
        'the fees page made a request. A rate fetched here would look like the rate on a sale, ' +
          'and it is not — the listing carries the snapshot.',
      )
      assert.match(s.text(), /250 basis points/i)
      assert.match(
        s.text(),
        /stamped onto it/i,
        'the page must say these figures are the platform position rather than the rate charged',
      )
    })
  })

  it('BJ-MKT-16 T1: an auction with a leading bid renders the caveat beside the figure', async () => {
    const auction = {
      pricingMode: 'auction' as const,
      auctionEndsAt: '2099-01-01T00:00:00.000Z',
      price: '1000000000000000000',
    }
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail(auction) },
          [`GET /v1/listings/${fx.LISTING_ID}/bids`]: { body: { bids: [fx.bid()] } },
        }),
      },
      async (s) => {
        const shown = formatMoney(BigInt(fx.bid().amount), 'CFG')
        assert.ok(s.text().includes(shown.text), 'the leading bid figure is not rendered')
        // The caveat, beside the figure rather than omitted.
        assert.match(s.text(), /leading bid/i)
        assert.match(
          s.text(),
          /a leading bid is not a final price/i,
          'the leading-bid figure is rendered without the caveat that goes beside it every time ' +
            '(src/lib/auction.ts)',
        )
        s.before(
          'Leading bid',
          'A leading bid is not a final price',
          'the caveat belongs beside the figure, not before anyone knows what it qualifies',
        )
      },
    )
  })

  it('BJ-MKT-17 T1: a moderated listing renders the notice and offers no buy control', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail({ frozen: true }) },
        }),
      },
      async (s) => {
        // Presentation, relative to what the API returned: `frozen: true` came back, so the
        // notice is on screen. This is NOT an assertion that the purchase would be refused —
        // that rule is `market/src/moderation.ts`'s and is cited in ownedBy.
        assert.match(s.text(), /under review/i)
        assert.equal(
          s.queryByRole('button', 'Buy it now'),
          null,
          'a frozen listing still offered a Buy control',
        )
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.19 Group S — the adversarial matrix
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-ADV — the adversarial matrix', () => {
  it('BJ-ADV-01-H1 ★ T1: the bid form under a double-submit sends one key', async () => {
    const auction = {
      pricingMode: 'auction' as const,
      auctionEndsAt: '2099-01-01T00:00:00.000Z',
      price: '1000000000000000000',
    }
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail(auction) },
          [`POST /v1/listings/${fx.LISTING_ID}/bids`]: (_w, n) => ({
            status: n === 1 ? 201 : 200,
            body: { bid: fx.bid(), replayed: n > 1, outbid: null, auctionEndsAt: null },
            delayMs: 5,
          }),
        }),
      },
      async (s) => {
        await s.type(s.allByRole('textbox')[0] as Element, '2000000000000000000')
        const button = s.byRole('button', 'Place this bid')
        s.clickNoFlush(button)
        s.clickNoFlush(button)
        await s.settle(30)
        const keys = new Set(
          s.api.matching(`POST /v1/listings/${fx.LISTING_ID}/bids`).map((p) => p.headers['idempotency-key']),
        )
        assert.equal(keys.size, 1, `a double-submitted bid sent ${keys.size} keys`)
      },
    )
  })

  it('BJ-ADV-01-H2 ★ T1: the amount posted is the amount in the field, never a re-parsed one', async () => {
    const auction = {
      pricingMode: 'auction' as const,
      auctionEndsAt: '2099-01-01T00:00:00.000Z',
      price: '1000000000000000000',
    }
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail(auction) },
          [`POST /v1/listings/${fx.LISTING_ID}/bids`]: {
            status: 201,
            body: { bid: fx.bid(), replayed: false, outbid: null, auctionEndsAt: null },
          },
        }),
      },
      async (s) => {
        const field = s.allByRole('textbox')[0] as Element
        await s.type(field, '2000000000000000001')
        await s.click(s.byRole('button', 'Place this bid'))
        const posted = s.api.matching(`POST /v1/listings/${fx.LISTING_ID}/bids`)[0]
        assert.equal(
          (posted?.json as { amount?: string } | undefined)?.amount,
          '2000000000000000001',
          'the bid submitted is not the bid typed. The bottom digit of an 18-decimal value is ' +
            'exactly where a fee and a royalty land.',
        )
        // The intent renews after a success, so the field is armed for a NEW intent rather than
        // holding the settled one.
        assert.equal(
          (field as unknown as { value: string }).value,
          '2000000000000000001',
          'the form cleared under the user after a success',
        )
      },
    )
  })

  it('BJ-ADV-01-H4 ★ T1: a failed buy reverts to a stated failure with its request id', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`POST /v1/listings/${fx.LISTING_ID}/buy`]: {
            status: 500,
            body: fx.error('internal', 'the ledger did not answer'),
            requestId: 'req-buyfail-77',
          },
        }),
      },
      async (s) => {
        await s.click(s.byRole('button', 'Buy it now'))
        const alert = s.document.querySelector('[role="alert"]')
        assert.ok(alert, 'a failed purchase left no failure on screen')
        assert.match(s.textOf(alert), /the ledger did not answer/i)
        assert.match(s.textOf(alert), /req-buyfail-77/)
        // The button is armed again rather than left saying "Buying…" for ever.
        assert.ok(s.queryByRole('button', 'Buy it now'), 'the control was left in its busy state')
      },
    )
  })

  it('BJ-ADV-01-H6 ★ T1: with the listing read degraded the page states it rather than offering a dead control', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: {
            status: 503,
            body: fx.error('upstream_unavailable', 'micro-market did not answer'),
            requestId: 'req-degraded-1',
          },
        }),
      },
      async (s) => {
        assert.equal(s.queryByRole('button', 'Buy it now'), null, 'a Buy control was offered over a failed read')
        const alert = s.document.querySelector('[role="alert"]')
        assert.ok(alert, 'a failed listing read produced no alert')
        assert.match(s.textOf(alert), /req-degraded-1/, 'the failure carries no request id to quote')
        assert.ok(s.queryByRole('button', 'Try again'), 'a retryable failure offers no retry')
      },
    )
  })

  it('BJ-ADV-02-H1 T1: creating a listing under a double-submit sends one key', async () => {
    await withScreen(
      page(h(SellPage), '/sell'),
      {
        url: `${ORIGIN}/sell`,
        storage: fx.SIGNED_IN,
        routes: {
          ...sellRoutes([]),
          'POST /v1/listings': (_w, n) => ({
            status: n === 1 ? 201 : 200,
            body: { listing: fx.listing({ status: 'draft' }), replayed: n > 1 },
            delayMs: 5,
          }),
        },
      },
      async (s) => {
        await s.settle(20)
        await fillSellForm(s)
        const create = s.byRole('button', /save this as a draft/i)
        s.clickNoFlush(create)
        s.clickNoFlush(create)
        await s.settle(30)
        const keys = new Set(s.api.matching('POST /v1/listings').map((p) => p.headers['idempotency-key']))
        assert.equal(keys.size, 1, `a double-submitted create sent ${keys.size} keys`)
      },
    )
  })

  it('BJ-ADV-02-H4 T1: a failed create leaves the form’s values and states the failure', async () => {
    await withScreen(
      page(h(SellPage), '/sell'),
      {
        url: `${ORIGIN}/sell`,
        storage: fx.SIGNED_IN,
        routes: {
          ...sellRoutes([]),
          'POST /v1/listings': {
            status: 422,
            body: fx.error('invalid_argument', 'that item urn is not one this seller owns'),
            requestId: 'req-create-fail',
          },
        },
      },
      async (s) => {
        await s.settle(20)
        const urn = await fillSellForm(s)
        await s.click(s.byRole('button', /save this as a draft/i))
        assert.match(s.text(), /that item urn is not one this seller owns/i)
        assert.match(s.text(), /req-create-fail/)
        // 05:91 makes form-state preservation the requirement, and a form that clears on a
        // refusal is the failure. Asserted here because this is the one form in this repo where a
        // refusal is likely and the retyping is long.
        assert.ok(
          s.text().includes(urn) || fieldValues(s).includes(urn),
          'the form cleared its values on a refusal',
        )
      },
    )
  })

  it('BJ-ADV-02-H6 T1: a slow indexer leaves nothing hanging and says which state it is in', async () => {
    await withScreen(
      page(h(SellPage), '/sell'),
      {
        url: `${ORIGIN}/sell`,
        storage: fx.SIGNED_IN,
        routes: {
          'GET /auth/me': { body: fx.ME },
          'GET /v1/listings': (w) => ({
            body: { listings: /status=draft/.test(w.path) ? [fx.listing({ status: 'draft' })] : [] },
            delayMs: 25,
          }),
        },
      },
      async (s) => {
        // Mounted while the read is still in flight: the page paints, and the pending read says so.
        assert.ok(s.text().length > 40, 'the page did not paint while its read was slow')
        await s.settle(60)
        assert.match(s.text(), /draft/i, 'the slow read never resolved into the rendered listing')
      },
    )
  })

  it('BJ-ADV-03-H1 T1: raising a dispute twice sends one key', async () => {
    await withScreen(
      page(h(OrdersPage), `/orders/${fx.ORDER_ID}`),
      {
        url: `${ORIGIN}/orders/${fx.ORDER_ID}`,
        storage: fx.SIGNED_IN,
        routes: {
          'GET /auth/me': { body: fx.ME },
          [`GET /v1/orders/${fx.ORDER_ID}`]: { body: { order: fx.order() } },
          [`POST /v1/orders/${fx.ORDER_ID}/disputes`]: (_w, n) => ({
            status: n === 1 ? 201 : 200,
            body: {
              dispute: {
                id: 'dispute-1',
                orderId: fx.ORDER_ID,
                raiserSubject: fx.BUYER,
                reason: 'not_as_described',
                state: 'open',
                openedAt: '2026-07-05T09:00:00.000Z',
              },
              replayed: n > 1,
            },
            delayMs: 5,
          }),
        },
      },
      async (s) => {
        const reason = s.allByRole('combobox')[0] ?? s.allByRole('textbox')[0]
        if (reason) await s.type(reason, 'not_as_described')
        const button = s.byRole('button', /flag this sale/i)
        s.clickNoFlush(button)
        s.clickNoFlush(button)
        await s.settle(30)
        const keys = new Set(
          s.api
            .matching(`POST /v1/orders/${fx.ORDER_ID}/disputes`)
            .map((p) => p.headers['idempotency-key']),
        )
        assert.equal(keys.size, 1, `a double-submitted dispute sent ${keys.size} keys`)
      },
    )
  })

  it('BJ-ADV-03-H2 T1: a raised dispute renews the intent, so nothing re-arms against it', async () => {
    await withScreen(
      page(h(OrdersPage), `/orders/${fx.ORDER_ID}`),
      {
        url: `${ORIGIN}/orders/${fx.ORDER_ID}`,
        storage: fx.SIGNED_IN,
        routes: {
          'GET /auth/me': { body: fx.ME },
          [`GET /v1/orders/${fx.ORDER_ID}`]: { body: { order: fx.order() } },
          [`POST /v1/orders/${fx.ORDER_ID}/disputes`]: {
            status: 201,
            body: {
              dispute: {
                id: 'dispute-1',
                orderId: fx.ORDER_ID,
                raiserSubject: fx.BUYER,
                reason: 'not_as_described',
                state: 'open',
                openedAt: '2026-07-05T09:00:00.000Z',
              },
              replayed: false,
            },
          },
        },
      },
      async (s) => {
        const reason = s.allByRole('textbox')[0] as Element
        await s.type(reason, 'not as described')
        await s.click(s.byRole('button', /flag this sale/i))
        // The commit control is GONE once the dispute is raised — replaced by the confirmation,
        // not left disabled beside it. There is nothing on the page a back-button could re-arm,
        // which is what H2 is about: "the previous step does not re-arm a second commit against
        // a settled intent".
        assert.equal(
          s.queryByRole('button', /raise/i),
          null,
          'the Raise control survives a raised dispute — one complaint becoming two disputes ' +
            'freezes the listing twice',
        )
        assert.match(s.text(), /raised/i)
      },
    )
  })

  it('BJ-ADV-03-H4 T1: a failed dispute states the failure and keeps the order rendered', async () => {
    await withScreen(
      page(h(OrdersPage), `/orders/${fx.ORDER_ID}`),
      {
        url: `${ORIGIN}/orders/${fx.ORDER_ID}`,
        storage: fx.SIGNED_IN,
        routes: {
          'GET /auth/me': { body: fx.ME },
          [`GET /v1/orders/${fx.ORDER_ID}`]: { body: { order: fx.order() } },
          [`POST /v1/orders/${fx.ORDER_ID}/disputes`]: {
            status: 503,
            body: fx.error('upstream_unavailable', 'moderation did not answer'),
            requestId: 'req-dispute-fail',
          },
        },
      },
      async (s) => {
        await s.type(s.allByRole('textbox')[0] as Element, 'not as described')
        await s.click(s.byRole('button', /flag this sale/i))
        const alert = s.document.querySelector('[role="alert"]')
        assert.ok(alert, 'a failed dispute left nothing on screen')
        assert.match(s.textOf(alert), /moderation did not answer/i)
        assert.match(s.textOf(alert), /req-dispute-fail/)
        // The order itself is still rendered. A failed write that blanks the page it was made
        // from is the failure H4 names.
        assert.ok(s.text().includes(fx.ORDER_ID.slice(0, 8)) || /proceeds/i.test(s.text()))
        // And the control is armed again rather than left saying "Opening…".
        assert.ok(s.queryByRole('button', /flag this sale/i))
      },
    )
  })

  it('BJ-ADV-22 ★ T1: every tile paints while its own read is slow', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}/risk`]: { body: fx.risk(), delayMs: 40 },
          [`GET /v1/listings/${fx.LISTING_ID}/offers`]: { body: { offers: [] }, delayMs: 40 },
        }),
      },
      async (s) => {
        // The listing painted with two of its four reads still in flight.
        assert.ok(s.text().includes('urn:cf:token:hearth:testnet:0xabc'))
        assert.ok(s.queryByRole('button', 'Buy it now'), 'the page waited for an unrelated slow read')
        // And the slow ones are marked pending rather than rendered as absent or as zero.
        assert.match(s.text(), /looking the item up on chain|reading them/i)
        await s.settle(80)
        assert.match(s.text(), /verified/i, 'the slow read never landed')
      },
    )
  })

  it('BJ-ADV-23 ★ T1: every failure state on this surface offers a request id', async () => {
    // One mount per failure surface, so a shared component passing once cannot cover for a page
    // that drops the id.
    const cases: ReadonlyArray<{ name: string; el: () => ReactElement; url: string; routes: Routes }> = [
      {
        name: 'the listing read',
        el: () => listingAt(),
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: {
            status: 500,
            body: fx.error('internal', 'it broke'),
            requestId: 'req-a',
          },
        }),
      },
      {
        name: 'the browse read',
        el: () => page(h(BrowsePage), '/'),
        url: `${ORIGIN}/`,
        routes: {
          'GET /v1/listings': { status: 500, body: fx.error('internal', 'it broke'), requestId: 'req-b' },
        },
      },
      {
        name: 'the orders read',
        el: () => page(h(OrdersPage), '/orders'),
        url: `${ORIGIN}/orders`,
        routes: {
          'GET /auth/me': { body: fx.ME },
          'GET /v1/orders': { status: 500, body: fx.error('internal', 'it broke'), requestId: 'req-c' },
        },
      },
    ]
    for (const c of cases) {
      await withScreen(
        c.el(),
        { url: c.url, storage: fx.SIGNED_IN, routes: c.routes },
        async (s) => {
          assert.match(
            s.text(),
            /Quote this to support/i,
            `${c.name} failed without offering the request id to quote`,
          )
          assert.match(s.text(), /req-[abc]/, `${c.name} rendered the label but not the id`)
        },
      )
    }
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.20 Group T — accessibility
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-A11Y — accessibility', () => {
  it('BJ-A11Y-03 ★ T1: a degraded tile is announced, and a failure is not colour-only', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: {
            status: 500,
            body: fx.error('internal', 'it broke'),
            requestId: 'req-a11y',
          },
        }),
      },
      async (s) => {
        const alert = s.document.querySelector('[role="alert"]')
        assert.ok(alert, 'a failure was rendered with no live region, so it is never announced')
        // Not colour-only: the failure carries words, not just a tone class.
        assert.ok(
          s.textOf(alert).length > 20,
          'the failure state is styling with no sentence in it — colour would be the only channel',
        )
      },
    )
  })

  it('BJ-A11Y-10 T1: every state chip carries a word, not only a colour', async () => {
    await withScreen(
      listingAt(),
      { url: `${ORIGIN}/listings/${fx.LISTING_ID}`, routes: listingRoutes() },
      async (s) => {
        const chips = [...s.document.querySelectorAll('[class*="badge" i], [class*="chip" i]')]
        assert.ok(chips.length > 0, 'no state chips on a page that renders a listing status')
        for (const chip of chips) {
          assert.ok(
            s.textOf(chip).length > 0,
            `a chip rendered with no text: ${chip.outerHTML.slice(0, 120)}. Colour is never the ` +
              `only channel — ui/packages/ui/src/surfaces.ts.`,
          )
        }
      },
    )
  })

  it('BJ-A11Y-12 T1: one main landmark, a reachable skip link, and no skipped heading level', async () => {
    await withScreen(
      h(App),
      {
        url: `${ORIGIN}/fees`,
        routes: {},
      },
      async (s) => {
        assert.equal(s.allByRole('main').length, 1, 'a surface has exactly one main landmark')

        const skip = s.document.querySelector('a[href^="#"]')
        assert.ok(skip, 'no skip link')
        const target = s.document.getElementById((skip.getAttribute('href') ?? '#').slice(1))
        assert.ok(target, `the skip link points at ${skip.getAttribute('href')}, which is not on the page`)
        // Reachable: it is the first thing in the tab order, or nobody using a keyboard finds it.
        assert.equal(
          s.tabbables()[0],
          skip,
          'the skip link is not the first tabbable element, so it cannot be used to skip anything',
        )

        const levels = s.allByRole('heading').map((el) => Number(el.tagName.slice(1)))
        assert.ok(levels.length > 0, 'the page has no headings at all')
        assert.equal(levels.filter((l) => l === 1).length, 1, 'a page has exactly one h1')
        let previous = 0
        for (const level of levels) {
          assert.ok(
            previous === 0 || level <= previous + 1,
            `heading order skips from h${previous} to h${level}`,
          )
          previous = level
        }
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   5.1 — the universal per-surface property
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-MARKET-404 — an unowned address answers 404', () => {
  /** nginx.conf with its comments stripped: the header quotes the directive it forbids. */
  const directives = readFileSync(at('nginx.conf'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

  it('BJ-MARKET-404 T2: nginx serves the shell through error_page 404, never try_files', () => {
    assert.match(
      directives,
      /error_page\s+404\s+\/index\.html/,
      'the SPA fallback must keep the 404 status',
    )
    assert.doesNotMatch(
      directives,
      /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/,
      '`try_files $uri /index.html` answers 200 for every address in existence, which is exactly ' +
        'what doc 22 §5.1 says has broken surfaces before',
    )
  })

  it('BJ-MARKET-404 T2: the not-found screen renders inside the shell for an unowned address', async () => {
    await withScreen(h(App), { url: `${ORIGIN}/nothing-here`, routes: {} }, async (s) => {
      assert.match(s.text(), /not found|no page|does not exist/i)
      // The reader keeps the navigation they need to get back out.
      assert.ok(s.allByRole('link').length > 0, 'the not-found screen strands the reader')
      // And the status is nginx's doing, not the router's — asserted above, and the route table
      // this test reads is the one nginx is generated against (test/routes.test.ts).
      const owned = ROUTES.map((r) => r.path)
      assert.ok(!owned.includes('nothing-here'))
    })
  })
})

describe('BJ-MINE-LINK — browser mining is offered from the bar', () => {
  /**
   * The owner's report was that starting a browser miner is "hidden deep in mining page". It now
   * has a place in the one piece of chrome every surface renders, immediately before the account.
   *
   * What this surface can honestly assert is the whole of what this surface does: the control is
   * present on an ordinary address, it is a real ANCHOR to the surface that hosts the miner, and
   * it claims no payment. The session itself belongs to `hub.<apex>` — a different origin — and is
   * asserted in micro-hub-web by BJ-MINE-01..07, which mount the miner and press it.
   */
  it('BJ-MINE-LINK T1: the bar links to the mining surface, beside the account, promising nothing', async () => {
    await withScreen(h(App), { url: `${ORIGIN}/`, routes: { 'GET /v1/listings': { body: { listings: [fx.listing()] } } } }, async (s) => {
      const bar = s.document.querySelector('.cf-bar')
      assert.ok(bar, 'this surface no longer renders the company bar at all')

      const found = [...bar.querySelectorAll('.cf-mine')]
      assert.equal(
        found.length,
        1,
        `expected one mining control in the bar, found ${found.length}. The owner's report was ` +
          'that browser mining was reachable only from deep inside one page',
      )
      const mine = found[0] as Element

      // ── A LINK, NOT AN onClick ──────────────────────────────────────────────────────────────
      // The account entry spent four months as a `<button>` pointing at the wrong place precisely
      // because a destination expressed as a handler is invisible to everything that reads links
      // (micro-hub-web `test/account-link.test.ts`). This one is an anchor or it is nothing.
      assert.equal(
        mine.tagName.toLowerCase(),
        'a',
        'the mining control is not an anchor, so it cannot be middle-clicked, copied or crawled',
      )

      // ── AND IT POINTS AT THE SURFACE THAT CAN ACTUALLY MINE ─────────────────────────────────
      // Resolved through the registry, never written out: this bundle is served from localhost,
      // from a preview host and from the apex, and a literal would be right on one of them.
      assert.equal(
        mine.getAttribute('href'),
        `${hosts().hub}${HUB_MINE_PATH}`,
        'the mining control does not point at Forge Hub’s mining address',
      )

      // ── AND IT IS BESIDE THE ACCOUNT, WHICH IS THE WHOLE OF THE CHANGE ──────────────────────
      // Asserted as TAB ORDER rather than as a CSS neighbour, because that is the property a
      // reader has: the mining control is the last thing before the account on every surface. A
      // stylesheet can move a box; only document order moves this.
      const order = s.tabbables()
      const account = s.byRole('button', 'Sign in')
      assert.equal(
        order.indexOf(account) - order.indexOf(mine),
        1,
        'the mining control is no longer immediately before the account in the tab order',
      )

      // ── AND IT PROMISES NOTHING THE POOL DOES NOT PAY ───────────────────────────────────────
      // `pool/src/payouts.ts` derives `payoutsImplemented` and it is false today, so any surface
      // that implies settlement is a defect. The clause is the design system's own exported
      // string rather than a paraphrase this repository keeps a second copy of.
      const description = s.document.getElementById(mine.getAttribute('aria-describedby') ?? '')
      assert.ok(description, 'the mining control carries no description for a screen reader')
      assert.ok(
        (description.textContent ?? '').includes(NOT_PAID_CLAUSE),
        'the mining control does not carry the not-paid clause, on a surface where every other ' +
          'number on screen is money',
      )
      // No currency mark and no figure anywhere in the control. On a marketplace, a number beside
      // the word Mine is read as what the mining is worth.
      const shown = `${mine.textContent ?? ''} ${description.textContent ?? ''}`
      assert.doesNotMatch(
        shown,
        /[$€£]|\d/,
        `the mining control shows a figure (${shown.trim()}), and nothing is paid`,
      )

      s.clean('the bar’s mining control')
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The meta-test. Doc 22 §3.2.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Listing images — not a doc 22 scenario
   ══════════════════════════════════════════════════════════════════════════════════════════════

   Doc 22 predates galleries and assigns no id to them, and an id invented here would fail the
   catalogue meta-test below — correctly, because that test is what stops this file and doc 22
   drifting apart. So these are plain scenarios in the same tier-1 shape: the bundle, a document,
   and stubbed responses, asserting TEXT, DOCUMENT ORDER and ACCESSIBLE NAMES, which is what doc 22
   §3.1 allows.

   The second one is the important one, and it is about a claim rather than a pixel. An image on
   this surface has a RECORDED content address and NOT a chain attestation — Hearth has no Registry
   of Authorship contract, so studio's `anchor.state` is `'unanchored'` on every asset in existence.
   A tick that always appears, on a page where people spend real money, is worse than no tick. This
   asserts the words are absent, so adding one has to break a test.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('a listing gallery', () => {
  it('renders one image per gallery entry, in position order, from studio', async () => {
    const images = [
      fx.image({ studioAssetId: 'aaaaaaaa-0000-4000-8000-000000000001', position: 0 }),
      fx.image({ studioAssetId: 'aaaaaaaa-0000-4000-8000-000000000002', position: 1 }),
    ]
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: { body: { ...fx.detail(), images } },
        }),
      },
      async (s) => {
        const rendered = [...s.document.querySelectorAll('img.mk-gallery__img')]
        assert.equal(rendered.length, images.length)
        // Document order IS gallery order. A `sort` that got lost would show a seller's third
        // photograph first, which on a marketplace is a different item to a scrolling buyer.
        assert.deepEqual(
          rendered.map((img) => img.getAttribute('src')),
          images.map((image) => image.bytesUrl),
        )
        // Every one is described. An `<img>` with no alt is invisible to a screen reader and
        // indistinguishable from a broken one to everybody else.
        for (const img of rendered) {
          assert.ok((img.getAttribute('alt') ?? '').length > 0, 'an image has no alt text')
        }
      },
    )
  })

  it('never calls an image verified, attested, anchored or on-chain', async () => {
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: {
            body: { ...fx.detail(), images: [fx.image()] },
          },
        }),
      },
      async (s) => {
        const text = s.text().toLowerCase()
        for (const claim of ['attested', 'anchored', 'on-chain', 'verified image']) {
          assert.equal(text.includes(claim), false, `the listing page claims "${claim}"`)
        }
        // And the checksum is not paraded either: it is an identifier, and a 64-character hex
        // string beside a photograph reads as a proof to anybody who does not know better.
        assert.equal(text.includes('sha256:'), false)
      },
    )
  })

  it('says images are unavailable rather than pretending there are none', async () => {
    // `bytesUrl: null` is what every deployment returns today — `STUDIO_PUBLIC_URL` is unset,
    // because studio has no public hostname in the estate. Rendering nothing would tell a seller
    // who uploaded six photographs that their work had vanished.
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [`GET /v1/listings/${fx.LISTING_ID}`]: {
            body: { ...fx.detail(), images: [fx.image({ bytesUrl: null })] },
          },
        }),
      },
      async (s) => {
        assert.equal(s.document.querySelectorAll('img.mk-gallery__img').length, 0)
        assert.match(s.text(), /images are not available on this deployment/i)
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The sections strip — not a doc 22 scenario either

   Doc 22 assigns no id to the chrome, so this carries none: an invented id fails the catalogue
   meta-test below, correctly.

   It is here rather than in a stylesheet test because a stylesheet test cannot see it. `.mk-subnav`
   was deleted from `src/styles.css` and `SubNav` adopted in `src/components/shell.tsx`, and a grep
   over the stylesheet goes green on either half alone — including on the half that leaves this
   surface's sections row completely unstyled. This file is the one that mounts the real `App` in a
   document, so this is where the question "is the strip a reader SEES the shared one" can be asked.

   Measured 2026-08-10: ten frontends declared this row themselves under six prefixes. This copy was
   `display: flex` with no `overflow-x` and its links had no `white-space: nowrap`, so a phone
   squeezed six labels plus the wordmark, broke them mid-word, and put the rest past an edge that
   could not be scrolled to. The shared `.cf-subnav__inner` scrolls and `.cf-subnav__link` does not
   wrap — but only for the links that actually carry those classes, which is what is asserted.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

describe('the sections strip is the design system’s', () => {
  it('renders the shared landmark, and every section link in it is a shared link', async () => {
    await withScreen(h(App), { url: `${ORIGIN}/fees`, routes: {} }, async (s) => {
      const strip = s.document.querySelector('nav.cf-subnav')
      assert.ok(strip, 'the sections strip on screen is not the shared `.cf-subnav`')
      // The repository's own wording for the landmark, carried across unchanged: only the strip
      // was homogenised, not the name a screen reader announces for it.
      assert.equal(strip.getAttribute('aria-label'), 'Sections')
      // The element that actually scrolls. Without it the links are `nowrap` inside a row that
      // still cannot be reached past its edge, which is defect 1 half-fixed.
      assert.ok(strip.querySelector('.cf-subnav__inner'), 'the strip has no scrolling inner')

      const links = [...strip.querySelectorAll('a')]
      assert.ok(links.length >= 4, `the strip rendered ${links.length} links`)
      for (const link of links) {
        assert.ok(
          link.classList.contains('cf-subnav__link'),
          `"${s.textOf(link)}" is not a shared link. Every one, not at least one: a half-adopted ` +
            'strip is a row where some labels wrap and some do not.',
        )
      }
      // `/fees` is one of them, so exactly one is current — and the shared spelling is
      // `--current`, where this app's local class was `is-active`.
      assert.equal(
        links.filter((a) => a.classList.contains('cf-subnav__link--current')).length,
        1,
        'the current section is not marked, or more than one is',
      )
      // Scoped to the strip: `is-active` also spells the pressed state of Browse's Kind/Order
      // toggle, which is a different control and is staying.
      assert.equal(
        strip.querySelector('[class*="mk-subnav"], .is-active'),
        null,
        'the deleted local sub-nav classes are still being rendered',
      )
      assert.equal(s.document.querySelector('[class*="mk-subnav"]'), null, 'a local strip remains')
    })
  })

  it('keeps the wordmark, which is this surface’s own and not a copy of anything shared', async () => {
    // The one rule that survived the deletion. `SubNav` takes children rather than a list of
    // addresses precisely so a surface with something extra to put in the row does not need a
    // second strip to put it in — so it must be INSIDE the shared strip, not beside it.
    await withScreen(h(App), { url: `${ORIGIN}/fees`, routes: {} }, async (s) => {
      const wordmark = s.document.querySelector('nav.cf-subnav .mk-wordmark')
      assert.ok(wordmark, 'the product wordmark is not inside the shared strip')
      assert.match(s.textOf(wordmark), /Forge Market/)
    })
  })
})

describe('the catalogue and this file agree', () => {
  it('every id doc 22 assigns to this surface is accounted for exactly once', () => {
    const ids = SCENARIOS.map((s) => s.id)
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), 'an id appears twice')
    assert.deepEqual(
      [...ids].sort(),
      [...DOC22_IDS].sort(),
      'the catalogue and doc 22 disagree about which scenarios this surface owns',
    )
  })

  it('a scenario whose outcome depends on a server rule carries an ownedBy path', () => {
    // Doc 22 §3.2, mechanically: a scenario whose expected outcome is a refusal, a denial or a
    // 4xx and which carries no `ownedBy` fails. The suite refuses to run rather than reporting
    // green — the same shape as beacon's rule that a declared-but-faked journey is worse than no
    // journey.
    const REFUSAL = /\b(refus|denie|denial|reject|409|403|4xx|frozen|moderat|not confirmed|reused)\w*/i
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      if (!REFUSAL.test(s.what)) continue
      assert.ok(
        s.ownedBy,
        `${s.id} turns on a server-side refusal and names no test that owns it. Doc 22 §3.2: ` +
          `"a path, resolvable by grep, in the service that enforces the rule".`,
      )
      assert.match(
        s.ownedBy.path,
        /^[a-z-]+\/src\/[\w./-]+\.ts$/,
        `${s.id}'s ownedBy must be <repo>/src/<file>.ts, got ${s.ownedBy.path}`,
      )
    }
  })

  it('no scenario is marked implemented without a test named for it', () => {
    const source = readFileSync(at('test/journeys.test.ts'), 'utf8')
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      // `it('<id> …` — the id is the first token of the test name, so this cannot be satisfied by
      // the id appearing in a comment or in the catalogue import.
      assert.ok(
        new RegExp(`it\\('${s.id.replace(/[-]/g, '-')}[ ★]`).test(source),
        `${s.id} is in the catalogue as implemented and has no test named for it`,
      )
    }
  })

  it('every blocked scenario names its blocker and no blocker is a shrug', () => {
    for (const s of SCENARIOS) {
      if (!s.blocked) continue
      assert.ok(s.blocked.length > 60, `${s.id}'s blocker is too short to be a reason`)
      assert.ok(
        /doc 22|§|does not exist|no UI|tier 3|micro-beacon|not installed|no market corpus/i.test(s.blocked),
        `${s.id}'s blocker does not name a fact about the estate: ${s.blocked}`,
      )
    }
  })

  it('nothing here is tier 3 and implemented — tier 3 lives in micro-beacon', () => {
    for (const s of SCENARIOS) {
      if (s.tier !== 'T3') continue
      assert.ok(s.blocked, `${s.id} is tier 3 and not blocked; doc 22 §4 puts tier 3 in beacon`)
    }
  })
})

/* ── helpers ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Fill the create-listing form with a valid draft, returning the item urn it used.
 *
 * The two asset codes are typed rather than defaulted. The form opens both blank on purpose — it
 * used to open them pre-filled with the retired `SHARD` (micro-org #227 §2) and now offers no
 * default at all, so `Save this as a draft` is disabled until a seller supplies them
 * (`UNCHOSEN_ASSET_CODE`, `src/lib/market.ts`; the rule is owned by `test/sell-form.test.ts`).
 * A helper that did not fill them would leave every scenario below clicking a dead button.
 */
async function fillSellForm(s: Screen): Promise<string> {
  const urn = 'urn:cf:token:hearth:testnet:0xfeedface'
  const boxes = s.allByRole('textbox')
  const byLabel = (want: RegExp): Element | undefined =>
    boxes.find((el) => want.test(labelFor(el)))
  const urnField = byLabel(/urn|item/i) ?? boxes[0]
  if (urnField) await s.type(urnField, urn)
  const price = byLabel(/asking|bidding opens|amount/i)
  if (price) await s.type(price, '2500000000000000000')
  const quantity = byLabel(/quantity/i)
  if (quantity) await s.type(quantity, '1')
  const payAsset = byLabel(/which asset buyers pay in/i)
  if (payAsset) await s.type(payAsset, 'EMBER')
  const itemAsset = byLabel(/asset code the item itself carries/i)
  if (itemAsset) await s.type(itemAsset, 'EMBER')
  return urn
}

function labelFor(el: Element): string {
  const wrapping = el.closest('label')
  if (wrapping) return wrapping.textContent ?? ''
  const id = el.getAttribute('id')
  if (id) return el.ownerDocument.querySelector(`label[for="${id}"]`)?.textContent ?? ''
  return el.getAttribute('placeholder') ?? el.getAttribute('name') ?? ''
}

function fieldValues(s: Screen): string {
  return [...s.document.querySelectorAll('input, textarea, select')]
    .map((el) => (el as unknown as { value?: string }).value ?? '')
    .join(' ')
}
