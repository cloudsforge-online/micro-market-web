/**
 * The four states a screen can be in, as four visibly different things.
 *
 * They are separated because collapsing any two of them destroys information the user needs:
 *
 *   LOADING   — we do not know yet. Waiting is the correct action.
 *   EMPTY     — the query answered, with nothing. Nothing is wrong; there is something to DO.
 *   FAILED    — the query did not answer. Retrying may work. The request id is what support needs.
 *   FORBIDDEN — the query was understood and refused. Retrying will never work, and the honest
 *               response is to say who to ask, not to offer a button that cannot succeed.
 *
 * A spinner that never resolves, an empty list that was actually a timeout, and a "no results"
 * that was actually a missing scope are the three failures this file exists to prevent.
 */
import type { ReactNode } from 'react'
import type { ErrorNotice } from '../lib/api.ts'

// Every optional prop is spelled `?: T | undefined`. Under `exactOptionalPropertyTypes` those are
// two different types, and only the second one accepts the `value ?? undefined` a caller writes
// when it may or may not have something to pass.
export function Loading({ label = 'Loading' }: { label?: string | undefined }) {
  return (
    <div className="mk-state mk-state--loading" role="status" aria-live="polite">
      <span className="mk-spinner" aria-hidden="true" />
      <p className="mk-state__title">{label}</p>
    </div>
  )
}

export function Empty({
  title,
  hint,
  action,
}: {
  /** Say what was asked and found nothing. "No data" describes the screen, not the answer. */
  title: string
  hint?: string | undefined
  action?: ReactNode | undefined
}) {
  return (
    <div className="mk-state mk-state--empty" role="status">
      <span className="mk-state__icon" aria-hidden="true">
        ◇
      </span>
      <p className="mk-state__title">{title}</p>
      {hint && <p className="mk-state__hint">{hint}</p>}
      {action && <div className="mk-state__action">{action}</div>}
    </div>
  )
}

/**
 * A failure, with the request id on screen.
 *
 * The id is what the user quotes and what finds their exact request across every service at once.
 * It is rendered in the monospace token and made selectable on its own line, because it is going
 * to be read aloud down a phone line or pasted into a support form, and a `cf-1a2b…` embedded
 * mid-sentence is neither.
 */
export function Failed({
  notice,
  onRetry,
  title = 'This did not load',
}: {
  notice: ErrorNotice
  onRetry?: (() => void) | undefined
  title?: string | undefined
}) {
  return (
    <div className="mk-state mk-state--failed" role="alert">
      <span className="mk-state__icon" aria-hidden="true">
        ■
      </span>
      <p className="mk-state__title">{title}</p>
      <p className="mk-state__hint">{notice.message}</p>
      {notice.requestId && (
        <p className="mk-state__meta">
          Quote this to support:{' '}
          <code className="cf-num mk-reqid">{notice.requestId}</code>
        </p>
      )}
      {onRetry && (
        <div className="mk-state__action">
          <button type="button" className="cf-btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Refused, not broken.
 *
 * No retry button: the request was understood and denied, and a button that cannot succeed is a
 * button that teaches the user the app is unreliable. The request id is still shown — an
 * unexpected 403 is usually a misconfigured scope, and that is diagnosed from the server side.
 */
export function Forbidden({
  notice,
  title = 'This is not open to your account',
}: {
  notice?: ErrorNotice | undefined
  title?: string | undefined
}) {
  return (
    <div className="mk-state mk-state--forbidden" role="alert">
      <span className="mk-state__icon" aria-hidden="true">
        ⊘
      </span>
      <p className="mk-state__title">{title}</p>
      <p className="mk-state__hint">
        {notice?.message ?? 'Your account does not carry the permission this page needs.'} Whoever
        administers it can add that for you.
      </p>
      {notice?.requestId && (
        <p className="mk-state__meta">
          Reference: <code className="cf-num mk-reqid">{notice.requestId}</code>
        </p>
      )}
    </div>
  )
}
