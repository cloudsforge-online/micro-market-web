/**
 * One listing: what it is, what it costs, what is escrowed, and how to act on it.
 *
 * Five calls, each of them cited in `src/lib/market.ts`:
 *
 *   `GET /v1/listings/:id`        server.ts:636 — the listing and its royalty split in bps
 *   `GET /v1/listings/:id/risk`   server.ts:790 — verification and chain facts, FAILING OPEN
 *   `GET /v1/listings/:id/bids`   server.ts:846 — the auction, when there is one
 *   `GET /v1/listings/:id/offers` server.ts:893 — standing offers
 *   and one of buy / bid / offer, each requiring an Idempotency-Key.
 *
 * The four reads are independent, and one failing must not blank the others: a listing whose risk
 * call failed is still a listing somebody can read and buy. So each is its own resource with its
 * own degradation, and the page names what is missing rather than showing less and saying nothing.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Amount, Breakdown, MaybeAmount } from '../components/money.tsx'
import { Badge, EscrowPanel, ModerationNotice, RiskPanel, VerificationBadge } from '../components/status.tsx'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import {
  LEADING_BID_CAVEAT,
  LEADING_BID_LABEL,
  auctionClock,
  bidFloorFrom,
  leadingBid,
} from '../lib/auction.ts'
import { previewBreakdown } from '../lib/breakdown.ts'
import { escrowKnowledge, riskKnowledge } from '../lib/escrow.ts'
import {
  ASSET_KIND_COPY,
  LISTING_STATUS_COPY,
  PRICING_MODE_COPY,
  SETTLEMENT_MODE_COPY,
  ageLabel,
  shortSubject,
  utcDateTime,
} from '../lib/format.ts'
import { useIntent } from '../lib/intent.ts'
import {
  bidMinimum,
  buyListing,
  getListing,
  getListingRisk,
  listBids,
  listOffers,
  makeOffer,
  placeBid,
  type ListingDetail,
  type ListingView,
} from '../lib/market.ts'
import { formatMoney, parseAmountOrNull } from '../lib/money.ts'
import { orderPath } from '../lib/routes.ts'
import { useResource } from '../lib/resource.ts'

/** The uuid at the end of `/listings/<id>`. The router gives us the path; this reads the segment. */
function useListingId(): string {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  return decodeURIComponent(segments[1] ?? '')
}

export function ListingPage() {
  const id = useListingId()

  const loadListing = useCallback(
    (signal: AbortSignal) => getListing(id, { signal }),
    [id],
  )
  const listing = useResource(loadListing, () => 1, 'This listing did not load.')

  if (!id) {
    return (
      <Failed
        notice={{ message: 'That address does not name a listing.', requestId: undefined, forbidden: false }}
        title="No listing in this address"
      />
    )
  }
  // `listing.data === null` is doing real work here, and it is not defensive noise.
  //
  // A successful buy, bid or offer calls `onChanged` — `listing.reload()` — because the listing's
  // status and its bids have moved and the page must not keep showing the old ones. `useResource`
  // sets `loading` on a reload, so the naive `state === 'loading'` test replaced the WHOLE page
  // with a spinner, unmounting `ListingBody` and with it the `ActionOutcome` that had just been
  // rendered. The buyer's confirmation — including the only link to the order they had just paid
  // for — was destroyed by the refresh their own purchase triggered, and the screen settled back
  // to a listing with no evidence anything had happened.
  //
  // Found by BJ-MKT-05 and BJ-MKT-07 of docs/ecosystem/22-browser-journeys.md. A refresh over data
  // we already have is not a load: the previous answer stays on screen until the new one arrives,
  // which is also the only reading under which "no stale data left rendered as current" (hazard
  // H5) and "the page does not blank" can both hold.
  if (listing.state === 'loading' && listing.data === null) {
    return <Loading label="Loading the listing" />
  }
  if (listing.state === 'forbidden') return <Forbidden notice={listing.error ?? undefined} />
  if (listing.state === 'failed' || listing.data === null) {
    return (
      <Failed
        notice={listing.error ?? { message: 'This listing did not load.', requestId: undefined, forbidden: false }}
        onRetry={listing.reload}
        title="This listing did not load"
      />
    )
  }
  return <ListingBody detail={listing.data} onChanged={listing.reload} />
}

