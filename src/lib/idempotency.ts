/**
 * The `Idempotency-Key` every mutating call to `micro-market` must carry.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE HEADER IS REQUIRED, AND A KEY IDENTIFIES AN INTENT — NOT A REQUEST.**
 *
 * `market/src/server.ts` refuses any mutating request without a key matching
 * `/^[A-Za-z0-9_:.-]{8,200}$/` (`server.ts`). It is required rather than optional because
 * "the safe path is the one a client has to remember, and the unsafe one is the default — which
 * on a marketplace means a double-clicked Buy button charges twice" (server.ts).
 *
 * So the key is minted ONCE, when the user forms the intent (the form is mounted, the Buy button
 * is armed), and REUSED for every retry of that intent. A key minted per fetch would defeat the
 * whole mechanism: two clicks would be two keys and two orders. `useIdempotencyKey` in the pages
 * holds one for the lifetime of the form and mints a fresh one only after a success.
 *
 * The service replays a repeat under the same key and answers 200 with `replayed: true` rather
 * than 201 (server.ts), so a second click reads back the FIRST order rather than
 * failing — which is why a client must never translate `replayed` into an error.
 *
 * A key reused with a genuinely DIFFERENT body is a 409 `idempotency_key_reused`
 * (server.ts), and that is a real error worth showing: it means this app sent two
 * different intents under one key, which is a bug here rather than a fault the user can fix.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The header name, spelled once. `market/src/server.ts`. */
export const IDEMPOTENCY_HEADER = 'idempotency-key'

/** The service's own pattern, restated so a bad key is caught before it costs a round trip. */
export const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{8,200}$/

/**
 * Mint a key for one intent.
 *
 * `crypto.randomUUID` where the browser has it, and a rejection-free fallback built from
 * `crypto.getRandomValues` where it does not — Safari only gained `randomUUID` in 15.4, and a
 * `TypeError` thrown here would take out the Buy button rather than degrade it. The prefix names
 * the intent, so a key visible in a log says what it was for.
 */
export function newIdempotencyKey(prefix: string): string {
  const clean = prefix.replace(/[^A-Za-z0-9_.-]/g, '') || 'intent'
  return `market-web:${clean}:${randomToken()}`
}

function randomToken(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // No crypto at all. Still unique enough to keep two clicks in one session apart, which is the
  // failure this header exists to stop; a counter is honest about being a fallback.
  fallbackCounter += 1
  return `f${Date.now().toString(36)}-${fallbackCounter.toString(36)}`
}

let fallbackCounter = 0

/**
 * The headers for a mutating call, with the key validated first.
 *
 * Validated here rather than at the service, because a 400 that says "an Idempotency-Key header of
 * 8 to 200 characters is required" for a key this app generated is a bug in this app, and it
 * should fail where it was made rather than where it was rejected.
 */
export function idempotentHeaders(key: string): Record<string, string> {
  if (!SAFE_IDEMPOTENCY_KEY.test(key)) {
    throw new RangeError(
      `an idempotency key must match ${String(SAFE_IDEMPOTENCY_KEY)}; got ${JSON.stringify(key)}`,
    )
  }
  return { [IDEMPOTENCY_HEADER]: key }
}
