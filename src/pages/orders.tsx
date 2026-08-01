/**
 * Orders, and the dispute path.
 *
 * `GET /v1/orders?role=…` (server.ts:969) for the list, `GET /v1/orders/:id` (980) for one, and
 * `POST /v1/orders/:id/disputes` (993) to raise one.
 *
 * ── What this surface can and cannot tell you about a dispute ─────────────────────────────────
 *
 * It can tell you that you raised one, in the moment you raise it. It cannot tell you its state
 * afterwards: `GET /v1/disputes` requires an operator (server.ts:1017) and `orderWire`
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
  const orders = useResource(load, (data) => data.orders.length, 'Your orders did not load.')

  return (
    <>
      <header className="mk-page__head">
        <div>
          <h1 className="mk-page__title">Orders</h1>
          <p className="mk-page__lede">
            Each one is a single balanced ledger entry: the payment, the fee, every royalty share
            and the item are legs of the same entry, which is why they add up exactly.
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

      {orders.state === 'loading' && <Loading label="Loading your orders" />}
      {orders.state === 'forbidden' && <Forbidden notice={orders.error ?? undefined} />}
      {orders.state === 'failed' && orders.error && (
        <Failed notice={orders.error} onRetry={orders.reload} title="Your orders did not load" />
      )}
      {orders.state === 'empty' && (
        <Empty
          title={role === 'buyer' ? 'You have not bought anything' : 'You have not sold anything'}
          hint="The market answered; there is nothing on this side yet."
          action={
            <Link className="cf-btn" to="/">
              Browse the market
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
  const order = useResource(load, () => 1, 'This order did not load.')

  if (order.state === 'loading') return <Loading label="Loading the order" />
  if (order.state === 'forbidden') return <Forbidden notice={order.error ?? undefined} />
  if (order.state === 'failed' || order.data === null) {
    return (
      <Failed
        notice={
          order.error ?? { message: 'This order did not load.', requestId: undefined, forbidden: false }
        }
        onRetry={order.reload}
        title="This order did not load"
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
            <h2 className="mk-panel__title">Where the money went</h2>
            {breakdown === null ? (
              <p className="mk-panel__body">
                We could not read the amounts on this order. The rest of the order is below, and the
                figures themselves are in the ledger entry named here — this is a fault in reading
                them, not in the sale.
              </p>
            ) : (
              <Breakdown data={breakdown} caption="The sale price, divided as it was posted" />
            )}
          </section>

          <section className="mk-panel">
            <h2 className="mk-panel__title">The order</h2>
            <dl className="mk-facts mk-facts--mono">
              <dt>Buyer</dt>
              <dd>{shortSubject(order.buyerSubject)}</dd>
              <dt>Seller</dt>
              <dd>{shortSubject(order.sellerSubject)}</dd>
              <dt>Quantity</dt>
              <dd>{order.quantity}</dd>
              <dt>How it was bought</dt>
              <dd>{order.source}</dd>
              <dt>Ledger entry</dt>
              <dd>{order.journalEntryId ?? <span className="mk-absent">None — this settled on chain</span>}</dd>
              <dt>Chain transaction</dt>
              <dd>
                {order.outboundTransactionId ?? (
                  <span className="mk-absent">None — this settled in the ledger</span>
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
              <p className="mk-panel__body">The seller's proceeds have been released.</p>
            ) : payoutDue === null ? (
              <p className="mk-panel__body">
                The proceeds are held. No payout time is recorded on this order — an on-chain sale
                has no dispute window, because there is no ledger entry for the platform to reverse.
              </p>
            ) : (
              <p className="mk-panel__body">
                The proceeds are held until <b>{payoutDue}</b>. That window is what a dispute has to
                land inside to stop the money becoming spendable.
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
 * Only the buyer or the seller may raise one (`market/src/moderation.ts:366-373`); a third party's
 * complaint is a moderation case with no power to move money. A refund is only possible for a
 * custodial sale — `moderation.ts:430-434`: "An on-chain sale was never the platform's to reverse:
 * the buyer paid the seller's own wallet and no ledger entry exists to reverse." That is said
 * before the button, not after it is pressed.
 */
function DisputePanel({ order }: { order: OrderView }) {
  const intent = useIntent('dispute')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<{ dispute: DisputeView; replayed: boolean } | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await openDispute(intent.key, order.id, { reason: reason.trim() })
      setOpened({ dispute: response.dispute, replayed: response.replayed })
      intent.renew()
    } catch (err) {
      setError(noticeFor(err, 'The dispute was not opened.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mk-panel" aria-labelledby="mk-dispute-title">
      <h2 className="mk-panel__title" id="mk-dispute-title">
        Dispute
      </h2>
      {opened === null ? (
        <>
          <p className="mk-panel__body">
            If something is wrong with this sale, either side can raise a dispute. Raising one
            freezes the listing behind it and stops the proceeds being released while it runs.
          </p>
          {order.settlementMode === 'onchain' && (
            <p className="mk-note mk-note--strong">
              This sale settled on chain, so it cannot be refunded through the ledger — you paid the
              seller's own wallet and there is no entry for us to reverse. A dispute is still worth
              raising; the remedy is not automatic.
            </p>
          )}
          <label className="mk-field">
            <span className="mk-field__label">What is wrong</span>
            <textarea
              className="mk-input mk-input--area"
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
            {busy ? 'Opening…' : 'Raise a dispute'}
          </button>
          <p className="mk-note">
            Pressing this twice is safe. It carries an idempotency key, which is what stops one
            complaint becoming two disputes and freezing the listing twice.
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
            We cannot show you its progress here: reading a dispute's state needs an operator, and
            there is no route on this surface for the people it affects. What you will see is the
            effect — the proceeds stay held and the listing stays frozen until it is resolved.
          </p>
        </div>
      )}
      {error && (
        <div className="mk-notice mk-notice--error" role="alert">
          <p className="mk-notice__title">
            <span aria-hidden="true">■ </span>
            Not opened
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