function ListingBody({ detail, onChanged }: { detail: ListingDetail; onChanged: () => void }) {
  const listing = detail.listing
  const price = parseAmountOrNull(listing.price)
  const clock = auctionClock(listing)

  const loadRisk = useCallback((signal: AbortSignal) => getListingRisk(listing.id, { signal }), [listing.id])
  // The count is 1 rather than the indicator count: a risk answer with no indicators is a real
  // answer, and reducing it to `empty` would render "nothing here" for a listing that was checked.
  const risk = useResource(loadRisk, () => 1, 'The chain facts did not load.')

  const loadBids = useCallback((signal: AbortSignal) => listBids(listing.id, { signal }), [listing.id])
  const bids = useResource(loadBids, () => 1, 'The bids did not load.')

  const loadOffers = useCallback((signal: AbortSignal) => listOffers(listing.id, { signal }), [listing.id])
  const offers = useResource(loadOffers, () => 1, 'The offers did not load.')

  const allBids = bids.data?.bids ?? []
  const leader = leadingBid(allBids)
  const leaderAmount = leader === null ? null : parseAmountOrNull(leader.amount)

  const preview = useMemo(() => {
    const basis = listing.pricingMode === 'auction' ? leaderAmount : price
    if (basis === null || basis <= 0n) return null
    return previewBreakdown({
      price: basis,
      assetCode: listing.assetCode,
      platformFeeBps: listing.platformFeeBps,
      royaltyBps: listing.royaltyBps,
      royaltyRecipients: detail.royalties,
    })
  }, [listing, detail.royalties, price, leaderAmount])

  return (
    <>
      <header className="mk-page__head">
        <div>
          <p className="mk-eyebrow">{ASSET_KIND_COPY[listing.assetKind] ?? listing.assetKind}</p>
          <h1 className="mk-page__title mk-page__title--urn cf-num">{listing.itemUrn}</h1>
          <p className="mk-page__lede">
            Listed by <span className="cf-num">{shortSubject(listing.sellerSubject)}</span>
            {' · '}
            {ageLabel(listing.createdAt) ?? 'at an unknown time'}
          </p>
        </div>
        <div className="mk-page__badges">
          <Badge
            tone={listing.status === 'active' ? 'good' : 'neutral'}
            label={LISTING_STATUS_COPY[listing.status] ?? listing.status}
          />
          {risk.data && <VerificationBadge verification={risk.data.verification} />}
        </div>
      </header>

      <ModerationNotice listing={listing} />

      <div className="mk-columns">
        <div className="mk-columns__main">
          <section className="mk-panel" aria-labelledby="mk-price-title">
            <div className="mk-panel__head">
              <h2 className="mk-panel__title" id="mk-price-title">
                {listing.pricingMode === 'auction' ? 'The auction' : 'The price'}
              </h2>
              <Badge tone="neutral" label={PRICING_MODE_COPY[listing.pricingMode] ?? listing.pricingMode} />
            </div>

            {listing.pricingMode === 'auction' ? (
              <AuctionBlock
                listing={listing}
                leaderAmount={leaderAmount}
                bidsFailed={bids.state === 'failed'}
                clockNote={clock.note}
                clockRemaining={clock.remaining}
                endsAt={clock.endsAt}
                leaderPlacedAt={leader?.placedAt ?? null}
              />
            ) : (
              <dl className="mk-facts">
                <dt>{listing.pricingMode === 'offers_only' ? 'Asking' : 'Price'}</dt>
                <dd>
                  <MaybeAmount
                    value={price}
                    assetCode={listing.assetCode}
                    absent={listing.pricingMode === 'offers_only' ? 'Open to offers' : 'No price set'}
                  />
                </dd>
                <dt>Quantity</dt>
                <dd className="cf-num">{listing.quantity}</dd>
                <dt>Settles</dt>
                <dd>{SETTLEMENT_MODE_COPY[listing.settlementMode] ?? listing.settlementMode}</dd>
                <dt>Expires</dt>
                <dd>{utcDateTime(listing.expiresAt) ?? <span className="mk-absent">No expiry set</span>}</dd>
              </dl>
            )}
          </section>

          {preview === null ? (
            <section className="mk-panel">
              <h2 className="mk-panel__title">Where the money would go</h2>
              <p className="mk-panel__body">
                There is no price to split yet.{' '}
                {listing.pricingMode === 'auction'
                  ? 'Once there is a bid, this shows exactly how that amount divides.'
                  : 'An offer sets the amount, and the split is taken from that.'}
              </p>
            </section>
          ) : (
            <section className="mk-panel">
              <h2 className="mk-panel__title">Where the money would go</h2>
              <Breakdown
                data={preview}
                caption={
                  listing.pricingMode === 'auction'
                    ? 'The leading bid, divided as it would settle'
                    : 'The price, divided as it would settle'
                }
              />
              <p className="mk-note">
                The platform fee is fixed on the listing when it is created, not read at
                settlement, so this rate is the one that will be charged.
              </p>
            </section>
          )}

          <ActionPanel listing={listing} leaderAmount={leaderAmount} onChanged={onChanged} />
        </div>

        <aside className="mk-columns__side">
          <EscrowPanel knowledge={escrowKnowledge(listing)} />

          {risk.state === 'failed' ? (
            // Degradation with a name on it. The risk route fails OPEN, so reaching this branch
            // means the request itself did not land — which is a different fact again from
            // `indicatorsAvailable: false`, and is said as one.
            <section className="mk-panel">
              <div className="mk-panel__head">
                <h2 className="mk-panel__title">What the chain says</h2>
                <Badge tone="unknown" label="Not loaded" />
              </div>
              <p className="mk-panel__body">
                We could not fetch the chain facts for this item. The rest of this page is
                unaffected, and nothing here should be read as a clean bill of health.
              </p>
              <button type="button" className="cf-btn" onClick={risk.reload}>
                Try again
              </button>
            </section>
          ) : risk.state === 'loading' ? (
            <Loading label="Reading the chain" />
          ) : (
            <RiskPanel knowledge={riskKnowledge(risk.data)} />
          )}

          <OffersPanel
            offers={offers.data?.offers ?? []}
            failed={offers.state === 'failed'}
            loading={offers.state === 'loading'}
            assetCode={listing.assetCode}
          />
        </aside>
      </div>
    </>
  )
}

