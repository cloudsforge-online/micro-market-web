/**
 * Sell: create a listing, and see your own — including the drafts nobody else can.
 *
 * Three calls: `GET /v1/listings?sellerSubject=` (server.ts, 626), `POST /v1/listings`
 * (server.ts) and `POST /v1/listings/:id/activate` (server.ts).
 *
 * ── The activate step is where this page earns its keep ───────────────────────────────────────
 *
 * An `onchain` listing is created as a draft and then activated, and activation FAILS CLOSED on
 * the chain index (server.ts). Two different failures come back, and the estate has just
 * spent a release on a client that reported them as one:
 *
 *   503 `indexer_unavailable`  — we could not confirm. We do not know. Wait.
 *   409 `state_conflict`       — the index answered: the escrow is not confirmed. Post it, or wait
 *                                for confirmations.
 *
 * `diagnoseActivation` in `lib/escrow.ts` separates them, and this page renders the two with
 * different words, a different tone and a different suggested action.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GalleryEditor } from '../components/gallery.tsx'
import { Amount, Breakdown } from '../components/money.tsx'
import { Badge } from '../components/status.tsx'
import { Empty, Failed, Loading } from '../components/states.tsx'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { useSession } from '../lib/auth.tsx'
import { previewBreakdown } from '../lib/breakdown.ts'
import { diagnoseActivation, escrowKnowledge, type ActivationDiagnosis } from '../lib/escrow.ts'
import {
  ASSET_KIND_COPY,
  LISTING_STATUS_COPY,
  PRICING_MODE_COPY,
  SETTLEMENT_MODE_COPY,
  ageLabel,
} from '../lib/format.ts'
import { useIntent } from '../lib/intent.ts'
import {
  ASSET_KINDS,
  PRICING_MODES,
  SETTLEMENT_MODES,
  activateListing,
  createListing,
  listListings,
  type AssetKind,
  type ListingView,
  type PricingMode,
  type SettlementMode,
} from '../lib/market.ts'
import { AmountError, parseAmount, parseAmountOrNull } from '../lib/money.ts'
import { listingPath } from '../lib/routes.ts'
import { useResource } from '../lib/resource.ts'
import { useSubmit } from '../lib/submit.ts'

export function SellPage() {
  const { subject } = useSession()

  const load = useCallback(
    (signal: AbortSignal) => {
      if (!subject) return Promise.resolve({ listings: [] as readonly ListingView[] })
      // NOT filtered by status: the default is `active` (server.ts), and a seller's own page
      // that hid their drafts would hide exactly the listings that still need activating.
      return listListings({ sellerSubject: subject, status: 'draft' }, { signal })
    },
    [subject],
  )
  // `[subject]`: it is null until `GET /auth/me` answers, which is always after mount.
  const drafts = useResource(load, (data) => data.listings.length, 'We could not read what you have waiting.', [
    subject,
  ])

  const loadLive = useCallback(
    (signal: AbortSignal) => {
      if (!subject) return Promise.resolve({ listings: [] as readonly ListingView[] })
      return listListings({ sellerSubject: subject, status: 'active' }, { signal })
    },
    [subject],
  )
  const live = useResource(loadLive, (data) => data.listings.length, 'We could not read what you have on sale.', [
    subject,
  ])

  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">Sell</h1>
          <p className="mk-page__lede">
            Post an item at a set price, open it to bidding, or invite offers and pick the one you
            like. Our share is carved out of what it sells for rather than added to it, and you
            keep everything left once that and any royalty are taken. The{' '}
            <Link to="/fees">figures are here</Link>.
          </p>
        </div>
      </header>

      <CreateListingForm
        onCreated={() => {
          drafts.reload()
          live.reload()
        }}
      />

      <section className="mk-panel">
        <h2 className="mk-panel__title">Waiting to go up</h2>
        <p className="mk-panel__body">
          Nobody can see a draft but you, and nothing about it is committed. It reaches the market
          when you activate it, at which point the item is locked away so it cannot be sold twice.
          If you chose to settle on chain, activation waits until we can see your escrow
          transaction confirmed.
        </p>
        {drafts.state === 'loading' && <Loading label="Reading what you have waiting" />}
        {drafts.state === 'failed' && drafts.error && (
          <Failed notice={drafts.error} onRetry={drafts.reload} title="We could not read your drafts" />
        )}
        {drafts.state === 'empty' && (
          <Empty
            title="Nothing waiting"
            hint="Everything you have posted is either on the market or already done with."
          />
        )}
        {drafts.state === 'ok' &&
          (drafts.data?.listings ?? []).map((listing) => (
            <DraftRow
              key={listing.id}
              listing={listing}
              onActivated={() => {
                drafts.reload()
                live.reload()
              }}
              onDraftChanged={drafts.reload}
            />
          ))}
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">On the market now</h2>
        {live.state === 'loading' && <Loading label="Reading what you have on sale" />}
        {live.state === 'failed' && live.error && (
          <Failed notice={live.error} onRetry={live.reload} title="We could not read your listings" />
        )}
        {live.state === 'empty' && (
          <Empty
            title="You have nothing on sale"
            hint="Fill in the form above and it will show up here once you activate it."
          />
        )}
        {live.state === 'ok' && (
          <ul className="mk-rows">
            {(live.data?.listings ?? []).map((listing) => (
              <LiveRow key={listing.id} listing={listing} onChanged={live.reload} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ activation */

