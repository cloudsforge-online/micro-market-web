/**
 * Browse: the front door.
 *
 * One request — `GET /v1/listings` (`market/src/server.ts`) — and everything else on this
 * page is done to what it returned. That is not an optimisation, it is the surface: the route
 * reads four filters and no text query and no page size, so a search box here filters fifty
 * listings rather than searching a catalogue. `searchScopeNote` says which, every time.
 *
 * ── WHY THIS PAGE IS SHAPED LIKE A SALEROOM CATALOGUE ────────────────────────────────────────
 *
 * `ListingView` HAS NO TITLE. There is no `name`, no `description`, no `summary` — the fields are
 * in `src/lib/market.ts` and the closest thing to a name is `itemUrn`, a colon-delimited address
 * like `cf:brand:emberkin:species-sheet-v1`. Every earlier version of this page set that string in
 * 13px mono and called it the card, which is how a marketplace ends up looking like a database
 * dump: forty grey boxes each headed by a machine identifier.
 *
 * A URN is not a machine identifier that happens to be readable, though. It is a TAXONOMY, and its
 * colons are its levels — issuer, then class, then collection, then the item. So the card splits it
 * and sets the levels as a trail with the last segment promoted to the display face. That is the
 * one bold move on the page and it is made of data that was already there; nothing is invented and
 * nothing is truncated. See `urnTrail`.
 *
 * The hero carries the escrow run as three numbered beats rather than a paragraph. Numbering is
 * usually decoration, but here the order is the product — money is held BEFORE the goods move and
 * released AFTER, and a buyer who reads those in the wrong order has misunderstood what they are
 * being offered.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { Amount } from '../components/money.tsx'
import { Badge } from '../components/status.tsx'
import { auctionClock, LEADING_BID_LABEL } from '../lib/auction.ts'
import {
  ASSET_KIND_COPY,
  PRICING_MODE_COPY,
  SETTLEMENT_MODE_COPY,
  ageLabel,
  utcDateTime,
} from '../lib/format.ts'
import { ASSET_KINDS, listListings, type AssetKind, type ListingView } from '../lib/market.ts'
import { parseAmountOrNull } from '../lib/money.ts'
import { listingPath } from '../lib/routes.ts'
import { useResource } from '../lib/resource.ts'
import { filterListings, searchScopeNote, sortListings, type SortKey, SORTS } from '../lib/search.ts'

/**
 * The escrow run, in the order it happens.
 *
 * Held in one place because the same three beats appear on the sell page and in the listing's own
 * "what happens when you buy" panel, and three copies of a promise drift into three promises.
 */
const ESCROW_RUN: readonly { readonly step: string; readonly line: string }[] = [
  { step: 'Buyer pays in', line: 'The price leaves the buyer and is held by the market, not by the seller.' },
  { step: 'Item moves', line: 'The seller hands over. Nothing is released until this has happened.' },
  { step: 'Money is let go', line: 'Fee, royalty and the seller’s share, split to the last whole unit.' },
]