function AuctionBlock({
  listing,
  leaderAmount,
  bidsFailed,
  clockNote,
  clockRemaining,
  endsAt,
  leaderPlacedAt,
}: {
  listing: ListingView
  leaderAmount: bigint | null
  bidsFailed: boolean
  clockNote: string
  clockRemaining: string | null
  endsAt: string | null
  leaderPlacedAt: string | null
}) {
  return (
    <>
      <dl className="mk-facts">
        <dt>{LEADING_BID_LABEL}</dt>
        <dd>
          {bidsFailed ? (
            <span className="mk-absent">Not loaded — we could not read the bids</span>
          ) : (
            <MaybeAmount value={leaderAmount} assetCode={listing.assetCode} absent="No bids yet" />
          )}
          {leaderPlacedAt !== null && (
            <span className="mk-stamp"> placed {ageLabel(leaderPlacedAt) ?? 'at an unknown time'}</span>
          )}
        </dd>
        <dt>Starting price</dt>
        <dd>
          <MaybeAmount
            value={parseAmountOrNull(listing.price)}
            assetCode={listing.assetCode}
            absent="None set"
          />
        </dd>
        <dt>Closes</dt>
        <dd>
          {endsAt === null ? (
            <span className="mk-absent">No close time recorded</span>
          ) : (
            <>
              {utcDateTime(endsAt)}
              {clockRemaining !== null && <b className="mk-countdown"> · {clockRemaining} left</b>}
            </>
          )}
        </dd>
      </dl>
      <p className="mk-note">{clockNote}</p>
      <p className="mk-note mk-note--strong">{LEADING_BID_CAVEAT}</p>
    </>
  )
}

