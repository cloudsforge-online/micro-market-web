/**
 * Collections: a shopfront, and the listings inside one.
 *
 * `GET /v1/collections` (server.ts) for the index, and `GET /v1/listings?collectionId=`
 * (server.ts) for one collection's listings. Both public — a collection behind a sign-in is a
 * shopfront nobody can link to.
 *
 * A collection carries its OWN royalty recipients (`market/src/listings.ts`), which are
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
    'We could not read the collections.',
  )

  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">Collections</h1>
          <p className="mk-page__lede">
            A collection gathers related listings under one shopfront and holds the royalty split
            that anything added to it picks up by default.
          </p>
        </div>
      </header>

      {collections.state === 'loading' && <Loading label="Reading the collections" />}
      {collections.state === 'failed' && collections.error && (
        <Failed
          notice={collections.error}
          onRetry={collections.reload}
          title="We could not read the collections"
        />
      )}
      {collections.state === 'empty' && (
        <Empty
          title="Nobody has made one"
          hint="We asked and got a clean answer back — there is not a single collection on this market."
        />
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
          {/* The shares are of the ROYALTY, not of the price — `market/src/money.ts`. So
              they sum to 100% of the royalty, and saying "of the royalty" is what stops a reader
              adding them to the platform fee. */}
          The royalty is shared between {collection.royalties.length}{' '}
          {collection.royalties.length === 1 ? 'person' : 'people'}, accounting for {formatBps(total)}{' '}
          of it
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
    'We could not read what is in this collection.',
  )

  const loadCollection = useCallback((signal: AbortSignal) => listCollections({}, { signal }), [])
  const collections = useResource(loadCollection, () => 1, 'We could not read this collection.')
  const collection = collections.data?.collections.find((entry) => entry.id === id) ?? null

  return (
    <>
      <header className="mk-page__head">
        <div>
          <p className="mk-eyebrow">Collection</p>
          <h1 className="mk-page__title">{collection?.name ?? 'This collection'}</h1>
          {collection === null ? (
            // `collections.data` is null for the whole of the first request, so reading it
            // directly said "we could not read this" at first paint for EVERY collection, every
            // time, including the ones that arrived a moment later. A read IN FLIGHT is not a read
            // that failed, and `resource.ts` already knows the difference — the bug was reaching
            // past `state` to `data`. The three cases are now three sentences.
            <p className="mk-page__lede">
              {collections.state === 'loading'
                ? 'Fetching what this collection is…'
                : collections.state === 'failed'
                  ? // Degradation with a name on it: we are showing the listings, and we could not
                    // name the collection. Saying so beats a heading that reads as its name.
                    'We could not read this collection itself, so it goes unnamed here. What is inside it is below.'
                  : 'No collection on this market answers to that address. Anything listed against it appears below anyway.'}
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
                  Their share of it
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
            What is divided here is the royalty, not the sale price. Each listing sets its own
            royalty rate, and these shares carve that up to the last unit — the remainder is handed
            out rather than dropped, so the column always totals the whole of it.
          </p>
        </section>
      )}

      {listings.state === 'loading' && <Loading label="Reading what is inside" />}
      {listings.state === 'failed' && listings.error && (
        <Failed notice={listings.error} onRetry={listings.reload} title="The listings did not load" />
      )}
      {listings.state === 'empty' && (
        <Empty
          title="This collection has nothing on sale"
          hint="We asked and got a clean answer back — everything in it is either sold, withdrawn, or not yet posted."
        />
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
                    <span className="mk-absent">nothing asked</span>
                  ) : (
                    <Amount value={price} assetCode={listing.assetCode} />
                  )}
                </span>
                <Badge tone="neutral" label={ASSET_KIND_COPY[listing.assetKind] ?? listing.assetKind} />
                <span className="mk-rows__when">{ageLabel(listing.createdAt) ?? 'when, we cannot say'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