export function BrowsePage() {
  const [assetKind, setAssetKind] = useState<AssetKind | ''>('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')

  const load = useCallback(
    (signal: AbortSignal) =>
      // `status` is left at the route's own default of `active` (server.ts) rather than sent
      // explicitly: a browse page that asked for drafts would be showing sellers' unpublished work
      // to buyers.
      listListings(assetKind === '' ? {} : { assetKind }, { signal }),
    [assetKind],
  )

  // `[assetKind]`: it is the one filter the ROUTE reads, so changing it is a new request rather
  // than a new view of the same one. The text filter and the sort are not here on purpose —
  // both are applied in this bundle to what the request returned, and `searchScopeNote` says so.
  const resource = useResource(load, (data) => data.listings.length, 'We could not fetch what is on sale.', [
    assetKind,
  ])
  const all = resource.data?.listings ?? []
  const visible = useMemo(
    () => sortListings(filterListings(all, query), sort),
    [all, query, sort],
  )

  // What is on sale actually settles in — read off the listings rather than asserted. A market
  // that quietly holds one asset should not advertise a row of currencies it cannot honour.
  const settlesIn = useMemo(() => {
    const codes = new Set<string>()
    for (const listing of all) codes.add(listing.assetCode)
    return [...codes].sort()
  }, [all])

  return (
    <>
      <header className="mk-hero">
        <p className="mk-hero__eyebrow">Forge Market</p>
        <div className="mk-hero__top">
          <h1 className="mk-hero__title">
            The money waits with us
            <br />
            until the goods have moved.
          </h1>
          <Link className="cf-btn cf-btn--ember mk-hero__cta" to="/sell">
            Sell something
          </Link>
        </div>

        {/* A sequence, so it is numbered. See the file header. */}
        <ol className="mk-run">
          {ESCROW_RUN.map((beat, index) => (
            <li className="mk-run__beat" key={beat.step}>
              <span className="mk-run__ord cf-num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="mk-run__step">{beat.step}</span>
              <span className="mk-run__line">{beat.line}</span>
            </li>
          ))}
        </ol>

        <p className="mk-hero__note">
          Game items, tokens, entitlements, memberships, brand assets and collectibles. Each one is
          priced in the asset it settles in, and we convert nothing — a converted price is a price
          at a rate somebody else picked for you.
        </p>
      </header>

      <form className="mk-bar" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="mk-bar__search">
          <span className="cf-sr">Narrow what is below</span>
          <input
            className="cf-input"
            type="search"
            value={query}
            placeholder="An item address, an asset code…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {/*
          Pills rather than the <select> this was: there are seven choices including Everything,
          and on a marketplace front door the list of things that CAN be sold here is itself worth
          reading. A closed menu hides the taxonomy behind a click.

          `radiogroup`, not a row of buttons — one of these is always chosen and choosing another
          replaces it, which is what a radio group means to a screen reader.
        */}
        <div className="mk-kinds" role="radiogroup" aria-label="Type of thing">
          <KindPill current={assetKind} value="" label="Everything" onPick={setAssetKind} />
          {ASSET_KINDS.map((kind) => (
            <KindPill
              key={kind}
              current={assetKind}
              value={kind}
              label={ASSET_KIND_COPY[kind] ?? kind}
              onPick={setAssetKind}
            />
          ))}
        </div>

        <label className="mk-bar__sort">
          <span className="cf-sr">Show me in this order</span>
          <select
            className="cf-input"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      {resource.state === 'loading' && <Loading label="Fetching what is on sale" />}
      {resource.state === 'forbidden' && <Forbidden notice={resource.error ?? undefined} />}
      {resource.state === 'failed' && resource.error && (
        <Failed notice={resource.error} onRetry={resource.reload} title="The listings did not load" />
      )}
      {resource.state === 'empty' && (
        <Empty
          title="Nothing is on sale right now"
          hint={
            assetKind === ''
              ? 'Nothing failed to load — the catalogue is genuinely empty. Whatever goes up next will be the first thing here.'
              : `Nothing failed to load. Nothing on sale right now is a ${(ASSET_KIND_COPY[assetKind] ?? assetKind).toLowerCase()}. Try Everything.`
          }
          action={
            <Link className="cf-btn" to="/sell">
              Be the first
            </Link>
          }
        />
      )}

      {resource.state === 'ok' && (
        <>
          <p className="mk-scope" aria-live="polite">
            <span className="mk-scope__note">{searchScopeNote(visible.length, all.length, query)}</span>
            {settlesIn.length > 0 && (
              <span className="mk-scope__settles">
                Settling in <b className="cf-num">{settlesIn.join(' · ')}</b>
              </span>
            )}
          </p>
          {visible.length === 0 ? (
            <Empty
              title="Nothing here answers to that"
              hint="What you typed is matched against the listings that were fetched, not against every listing in existence. Empty the box and they all come back."
              action={
                <button type="button" className="cf-btn" onClick={() => setQuery('')}>
                  Empty the box
                </button>
              }
            />
          ) : (
            <ul className="mk-lots">
              {visible.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

/** One choice in the kind row. Split out so the `aria-checked`/`is-on` pair cannot drift apart. */
function KindPill({
  current,
  value,
  label,
  onPick,
}: {
  current: AssetKind | ''
  value: AssetKind | ''
  label: string
  onPick: (next: AssetKind | '') => void
}) {
  const on = current === value
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={on ? 'mk-kind is-on' : 'mk-kind'}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  )
}

/**
 * A URN split into the levels its colons already describe.
 *
 * `cf:brand:emberkin:species-sheet-v1` → trail `['cf', 'brand', 'emberkin']`, leaf
 * `species-sheet-v1`. A URN with no colon — the drill and probe listings carry these — is all leaf
 * and no trail, which renders as a bare name rather than as an empty line above one.
 *
 * Nothing is dropped and nothing is abbreviated: the full address is still on the card, and it is
 * still the string the buyer can paste. It is only SET differently.
 */
function urnTrail(urn: string): { trail: readonly string[]; leaf: string } {
  const parts = urn.split(':').filter((part) => part.length > 0)
  if (parts.length <= 1) return { trail: [], leaf: urn }
  return { trail: parts.slice(0, -1), leaf: parts[parts.length - 1] as string }
}

/**
 * One lot in the catalogue.
 *
 * The price row is the one that has to be right. An auction's `price` is its STARTING price
 * (`market/src/bids.ts`), not what it will sell for, and an `offers_only` listing has no
 * price at all (`server.ts`) — so the three pricing modes get three different labels rather
 * than one word doing three jobs.
 */
function ListingCard({ listing }: { listing: ListingView }) {
  const price = parseAmountOrNull(listing.price)
  const clock = auctionClock(listing)
  const listed = ageLabel(listing.createdAt)
  const { trail, leaf } = urnTrail(listing.itemUrn)

  return (
    <li className="mk-lot">
      <Link className="mk-lot__link" to={listingPath(listing.id)}>
        <span className="mk-lot__head">
          <span className="mk-lot__kind">{ASSET_KIND_COPY[listing.assetKind] ?? listing.assetKind}</span>
          <span className="mk-lot__asset cf-num">{listing.assetCode}</span>
        </span>

        {/*
          The signature — and the address is READ OUT WHOLE, once, before it is set in levels.

          Splitting the URN across two lines with the colons drawn in CSS is a presentational
          treatment of ONE string. A screen reader that walked the split markup would hear
          "cf, brand, emberkin, species sheet v one" as four unrelated fragments and never learn
          the address the buyer would have to paste. So the complete `itemUrn` goes in first as
          `.cf-sr` text, the visual split is `aria-hidden`, and `title` puts the same unbroken
          string under the pointer.
        */}
        <span className="mk-lot__urn">
          <span className="cf-sr">{listing.itemUrn}</span>
          <span className="mk-lot__set" aria-hidden="true" title={listing.itemUrn}>
            {trail.length > 0 && (
              <span className="mk-lot__trail">
                {trail.map((part, index) => (
                  <span key={`${part}-${index}`} className="mk-lot__seg">
                    {part}
                  </span>
                ))}
              </span>
            )}
            <span className="mk-lot__leaf">{leaf}</span>
          </span>
        </span>
      </Link>

      <div className="mk-lot__tags">
        <Badge tone="neutral" label={PRICING_MODE_COPY[listing.pricingMode] ?? listing.pricingMode} />
        <Badge
          tone="neutral"
          label={SETTLEMENT_MODE_COPY[listing.settlementMode] ?? listing.settlementMode}
        />
        {listing.frozen && <Badge tone="warn" label="Under review" />}
      </div>

      {/* The estimate plate. Label and figure share one baseline, ruled off from the lot above it. */}
      <div className="mk-lot__plate">
        <span className="mk-lot__plate-label">
          {listing.pricingMode === 'auction'
            ? price === null
              ? LEADING_BID_LABEL
              : 'Bidding opens at'
            : listing.pricingMode === 'offers_only'
              ? 'Offers wanted'
              : 'Asking'}
        </span>
        <span className="mk-lot__plate-value">
          {price === null ? (
            <span className="mk-absent">
              {listing.pricingMode === 'offers_only' ? 'Name your figure' : 'Nothing asked'}
            </span>
          ) : (
            <Amount value={price} assetCode={listing.assetCode} />
          )}
        </span>
      </div>

      {clock.phase === 'open' && clock.remaining !== null && (
        <p className="mk-lot__clock">
          Closes in <b>{clock.remaining}</b>, at {utcDateTime(clock.endsAt)}. Bid near the end and the
          clock is pushed back.
        </p>
      )}
      {clock.phase === 'closing' && (
        <p className="mk-lot__clock">The clock has run down. The close is being worked out now.</p>
      )}
      {clock.phase === 'no_close_time' && (
        <p className="mk-lot__clock">This auction carries no closing time that we can read.</p>
      )}

      {/* Every figure carries its observation time. A listing with an unreadable `createdAt` says
          so rather than borrowing the reader's clock. */}
      <p className="mk-lot__stamp">
        {listed === null ? 'We cannot read when this went up' : `Put up ${listed}`}
      </p>
    </li>
  )
}
