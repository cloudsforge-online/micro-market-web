/**
 * This surface's slice of `docs/ecosystem/22-browser-journeys.md`, as data.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE CATALOGUE IS DATA AND NOT JUST A LIST OF `it(...)` TITLES
 *
 * Doc 22 §3.2 makes the layer boundary mechanical rather than advisory: every scenario declares
 * one `asserts` kind, and any scenario whose outcome depends on a SERVER-SIDE rule must carry
 * `ownedBy` — "a path, resolvable by grep, in the service that enforces the rule". A meta-test
 * reads these and fails the suite when one is missing. Advice does not survive a deadline; a
 * meta-test does.
 *
 * The second reason is doc 22 §8. Forty-eight of its 318 scenarios cannot be run because the
 * functionality does not exist, and it argues — correctly — that "a scenario that exists and
 * cannot run is a gap somebody can close, and an absent scenario is a gap nobody can see". So the
 * blocked ones are here too, with the blocker named, and `journeys.test.ts` asserts that every id
 * doc 22 assigns to this surface is accounted for exactly once. A scenario cannot be quietly
 * dropped.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Doc 22 §3.1. Nothing else is assertable from a browser. `absence` is deliberately not a kind. */
export type Asserts = 'presentation' | 'client-request' | 'navigation'

/** Doc 22 §4. T3 is not implemented here — it lives in `micro-beacon`. */
export type Tier = 'T1' | 'T2' | 'T3'

export interface Scenario {
  /** Doc 22's stable id. Never renumbered: a renamed scenario abandons its metric history. */
  readonly id: string
  /** What doc 22's row says fails if the feature breaks, in one line. */
  readonly what: string
  readonly asserts: Asserts
  readonly tier: Tier
  /** Release-gate (★ in doc 22). */
  readonly gate?: boolean
  /**
   * The server-side test that owns the rule this scenario's outcome depends on.
   *
   * Required by doc 22 §3.2 whenever the expected outcome is a refusal, a denial, a 4xx or an
   * absence. `<repo>/<path>` relative to the estate root, plus the symbol to grep for.
   */
  readonly ownedBy?: { readonly path: string; readonly grep: string }
  /** Why this cannot be implemented here, when it cannot. Absent means it is implemented. */
  readonly blocked?: string
}

