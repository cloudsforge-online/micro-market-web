/**
 * Two events in one tick, on every button that spends money.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS SEPARATE FROM `journeys.test.ts`, WHICH ALREADY DOUBLE-CLICKS FOUR OF THESE
 *
 * `journeys.test.ts` (BJ-MKT-04) double-clicks Buy and asserts ONE IDEMPOTENCY KEY. It says
 * so in as many words: "Whether the button also guards itself with `busy` is this app's business;
 * the key is the contract". That reading is correct for doc 22 — a browser scenario may not assert
 * a business rule, and collapsing duplicates IS the server's rule.
 *
 * It leaves a hole, and this file is that hole. HOW MANY TIMES A BROWSER SENDS is not a business
 * rule; it is the one thing about a duplicate that is squarely the client's own. And the estate has
 * now found the same defect three times — `micro-tessera-web` (Fire, list and claim each produced
 * TWO requests) and `micro-hub-web` (two 24-hour key-export ceremonies) — always with the same
 * cause:
 *
 *   A GUARD WRITTEN AS COMPONENT STATE CANNOT SEE A SECOND EVENT IN THE SAME TICK.
 *
 * `const [busy, setBusy] = useState(false)` is read out of the render closure, and `setBusy(true)`
 * only SCHEDULES a render. Two clicks dispatched before React commits both read `busy === false`.
 * `disabled={busy}` has exactly the same hole from the other end: the attribute is not on the DOM
 * node until the render commits, so the second event is already dispatched by then.
 *
 * ── WHAT THE SECOND REQUEST ACTUALLY COSTS HERE ───────────────────────────────────────────────
 *
 * Not a double charge. `useIntent` (src/lib/intent.ts) holds the key in
 * `useState(() => newIdempotencyKey(prefix))`, so it is minted at MOUNT and is stable across
 * renders; both same-tick clicks read the same key from the same closure and send the same header.
 * The server collapses them. That half is already right and this file must not break it.
 *
 * What it costs is a LIE ABOUT THE OUTCOME. `market/src/server.ts` answers a request whose
 * key has a claim but no stored response yet with **503 `in_flight`** — and the comment there is
 * the whole argument for this file:
 *
 *   "503 with a retry hint, not 409. The first attempt may still succeed, and telling a client
 *    'conflict' for work that is about to commit is how a purchase gets reported as failed."
 *
 * The service went to the trouble of choosing a status that would not be reported as a failure,
 * and `BuyForm`'s `catch` reports every non-2xx as a failure anyway: `The purchase did not go
 * through.` Meanwhile `listing.tsx` promises the reader, in as many words, "Clicking twice is
 * safe". Under a same-tick double click that promise is false — not because money moves twice, but
 * because the buyer is told their purchase failed when it succeeded.
 *
 * So each scenario below asserts BOTH halves: exactly one request leaves the browser, and the
 * reader is never shown a failure for work that succeeded.
 *
 * ── AND BOTH WAYS ROUND ───────────────────────────────────────────────────────────────────────
 *
 * `src/main.tsx` renders under `<StrictMode>` and this harness mounts without it. A ref latch is
 * created twice on a StrictMode mount and a `useState` initialiser is invoked twice, so a guard
 * that works here can still be a guard that has never been run the way the app runs it —
 * `micro-hub-web`'s mutation run found exactly that, "a StrictMode ref never exercised". Every
 * proof below runs twice, `strict: false` and `strict: true`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, useState, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { ListingPage } from '../src/pages/listing.tsx'
import { OrdersPage } from '../src/pages/orders.tsx'
import { SellPage } from '../src/pages/sell.tsx'
import { useSubmit } from '../src/lib/submit.ts'

const ORIGIN = 'https://market.cloudsforge.online'

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element) as ReactElement)

const listingAt = () => page(h(ListingPage), `/listings/${fx.LISTING_ID}`)

function listingRoutes(over: Routes = {}): Routes {
  return {
    [`GET /v1/listings/${fx.LISTING_ID}/risk`]: { body: fx.risk() },
    [`GET /v1/listings/${fx.LISTING_ID}/bids`]: { body: { bids: [] } },
    [`GET /v1/listings/${fx.LISTING_ID}/offers`]: { body: { offers: [] } },
    [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail() },
    ...over,
  }
}

function sellRoutes(drafts: readonly unknown[] = [fx.listing({ status: 'draft' })]): Routes {
  return {
    'GET /auth/me': { body: fx.ME },
    'GET /v1/listings': (w) => ({ body: { listings: /status=draft/.test(w.path) ? drafts : [] } }),
  }
}

const AUCTION = {
  pricingMode: 'auction' as const,
  auctionEndsAt: '2099-01-01T00:00:00.000Z',
  price: '1000000000000000000',
}

/**
 * The sentence a scenario fails with.
 *
 * Named after the real-world loss rather than after the mechanism, because a failure message that
 * says "expected 1, got 2" is a message the next reader deletes the assertion over.
 */
