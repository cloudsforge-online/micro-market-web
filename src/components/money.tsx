/**
 * Money on screen: an amount with its asset code, and a split that visibly adds up.
 *
 * ── An amount always carries its unit ─────────────────────────────────────────────────────────
 *
 * `1,000` is not a price. `1,000 SHARD` is. Every amount this app renders goes through `<Amount>`,
 * which puts the asset code beside it — and which says "smallest units" out loud for a `TOKEN:`
 * asset, whose decimals nothing in this bundle knows (`money.ts`, `ASSET_DECIMALS`). Guessing
 * eighteen there would render a whole token as a thousandth of one, and nothing about it would
 * look wrong.
 *
 * ── A split is rendered with its sum ──────────────────────────────────────────────────────────
 *
 * `market/src/money.ts` proves `fee + royalty + proceeds === price` exactly and asserts it on
 * every split. `<Breakdown>` shows the parts AND the total, computed here in `bigint` from the
 * same figures — so a reader can see the arithmetic close rather than take it on trust, and so a
 * wire that ever stopped balancing says so on screen instead of showing three plausible numbers.
 */
import type { Breakdown as BreakdownData } from '../lib/breakdown.ts'
import { formatBps, formatMoney } from '../lib/money.ts'
import { shortSubject } from '../lib/format.ts'

export function Amount({
  value,
  assetCode,
  className,
}: {
  value: bigint
  assetCode: string
  className?: string | undefined
}) {
  const rendered = formatMoney(value, assetCode)
  return (
    <span className={className ? `mk-amount ${className}` : 'mk-amount'}>
      <span className="cf-num mk-amount__value">{rendered.text}</span>{' '}
      <span className="mk-amount__code">{rendered.assetCode}</span>
      {!rendered.exactUnits && (
        // Said, not implied. The number is in the asset's smallest units because this bundle does
        // not know its decimals, and a reader who is not told will read it as whole tokens.
        <span className="mk-amount__note" title="This bundle does not know this asset's decimals">
          {' '}
          smallest units
        </span>
      )}
    </span>
  )
}

/** An amount that may be absent. Missing renders as missing — never as zero. */
export function MaybeAmount({
  value,
  assetCode,
  absent = 'Not set',
}: {
  value: bigint | null
  assetCode: string
  absent?: string
}) {
  if (value === null) return <span className="mk-absent">{absent}</span>
  return <Amount value={value} assetCode={assetCode} />
}

/**
 * A sale split, with its sum.
 *
 * The sum row is not decoration. It is the assertion `market/src/money.ts:195-212` makes on the
 * server, made again where a seller reads it — and when it fails, the failure is the loudest thing
 * on the panel rather than an exception that blanks the page.
 */
export function Breakdown({ data, caption }: { data: BreakdownData; caption: string }) {
  return (
    <div className="mk-breakdown">
      <table className="mk-table mk-table--money">
        <caption className="mk-table__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Goes to</th>
            <th scope="col" className="mk-table__rate">
              Rate
            </th>
            <th scope="col" className="mk-table__num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, index) => (
            <tr
              key={`${row.label}-${index}`}
              className={row.nested ? 'mk-table__row--nested' : undefined}
            >
              <th scope="row">
                {row.nested && (
                  <span className="mk-table__branch" aria-hidden="true">
                    ↳{' '}
                  </span>
                )}
                {row.nested ? (shortSubject(row.label) ?? row.label) : row.label}
                {row.nested && <span className="cf-sr"> (share of the royalty)</span>}
              </th>
              <td className="mk-table__rate">{row.bps === null ? '' : formatBps(row.bps)}</td>
              <td className="mk-table__num">
                <Amount value={row.amount} assetCode={data.assetCode} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="mk-table__sum">
            <th scope="row">Adds up to</th>
            <td className="mk-table__rate" />
            <td className="mk-table__num">
              <Amount value={data.sum} assetCode={data.assetCode} />
            </td>
          </tr>
          <tr>
            <th scope="row">Sale price</th>
            <td className="mk-table__rate" />
            <td className="mk-table__num">
              <Amount value={data.price} assetCode={data.assetCode} />
            </td>
          </tr>
        </tfoot>
      </table>
      {data.balances && data.royaltyBalances ? (
        <p className="mk-breakdown__ok">
          {/* The tick is accompanied by words, and the words carry the meaning: colour and glyph
              are both secondary channels here. */}
          <span aria-hidden="true">✓ </span>
          The parts add up to the price exactly. They always do — the seller's share is defined as
          what is left after the fee and the royalty, so there is no rounding left over.
        </p>
      ) : (
        <p className="mk-breakdown__problem" role="alert">
          <span aria-hidden="true">■ </span>
          These figures do not add up: {data.problem ?? 'the totals disagree'}. That is a fault
          worth reporting — the sale itself is posted as a single balanced ledger entry, so what is
          wrong is this reading of it.
        </p>
      )}
    </div>
  )
}
