/**
 * The badges that say what is known about a listing — escrow, moderation, verification, risk.
 *
 * ── Never colour alone ────────────────────────────────────────────────────────────────────────
 *
 * Every badge here carries a GLYPH, a WORD and a colour, in that order of importance. A reader
 * who cannot separate the accent violet from the warn amber still has two channels left, and a
 * reader using a screen reader gets the word. The estate's own history is the argument: a product
 * shipped in the wrong accent and looked entirely correct, because colour was the only thing
 * carrying the claim.
 *
 * ── Unknown is its own badge ──────────────────────────────────────────────────────────────────
 *
 * `mk-badge--unknown` is a dashed outline, a `?` glyph and the words "not checked". It is
 * deliberately NOT the same shape as either the positive or the negative badge, because the whole
 * defect this surface was built after was an unknown rendered as a negative.
 */
import type { EscrowKnowledge, RiskKnowledge } from '../lib/escrow.ts'
import { INDICATOR_COPY } from '../lib/escrow.ts'
import type { ListingView, VerificationView } from '../lib/market.ts'
import { utcDateTime } from '../lib/format.ts'

type Tone = 'good' | 'warn' | 'unknown' | 'neutral'

const GLYPH: Record<Tone, string> = {
  good: '✓',
  warn: '!',
  unknown: '?',
  neutral: '·',
}

export function Badge({
  tone,
  label,
  title,
}: {
  tone: Tone
  label: string
  title?: string | undefined
}) {
  return (
    <span className={`mk-badge mk-badge--${tone}`} title={title}>
      <span className="mk-badge__glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      <span className="mk-badge__label">{label}</span>
    </span>
  )
}

/**
 * The escrow panel.
 *
 * `knowledge.known` drives the tone, not the state name. An escrow whose confirmation nobody has
 * checked is `unknown` — never `warn`, which a reader parses as "something is wrong with it".
 */
export function EscrowPanel({ knowledge }: { knowledge: EscrowKnowledge }) {
  const tone: Tone = knowledge.known
    ? knowledge.state === 'none'
      ? 'neutral'
      : 'good'
    : 'unknown'
  return (
    <section className="mk-panel" aria-labelledby="mk-escrow-title">
      <div className="mk-panel__head">
        <h2 className="mk-panel__title" id="mk-escrow-title">
          Escrow
        </h2>
        <Badge tone={tone} label={knowledge.title} />
      </div>
      <p className="mk-panel__body">{knowledge.detail}</p>
      <p className="mk-note">
        Whatever is escrowed is held as a reservation in Forge Ledger or on chain. Forge Market
        holds the reference to it and never a balance of its own.
      </p>
    </section>
  )
}

/** Moderation and dispute state, as much of it as the affected party is entitled to see. */
export function ModerationNotice({ listing }: { listing: ListingView }) {
  if (!listing.frozen) return null
  return (
    <div className="mk-notice mk-notice--frozen" role="status">
      <p className="mk-notice__title">
        <span aria-hidden="true">! </span>
        This listing is under review
      </p>
      <p className="mk-notice__body">
        It cannot be bought or bid on while that is true. A listing is frozen either by a
        moderation case or by a dispute raised on a sale of it. We do not publish which, or what
        was said — that is between the parties and the reviewer.
      </p>
    </div>
  )
}

/**
 * The verification level, with "nobody has looked" kept apart from "looked, and unverified".
 *
 * `GET /v1/verifications/:urn` answers `{ verification: null }` for a subject nobody has reviewed
 * (`market/src/server.ts`), which is a different fact from the `unverified` level. The
 * two render differently here for the same reason the escrow does.
 */
export function VerificationBadge({ verification }: { verification: VerificationView | null }) {
  if (verification === null) {
    return <Badge tone="unknown" label="Nobody has looked" title="No reviewer has ever examined this item" />
  }
  const reviewed = utcDateTime(verification.reviewedAt)
  const suffix = reviewed === null ? 'Never reviewed' : `Reviewed ${reviewed}`
  switch (verification.level) {
    case 'verified':
      return <Badge tone="good" label="Verified" title={suffix} />
    case 'flagged':
      return <Badge tone="warn" label="Flagged" title={suffix} />
    case 'claimed':
      return <Badge tone="neutral" label="Claimed, unproven" title={suffix} />
    case 'unverified':
    default:
      return <Badge tone="neutral" label="Looked at, not confirmed" title={suffix} />
  }
}

/**
 * Risk indicators: computed facts, never a score.
 *
 * `market/src/risk.ts` refuses a numeric score in three separate ways, and the frontend is
 * where a score would be reintroduced by accident — a count of indicators rendered as a rating is
 * the same mistake with extra steps. So each indicator is a sentence, and the panel says whether
 * the chain was readable at all.
 */
export function RiskPanel({ knowledge }: { knowledge: RiskKnowledge }) {
  return (
    <section className="mk-panel" aria-labelledby="mk-risk-title">
      <div className="mk-panel__head">
        <h2 className="mk-panel__title" id="mk-risk-title">
          What the chain shows
        </h2>
        {knowledge.known ? (
          <Badge tone="neutral" label={`${knowledge.indicators.length} checked`} />
        ) : (
          <Badge tone="unknown" label="Nothing read" />
        )}
      </div>
      <p className="mk-panel__body">{knowledge.note}</p>
      {knowledge.known && knowledge.indicators.length > 0 && (
        <ul className="mk-indicators">
          {knowledge.indicators.map((indicator) => (
            <li
              key={indicator.code}
              className={`mk-indicator${indicator.present ? ' is-present' : ''}`}
            >
              <span className="mk-indicator__glyph" aria-hidden="true">
                {indicator.present ? '!' : '·'}
              </span>
              <span>
                <span className="mk-indicator__text">
                  {INDICATOR_COPY[indicator.code] ?? indicator.code}
                </span>{' '}
                <span className="mk-indicator__state">
                  {indicator.present ? 'Applies.' : 'Does not apply.'}
                </span>{' '}
                <span className="mk-indicator__detail cf-num">{indicator.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mk-note">
        Each line above is something anybody could go and check for themselves. None of it is
        advice, and there is deliberately no number attached. A rating buries what went into it,
        and once published it stops describing risk and starts describing the least a seller has
        to do to appear respectable.
      </p>
    </section>
  )
}