const once = (action: string, n: number, cost: string): string =>
  `${action} left the browser ${n} times for one press. ${cost} The guard has to be a ref set ` +
  `before the first await — component state is read out of the render closure and cannot see a ` +
  `second event in the same tick (src/lib/submit.ts).`

/** Every textbox on the page, with the text of the label wrapping it. */
function labelled(s: Screen, want: RegExp): Element | undefined {
  return s
    .allByRole('textbox')
    .find((el) => want.test(el.closest('label')?.textContent ?? ''))
}

/**
 * The control, mid-flight.
 *
 * The ref latch is the correctness guarantee; `disabled` and the changed label are the
 * AFFORDANCE, and they are asserted separately because they fail separately. A form that latched
 * correctly and dropped its `disabled` would send one request and give the reader no way at all to
 * tell a submitted form from an idle one — so they press again, and again, and the button they are
 * pressing does nothing while the page says nothing. Keeping `busy` as state alongside the ref is
 * deliberate (src/lib/submit.ts); this is what stops it being deleted as redundant.
 */
function assertBusy(s: Screen, button: Element, label: RegExp): void {
  assert.ok(
    button.hasAttribute('disabled'),
    `the control stayed enabled while its request was in flight: ${JSON.stringify(s.textOf(button))}`,
  )
  assert.match(
    s.textOf(button),
    label,
    'the control did not say it was working while it was working',
  )
}

/* ── the six spending forms ─────────────────────────────────────────────────────────────────── */