function OffersPanel({
  offers,
  failed,
  loading,
  assetCode,
}: {
  offers: readonly { id: string; amount: string; offererSubject: string; status: string; createdAt: string }[]
  failed: boolean
  loading: boolean
  assetCode: string
}) {
  return (
    <section className="mk-panel" aria-labelledby="mk-offers-title">
      <h2 className="mk-panel__title" id="mk-offers-title">
        Offers
      </h2>
      {loading && <p className="mk-panel__body">Loading…</p>}
      {failed && (
        <p className="mk-panel__body">
          We could not read the offers on this listing. There may be some; we do not know.
        </p>
      )}
      {!loading && !failed && offers.length === 0 && (
        <p className="mk-panel__body">No standing offers.</p>
      )}
      {offers.length > 0 && (
        <ul className="mk-offers">
          {offers.map((offer) => {
            const amount = parseAmountOrNull(offer.amount)
            return (
              <li key={offer.id} className="mk-offers__row">
                <span>
                  {amount === null ? (
                    <span className="mk-absent">Unreadable amount</span>
                  ) : (
                    <Amount value={amount} assetCode={assetCode} />
                  )}
                </span>
                <span className="cf-num mk-offers__who">{shortSubject(offer.offererSubject)}</span>
                <span className="mk-offers__when">{ageLabel(offer.createdAt) ?? 'unknown time'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ acting on a listing */

type ActionResult =
  | { kind: 'none' }
  | { kind: 'ok'; message: string; orderId?: string; replayed: boolean }
  | { kind: 'error'; notice: ErrorNotice; minimum: string | null }

function ActionPanel({
  listing,
  leaderAmount,
  onChanged,
}: {
  listing: ListingView
  leaderAmount: bigint | null
  onChanged: () => void
}) {
  if (listing.frozen) {
    return (
      <section className="mk-panel">
        <h2 className="mk-panel__title">Buying is paused</h2>
        <p className="mk-panel__body">
          This listing is under review, so it cannot be bought, bid on, or offered against until
          the review finishes.
        </p>
      </section>
    )
  }
  if (listing.status !== 'active') {
    return (
      <section className="mk-panel">
        <h2 className="mk-panel__title">Not available</h2>
        <p className="mk-panel__body">
          This listing is {LISTING_STATUS_COPY[listing.status]?.toLowerCase() ?? listing.status}.
        </p>
      </section>
    )
  }
  if (listing.pricingMode === 'auction') {
    return <BidForm listing={listing} leaderAmount={leaderAmount} onChanged={onChanged} />
  }
  return (
    <>
      {listing.pricingMode === 'fixed' && <BuyForm listing={listing} onChanged={onChanged} />}
      <OfferForm listing={listing} onChanged={onChanged} />
    </>
  )
}

function BuyForm({ listing, onChanged }: { listing: ListingView; onChanged: () => void }) {
  const intent = useIntent('buy')
  const [result, setResult] = useState<ActionResult>({ kind: 'none' })
  const [busy, setBusy] = useState(false)
  const price = parseAmountOrNull(listing.price)

  const submit = async () => {
    if (price === null) return
    setBusy(true)
    try {
      // `amount` is the only body field the route reads (server.ts:829), and it is sent as the
      // service's own string rather than reformatted — a re-rendered amount is a chance to change
      // it, and the service compares it against the listing.
      const response = await buyListing(intent.key, listing.id, { amount: listing.price ?? '0' })
      setResult({
        kind: 'ok',
        message: response.replayed
          ? 'This purchase had already gone through under the same key. Here it is again — you have not been charged twice.'
          : 'Bought. The order is settled as a single ledger entry.',
        orderId: response.order.id,
        replayed: response.replayed,
      })
      intent.renew()
      onChanged()
    } catch (err) {
      setResult({ kind: 'error', notice: noticeFor(err, 'The purchase did not go through.'), minimum: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Buy it</h2>
      {price === null ? (
        <p className="mk-panel__body">This listing has no price, so there is nothing to buy at.</p>
      ) : (
        <>
          <p className="mk-panel__body">
            You pay <Amount value={price} assetCode={listing.assetCode} />. The fee and the royalty
            come out of that, not on top of it.
          </p>
          <button type="button" className="cf-btn cf-btn--ember" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Buying…' : 'Buy now'}
          </button>
          <p className="mk-note">
            Clicking twice is safe: this request carries an idempotency key, so a second attempt
            returns the first order rather than making a second one.
          </p>
        </>
      )}
      <ActionOutcome result={result} />
    </section>
  )
}

function BidForm({
  listing,
  leaderAmount,
  onChanged,
}: {
  listing: ListingView
  leaderAmount: bigint | null
  onChanged: () => void
}) {
  const intent = useIntent('bid')
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<ActionResult>({ kind: 'none' })
  const [busy, setBusy] = useState(false)

  // The floor is computed the way the service computes it — `bids.ts:203` — so the form offers the
  // minimum the service will actually accept rather than one it would refuse.
  const floor = bidFloorFrom(listing, leaderAmount)

  const submit = async () => {
    setBusy(true)
    try {
      const response = await placeBid(intent.key, listing.id, { amount })
      setResult({
        kind: 'ok',
        message:
          (response.replayed
            ? 'This bid had already been placed under the same key. '
            : 'Bid placed. ') +
          (response.outbid === null ? '' : 'It displaced the previous leader. ') +
          (response.auctionEndsAt === null
            ? ''
            : `It landed late enough to extend the auction, which now closes ${utcDateTime(response.auctionEndsAt)}.`),
        replayed: response.replayed,
      })
      intent.renew()
      onChanged()
    } catch (err) {
      // A `bid_too_low` 409 carries the minimum as a string (server.ts:413-427) so a bidder can
      // re-bid without a second round trip. Read off the parsed body, never off the sentence.
      setResult({
        kind: 'error',
        notice: noticeFor(err, 'The bid was not placed.'),
        minimum: bidMinimum(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Place a bid</h2>
      <p className="mk-panel__body">
        The smallest bid this auction will take is{' '}
        <Amount value={floor.minimum} assetCode={listing.assetCode} />
        {floor.basis === 'above_leader' ? ' — one unit above the leader.' : ' — the starting price.'}
      </p>
      <div className="mk-form__row">
        <label className="mk-field">
          <span className="mk-field__label">Your bid, in smallest units of {listing.assetCode}</span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={amount}
            placeholder={floor.minimum.toString()}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button type="button" className="cf-btn cf-btn--ember" disabled={busy || amount === ''} onClick={() => void submit()}>
          {busy ? 'Bidding…' : 'Bid'}
        </button>
      </div>
      <p className="mk-note">{LEADING_BID_CAVEAT}</p>
      <ActionOutcome result={result} assetCode={listing.assetCode} />
    </section>
  )
}

function OfferForm({ listing, onChanged }: { listing: ListingView; onChanged: () => void }) {
  const intent = useIntent('offer')
  const [amount, setAmount] = useState('')
  const [expires, setExpires] = useState('')
  const [result, setResult] = useState<ActionResult>({ kind: 'none' })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const response = await makeOffer(intent.key, listing.id, {
        amount,
        // Omitted rather than sent empty: `readDate` (server.ts:1348-1354) refuses anything that
        // is not a valid ISO string, so `expiresAt: ''` would be a 400.
        ...(expires === '' ? {} : { expiresAt: new Date(expires).toISOString() }),
      })
      setResult({
        kind: 'ok',
        message: response.replayed
          ? 'That offer had already been made under the same key.'
          : 'Offer made. The seller decides; your funds are reserved until they do or it expires.',
        replayed: response.replayed,
      })
      intent.renew()
      onChanged()
    } catch (err) {
      setResult({ kind: 'error', notice: noticeFor(err, 'The offer was not made.'), minimum: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Make an offer</h2>
      <div className="mk-form__row">
        <label className="mk-field">
          <span className="mk-field__label">Your offer, in smallest units of {listing.assetCode}</span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Expires (optional)</span>
          <input
            className="cf-input"
            type="datetime-local"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </label>
        <button type="button" className="cf-btn" disabled={busy || amount === ''} onClick={() => void submit()}>
          {busy ? 'Offering…' : 'Offer'}
        </button>
      </div>
      <p className="mk-note">
        An offer reserves your funds in Forge Ledger until it is accepted, withdrawn or expires.
        That reservation is a journal entry, not a balance Forge Market holds.
      </p>
      <ActionOutcome result={result} assetCode={listing.assetCode} />
    </section>
  )
}

function ActionOutcome({ result, assetCode }: { result: ActionResult; assetCode?: string }) {
  if (result.kind === 'none') return null
  if (result.kind === 'ok') {
    return (
      <div className="mk-notice mk-notice--ok" role="status">
        <p className="mk-notice__title">
          <span aria-hidden="true">✓ </span>
          {result.replayed ? 'Already done' : 'Done'}
        </p>
        <p className="mk-notice__body">{result.message}</p>
        {result.orderId && (
          <Link className="cf-btn" to={orderPath(result.orderId)}>
            See the order
          </Link>
        )}
      </div>
    )
  }
  const minimum = result.minimum === null ? null : parseAmountOrNull(result.minimum)
  return (
    <div className="mk-notice mk-notice--error" role="alert">
      <p className="mk-notice__title">
        <span aria-hidden="true">■ </span>
        That did not go through
      </p>
      <p className="mk-notice__body">{result.notice.message}</p>
      {minimum !== null && assetCode && (
        <p className="mk-notice__body">
          The smallest bid that would be accepted is{' '}
          {formatMoney(minimum, assetCode).text} {assetCode}.
        </p>
      )}
      {result.notice.requestId && (
        <p className="mk-notice__meta">
          Quote this to support: <code className="cf-num mk-reqid">{result.notice.requestId}</code>
        </p>
      )}
    </div>
  )
}