function DraftRow({
  listing,
  onActivated,
  onDraftChanged,
}: {
  listing: ListingView
  onActivated: () => void
  /** Re-read the drafts after a gallery change. Separate from `onActivated`, which also re-reads
   *  the LIVE list — a draft whose photograph changed has not gone anywhere. */
  onDraftChanged: () => void
}) {
  const intent = useIntent('activate')
  const [tx, setTx] = useState('')
  const [chain, setChain] = useState('ember')
  const { busy, run } = useSubmit()
  const [diagnosis, setDiagnosis] = useState<ActivationDiagnosis | null>(null)
  const knowledge = escrowKnowledge(listing)
  const onchain = listing.settlementMode === 'onchain'

  // A ref latch, not `busy`, because activation FAILS CLOSED on the chain index (see the file
  // header). Two same-tick presses are two independent indexer reads under one key, and the second
  // one's answer — 503 `indexer_unavailable` or 409 `state_conflict` — would be diagnosed and
  // rendered over the first one's success. The seller would be told to go and re-post an escrow
  // that has just been accepted.
  const submit = () =>
    run(async () => {
      setDiagnosis(null)
      try {
        // For a custodial listing the route reads no body fields at all (server.ts), so none is
        // sent. A field the route ignores is a field a seller will believe did something.
        await activateListing(intent.key, listing.id, onchain ? { onchainEscrowTx: tx, chain } : {})
        intent.renew()
        onActivated()
      } catch (err) {
        setDiagnosis(diagnoseActivation(err))
      }
    })

  return (
    <div className="mk-draft">
      <div className="mk-draft__head">
        <Link className="cf-num" to={listingPath(listing.id)}>
          {listing.itemUrn}
        </Link>
        <Badge tone="neutral" label={SETTLEMENT_MODE_COPY[listing.settlementMode] ?? listing.settlementMode} />
        <Badge tone={knowledge.known ? 'good' : 'unknown'} label={knowledge.title} />
      </div>
      <p className="mk-note">{knowledge.detail}</p>
      {onchain && (
        <div className="mk-form__row">
          <label className="mk-field">
            <span className="mk-field__label">Hash of the escrow transaction</span>
            <input
              className="cf-input cf-num"
              value={tx}
              placeholder="0x…"
              onChange={(event) => setTx(event.target.value)}
            />
          </label>
          <label className="mk-field">
            <span className="mk-field__label">Chain</span>
            <input className="cf-input" value={chain} onChange={(event) => setChain(event.target.value)} />
          </label>
        </div>
      )}
      <button
        type="button"
        className="cf-btn cf-btn--ember"
        disabled={busy || (onchain && tx.trim() === '')}
        onClick={() => void submit()}
      >
        {busy ? 'Activating…' : 'Activate'}
      </button>
      {diagnosis && <ActivationNotice diagnosis={diagnosis} />}
      {/*
        A draft is where photographs are added, because a draft is the listing being composed — and
        because there is no separate edit page on this surface. `onDraftChanged` re-reads the
        drafts so the gallery this component is handed is the one the service now holds, rather
        than a local copy that would drift the first time a write partially failed.
      */}
      <GalleryEditor
        listingId={listing.id}
        images={listing.images ?? []}
        itemUrn={listing.itemUrn}
        onChanged={onDraftChanged}
      />
    </div>
  )
}