for (const strict of [false, true]) {
  const mode = strict ? 'under StrictMode' : 'plain'

  describe(`one press is one request — ${mode}`, () => {
    it(`Buy sends one purchase, not two (${mode})`, async () => {
      const path = `POST /v1/listings/${fx.LISTING_ID}/buy`
      await withScreen(
        listingAt(),
        {
          url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
          strict,
          routes: listingRoutes({
            [path]: (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { order: fx.order(), replayed: n > 1 },
              delayMs: 30,
            }),
          }),
        },
        async (s) => {
          const buy = s.byRole('button', 'Buy now')
          s.clickNoFlush(buy)
          s.clickNoFlush(buy)
          // Mid-flight: React has committed the busy render, the stub has not answered.
          await s.settle(5)
          assertBusy(s, buy, /buying/i)
          await s.settle(60)
          const posted = s.api.matching(path)
          assert.equal(
            posted.length,
            1,
            once(
              'a purchase',
              posted.length,
              'A buyer who double-clicks pays once and is told twice about it.',
            ),
          )
        },
      )
    })

    it(`a bid is placed once, not twice (${mode})`, async () => {
      const path = `POST /v1/listings/${fx.LISTING_ID}/bids`
      await withScreen(
        listingAt(),
        {
          url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
          strict,
          routes: listingRoutes({
            [`GET /v1/listings/${fx.LISTING_ID}`]: { body: fx.detail(AUCTION) },
            [path]: (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { bid: fx.bid(), replayed: n > 1, outbid: null, auctionEndsAt: null },
              delayMs: 30,
            }),
          }),
        },
        async (s) => {
          await s.type(s.allByRole('textbox')[0] as Element, '2000000000000000000')
          const button = s.byRole('button', 'Bid')
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          // Mid-flight: React has committed the busy render, the stub has not answered.
          await s.settle(5)
          assertBusy(s, button, /bidding/i)
          await s.settle(60)
          const posted = s.api.matching(path)
          assert.equal(
            posted.length,
            1,
            once(
              'a bid',
              posted.length,
              'The second one races the first for the auction extension window.',
            ),
          )
        },
      )
    })

    it(`an offer is made once, not twice (${mode})`, async () => {
      const path = `POST /v1/listings/${fx.LISTING_ID}/offers`
      await withScreen(
        listingAt(),
        {
          url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
          strict,
          routes: listingRoutes({
            [path]: (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { offer: fx.offer(), replayed: n > 1 },
              delayMs: 30,
            }),
          }),
        },
        async (s) => {
          const amount = labelled(s, /your offer/i)
          assert.ok(amount, 'the offer form has no amount field')
          await s.type(amount, '2000000000000000000')
          const button = s.byRole('button', /^offer/i)
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          // Mid-flight: React has committed the busy render, the stub has not answered.
          await s.settle(5)
          assertBusy(s, button, /offering/i)
          await s.settle(60)
          const posted = s.api.matching(path)
          assert.equal(
            posted.length,
            1,
            once(
              'an offer',
              posted.length,
              'An offer reserves the offerer’s funds; two of them reserve them twice.',
            ),
          )
        },
      )
    })

    it(`activating a draft sends one activation, not two (${mode})`, async () => {
      const path = `POST /v1/listings/${fx.LISTING_ID}/activate`
      await withScreen(
        page(h(SellPage), '/sell'),
        {
          url: `${ORIGIN}/sell`,
          strict,
          storage: fx.SIGNED_IN,
          routes: {
            ...sellRoutes(),
            [path]: { status: 200, body: { listing: fx.listing() }, delayMs: 30 },
          },
        },
        async (s) => {
          await s.settle(20)
          const button = s.byRole('button', /activate/i)
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          // Mid-flight: React has committed the busy render, the stub has not answered.
          await s.settle(5)
          assertBusy(s, button, /activating/i)
          await s.settle(60)
          const posted = s.api.matching(path)
          assert.equal(
            posted.length,
            1,
            once(
              'an activation',
              posted.length,
              'Activation FAILS CLOSED on the chain index (sell.tsx): a second call is a ' +
                'second indexer read that can answer differently from the first.',
            ),
          )
        },
      )
    })

    it(`creating a listing sends one create, not two (${mode})`, async () => {
      await withScreen(
        page(h(SellPage), '/sell'),
        {
          url: `${ORIGIN}/sell`,
          strict,
          storage: fx.SIGNED_IN,
          routes: {
            ...sellRoutes([]),
            'POST /v1/listings': (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { listing: fx.listing({ status: 'draft' }), replayed: n > 1 },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          await s.settle(20)
          await fillSellForm(s)
          const create = s.byRole('button', /create/i)
          s.clickNoFlush(create)
          s.clickNoFlush(create)
          // Mid-flight: React has committed the busy render, the stub has not answered.
          await s.settle(5)
          assertBusy(s, create, /creating/i)
          await s.settle(60)
          const posted = s.api.matching('POST /v1/listings')
          assert.equal(
            posted.length,
            1,
            once(
              'a create',
              posted.length,
              'The second one runs the policy check again, and a degraded verdict on the retry ' +
                'opens a review the first create did not need.',
            ),
          )
        },
      )
    })

    it(`raising a dispute sends one dispute, not two (${mode})`, async () => {
      const path = `POST /v1/orders/${fx.ORDER_ID}/disputes`
      await withScreen(
        page(h(OrdersPage), `/orders/${fx.ORDER_ID}`),
        {
          url: `${ORIGIN}/orders/${fx.ORDER_ID}`,
          strict,
          storage: fx.SIGNED_IN,
          routes: {
            'GET /auth/me': { body: fx.ME },
            [`GET /v1/orders/${fx.ORDER_ID}`]: { body: { order: fx.order() } },
            [path]: (_w, n) => ({
              status: n === 1 ? 201 : 200,
              body: { dispute: DISPUTE, replayed: n > 1 },
              delayMs: 30,
            }),
          },
        },
        async (s) => {
          await s.type(s.allByRole('textbox')[0] as Element, 'it never arrived')
          const button = s.byRole('button', /raise a dispute/i)
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          // Mid-flight: React has committed the busy render, the stub has not answered.
          await s.settle(5)
          assertBusy(s, button, /opening/i)
          await s.settle(60)
          const posted = s.api.matching(path)
          assert.equal(
            posted.length,
            1,
            once(
              'a dispute',
              posted.length,
              'orders.tsx promises "Pressing this twice is safe … which is what stops ' +
                'one complaint becoming two disputes and freezing the listing twice".',
            ),
          )
        },
      )
    })
  })
}

