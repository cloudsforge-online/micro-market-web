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
            The platform earns when a trade happens, and only then. Browsing, listing, bidding and
            offering are free.
          </p>
        </div>
      </header>

      <section className="mk-panel">
        <h2 className="mk-panel__title">The take rate</h2>
        <p className="mk-panel__body">
          <b>250 basis points — 2.5% — of the sale price, paid by the seller.</b> It comes out of
          the sale, never on top of it, so the price a buyer sees is the price a buyer pays.
        </p>
        <p className="mk-panel__body">
          It is deliberately below general marketplace rates. A marketplace earns nothing until a
          trade happens, so the thing worth optimising is that trades happen at all — liquidity
          beats take rate.
        </p>
        <p className="mk-note">
          The rate is fixed onto a listing when the listing is created, and settlement uses that
          snapshot rather than whatever the rate is on the day of the sale. A listing made under an
          old rate keeps it. That is why this page states the policy and the listing states the
          number.
        </p>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">Royalties</h2>
        <p className="mk-panel__body">
          A seller may set a royalty on a listing, in basis points of the sale price, paid to
          recipients they name. It is <b>not</b> the platform's: it goes to the creator's account,
          posted in the same ledger entry as the sale.
        </p>
        <p className="mk-panel__body">
          Where a royalty is split between several recipients, the shares are shares of the
          royalty, not of the price, and they divide it <b>exactly</b> — largest remainder, so the
          leftover units are handed out rather than lost. The seller's own proceeds are then defined
          as what is left: price minus fee minus royalty. That is why every breakdown on this
          surface adds up to the price with nothing missing.
        </p>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">What is free</h2>
        <ul className="mk-list">
          <li>Browsing, searching and reading any listing — no account needed.</li>
          <li>Creating a listing, and withdrawing one.</li>
          <li>Placing a bid, making an offer, and withdrawing an offer.</li>
          <li>Raising a dispute.</li>
          <li>
            Verification. There is no paid badge, and there will not be one: a badge that reads as
            an endorsement and is sold is how a marketplace becomes complicit in its worst listing.
          </li>
        </ul>
      </section>

      <section className="mk-panel">
        <h2 className="mk-panel__title">What it costs us, and why that matters to you</h2>
        <p className="mk-panel__body">
          A custodial sale is a handful of ledger postings and costs us almost nothing. An on-chain
          sale costs gas. The real cost of running a marketplace is moderation and dispute
          handling, and that is human — which is the argument for the fee being on completed sales
          rather than on listing, where it would price out exactly the sellers with the least to
          risk.
        </p>
      </section>

      <p className="mk-note">
        <Link to="/">Back to the market</Link>
      </p>
    </>
  )
}
