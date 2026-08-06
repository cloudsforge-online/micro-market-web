/**
 * One listing: what it is, what it costs, what is escrowed, and how to act on it.
 *
 * Five calls, each of them cited in `src/lib/market.ts`:
 *
 *   `GET /v1/listings/:id`        server.ts — the listing and its royalty split in bps
 *   `GET /v1/listings/:id/risk`   server.ts — verification and chain facts, FAILING OPEN
 *   `GET /v1/listings/:id/bids`   server.ts — the auction, when there is one
 *   `GET /v1/listings/:id/offers` server.ts — standing offers
 *   and one of buy / bid / offer, each requiring an Idempotency-Key.
 *
 * The gallery is NOT a sixth call: `GET /v1/listings/:id` carries `images` alongside the listing,
 * so the photographs arrive with the text rather than a round trip later. See
 * `components/gallery.tsx` for the three states one of those images can be in — and for why none of
 * them is a badge.
 *
 * The four reads are independent, and one failing must not blank the others: a listing whose risk
 * call failed is still a listing somebody can read and buy. So each is its own resource with its
 * own degradation, and the page names what is missing rather than showing less and saying nothing.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Gallery } from '../components/gallery.tsx'
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
import { useSubmit } from '../lib/submit.ts'

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
  const listing = useResource(loadListing, () => 1, 'We could not read this listing.')

  if (!id) {
    return (
      <Failed
        notice={{ message: 'This address does not point at a listing.', requestId: undefined, forbidden: false }}
        title="Nothing to show for that address"
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
    return <Loading label="Reading the listing" />
  }
  if (listing.state === 'forbidden') return <Forbidden notice={listing.error ?? undefined} />
  if (listing.state === 'failed' || listing.data === null) {
    return (
      <Failed
        notice={listing.error ?? { message: 'We could not read this listing.', requestId: undefined, forbidden: false }}
        onRetry={listing.reload}
        title="We could not read this listing"
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
  const risk = useResource(loadRisk, () => 1, 'We could not read what the chain says about this.')

  const loadBids = useCallback((signal: AbortSignal) => listBids(listing.id, { signal }), [listing.id])
  const bids = useResource(loadBids, () => 1, 'We could not read the bids.')

  const loadOffers = useCallback((signal: AbortSignal) => listOffers(listing.id, { signal }), [listing.id])
  const offers = useResource(loadOffers, () => 1, 'We could not read the offers.')

  // `?? []` is the shape `src/lib/resource.ts` warns about — "reporting 'nothing here' for a
  // timeout is how an outage reads as a quiet week" — so the failure travels alongside it. Nothing
  // downstream may read this empty array without also reading `bidsFailed`: an auction whose bids
  // did not load has an UNKNOWN leader, not no leader, and the two lead to different sentences and
  // to a different bid floor.
  const bidsFailed = bids.state === 'failed'
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

      {/*
        Above the price, below the moderation notice. A photograph is the first thing a buyer looks
        at, and it must not push a "this listing is under review" warning off the top of the screen.
        `?? []` because `images` is optional on the wire type: a service older than this bundle sends
        no such key, and `.map` on `undefined` would blank the whole page rather than the gallery.
      */}
      <Gallery images={detail.images ?? []} itemUrn={listing.itemUrn} />

      <div className="mk-columns">
        <div className="mk-columns__main">
          <section className="mk-panel" aria-labelledby="mk-price-title">
            <div className="mk-panel__head">
              <h2 className="mk-panel__title" id="mk-price-title">
                {listing.pricingMode === 'auction' ? 'The bidding' : 'What it costs'}
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
                <dt>{listing.pricingMode === 'offers_only' ? 'Seller hopes for' : 'Asking'}</dt>
                <dd>
                  <MaybeAmount
                    value={price}
                    assetCode={listing.assetCode}
                    absent={listing.pricingMode === 'offers_only' ? 'Whatever you think it is worth' : 'Nothing asked'}
                  />
                </dd>
                <dt>Quantity</dt>
                <dd className="cf-num">{listing.quantity}</dd>
                <dt>Handed over by</dt>
                <dd>{SETTLEMENT_MODE_COPY[listing.settlementMode] ?? listing.settlementMode}</dd>
                <dt>Comes down</dt>
                <dd>{utcDateTime(listing.expiresAt) ?? <span className="mk-absent">Not set to come down</span>}</dd>
              </dl>
            )}
          </section>

          {preview === null ? (
            <section className="mk-panel">
              <h2 className="mk-panel__title">How the money would divide</h2>
              {listing.pricingMode === 'auction' && bidsFailed ? (
                // Not "there is no price to split yet". We did not read the bids, so we do not
                // know whether there is one — and "once there is a bid" would be this page
                // asserting the auction is empty on the strength of a request that failed.
                <p className="mk-panel__body">
                  The bids on this listing came back unreadable, so we have no figure to work
                  from. Somebody may perfectly well be leading it — what failed is our reading of
                  the bids, not the bidding.
                </p>
              ) : (
                <p className="mk-panel__body">
                  There is no price to split yet.{' '}
                  {listing.pricingMode === 'auction'
                    ? 'The first bid gives us an amount, and this panel then shows exactly where every unit of it lands.'
                    : 'Whatever an offer names becomes the amount, and the division is taken out of that.'}
                </p>
              )}
            </section>
          ) : (
            <section className="mk-panel">
              <h2 className="mk-panel__title">How the money would divide</h2>
              <Breakdown
                data={preview}
                caption={
                  listing.pricingMode === 'auction'
                    ? 'The bid in front, split the way it would settle'
                    : 'The asking price, split the way it would settle'
                }
              />
              <p className="mk-note">
Our share was stamped onto this listing the day it went up rather than looked up when it sells, so the rate you can see here is the rate that will actually be taken.
              </p>
            </section>
          )}

          <ActionPanel
            listing={listing}
            leaderAmount={leaderAmount}
            bidsFailed={bidsFailed}
            onChanged={onChanged}
          />
        </div>

        <aside className="mk-columns__side">
          <EscrowPanel knowledge={escrowKnowledge(listing)} />

          {risk.state === 'failed' ? (
            // Degradation with a name on it. The risk route fails OPEN, so reaching this branch
            // means the request itself did not land — which is a different fact again from
            // `indicatorsAvailable: false`, and is said as one.
            <section className="mk-panel">
              <div className="mk-panel__head">
                <h2 className="mk-panel__title">What the chain shows</h2>
                <Badge tone="unknown" label="Not loaded" />
              </div>
              <p className="mk-panel__body">
We could not reach the chain to look this item up. Nothing else on the page is affected — but do not read the gap as reassurance, because nothing was checked.
              </p>
              <button type="button" className="cf-btn" onClick={risk.reload}>
                Try again
              </button>
            </section>
          ) : risk.state === 'loading' ? (
            <Loading label="Looking the item up on chain" />
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
      {loading && <p className="mk-panel__body">Reading them…</p>}
      {failed && (
        <p className="mk-panel__body">
          The offers on this listing came back unreadable. There may be several standing, or none — we cannot tell you which.
        </p>
      )}
      {!loading && !failed && offers.length === 0 && (
        <p className="mk-panel__body">Nobody has put an offer forward.</p>
      )}
      {offers.length > 0 && (
        <ul className="mk-offers">
          {offers.map((offer) => {
            const amount = parseAmountOrNull(offer.amount)
            return (
              <li key={offer.id} className="mk-offers__row">
                <span>
                  {amount === null ? (
                    <span className="mk-absent">amount we cannot read</span>
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
  bidsFailed,
  onChanged,
}: {
  listing: ListingView
  leaderAmount: bigint | null
  /** The bids read failed, so `leaderAmount === null` means UNKNOWN rather than "no bids". */
  bidsFailed: boolean
  onChanged: () => void
}) {
  if (listing.frozen) {
    return (
      <section className="mk-panel">
        <h2 className="mk-panel__title">On hold</h2>
        <p className="mk-panel__body">
          Somebody is looking at this listing. While that is under review nothing can be bought,
          bid or offered against it. It has not been taken down, and it may well come back
          untouched.
        </p>
      </section>
    )
  }
  if (listing.status !== 'active') {
    return (
      <section className="mk-panel">
        <h2 className="mk-panel__title">You cannot act on this one</h2>
        <p className="mk-panel__body">
          It is {LISTING_STATUS_COPY[listing.status]?.toLowerCase() ?? listing.status}, so there is
          nothing here left to buy or bid on.
        </p>
      </section>
    )
  }
  if (listing.pricingMode === 'auction') {
    return (
      <BidForm
        listing={listing}
        leaderAmount={leaderAmount}
        bidsFailed={bidsFailed}
        onChanged={onChanged}
      />
    )
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
  const { busy, run } = useSubmit()
  const price = parseAmountOrNull(listing.price)

  // `run` latches on a ref, so the second click of a double click never becomes a second request.
  // That is not belt-and-braces on top of the idempotency key — the key stops a second ORDER, and
  // this stops the second REQUEST, whose 503 `in_flight` (server.ts) this component would
  // otherwise render as "The purchase did not go through." for a purchase that went through. The
  // note under the button promises the reader that clicking twice is safe; this is what makes it
  // true on the screen as well as in the ledger.
  const submit = () =>
    run(async () => {
      if (price === null) return
      try {
        // `amount` is the only body field the route reads (server.ts), and it is sent as the
        // service's own string rather than reformatted — a re-rendered amount is a chance to change
        // it, and the service compares it against the listing.
        const response = await buyListing(intent.key, listing.id, { amount: listing.price ?? '0' })
        setResult({
          kind: 'ok',
          message: response.replayed
            ? 'This purchase had already gone through under the same key. Here it is again — you have not been charged twice.'
            : 'It is yours. The whole sale posted as one ledger entry.',
          orderId: response.order.id,
          replayed: response.replayed,
        })
        intent.renew()
        onChanged()
      } catch (err) {
        setResult({ kind: 'error', notice: noticeFor(err, 'The purchase did not go through.'), minimum: null })
      }
    })

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Take it</h2>
      {price === null ? (
        <p className="mk-panel__body">
          No price is set on this listing, so there is no figure to buy it at.
        </p>
      ) : (
        <>
          <p className="mk-panel__body">
            It costs you <Amount value={price} assetCode={listing.assetCode} /> and no more. Our
            share and any royalty are carved out of that figure rather than added to it, and the
            whole sale posts as one entry.
          </p>
          <button type="button" className="cf-btn cf-btn--ember" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Going through…' : 'Buy it now'}
          </button>
          <p className="mk-note">
            Click as many times as you like. Every attempt is tagged, so the second one hands
            back the order the first one made instead of buying the thing again.
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
  bidsFailed,
  onChanged,
}: {
  listing: ListingView
  leaderAmount: bigint | null
  bidsFailed: boolean
  onChanged: () => void
}) {
  const intent = useIntent('bid')
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<ActionResult>({ kind: 'none' })
  const { busy, run } = useSubmit()

  // The floor is computed the way the service computes it — `bids.ts` — so the form offers the
  // minimum the service will actually accept rather than one it would refuse.
  const floor = bidFloorFrom(listing, leaderAmount)

  const submit = () =>
    run(async () => {
      try {
        const response = await placeBid(intent.key, listing.id, { amount })
        setResult({
          kind: 'ok',
          message:
            (response.replayed
              ? 'You had already placed this bid, and it still stands. '
              : 'Your bid is in. ') +
            (response.outbid === null ? '' : 'You are now in front. ') +
            (response.auctionEndsAt === null
              ? ''
              : `It came in late enough to push the clock back, so bidding now runs until ${utcDateTime(response.auctionEndsAt)}.`),
          replayed: response.replayed,
        })
        intent.renew()
        onChanged()
      } catch (err) {
        // A `bid_too_low` 409 carries the minimum as a string (server.ts) so a bidder can
        // re-bid without a second round trip. Read off the parsed body, never off the sentence.
        setResult({
          kind: 'error',
          notice: noticeFor(err, 'The bid was not placed.'),
          minimum: bidMinimum(err),
        })
      }
    })

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Bid on it</h2>
      {bidsFailed ? (
        // The floor is `minimumBid(leader ?? null, startingPrice)`, and we could not read the
        // leader. Stating the starting price as "the smallest bid this auction will take" would
        // send a bidder straight into a `bid_too_low` 409 with a figure this page invented from an
        // empty array that a 500 produced. So the starting price is named as what it is, and the
        // unknown is named as an unknown.
        <p className="mk-panel__body">
          The bids came back unreadable, so we cannot tell you what the smallest acceptable bid
          is. Bidding opened at{' '}
          <MaybeAmount
            value={parseAmountOrNull(listing.price)}
            assetCode={listing.assetCode}
            absent="not set"
          />
          ; if somebody is ahead already, you need one unit more than they put up. Bid the figure
          you actually mean. Anything too low is turned away, and the refusal tells you precisely
          what would have been enough.
        </p>
      ) : (
        <p className="mk-panel__body">
          The least you can bid right now is{' '}
          <Amount value={floor.minimum} assetCode={listing.assetCode} />
          {floor.basis === 'above_leader' ? ', one unit past whoever is in front.' : ', which is where the bidding opened.'}
        </p>
      )}
      <div className="mk-form__row">
        <label className="mk-field">
          <span className="mk-field__label">What you are bidding, in smallest units of {listing.assetCode}</span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={amount}
            // No placeholder when the bids did not load: a greyed-out figure in the field is a
            // suggestion, and suggesting the starting price to somebody who may be bidding against
            // a leader we could not see is the same wrong number in a quieter voice.
            placeholder={bidsFailed ? '' : floor.minimum.toString()}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button type="button" className="cf-btn cf-btn--ember" disabled={busy || amount === ''} onClick={() => void submit()}>
          {busy ? 'Placing it…' : 'Place this bid'}
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
  const { busy, run } = useSubmit()

  const submit = () =>
    run(async () => {
      try {
        const response = await makeOffer(intent.key, listing.id, {
          amount,
          // Omitted rather than sent empty: `readDate` (server.ts) refuses anything that
          // is not a valid ISO string, so `expiresAt: ''` would be a 400.
          ...(expires === '' ? {} : { expiresAt: new Date(expires).toISOString() }),
        })
        setResult({
          kind: 'ok',
          message: response.replayed
            ? 'You had already sent this offer, and it is still standing.'
            : 'Sent. It is the seller\'s call now, and your money stays reserved until they answer or it runs out.',
          replayed: response.replayed,
        })
        intent.renew()
        onChanged()
      } catch (err) {
        setResult({ kind: 'error', notice: noticeFor(err, 'The offer was not made.'), minimum: null })
      }
    })

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Offer what you think it is worth</h2>
      <div className="mk-form__row">
        <label className="mk-field">
          <span className="mk-field__label">What you are offering, in smallest units of {listing.assetCode}</span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Withdraw it automatically at (optional)</span>
          <input
            className="cf-input"
            type="datetime-local"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </label>
        <button type="button" className="cf-btn" disabled={busy || amount === ''} onClick={() => void submit()}>
          {busy ? 'Sending it…' : 'Send this offer'}
        </button>
      </div>
      <p className="mk-note">
Offering puts the money aside in Forge Ledger the moment you send it, and there it stays until the seller takes it, you pull it back, or it runs out of time. Only one offer of yours can stand against a listing at a time. Nothing is transferred to us — the hold is a bookkeeping entry against your own balance.
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
          {result.replayed ? 'This had already gone through' : 'That worked'}
        </p>
        <p className="mk-notice__body">{result.message}</p>
        {result.orderId && (
          <Link className="cf-btn" to={orderPath(result.orderId)}>
            Open the order
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
        It did not go through
      </p>
      <p className="mk-notice__body">{result.notice.message}</p>
      {minimum !== null && assetCode && (
        <p className="mk-notice__body">
          Bid at least{' '}
          {formatMoney(minimum, assetCode).text} {assetCode}.
        </p>
      )}
      {result.notice.requestId && (
        <p className="mk-notice__meta">
          Give support this reference:{' '}
          <code className="cf-num mk-reqid">{result.notice.requestId}</code>
        </p>
      )}
    </div>
  )
}