/* ── the lie the second request tells ───────────────────────────────────────────────────────── */

describe('a purchase that went through is never reported as failed', () => {
  const path = `POST /v1/listings/${fx.LISTING_ID}/buy`

  /**
   * `market/src/idempotency.ts` throws `IdempotencyInFlightError` the moment it finds a claim
   * with no stored response — so in the real service the 503 comes back FAST while the first
   * request is still settling in the ledger. That ordering is the one modelled here, and it is the
   * one a naive end-state assertion misses: the failure is rendered, then overwritten seconds
   * later by the success. A buyer reading the screen in between has been told their money did not
   * move when it did, and there is nothing on the page at that moment that says otherwise.
   */
  for (const strict of [false, true]) {
    it(`no failure is shown while the purchase is committing (${strict ? 'strict' : 'plain'})`, async () => {
      await withScreen(
        listingAt(),
        {
          url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
          strict,
          routes: listingRoutes({
            [path]: (_w, n) =>
              n === 1
                ? { status: 201, body: { order: fx.order(), replayed: false }, delayMs: 40 }
                : {
                    status: 503,
                    body: fx.error('in_flight', 'a request under this key is already in flight'),
                    delayMs: 1,
                  },
          }),
        },
        async (s) => {
          const buy = s.byRole('button', 'Buy now')
          s.clickNoFlush(buy)
          s.clickNoFlush(buy)

          // The window between the fast 503 and the slow 201. The purchase HAS gone through — the
          // service is committing it right now — and the screen must not say otherwise.
          await s.settle(15)
          assert.ok(
            s.queryByRole('alert', /did not go through/i) === null,
            'the buyer was told "The purchase did not go through." while the purchase was ' +
              'committing. market/src/server.ts chose 503 over 409 precisely so that a ' +
              'client would not report it as a failure, and listing.tsx promises the reader ' +
              '"Clicking twice is safe".',
          )
          assert.doesNotMatch(
            s.text(),
            /did not go through/i,
            'the failure sentence is on screen for a purchase that succeeded',
          )

          await s.settle(60)
          assert.equal(s.api.matching(path).length, 1, 'two purchases left the browser')
          assert.match(s.text(), /Bought|already gone through/i, 'the purchase was never confirmed')
        },
      )
    })
  }

  it('nor after it has committed, when the 503 is the one that arrives last', async () => {
    // The other ordering — HTTP/2 multiplexing, a proxy, plain jitter. Here the lie is permanent:
    // the last write to `result` wins and the reader is left with a failure that never happened.
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        routes: listingRoutes({
          [path]: (_w, n) =>
            n === 1
              ? { status: 201, body: { order: fx.order(), replayed: false }, delayMs: 1 }
              : {
                  status: 503,
                  body: fx.error('in_flight', 'a request under this key is already in flight'),
                  delayMs: 40,
                },
        }),
      },
      async (s) => {
        const buy = s.byRole('button', 'Buy now')
        s.clickNoFlush(buy)
        s.clickNoFlush(buy)
        await s.settle(80)
        // The lie is asserted BEFORE the request count, so that a reader who breaks this sees the
        // loss rather than the arithmetic.
        assert.doesNotMatch(
          s.text(),
          /did not go through/i,
          'the buyer is left looking at "The purchase did not go through." for an order that ' +
            'exists, has been paid for, and is linked from this very page',
        )
        assert.match(s.text(), /Bought|already gone through/i, 'the purchase was never confirmed')
        assert.equal(s.api.matching(path).length, 1, 'two purchases left the browser')
      },
    )
  })
})

