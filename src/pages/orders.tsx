/**
 * Orders, and the dispute path.
 *
 * `GET /v1/orders?role=…` (server.ts) for the list, `GET /v1/orders/:id` (980) for one, and
 * `POST /v1/orders/:id/disputes` (993) to raise one.
 *
 * ── What this surface can and cannot tell you about a dispute ─────────────────────────────────
 *
 * It can tell you that you raised one, in the moment you raise it. It cannot tell you its state
 * afterwards: `GET /v1/disputes` requires an operator (server.ts) and `orderWire`
 * (1205-1230) carries no dispute field, so `micro-market` has no route by which a buyer or a
 * seller reads back a dispute they opened.
 *
 * The page therefore shows the two facts that ARE visible to the parties — the proceeds are still
 * held, and the listing behind the order is frozen — and says plainly that the dispute's own state
 * is not readable here. It does not invent a status, and it does not re-POST under the old key to
 * scrape the stored response, which would be a write dressed up as a read.
 */
import { useCallback, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Amount, Breakdown } from '../components/money.tsx'
import { Badge } from '../components/status.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { orderBreakdownOrNull } from '../lib/breakdown.ts'
import { SETTLEMENT_MODE_COPY, ageLabel, shortSubject, utcDateTime } from '../lib/format.ts'
import { useIntent } from '../lib/intent.ts'
import { getOrder, listOrders, openDispute, type DisputeView, type OrderView } from '../lib/market.ts'
import { parseAmountOrNull } from '../lib/money.ts'
import { listingPath, orderPath } from '../lib/routes.ts'
import { useResource } from '../lib/resource.ts'
import { useSubmit } from '../lib/submit.ts'

/** The uuid at the end of `/orders/<id>`, or `''` for the index. */
function useOrderId(): string {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  return decodeURIComponent(segments[1] ?? '')
}

export function OrdersPage() {
  const id = useOrderId()
  return id === '' ? <OrderList /> : <OrderDetail id={id} />
}