/**
 * One live listing of the seller's own, with its photographs editable in place.
 *
 * An ACTIVE listing's gallery is still the seller's to change — `micro-market` allows `draft` and
 * `active` and refuses every other status, because a sold listing's photographs are part of the
 * record of what was sold. So a seller who notices a badly-lit photograph after going live can
 * replace it without cancelling and relisting, which would release the escrow and lose the
 * listing's age and its bids.
 *
 * `onChanged` re-reads the seller's live listings rather than mutating a local copy: the service
 * returns the resulting gallery on every write, but the ROW also carries a status and a frozen flag
 * that a moderation case may have changed since this page loaded.
 */
function LiveRow({ listing, onChanged }: { listing: ListingView; onChanged: () => void }) {
  const price = parseAmountOrNull(listing.price)
  return (
    <li className="mk-rows__row mk-rows__row--stacked">
      <div className="mk-rows__line">
        <Link className="cf-num" to={listingPath(listing.id)}>
          {listing.itemUrn}
        </Link>
        <span>
          {price === null ? (
            <span className="mk-absent">No price</span>
          ) : (
            <Amount value={price} assetCode={listing.assetCode} />
          )}
        </span>
        <Badge tone="good" label={LISTING_STATUS_COPY[listing.status] ?? listing.status} />
        {listing.frozen && <Badge tone="warn" label="Under review" />}
        <span className="mk-rows__when">{ageLabel(listing.createdAt) ?? 'unknown time'}</span>
      </div>
      {listing.frozen ? (
        // The service refuses a gallery change on a frozen listing with a 403 `listing_frozen`, so
        // the control is not offered. A button that can only fail is a button that teaches a seller
        // the app is broken during the one moment they are already worried.
        <p className="mk-note">
          While this listing is under review its photographs are locked. You will get them back
          when the review closes.
        </p>
      ) : (
        <GalleryEditor
          listingId={listing.id}
          images={listing.images ?? []}
          itemUrn={listing.itemUrn}
          onChanged={onChanged}
        />
      )}
    </li>
  )
}

/**
 * The two sentences this whole repository was briefed on.
 *
 * `escrowIsUnknown` and `escrowIsUnconfirmed` are separate booleans, and exactly one of them is
 * ever true. The unknown case is a `status` role, not an `alert`, and its words never contain the
 * phrase "not confirmed" — because a seller who reads that goes and re-posts an escrow that is
 * already on the chain.
 */