/* ── the key survives StrictMode ────────────────────────────────────────────────────────────── */

describe('the intent key is minted once per intent, StrictMode included', () => {
  const path = `POST /v1/listings/${fx.LISTING_ID}/buy`

  it('two sequential attempts at one failed intent carry the same key under StrictMode', async () => {
    // `useIntent` holds the key in `useState(() => newIdempotencyKey(prefix))`. StrictMode invokes
    // that initialiser TWICE on mount and keeps one of the two results. If the component read the
    // key from anywhere but that state — or if the initialiser's value were recomputed per render —
    // the retry of a failed attempt would carry a DIFFERENT key, and the retry of a purchase that
    // had in fact committed would buy the item a second time. That is the failure this asserts
    // against, and it can only be asserted with StrictMode actually on.
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        strict: true,
        routes: listingRoutes({
          [path]: { status: 502, body: fx.error('upstream', 'the ledger did not answer') },
        }),
      },
      async (s) => {
        const buy = s.byRole('button', 'Buy now')
        await s.click(buy)
        await s.click(s.byRole('button', 'Buy now'))
        const posted = s.api.matching(path)
        assert.equal(posted.length, 2, 'a retry after a failure did not go out')
        const keys = new Set(posted.map((p) => p.headers['idempotency-key']))
        assert.equal(
          keys.size,
          1,
          `a retry of one intent sent ${keys.size} keys under StrictMode: ${[...keys].join(', ')}. ` +
            `A key minted per click is a second order for a purchase the first click may already ` +
            `have committed — src/lib/idempotency.ts.`,
        )
        assert.match([...keys][0] ?? '', /^market-web:buy:/)
      },
    )
  })

  it('a fresh mount under StrictMode does not send a key twice over', async () => {
    // The other half: the double-invoked initialiser must not leak a SECOND key into a second
    // request. One press, one request, one key.
    await withScreen(
      listingAt(),
      {
        url: `${ORIGIN}/listings/${fx.LISTING_ID}`,
        strict: true,
        routes: listingRoutes({
          [path]: { status: 201, body: { order: fx.order(), replayed: false } },
        }),
      },
      async (s) => {
        await s.click(s.byRole('button', 'Buy now'))
        const posted = s.api.matching(path)
        assert.equal(posted.length, 1, 'one press did not produce exactly one purchase')
        assert.match(posted[0]?.headers['idempotency-key'] ?? '', /^market-web:buy:/)
      },
    )
  })
})


/* ── the harness flag itself ────────────────────────────────────────────────────────────────── */

