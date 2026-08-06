/**
 * What is charged and what is free.
 *
 * A static page, deliberately: it makes no request and cannot fail. Every figure on it is the
 * platform's stated position from `docs/ecosystem/15-monetisation-model.md`, which is a document
 * rather than a runtime value — and the ACTUAL rate charged on any given sale is the one
 * snapshotted onto that listing when it was created (`market/src/server.ts`), which the
 * listing page shows. This page says the policy; the listing page says the fact.
 *
 * That distinction is the reason the number below is not fetched. A rate rendered here from a
 * live call would look like the rate on a sale, and it is not: a listing created last month
 * carries last month's rate for ever, which is exactly the property the snapshot exists to give.
 */
import { Link } from 'react-router-dom'

export function FeesPage() {
  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">What we charge</h1>
          <p className="mk-page__lede">
            One charge exists on this marketplace, and it only applies once something has actually
            sold. Putting an item up, watching an auction, bidding on it and offering against it
            all cost nothing, whether or not anything comes of them.
          </p>
        </div>
      </header>

      <section className="mk-panel">
        <h2 className="mk-panel__title">Our share of a sale</h2>
        <p className="mk-panel__body">
          <b>250 basis points — 2.5% — of whatever the item sold for, borne by the seller.</b> It
          is carved out of the sale rather than added to it, so a buyer hands over the figure on
          the listing and not a penny more.
        </p>
        <p className="mk-panel__body">
          We keep the rate under what marketplaces generally ask, on the reasoning that we earn
          nothing at all until people trade. Making the trade happen is worth more to us than
          squeezing the one that does.
        </p>
        <p className="mk-note">
          Whatever the rate is on the day a listing is created gets stamped onto it, and that
          stamped figure is what settlement uses however long the item sits there. Should we ever
          move the rate, items already up keep the terms they were posted under. This page tells
          you the policy; the listing itself tells you the number it is bound to.
        </p>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">Paying the creator</h2>
        <p className="mk-panel__body">
          A listing can carry a royalty of up to 10%, expressed in basis points of the sale, going
          to people the seller names. That money is not ours. It posts to the creators' accounts in
          the very same ledger entry that moves the item, so there is no separate payout to chase
          and nothing to reconcile afterwards. A listing made inside a collection picks up the
          collection's split unless it declares its own.
        </p>
        <p className="mk-panel__body">
          Where several people share a royalty, they are sharing the royalty and not the price, and
          the arithmetic divides it down to the last unit — leftovers get handed out rather than
          quietly disappearing. What the seller receives is then simply the remainder: the sale
          price, less our share, less the royalty. That is why every breakdown you will see on this
          site adds back up to the price exactly.
        </p>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">Costs you will never see</h2>
        <ul className="mk-list">
          <li>Looking around and reading any listing in full, without signing in.</li>
          <li>Putting an item up, and taking it down again before it sells.</li>
          <li>Bidding, offering, and pulling an offer back.</li>
          <li>Opening a dispute against an order that went wrong.</li>
          <li>Adding photographs to something you are selling, and swapping them later.</li>
          <li>
            Getting verified. No badge here has a price, and none ever will — the moment a marker
            that reads as approval can be bought, the marketplace has taken a side in its own worst
            listing.
          </li>
        </ul>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">When the seller gets paid</h2>
        <p className="mk-panel__body">
          A completed sale credits the seller straight away, but the proceeds sit apart from
          spendable balance for a day first. That gap is there so a buyer with a genuine complaint
          can raise it while the money is still recoverable; open a dispute and the release waits
          until it is resolved. Once the window closes with nothing raised, the funds move across
          on their own.
        </p>
        <p className="mk-note">
          A refund on a custodial sale is a reversal of the original entry, which pulls back our
          share and the royalties along with it. A sale that settled on chain cannot be undone by
          us — nobody here holds the keys that would be needed.
        </p>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">Why the charge sits where it does</h2>
        <p className="mk-panel__body">
          Settling a sale inside the ledger is a handful of bookkeeping lines and costs us next to
          nothing; settling one on chain costs gas. What genuinely costs money is people — the
          moderation queue and the disputes. Charging on completed sales rather than on listings
          keeps that cost off the sellers with least to spare, who are exactly the ones a listing
          fee would drive away first.
        </p>
      </section>

      <p className="mk-note">
        <Link to="/">Back to the market</Link>
      </p>
    </>
  )
}