function ActivationNotice({ diagnosis }: { diagnosis: ActivationDiagnosis }) {
  const unknown = diagnosis.escrowIsUnknown
  return (
    <div
      className={`mk-notice ${unknown ? 'mk-notice--unknown' : 'mk-notice--error'}`}
      role={unknown ? 'status' : 'alert'}
    >
      <p className="mk-notice__title">
        <span aria-hidden="true">{unknown ? '? ' : '■ '}</span>
        {unknown ? 'We could not confirm it' : 'It did not go up'}
      </p>
      <p className="mk-notice__body">{diagnosis.message}</p>
      {diagnosis.requestId && (
        <p className="mk-notice__meta">
          Quote this to support: <code className="cf-num mk-reqid">{diagnosis.requestId}</code>
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ creating */

function CreateListingForm({ onCreated }: { onCreated: () => void }) {
  const intent = useIntent('listing')
  const [assetKind, setAssetKind] = useState<AssetKind>('game_item')
  const [pricingMode, setPricingMode] = useState<PricingMode>('fixed')
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('custodial')
  const [itemUrn, setItemUrn] = useState('')
  const [assetCode, setAssetCode] = useState('SHARD')
  const [itemAssetCode, setItemAssetCode] = useState('SHARD')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [royaltyBps, setRoyaltyBps] = useState('0')
  const [royaltySubject, setRoyaltySubject] = useState('')
  const { busy, run } = useSubmit()
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [created, setCreated] = useState<{ id: string; degraded: boolean } | null>(null)

  const bps = Number.parseInt(royaltyBps, 10)
  const royaltyOk = Number.isInteger(bps) && bps >= 0 && bps <= 10_000

  /**
   * The preview.
   *
   * `platformFeeBps` is NOT in this form: `server.ts` snapshots it from the service's own
   * environment and never reads it from the body, so a field here would be a control that does
   * nothing. Until a listing exists there is no fee rate to show, so the preview shows the
   * royalty split and says the platform's cut is added by the service.
   */
  const preview = useMemo(() => {
    const amount = parseAmountOrNull(price)
    if (amount === null || amount <= 0n || !royaltyOk) return null
    if (bps > 0 && royaltySubject.trim() === '') return null
    try {
      return previewBreakdown({
        price: amount,
        assetCode,
        platformFeeBps: 0,
        royaltyBps: bps,
        royaltyRecipients: bps > 0 ? [{ subject: royaltySubject.trim(), bps: 10_000 }] : [],
      })
    } catch {
      return null
    }
  }, [price, assetCode, bps, royaltyOk, royaltySubject])

  const submit = () =>
    run(async () => {
      setError(null)
      try {
        // Validated here first, with the service's own rule, so a malformed amount fails on the
        // field that is wrong rather than as a 400 the reader has to translate back.
        const amount = pricingMode === 'offers_only' ? null : parseAmount(price, 'price')
        const response = await createListing(intent.key, {
          assetKind,
          pricingMode,
          settlementMode,
          itemUrn: itemUrn.trim(),
          itemAssetCode,
          assetCode,
          price: amount === null ? null : amount.toString(),
          quantity: parseAmount(quantity, 'quantity').toString(),
          royaltyBps: bps,
          ...(bps > 0 ? { royaltyRecipients: [{ subject: royaltySubject.trim(), bps: 10_000 }] } : {}),
        })
        setCreated({ id: response.listing.id, degraded: response.policy.degraded })
        intent.renew()
        onCreated()
      } catch (err) {
        setError(
          err instanceof AmountError
            ? { message: err.message, requestId: undefined, forbidden: false }
            : noticeFor(err, 'The listing was not created.'),
        )
      }
    })

  return (
    <section className="mk-panel mk-panel--action">
      <h2 className="mk-panel__title">Put something up for sale</h2>
      <div className="mk-form">
        <label className="mk-field">
          <span className="mk-field__label">Item URN — the address this item answers to</span>
          <input
            className="cf-input cf-num"
            value={itemUrn}
            placeholder="cf:worlds:item:…"
            onChange={(event) => setItemUrn(event.target.value)}
          />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">What sort of thing it is</span>
          <select className="cf-input" value={assetKind} onChange={(e) => setAssetKind(e.target.value as AssetKind)}>
            {ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {ASSET_KIND_COPY[kind] ?? kind}
              </option>
            ))}
          </select>
        </label>
        <label className="mk-field">
          <span className="mk-field__label">How you want it sold</span>
          <select
            className="cf-input"
            value={pricingMode}
            onChange={(e) => setPricingMode(e.target.value as PricingMode)}
          >
            {PRICING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PRICING_MODE_COPY[mode] ?? mode}
              </option>
            ))}
          </select>
        </label>
        <label className="mk-field">
          <span className="mk-field__label">How the handover happens</span>
          <select
            className="cf-input"
            value={settlementMode}
            onChange={(e) => setSettlementMode(e.target.value as SettlementMode)}
          >
            {SETTLEMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {SETTLEMENT_MODE_COPY[mode] ?? mode}
              </option>
            ))}
          </select>
          <span className="mk-field__help">
            Settle through the ledger and the item changes hands the instant it sells, in one
            balanced entry. Settle on chain and it is escrowed on the CloudsForge chain instead —
            a full EVM, so Solidity compiles and deploys against it and Hardhat and Foundry work
            unmodified. That route cannot be reversed by us afterwards.
          </span>
        </label>
        <label className="mk-field">
          <span className="mk-field__label">
            {pricingMode === 'auction' ? 'Bidding opens at this price' : 'Asking price'}, in
            smallest units
          </span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={price}
            disabled={pricingMode === 'offers_only'}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Which asset buyers pay in</span>
          <input className="cf-input" value={assetCode} onChange={(e) => setAssetCode(e.target.value)} />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Asset code the item itself carries</span>
          <input className="cf-input" value={itemAssetCode} onChange={(e) => setItemAssetCode(e.target.value)} />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Quantity</span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Royalty to the creator, in basis points</span>
          <input
            className="cf-input cf-num"
            inputMode="numeric"
            value={royaltyBps}
            onChange={(event) => setRoyaltyBps(event.target.value)}
          />
        </label>
        {bps > 0 && (
          <label className="mk-field">
            <span className="mk-field__label">Whose account the royalty lands in</span>
            <input
              className="cf-input cf-num"
              value={royaltySubject}
              placeholder="user:…"
              onChange={(event) => setRoyaltySubject(event.target.value)}
            />
          </label>
        )}
      </div>

      {!royaltyOk && (
        <p className="mk-note mk-note--strong">
          A royalty is a whole number of basis points. 250 means 2.5%, 1000 means 10%, and 10%
          is as high as this market will take.
        </p>
      )}

      {preview && (
        <>
          <Breakdown data={preview} caption="How the royalty divides at this price" />
          <p className="mk-note">
            Our own share is missing from that table on purpose: it is not a number you get to
            pick, and it is stamped onto the listing at the moment it is created. It comes out of
            the sale rather than being added to it, so a buyer pays exactly the figure you asked
            for.
          </p>
        </>
      )}

      <button
        type="button"
        className="cf-btn cf-btn--ember"
        disabled={busy || itemUrn.trim() === '' || !royaltyOk}
        onClick={() => void submit()}
      >
        {busy ? 'Saving…' : 'Save this as a draft'}
      </button>

      {created && (
        <div className="mk-notice mk-notice--ok" role="status">
          <p className="mk-notice__title">
            <span aria-hidden="true">✓ </span>
            Saved as a draft
          </p>
          <p className="mk-notice__body">
            Nobody can see it yet. Activate it below when you are ready.{' '}
            {created.degraded &&
              'We could not reach our content checks while saving this, so a person will look at it. That changes nothing you can do — activate it whenever you like. An outage on our side does not shut the market.'}
          </p>
          <Link className="cf-btn" to={listingPath(created.id)}>
            See it
          </Link>
        </div>
      )}
      {error && (
        <div className="mk-notice mk-notice--error" role="alert">
          <p className="mk-notice__title">
            <span aria-hidden="true">■ </span>
            Not saved
          </p>
          <p className="mk-notice__body">{error.message}</p>
          {error.requestId && (
            <p className="mk-notice__meta">
              Quote this to support: <code className="cf-num mk-reqid">{error.requestId}</code>
            </p>
          )}
        </div>
      )}
      <p className="mk-note">
        Every box above changes something. Two figures that matter are missing on purpose, because
        they are not the seller's to set: our share, and how long a buyer has to raise a dispute
        before your money is released. Both are fixed onto the listing the moment you save it.
      </p>
    </section>
  )
}