export const SCENARIOS: readonly Scenario[] = [
  /* ── 6.5 Group E — Forge Market ───────────────────────────────────────────────────────────── */
  {
    id: 'BJ-MKT-01',
    what: 'one card per listing in the response; exactly the four filters the route reads; no search box',
    asserts: 'presentation',
    tier: 'T2',
    gate: true,
  },
  {
    id: 'BJ-MKT-02',
    what: 'with the risk call failing the listing still renders and is still buyable, and names what is missing',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-MKT-03',
    what: 'the price breakdown is on screen before the button, and the total submitted equals the total shown',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
    // Doc 22 puts this at T3 because it wants the ledger's own arithmetic behind it. The half that
    // is a property of THIS CLIENT — that the amount posted is the amount rendered — is a
    // client-request assertion needing nothing up, so it is implemented here at T1 as well. The
    // ledger half stays in beacon.
  },
  {
    id: 'BJ-MKT-04',
    what: 'double-click Buy produces exactly one order under one idempotency key',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-MKT-05',
    what: 'a replay under the same key reads back the first order and is not rendered as an error',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-MKT-06',
    what: 'a 409 idempotency_key_reused IS rendered as an error — it means this client sent two intents under one key',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: {
      path: 'market/src/server.ts',
      grep: 'idempotency_key_reused',
    },
  },
  {
    id: 'BJ-MKT-07',
    what: 'the back button does not re-arm a second submit against a settled intent',
    asserts: 'navigation',
    tier: 'T1',
  },
  {
    id: 'BJ-MKT-08',
    what: 'two tabs, one listing, both press Buy: exactly one order, and the losing tab shows the refusal in words',
    asserts: 'client-request',
    tier: 'T3',
    blocked:
      'the reservation is the lock and it lives in micro-market (05:343). Two browsers against ' +
      'one service is tier 3 by definition — doc 22 §4 — and belongs in micro-beacon. What IS ' +
      'testable here is that two independently mounted forms mint two different keys, which is ' +
      'covered by BJ-MKT-04.',
  },
  {
    id: 'BJ-MKT-09',
    what: 'activation with the indexer unavailable says "we could not confirm — wait"',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-MKT-10',
    what: 'a 409 state_conflict is a different sentence, tone and suggested action from the 503',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
    ownedBy: { path: 'market/src/server.ts', grep: 'state_conflict' },
  },
  {
    id: 'BJ-MKT-11',
    what: 'the seller sees their own drafts on /sell and an anonymous index does not',
    asserts: 'presentation',
    tier: 'T2',
  },
  {
    id: 'BJ-MKT-12',
    what: 'raising a dispute names the two facts visible to the parties and invents no status',
    asserts: 'presentation',
    tier: 'T1',
    // Doc 22 marks this T3 because it wants a real dispute raised. The assertion that matters —
    // that the confirmation names proceeds-held and listing-frozen and claims nothing about the
    // dispute's own state — is presentation over a stubbed 201, so it runs at T1.
  },
  {
    id: 'BJ-MKT-13',
    what: 're-opening the orders page does not re-POST under the old key to scrape the stored response',
    asserts: 'client-request',
    tier: 'T1',
  },
  {
    id: 'BJ-MKT-14',
    what: 'the collections index and one collection both render anonymously',
    asserts: 'presentation',
    tier: 'T2',
  },
  {
    id: 'BJ-MKT-15',
    what: 'the fees page makes no request and cannot fail, and says the figures are the platform position',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-MKT-16',
    what: 'an auction with a leading bid renders the caveat beside the figure',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-MKT-17',
    what: 'a moderated listing renders the notice and offers no buy control',
    asserts: 'presentation',
    tier: 'T1',
    ownedBy: { path: 'market/src/moderation.ts', grep: 'frozen' },
  },
  {
    id: 'BJ-MKT-18',
    what: 'the operator half of 05 journey 15: moderate a fraudulent listing with computed risk indicators',
    asserts: 'presentation',
    tier: 'T3',
    blocked:
      'doc 22 §8.4: admin-web has no moderation screen. Nothing in THIS repository can carry the ' +
      'scenario either — market-web is the buyer-and-seller surface and its CI forbids it from ' +
      'calling any moderation route at all (.github/workflows/ci.yml, "No operator-only route is ' +
      'called from this buyer-and-seller surface").',
  },

  /* ── 6.19 Group S — the adversarial matrix, the rows naming this repo ─────────────────────── */
  //
  // Doc 22 §6.19 expands each form row into one scenario per applicable hazard: BJ-ADV-01's six
  // hazards are BJ-ADV-01-H1 … -H6. That expansion is written out here rather than left implicit,
  // because a hazard that is never named is a hazard nobody notices is missing.
  {
    id: 'BJ-ADV-01-H1',
    what: 'buy/bid/offer, double-submit: exactly one effect',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-01-H2',
    what: 'buy/bid/offer, back after a confirmation: the previous step does not re-arm a second commit',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-01-H3',
    what: 'buy/bid/offer, two tabs one intent',
    asserts: 'client-request',
    tier: 'T3',
    gate: true,
    blocked:
      'two browser contexts against one service. Tier 3 by doc 22 §4; see BJ-MKT-08. The ' +
      'single-context half — two mounts mint two keys — is BJ-ADV-01-H1.',
  },
  {
    id: 'BJ-ADV-01-H4',
    what: 'buy/bid/offer, the request fails after the optimistic UI moved: the UI reverts with a stated reason',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-01-H5',
    what: 'buy/bid/offer, session expires mid-flow',
    asserts: 'presentation',
    tier: 'T3',
    gate: true,
    blocked:
      'doc 22 §6.19 itself puts this row at "T1 (H1-H4), T3 (H5)". The re-authentication path is ' +
      'signInRedirect() into a surface that does not exist (doc 22 §8.1), so the browser half ' +
      'cannot be asserted anywhere until a sign-in page does. The client half — that a failed ' +
      'refresh fires cf:auth-expired exactly once — is already asserted by test/api.test.ts.',
  },
  {
    id: 'BJ-ADV-01-H6',
    what: 'buy/bid/offer against a degraded upstream: the control is disabled with the reason rather than left clickable',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-02-H1',
    what: 'create listing then activate, double-submit: one listing',
    asserts: 'client-request',
    tier: 'T1',
  },
  {
    id: 'BJ-ADV-02-H3',
    what: 'create listing then activate, two tabs',
    asserts: 'client-request',
    tier: 'T3',
    blocked:
      'two browser contexts against one service. Doc 22 §4 makes that tier 3 by definition and ' +
      'puts tier 3 in micro-beacon; nothing in this repository can hold two browsers open. The ' +
      'single-context half — that two mounts of the create form mint two different keys and one ' +
      'mount reuses one — is BJ-ADV-02-H1.',
  },
  {
    id: 'BJ-ADV-02-H4',
    what: 'activation fails after the optimistic UI moved: the row reverts to the server state with a reason',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-ADV-02-H6',
    what: 'activation against a degraded indexer: the reason is stated rather than the control left clickable',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-ADV-03-H1',
    what: 'open a dispute, double-submit: one dispute',
    asserts: 'client-request',
    tier: 'T1',
  },
  {
    id: 'BJ-ADV-03-H2',
    what: 'open a dispute, back after the confirmation: no second commit against the settled intent',
    asserts: 'navigation',
    tier: 'T1',
  },
  {
    id: 'BJ-ADV-03-H4',
    what: 'the dispute POST fails: the page states the failure with its request id and keeps the order rendered',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-ADV-22',
    what: 'degraded not down: the page paints with the slow tile marked pending and nothing left hanging',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-23',
    what: 'every failure state renders the request id to quote to support',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },

  /* ── 6.20 Group T — accessibility ─────────────────────────────────────────────────────────── */
  {
    id: 'BJ-A11Y-01',
    what: 'axe on every route of this surface: zero serious or critical violations',
    asserts: 'presentation',
    tier: 'T2',
    gate: true,
    blocked:
      'axe-core is not installed anywhere in the estate and doc 22 §1 records that as true of ' +
      'all fifteen bundles. Adding it here would put ONE surface behind a rule the other ' +
      'fourteen are not held to, and doc 22 §7.2 makes the axe sweep estate-wide by construction ' +
      '("Any PR in ui — every surface’s T1 axe set"), which means it belongs to the shared ' +
      'design system rather than to this repository. What IS asserted here without it, because ' +
      'it needs no engine, is BJ-A11Y-10 and BJ-A11Y-12 below.',
  },
  {
    id: 'BJ-A11Y-03',
    what: 'a degraded tile is still announced, and an error is not colour-only',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-A11Y-10',
    what: 'colour is never the only channel: every state chip carries a glyph or a word as well',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-A11Y-12',
    what: 'one main landmark, a reachable skip link, and a heading order with no level skipped',
    asserts: 'presentation',
    tier: 'T1',
  },

  /* ── 5.1 the universal per-surface property ───────────────────────────────────────────────── */
  {
    id: 'BJ-MARKET-404',
    what: 'an address this surface does not own renders the not-found screen UNDER a 404',
    asserts: 'navigation',
    tier: 'T2',
  },
]

