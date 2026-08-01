/**
 * Browse: the front door.
 *
 * One request — `GET /v1/listings` (`market/src/server.ts:618`) — and everything else on this
 * page is done to what it returned. That is not an optimisation, it is the surface: the route
 * reads four filters and no text query and no page size, so a search box here filters fifty
 * listings rather than searching a catalogue. `searchScopeNote` says which, every time.
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

export function BrowsePage() {
  const [assetKind, setAssetKind] = useState<AssetKind | ''>('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')

  const load = useCallback(
    (signal: AbortSignal) =>
      // `status` is left at the route's own default of `active` (server.ts:624) rather than sent
      // explicitly: a browse page that asked for drafts would be showing sellers' unpublished work
      // to buyers.
      listListings(assetKind === '' ? {} : { assetKind }, { signal }),
    [assetKind],
  )

  const resource = useResource(load, (data) => data.listings.length, 'The listings did not load.')
  const all = resource.data?.listings ?? []
  const visible = useMemo(
    () => sortListings(filterListings(all, query), sort),
    [all, query, sort],
  )

  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">Browse the market</h1>
          <p className="mk-page__lede">
            Every price is shown in the asset it settles in. Nothing here is converted, because a
            converted price is a price at a rate somebody else chose.
          </p>
        </div>
        <Link className="cf-btn" to="/sell">
          Sell something
        </Link>
      </header>

      <form className="mk-filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="mk-field">
          <span className="mk-field__label">Filter these listings</span>
          <input
            className="mk-input"
            type="search"
            value={query}
            placeholder="An item URN, an asset code…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Kind</span>
          <select
            className="mk-input"
            value={assetKind}
            onChange={(event) => setAssetKind(event.target.value as AssetKind | '')}
          >
            <option value="">Everything</option>
            {ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {ASSET_KIND_COPY[kind] ?? kind}
              </option>
            ))}
          </select>
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Order</span>
          <select
            className="mk-input"
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

      {resource.state === 'loading' && <Loading label="Loading listings" />}
      {resource.state === 'forbidden' && <Forbidden notice={resource.error ?? undefined} />}
      {resource.state === 'failed' && resource.error && (
        <Failed notice={resource.error} onRetry={resource.reload} title="The listings did not load" />
      )}
      {resource.state === 'empty' && (
        <Empty
          title="Nothing is listed here right now"
          hint={
            assetKind === ''
              ? 'The market answered, and there are no live listings.'
              : `The market answered, and nothing live is a ${ASSET_KIND_COPY[assetKind] ?? assetKind}.`
          }
          action={
            <Link className="cf-btn" to="/sell">
              List the first one
            </Link>
          }
        />
      )}

      {resource.state === 'ok' && (
        <>
          <p className="mk-scope" aria-live="polite">
            {searchScopeNote(visible.length, all.length, query)}
          </p>
          {visible.length === 0 ? (
            <Empty
              title="Nothing on this page matches"
              hint="The filter runs over the listings above, not over the whole market. Clearing it brings them back."
              action={
                <button type="button" className="cf-btn" onClick={() => setQuery('')}>
                  Clear the filter
                </button>
              }
            />
          ) : (
            <ul className="mk-grid">
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

/**
 * One listing in the grid.
 *
 * The price row is the one that has to be right. An auction's `price` is its STARTING price
 * (`market/src/bids.ts:200-203`), not what it will sell for, and an `offers_only` listing has no
 * price at all (`server.ts:1189`) — so the three pricing modes get three different labels rather
 * than one word doing three jobs.
 */
function ListingCard({ listing }: { listing: ListingView }) {
  const price = parseAmountOrNull(listing.price)
  const clock = auctionClock(listing)
  const listed = ageLabel(listing.createdAt)

  return (
    <li className="mk-card">
      <Link className="mk-card__link" to={listingPath(listing.id)}>
        <span className="mk-card__kind">{ASSET_KIND_COPY[listing.assetKind] ?? listing.assetKind}</span>
        <span className="mk-card__urn cf-num">{listing.itemUrn}</span>
      </Link>
      <div className="mk-card__price">
        <span className="mk-card__price-label">
          {listing.pricingMode === 'auction'
            ? price === null
              ? LEADING_BID_LABEL
              : 'Starting price'
            : listing.pricingMode === 'offers_only'
              ? 'Open to offers'
              : 'Price'}
        </span>
        {price === null ? (
          <span className="mk-absent">
            {listing.pricingMode === 'offers_only' ? 'Name your price' : 'No price set'}
          </span>
        ) : (
          <Amount value={price} assetCode={listing.assetCode} />
        )}
      </div>
      <div className="mk-card__tags">
        <Badge tone="neutral" label={PRICING_MODE_COPY[listing.pricingMode] ?? listing.pricingMode} />
        <Badge
          tone="neutral"
          label={SETTLEMENT_MODE_COPY[listing.settlementMode] ?? listing.settlementMode}
        />
        {listing.frozen && <Badge tone="warn" label="Under review" />}
      </div>
      {clock.phase === 'open' && clock.remaining !== null && (
        <p className="mk-card__clock">
          Closes in <b>{clock.remaining}</b> — {utcDateTime(clock.endsAt)}. A late bid extends it.
        </p>
      )}
      {clock.phase === 'closing' && (
        <p className="mk-card__clock">Bidding time has run out; the close is being settled.</p>
      )}
      {clock.phase === 'no_close_time' && (
        <p className="mk-card__clock">No close time recorded for this auction.</p>
      )}
      {/* Every figure carries its observation time. A listing with an unreadable `createdAt` says
          so rather than borrowing the reader's clock. */}
      <p className="mk-card__stamp">
        {listed === null ? 'Listed at an unknown time' : `Listed ${listed}`}
      </p>
    </li>
  )
}
