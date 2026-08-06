# micro-market-web — Forge Market

[![ci](https://github.com/cloudsforge-online/micro-market-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudsforge-online/micro-market-web/actions/workflows/ci.yml)
![licence](https://img.shields.io/badge/licence-MIT-97CA00)
![node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![module](https://img.shields.io/badge/module-ESM-F7DF1E?logo=javascript&logoColor=black)
![tests](https://img.shields.io/badge/tests-in--process%20DOM-6E56CF)

The marketplace surface: browse and search listings, read one, create one, buy it, bid on it, make
an offer, and follow an order through to its dispute.

It talks to exactly one service, `micro-market`, and to Nimbus for the session. Every price on it
is a `bigint` of an asset's smallest units, and every fee and royalty is shown adding up to the
sale price — because `market` proves that arithmetic exactly, and the screen should not be where it
stops being true.

```
pnpm install          # after `pnpm --dir ../ui install`, which the link: specifier needs
pnpm dev              # http://localhost:5187, talking to http://localhost:4007
pnpm typecheck
pnpm test             # 359 tests, node:test, no DOM
pnpm build
```

---

## The one rule this repository exists to keep

**Every call cites the line of `market/src/server.ts` it was verified against, and the tests assert
the REQUEST rather than the response.**

This estate has shipped seven clients written against a surface somebody imagined rather than the
one the service registers — three of them inside `micro-market` itself. Two are written up in
`docs/ecosystem/18-build-status.md` §3.3:

- `micro-wallet` called `POST /v1/quotes`; `micro-pricing` serves `/rates`.
- `micro-market` called `POST /v1/decisions/market.listing`; `micro-policy` has no `/v1` routes at
  all. It was first reported as the moderation gate being *bypassed*. It was the opposite: the 404
  landed on the `deny` branch and every listing creation returned 403. **The marketplace was not
  unmoderated — it was closed.**

Every suite involved was green, because a stubbed `fetch` answers whatever it is told to no matter
what path it was asked for. So `test/market.test.ts` asserts the outgoing URL, method, query string,
body and headers for every call in `src/lib/market.ts`, and CI requires every route to name the
service source it was read from.

### The routes this app calls

| Call | `market/src/server.ts` | Notes |
| --- | --- | --- |
| `GET /v1/collections` | 596 | Only `ownerSubject` is read (597). Public. |
| `POST /v1/collections` | 602 | Not idempotency-wrapped by the service; the key is sent anyway. |
| `GET /v1/listings` | 618 | Four parameters only. **No `limit`, no `q`.** Public. |
| `GET /v1/listings/:id` | 636 | Returns the listing and its royalty split in bps. |
| `POST /v1/listings` | 651 | `platformFeeBps` and `disputeWindowMs` are NOT body fields (701-702). |
| `POST /v1/listings/:id/activate` | 742 | Fails **closed** on the chain index (756-763). |
| `DELETE /v1/listings/:id` | 776 | No body: the reason is fixed by the service (782). |
| `GET /v1/listings/:id/risk` | 790 | Fails **open**: read `indicatorsAvailable`, not the status. |
| `POST /v1/listings/:id/buy` | 818 | `amount` only (829). |
| `GET /v1/listings/:id/bids` | 846 | No parameters. Public. |
| `POST /v1/listings/:id/bids` | 863 | A 409 carries `minimum` as a string (413-427). |
| `GET /v1/listings/:id/offers` | 893 | No parameters. |
| `POST /v1/listings/:id/offers` | 898 | `expiresAt` omitted rather than sent empty. |
| `DELETE /v1/offers/:id` | 917 | Top-level, not under the listing. |
| `POST /v1/offers/:id/accept` | 931 | **No body**: it settles at the offer's amount. |
| `GET /v1/orders` | 969 | `role` only; the subject comes from the token (972). |
| `GET /v1/orders/:id` | 980 | "Not yours" and "does not exist" are one 404 (986-989). |
| `POST /v1/orders/:id/disputes` | 993 | `reason` only. Idempotency-wrapped since `4df8518`. |
| `GET /v1/verifications/:urn` | 1106 | The URN is percent-encoded into one segment. |

**Every mutating route requires an `Idempotency-Key`** (1152-1157) matching `[A-Za-z0-9_:.-]{8,200}`
(237). It is not optional. A replay answers **200 with `replayed: true`** rather than an error
(1168-1173), and a client that translated that into a failure would tell a customer their completed
purchase had broken.

### Routes this surface deliberately never calls

`GET /v1/disputes` (1015), the three moderation routes (1051, 1064, 1086), `PUT /v1/verifications`
(1112) and `POST /v1/events` (515). All require an operator or a signed event. Calling one would be
building a 403 into a page and then explaining it. A CI rule greps for them.

---

## "We could not confirm" is not "not confirmed"

`src/lib/escrow.ts` exists because the most recent defect in this estate made *every on-chain escrow
activation* fail with a false diagnosis: an upstream that did not answer was reported as an upstream
that answered no. The two need opposite remedies — wait, versus go and post the escrow.

`micro-market` is careful about it in three places, and this app is the fourth:

| The service says | Meaning | What this app renders |
| --- | --- | --- |
| **503 `indexer_unavailable`** (467-475) | The chain index did not answer. | "We could not confirm the on-chain escrow… **This is not a statement that your escrow is missing — it is a statement that we do not know.**" A `role="status"` notice with a dashed border. |
| **409 `state_conflict`** with the escrow message (762) | The index answered: not confirmed. | "The chain index answered, and the escrow transaction is not confirmed yet. Once it has enough confirmations, activate again." A `role="alert"`. |
| `ApiError` status 0 | We never reached the service. | "Nothing was checked and nothing was changed." |

`escrowIsUnknown` and `escrowIsUnconfirmed` are **separate booleans**, so a careless `!confirmed`
cannot collapse them again. `test/escrow.test.ts` asserts both directions on every branch, including
that the two are never both set for any input, and that the unknown copy never contains the phrase
"not confirmed".

The same distinction one level out: `GET /v1/listings/:id/risk` fails open and answers 200 with
`indicatorsAvailable: false` when the chain cannot be read (801-804). The panel says "we could not
read the chain for this item — that is not the same as finding none", which is a different sentence
from "we read it and none of the six applied".

And on a listing itself: `escrowed` on the wire is `escrowId !== null || onchainEscrowTx !== null`
(1200). It says a reference EXISTS. The only sound inference about the chain is the one the
service's fail-closed rule licenses — an on-chain listing reached `active` only by passing
`escrowStatus().confirmed` — and it is worded as a past observation: *"That was checked when it was
activated, not just now."*

---

## An escrow is a reservation, not a balance

`market/src/escrow.ts` — `hold_entry_id` is the journal entry that moved value from `available`
to `reserved`. Market never adds anything up. So no screen here says Forge Market is holding your
funds; it says there is a reservation in Forge Ledger and Market holds the reference to it.

## Money is `bigint`, and the parts are shown adding up

`src/lib/money.ts` is a port of `market/src/money.ts`: the fee and the royalty round **down**, the
seller's proceeds are the **remainder**, and the royalty is divided between recipients by largest
remainder so the shares sum to it exactly. `checkPartition` returns the problem as a sentence rather
than throwing, so the breakdown component can render the sum row **and** say when it does not
balance — instead of blanking the page and taking the request id the user needs with it.

There is no `Number()`, no `parseFloat` and no `toFixed` anywhere near an amount, and CI greps for
the last two. A `TOKEN:` asset's decimals are unknown to this bundle, so its amounts are rendered in
smallest units and **labelled as such** rather than guessed at eighteen.

## Auctions have a clock, and a leading bid is not a price

A late bid extends the close time (`bids.ts`), so the clock says so. An auction whose close
has passed but whose listing is still `active` is **"closing"**, not closed — `market` settles
auctions by a sweep. `untilLabel` answers `null` rather than "0 min", so a closed auction can never
read as live. And the reserve is off the wire on purpose (1190-1191) and checked at close, so the
leading bid is labelled a leading bid, every time, with the caveat beside it.

---

## Behaviour this estate insists on

1. **Every figure carries its observation time.** `src/lib/format.ts` answers `null` for a missing
   instant and no caller substitutes "just now".
2. **Never invent a number.** An unpriced listing sorts *last* in both directions — it is not a
   price of zero. A missing amount renders as `Not set`, italic, never as `0`.
3. **Degradation, not blank pages.** The four reads on a listing page are independent resources; one
   failing names itself and leaves the rest.
4. **No build-time config.** Hosts come from `cloudsforgeHosts()` at runtime; there is no `.env` and
   `test/no-build-time-config.test.ts` fails the build if `VITE_` ever appears.
5. **Honest 404.** `nginx.conf` enumerates the real routes and serves everything else through
   `error_page 404 /index.html`, keeping the status.
6. **Accessible.** Real contrast on the warm ash ground, keyboard navigable, and never colour alone
   for state — every badge is a glyph, a word and a colour, and the *unknown* badge is a different
   shape from both the positive and the negative one.

## Search is honest about its scope

`micro-market` has no text-search route and the browse route passes no limit, so the answer is
capped at 50 (`listings.ts`). The search box filters what that request returned, and the line
under it says so — because a filter that silently searches a fraction of the catalogue is how a
buyer concludes an item is not for sale.

## Layout

```
src/lib/market.ts       every request, each citing server.ts:<line>
src/lib/escrow.ts       known / unknown / unconfirmed, kept apart
src/lib/money.ts        bigint arithmetic and rendering, ported from the service
src/lib/breakdown.ts    the rows a reader sees, with their sum
src/lib/auction.ts      the clock, the floor, and what a leading bid is not
src/lib/search.ts       client-side filtering, and the sentence that admits it
src/lib/routes.ts       the addresses, declared once
src/pages/              browse · listing · sell · orders · collections · fees
test/                   359 tests; every one asserts a request, a number, or a refusal
```

## The one temporary thing

`@cloudsforge/ui` is consumed as `link:../ui/packages/ui` because it is not published. When it is,
the specifier becomes `^1.0.0` and three things go with it: the `uipkg` build context in the
`Dockerfile`, the second checkout in `.github/workflows/ci.yml`, and the two local jobs that exist
only because the reusable workflow cannot resolve a sibling that is not there.

## Docker

```
docker build -t market-web --build-context uipkg=../ui .
docker run --rm -p 55630:8080 market-web
```

The image carries no environment. It is built once and the same tag is promoted; the hosts it talks
to are resolved in the browser from the address the page was served on.

---

## Provenance

The code in this repository was written by **Claude Opus 5** and **Claude Fable 5**, assets
generated with **FLUX 2 Pro**, under human direction and review.