describe('the StrictMode variants above are not duplicates of the plain ones', () => {
  /**
   * Twelve of the scenarios in this file exist only because `strict: true` changes how React runs
   * the component. If that option were a no-op — a typo in the key, a `wrap` that forgot to apply,
   * a merge that dropped it — those twelve would be an exact re-run of the other twelve and would
   * prove nothing while looking like twice the coverage. `micro-hub-web`'s mutation run found the
   * corresponding hole from the other side: "a StrictMode ref never exercised".
   *
   * So the flag is asserted directly, on the one observable that separates the two modes: React
   * double-invokes a `useState` initialiser on a StrictMode mount and once otherwise.
   */
  let initialiserCalls = 0
  const Probe = (): ReactElement => {
    const [label] = useState(() => {
      initialiserCalls += 1
      return 'A probe with enough text on it to satisfy the harness mounted-check.'
    })
    return h('p', null, label)
  }

  it('a useState initialiser runs once plain and twice under strict', async () => {
    initialiserCalls = 0
    await withScreen(h(Probe), { url: ORIGIN, routes: {} }, async () => undefined)
    const plain = initialiserCalls

    initialiserCalls = 0
    await withScreen(h(Probe), { url: ORIGIN, routes: {}, strict: true }, async () => undefined)
    const strict = initialiserCalls

    assert.equal(plain, 1, `the default mount invoked the initialiser ${plain} times, not once`)
    assert.equal(
      strict,
      2,
      `\`strict: true\` invoked the initialiser ${strict} times. StrictMode double-invokes it, ` +
        `so anything but 2 means the option did not take and every "under StrictMode" scenario ` +
        `in this file is a silent duplicate of its plain twin.`,
    )
  })
})


/* ── the latch is released even when the work throws ───────────────────────────────────────── */

describe('a form is never wedged by a throw it did not expect', () => {
  /**
   * All six callers today catch their own errors, so `work` never rejects in production and the
   * `finally` in `useSubmit` looks like decoration. It is not, and this is the scenario that keeps
   * it: release the latch after the `try` instead of inside a `finally` and the FIRST unexpected
   * throw — a bug in a body-builder, a `parseAmount` that escaped its catch, a seventh form
   * written without one — leaves the button permanently dead with no message and no way back
   * except a reload. That is a worse failure than the double submit this hook exists to stop, and
   * it is the reason the release is where it is.
   */
  it('two presses whose work throws both run', async () => {
    let calls = 0
    const Probe = (): ReactElement => {
      const { busy, run } = useSubmit()
      return h(
        'button',
        {
          onClick: () => {
            void run(async () => {
              calls += 1
              await Promise.resolve()
              throw new Error('the work threw, as a bug in a body-builder would')
            }).catch(() => undefined)
          },
        },
        busy ? 'Working…' : 'Press me — a probe for the submit latch, with text enough to mount',
      )
    }

    await withScreen(h(Probe), { url: ORIGIN, routes: {} }, async (s) => {
      await s.click(s.byRole('button', /press me/i))
      await s.click(s.byRole('button', /press me/i))
      assert.equal(
        calls,
        2,
        `the second press did nothing: the latch was never released after the first press threw, ` +
          `so the control is dead for the rest of the session with nothing on screen saying so`,
      )
    })
  })
})

/* ── helpers ────────────────────────────────────────────────────────────────────────────────── */

const DISPUTE = {
  id: 'dispute-1',
  orderId: fx.ORDER_ID,
  raiserSubject: fx.BUYER,
  reason: 'not_as_described',
  state: 'open' as const,
  openedAt: '2026-07-05T09:00:00.000Z',
}

/** Fill the create-listing form with a valid draft. */
async function fillSellForm(s: Screen): Promise<void> {
  const urn = labelled(s, /urn/i) ?? s.allByRole('textbox')[0]
  if (urn) await s.type(urn, 'urn:cf:token:hearth:testnet:0xfeedface')
  const price = labelled(s, /price/i)
  if (price) await s.type(price, '2500000000000000000')
  const quantity = labelled(s, /quantity/i)
  if (quantity) await s.type(quantity, '1')
}