function OrderList() {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer')
  const load = useCallback((signal: AbortSignal) => listOrders({ role }, { signal }), [role])
  const orders = useResource(load, (data) => data.orders.length, 'We could not read your orders.')

  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">Orders</h1>
          <p className="mk-page__lede">
            A sale here is one bookkeeping entry rather than a sequence of transfers. The money
            leaving the buyer, our share, each creator's royalty, what the seller keeps and the
            item itself all move together or not at all — which is why the figures on an order
            always reconcile to the penny.
          </p>
        </div>
        <div className="mk-toggle" role="group" aria-label="Which side">
          <button
            type="button"
            className={`cf-btn${role === 'buyer' ? ' is-active' : ''}`}
            aria-pressed={role === 'buyer'}
            onClick={() => setRole('buyer')}
          >
            Bought
          </button>
          <button
            type="button"
            className={`cf-btn${role === 'seller' ? ' is-active' : ''}`}
            aria-pressed={role === 'seller'}
            onClick={() => setRole('seller')}
          >
            Sold
          </button>
        </div>
      </header>

      {orders.state === 'loading' && <Loading label="Reading your orders" />}
      {orders.state === 'forbidden' && <Forbidden notice={orders.error ?? undefined} />}
      {orders.state === 'failed' && orders.error && (
        <Failed notice={orders.error} onRetry={orders.reload} title="We could not read your orders" />
      )}
      {orders.state === 'empty' && (
        <Empty
          title={role === 'buyer' ? 'Nothing bought yet' : 'Nothing sold yet'}
          hint="Nothing failed to load. This side of your account is genuinely empty."
          action={
            <Link className="cf-btn" to="/">
              See what is on sale
            </Link>
          }
        />
      )}
      {orders.state === 'ok' && (
        <ul className="mk-rows">
          {(orders.data?.orders ?? []).map((order) => {
            const amount = parseAmountOrNull(order.amount)
            return (
              <li key={order.id} className="mk-rows__row">
                <Link className="cf-num" to={orderPath(order.id)}>
                  {order.itemUrn}
                </Link>
                <span>
                  {amount === null ? (
                    <span className="mk-absent">Unreadable amount</span>
                  ) : (
                    <Amount value={amount} assetCode={order.assetCode} />
                  )}
                </span>
                <Badge
                  tone={order.proceedsState === 'released' ? 'good' : 'neutral'}
                  label={order.proceedsState === 'released' ? 'Paid out' : 'Proceeds held'}
                />
                <span className="mk-rows__when">
                  {ageLabel(order.settledAt) ?? 'settled at an unknown time'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function OrderDetail({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getOrder(id, { signal }), [id])
  const order = useResource(load, () => 1, 'We could not read this order.')

  if (order.state === 'loading') return <Loading label="Reading the order" />
  if (order.state === 'forbidden') return <Forbidden notice={order.error ?? undefined} />
  if (order.state === 'failed' || order.data === null) {
    return (
      <Failed
        notice={
          order.error ?? { message: 'We could not read this order.', requestId: undefined, forbidden: false }
        }
        onRetry={order.reload}
        title="We could not read this order"
      />
    )
  }
  return <OrderBody order={order.data.order} />
}

function OrderBody({ order }: { order: OrderView }) {
  const breakdown = orderBreakdownOrNull(order)
  const settled = utcDateTime(order.settledAt)
  const payoutDue = utcDateTime(order.payoutDueAt)

  return (
    <>
      <header className="mk-page__head">
        <div>
          <p className="mk-eyebrow">Order</p>
          <h1 className="mk-page__title mk-page__title--urn cf-num">{order.itemUrn}</h1>
          <p className="mk-page__lede">
            {/* Every figure carries its observation time; an order's is the moment it settled, and
                it is the fact everything else on this page is relative to. */}
            Settled {settled ?? 'at a time we could not read'} · {SETTLEMENT_MODE_COPY[order.settlementMode]}
          </p>
        </div>
        <div className="mk-page__badges">
          <Badge
            tone={order.proceedsState === 'released' ? 'good' : 'neutral'}
            label={order.proceedsState === 'released' ? 'Proceeds released' : 'Proceeds held'}
          />
        </div>
      </header>

      <div className="mk-columns">
        <div className="mk-columns__main">
          <section className="mk-panel">
            <h2 className="mk-panel__title">How the money divided</h2>
            {breakdown === null ? (
              <p className="mk-panel__body">
                The amounts on this order came back in a shape we cannot read. Everything else
                about it is below, and the real figures are in the ledger entry named further
                down. The sale itself is fine; our reading of it is not.
              </p>
            ) : (
              <Breakdown data={breakdown} caption="What it sold for, split the way it was posted" />
            )}
          </section>

          <section className="mk-panel">
            <h2 className="mk-panel__title">The particulars</h2>
            <dl className="mk-facts mk-facts--mono">
              <dt>Buyer</dt>
              <dd>{shortSubject(order.buyerSubject)}</dd>
              <dt>Seller</dt>
              <dd>{shortSubject(order.sellerSubject)}</dd>
              <dt>Quantity</dt>
              {/*
                `cf-num`, as on the listing page's own Quantity — this one was the odd column out.
                `mk-facts--mono` gives every value here a monospaced face but says nothing about
                figures, and the design system's tabular-numbers rule is what makes a quantity in
                one order line up with the same field in the next when a reader flips between them.
              */}
              <dd className="cf-num">{order.quantity}</dd>
              <dt>Route it took</dt>
              <dd>{order.source}</dd>
              <dt>Ledger entry</dt>
              <dd>{order.journalEntryId ?? <span className="mk-absent">none, because this one settled on chain</span>}</dd>
              <dt>Chain transaction</dt>
              <dd>
                {order.outboundTransactionId ?? (
                  <span className="mk-absent">none, because this one settled in the ledger</span>
                )}
              </dd>
              <dt>Listing</dt>
              <dd>
                <Link to={listingPath(order.listingId)}>See the listing</Link>
              </dd>
            </dl>
          </section>
        </div>

        <aside className="mk-columns__side">
          <section className="mk-panel">
            <h2 className="mk-panel__title">Payout</h2>
            {order.proceedsState === 'released' ? (
              <p className="mk-panel__body">
                The window has closed and the seller has the money to spend.
              </p>
            ) : payoutDue === null ? (
              <p className="mk-panel__body">
                The proceeds are still held, and no release time is written against this order.
                A sale that settled on chain gets no dispute window, because there is no ledger
                entry left for anyone here to unwind.
              </p>
            ) : (
              <p className="mk-panel__body">
                The seller's money is set aside until <b>{payoutDue}</b>. A dispute has to be
                raised before that moment to keep it there; after it, the funds become spendable
                on their own.
              </p>
            )}
          </section>

          <DisputePanel order={order} />
        </aside>
      </div>
    </>
  )
}

/**
 * Raising a dispute, and being honest about what happens after.
 *
 * Only the buyer or the seller may raise one (`market/src/moderation.ts`); a third party's
 * complaint is a moderation case with no power to move money. A refund is only possible for a
 * custodial sale — `moderation.ts`: "An on-chain sale was never the platform's to reverse:
 * the buyer paid the seller's own wallet and no ledger entry exists to reverse." That is said
 * before the button, not after it is pressed.
 */
function DisputePanel({ order }: { order: OrderView }) {
  const intent = useIntent('dispute')
  const [reason, setReason] = useState('')
  const { busy, run } = useSubmit()
  const [opened, setOpened] = useState<{ dispute: DisputeView; replayed: boolean } | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)

  // The note under the button says "Pressing this twice is safe … which is what stops one
  // complaint becoming two disputes and freezing the listing twice." The key is what makes that
  // true of the DISPUTES; the ref latch below is what makes it true of the SCREEN, because the
  // second concurrent request comes back 503 `in_flight` (market/src/server.ts) and this
  // component would render it as "Not opened" over the dispute it had just opened.
  const submit = () =>
    run(async () => {
      setError(null)
      try {
        const response = await openDispute(intent.key, order.id, { reason: reason.trim() })
        setOpened({ dispute: response.dispute, replayed: response.replayed })
        intent.renew()
      } catch (err) {
        setError(noticeFor(err, 'The dispute was not opened.'))
      }
    })

  return (
    <section className="mk-panel" aria-labelledby="mk-dispute-title">
      <h2 className="mk-panel__title" id="mk-dispute-title">
        Dispute
      </h2>
      {opened === null ? (
        <>
          <p className="mk-panel__body">
            Either party to this sale can flag it if something went wrong. Doing so puts the
            listing on hold and keeps the seller's money where it is until the matter is settled.
          </p>
          {order.settlementMode === 'onchain' && (
            <p className="mk-note mk-note--strong">
              This one settled on chain, so no refund can come out of the ledger: the payment
              went to the seller's own wallet and there is nothing here for us to reverse. Raising
              it is still worth doing, but do not expect the money back automatically.
            </p>
          )}
          <label className="mk-field">
            <span className="mk-field__label">Tell us what went wrong</span>
            <textarea
              className="cf-input mk-area"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="cf-btn"
            disabled={busy || reason.trim() === ''}
            onClick={() => void submit()}
          >
            {busy ? 'Sending…' : 'Flag this sale'}
          </button>
          <p className="mk-note">
            Press it twice by all means. Each attempt is tagged so the second one lands on the
            first — one complaint, never two, and the listing is put on hold only once.
          </p>
        </>
      ) : (
        <div className="mk-notice mk-notice--ok" role="status">
          <p className="mk-notice__title">
            <span aria-hidden="true">✓ </span>
            {opened.replayed ? 'Already raised' : 'Raised'}
          </p>
          <p className="mk-notice__body">
            Opened {utcDateTime(opened.dispute.openedAt) ?? 'just now'}. Reference{' '}
            <code className="cf-num mk-reqid">{opened.dispute.id}</code>.
          </p>
          <p className="mk-notice__body">
            {/* The honest limit, stated rather than papered over. */}
            You will not be able to follow it on this page. Reading the state of a dispute takes
            operator access, and no route exists here for the people it actually concerns. What
            you can see is the consequence: the money stays put and the listing stays frozen until
            somebody closes it.
          </p>
        </div>
      )}
      {error && (
        <div className="mk-notice mk-notice--error" role="alert">
          <p className="mk-notice__title">
            <span aria-hidden="true">■ </span>
            Nothing was flagged
          </p>
          <p className="mk-notice__body">{error.message}</p>
          {error.requestId && (
            <p className="mk-notice__meta">
              Quote this to support: <code className="cf-num mk-reqid">{error.requestId}</code>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
