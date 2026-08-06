/**
 * One idempotency key per INTENT, held for as long as the intent lasts.
 *
 * The key must not change between the first attempt and a retry of the same attempt — that is the
 * whole mechanism (`idempotency.ts`). So it is minted when a form mounts and kept in state, and
 * `renew()` is called only after a SUCCESS, at which point the user's next click is a new intent.
 *
 * Minting inside the submit handler would produce a fresh key per click, which is precisely the
 * double-charge `market/src/server.ts` requires the header to prevent.
 */
import { useCallback, useState } from 'react'
import { newIdempotencyKey } from './idempotency.ts'

export interface Intent {
  /** The key to send. Stable until `renew()`. */
  readonly key: string
  /** Start a new intent. Call after a success, never after a failure. */
  readonly renew: () => void
}

export function useIntent(prefix: string): Intent {
  const [key, setKey] = useState(() => newIdempotencyKey(prefix))
  const renew = useCallback(() => setKey(newIdempotencyKey(prefix)), [prefix])
  return { key, renew }
}
