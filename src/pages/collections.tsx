/**
 * Collections: a shopfront, and the listings inside one.
 *
 * `GET /v1/collections` (server.ts:596) for the index, and `GET /v1/listings?collectionId=`
 * (server.ts:629) for one collection's listings. Both public — a collection behind a sign-in is a
 * shopfront nobody can link to.
 *
 * A collection carries its OWN royalty recipients (`market/src/listings.ts:153-166`), which are
 * what a listing inside it inherits when it is created without its own. They are shown in basis
 * points here rather than as amounts, because until there is a sale price there is no amount —
 * and a percentage rendered as money is a number somebody will quote back.
 */
import { useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Amount } from '../components/money.tsx'
import { Badge } from '../components/status.tsx'
import { Empty, Failed, Loading } from '../components/states.tsx'
import { ASSET_KIND_COPY, ageLabel, shortSubject } from '../lib/format.ts'
import { listCollections, listListings, type CollectionView } from '../lib/market.ts'
import { formatBps, parseAmountOrNull } from '../lib/money.ts'
import { collectionPath, listingPath } from '../lib/routes.ts'
import { useResource } from '../lib/resource.ts'

function useCollectionId(): string {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  return decodeURIComponent(segments[1] ?? '')
}

export function CollectionsPage() {
  const id = useCollectionId()
  return id === '' ? <CollectionIndex /> : <CollectionDetail id={id} />
}

function CollectionIndex() {
  const load = useCallback((signal: AbortSignal) => listCollections({}, { signal }), [])
  const collections = useResource(
    load,
    (data) => data.collections.length,
    'The collections did not load.',
  )

  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">Collections</h1>
          <p className="mk-page__lede">
            A collection groups listings and carries the royalty split its listings inherit.
          </p>
        </div>
      </header>

      {collections.state === 'loading' && <Loading label="Loading collections" />}
      {collections.state === 'failed' && collections.error && (
        <Failed
          notice={collections.error}
          onRetry={collections.reload}
          title="The collections did not load"
        />
      )}
      {collections.state === 'empty' && (
        <Empty title="No collections yet" hint="The market answered; nobody has made one." />
      )}
      {collections.state === 'ok' && (
        <ul className="mk-grid">
          {(collections.data?.collections ?? []).map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </ul>
      )}
    </>
  )
}

function CollectionCard({ collection }: { collection: CollectionView }) {
  const total = collection.royalties.reduce((sum, share) => sum + share.bps, 0)
  return (
    <li className="mk-card">
      <Link className="mk-card__link" to={collectionPath(collection.id)}>
        <span className="mk-card__kind">{collection.slug}</span>
        <span className="mk-card__title">{collection.name}</span>
      </Link>
      {collection.description !== '' && <p className="mk-card__body">{collection.description}</p>}
      <p className="mk-card__stamp">
        Owned by <span className="cf-num">{shortSubject(collection.ownerSubject)}</span>
      </p>
      {collection.royalties.length > 0 && (
        <p className="mk-card__stamp">
          {/* The shares are of the ROYALTY, not of the price — `market/src/money.ts:118-119`. So
              they sum to 100% of the royalty, and saying "of the royalty" is what stops a reader
              adding them to the platform fee. */}
          Royalty split across {collection.royalties.length}{' '}
          {collection.royalties.length === 1 ? 'recipient' : 'recipients'}, {formatBps(total)} of the
          royalty in total
        </p>
      )}
    </li>
  )
}

function CollectionDetail({ id }: { id: string }) {
  const loadListings = useCallback(
    (signal: AbortSignal) => listListings({ collectionId: id }, { signal }),
    [id],
  )
  const listings = useResource(
    loadListings,
    (data) => data.listings.length,
    'The listings in this collection did not load.',
  )

  const loadCollection = useCallback((signal: AbortSignal) => listCollections({}, { signal }), [])
  const collections = useResource(loadCollection, () => 1, 'The collection did not load.')
  const collection = collections.data?.collections.find((entry) => entry.id === id) ?? null

  return (
    <>
      <header className="mk-page__head">
        <div>
          <p className="mk-eyebrow">Collection</p>
          <h1 className="mk-page__title">{collection?.name ?? 'This collection'}</h1>
          {collection === null ? (
            <p className="mk-page__lede">
              {/* Degradation with a name on it: we are showing the listings, and we could not name
                  the collection. Saying so beats a heading that reads as the collection's name. */}
              We could not read this collection's own details. Its listings are below.
            </p>
          ) : (
            <p className="mk-page__lede">
              {collection.description === ''
                ? `Owned by ${shortSubject(collection.ownerSubject) ?? 'somebody'}.`
                : collection.description}
            </p>
          )}
        </div>
        <Link className="cf-btn" to="/collections">
          All collections
        </Link>
      </header>

      {collection !== null && collection.royalties.length > 0 && (
        <section className="mk-panel">
          <h2 className="mk-panel__title">Royalty split</h2>
          <table className="mk-table">
            <thead>
              <tr>
                <th scope="col">Recipient</th>
                <th scope="col" className="mk-table__num">
                  Share of the royalty
                </th>
              </tr>
            </thead>
            <tbody>
              {collection.royalties.map((share) => (
                <tr key={share.subject}>
                  <th scope="row" className="cf-num">
                    {shortSubject(share.subject)}
                  </th>
                  <td className="mk-table__num">{formatBps(share.bps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mk-note">
            These are shares OF THE ROYALTY, not of the sale price. The royalty itself is a rate set
            on each listing, and the shares divide it exactly — largest remainder, so nothing is
            lost to rounding.
          </p>
        </section>
      )}

      {listings.state === 'loading' && <Loading label="Loading the listings" />}
      {listings.state === 'failed' && listings.error && (
        <Failed notice={listings.error} onRetry={listings.reload} title="The listings did not load" />
      )}
      {listings.state === 'empty' && (
        <Empty title="Nothing live in this collection" hint="The market answered; nothing here is on sale." />
      )}
      {listings.state === 'ok' && (
        <ul className="mk-rows">
          {(listings.data?.listings ?? []).map((listing) => {
            const price = parseAmountOrNull(listing.price)
            return (
              <li key={listing.id} className="mk-rows__row">
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
                <Badge tone="neutral" label={ASSET_KIND_COPY[listing.assetKind] ?? listing.assetKind} />
                <span className="mk-rows__when">{ageLabel(listing.createdAt) ?? 'unknown time'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