/**
 * Every id doc 22 assigns to this surface.
 *
 * Transcribed from §6.5 (the whole of Group E), §6.19's three `market-web` form rows expanded per
 * hazard, §6.19's two page-level rows, the four Group T rows that name a property this surface
 * has, and the one §5.1 row. `journeys.test.ts` asserts SCENARIOS covers exactly this set, so a
 * scenario cannot be dropped by deleting its test.
 */
export const DOC22_IDS: readonly string[] = [
  'BJ-MKT-01',
  'BJ-MKT-02',
  'BJ-MKT-03',
  'BJ-MKT-04',
  'BJ-MKT-05',
  'BJ-MKT-06',
  'BJ-MKT-07',
  'BJ-MKT-08',
  'BJ-MKT-09',
  'BJ-MKT-10',
  'BJ-MKT-11',
  'BJ-MKT-12',
  'BJ-MKT-13',
  'BJ-MKT-14',
  'BJ-MKT-15',
  'BJ-MKT-16',
  'BJ-MKT-17',
  'BJ-MKT-18',
  'BJ-ADV-01-H1',
  'BJ-ADV-01-H2',
  'BJ-ADV-01-H3',
  'BJ-ADV-01-H4',
  'BJ-ADV-01-H5',
  'BJ-ADV-01-H6',
  'BJ-ADV-02-H1',
  'BJ-ADV-02-H3',
  'BJ-ADV-02-H4',
  'BJ-ADV-02-H6',
  'BJ-ADV-03-H1',
  'BJ-ADV-03-H2',
  'BJ-ADV-03-H4',
  'BJ-ADV-22',
  'BJ-ADV-23',
  'BJ-A11Y-01',
  'BJ-A11Y-03',
  'BJ-A11Y-10',
  'BJ-A11Y-12',
  'BJ-MARKET-404',
]

export const byId = (id: string): Scenario => {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`no scenario ${id} in test/journeys.ts`)
  return found
}
