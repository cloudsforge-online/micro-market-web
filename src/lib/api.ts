/**
 * The auth client: tokens, one refresh at a time, and one error shape.
 *
 * Carried forward from Crucible's `src/lib/api.ts`, which is the version of this file that has
 * actually been run against Nimbus. The behaviour worth preserving verbatim is the SINGLE-FLIGHT
 * REFRESH: a dashboard that fires ten requests on mount, all of which 401 on an expired access
 * token, must perform ONE refresh. Ten refreshes against a rotating refresh token means nine of
 * them present a token that has just been superseded, and the user is signed out while holding a
 * valid session.
 */
import { consumeAuthCallback, signInRedirect, signOutRedirect } from '@cloudsforge/ui'
import { APP_NAME, apiBase, hosts, pageOrigin } from './hosts.ts'
import { report } from './obs.ts'

/** Nimbus issues and refreshes tokens; it is cross-origin from every app, always. */
function nimbusUrl(): string {
  return hosts().nimbus
}

/**
 * The shared CloudsForge token keys.
 *
 * Deliberately the same strings in every product: a session established at the Account portal is
 * picked up here without a second round trip, and signing out of one app on a shared machine
 * clears the tokens the next app would have read.
 */
const ACCESS_KEY = 'cf.accessToken'
const REFRESH_KEY = 'cf.refreshToken'

/** Fired when a refresh fails. `AuthProvider` listens and drops the session. */
export const AUTH_EXPIRED_EVENT = 'cf:auth-expired'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

/* ---- token storage ------------------------------------------------- */

const memory = new Map<string, string>()

/**
 * Storage, with a memory fallback.
 *
 * `localStorage` throws rather than returning null in a Safari private window and in a
 * third-party iframe with storage blocked. A module that touched it directly would take the whole
 * bundle down at import time in both, and could not be unit tested outside a browser at all. The
 * fallback loses the session on reload, which is a worse experience than persistence and a much
 * better one than a blank page.
 */
function store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Probe rather than trust: the throw happens on ACCESS, not on the typeof check.
      localStorage.getItem(ACCESS_KEY)
      return localStorage
    }
  } catch {
    // Fall through to memory.
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  }
}

export const getAccessToken = (): string | null => store().getItem(ACCESS_KEY)
export const getRefreshToken = (): string | null => store().getItem(REFRESH_KEY)

export function setTokens(tokens: AuthTokens): void {
  store().setItem(ACCESS_KEY, tokens.accessToken)
  store().setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearTokens(): void {
  store().removeItem(ACCESS_KEY)
  store().removeItem(REFRESH_KEY)
}

export const hasSession = (): boolean => Boolean(getAccessToken() && getRefreshToken())

/* ---- errors -------------------------------------------------------- */

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  /**
   * The server's id for the exact request that failed, echoed in both the `x-request-id` header
   * and the error body. Quoted by the user, it is what finds their request across every service
   * at once — which is why every failure state in this app displays it.
   */
  readonly requestId: string | undefined

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

/**
 * Pull the sentence, the code and the request id out of a service's error body.
 *
 * The estate's envelope is **nested** — `{error: {code, message, requestId}}`, built by
 * `errorReply()` in every service (`hub-api/src/server.ts:589`, `identity/src/server.ts:1431`,
 * `service-template/src/server.ts:342`). This function used to read it as flat, assigning
 * `data.error` — an object — straight to the displayed message. Every server-side failure in
 * every app cut from this template would have rendered as `[object Object]`, with the real
 * message, the code and the request id all present in the response and all discarded. The
 * request id is the one thing a support conversation runs on, so the failure mode was not
 * cosmetic: it destroyed exactly the field the app exists to show.
 *
 * Both shapes are accepted rather than only the nested one, because a proxy or an older service
 * on the rollback path may still answer flat, and a template that only understands the current
 * estate is a template that breaks during the migration it was written for.
 */
export function readErrorBody(body: unknown): {
  message?: string
  code?: string
  requestId?: string
} {
  if (typeof body !== 'object' || body === null) return {}
  const top = body as { error?: unknown; code?: unknown; requestId?: unknown; message?: unknown }
  const nested =
    typeof top.error === 'object' && top.error !== null
      ? (top.error as { code?: unknown; message?: unknown; requestId?: unknown })
      : undefined

  // A string `error` is the flat shape's message. An object `error` is the nested envelope, and
  // its fields win over any same-named field at the top level.
  const message =
    pickString(nested?.message) ??
    (typeof top.error === 'string' ? top.error : undefined) ??
    pickString(top.message)

  return {
    ...(message ? { message } : {}),
    ...(pickString(nested?.code) ?? pickString(top.code)
      ? { code: (pickString(nested?.code) ?? pickString(top.code)) as string }
      : {}),
    ...(pickString(nested?.requestId) ?? pickString(top.requestId)
      ? { requestId: (pickString(nested?.requestId) ?? pickString(top.requestId)) as string }
      : {}),
  }
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** What a failure state needs: the sentence, and the id to quote at support. */
export interface ErrorNotice {
  message: string
  requestId: string | undefined
  /** 403 is its own screen: the request was understood and refused, and retrying will not help. */
  forbidden: boolean
}

/**
 * Normalise a caught error for display.
 *
 * `fallback` covers the non-ApiError case, which is a bug in this bundle rather than a server
 * response — so it is also the only case worth reporting from here. An ApiError has already been
 * logged by the service that produced it, under the request id shown to the user.
 */
export function noticeFor(err: unknown, fallback: string): ErrorNotice {
  if (err instanceof ApiError) {
    return { message: err.message, requestId: err.requestId, forbidden: err.status === 403 }
  }
  report({
    app: APP_NAME,
    type: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? (err.stack ?? null) : null,
    context: { fallback },
  })
  return { message: fallback, requestId: undefined, forbidden: false }
}

/* ---- the single-flight refresh ------------------------------------- */

let inflightRefresh: Promise<boolean> | null = null

/**
 * Refresh the session, at most once concurrently.
 *
 * Every caller that arrives while a refresh is in flight awaits THE SAME promise; the slot is
 * cleared when it settles, so the next 401 after this one starts a fresh attempt rather than
 * replaying a stale answer.
 */
export function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return Promise.resolve(false)
  if (!inflightRefresh) {
    inflightRefresh = performRefresh(refreshToken).finally(() => {
      inflightRefresh = null
    })
  }
  return inflightRefresh
}

async function performRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${nimbusUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      // Returning false signs the user out either way, but the two causes are not the same event:
      // a 401 is an expired refresh token and routine, anything else is Nimbus failing. They were
      // indistinguishable for as long as neither was written down.
      if (res.status !== 401) {
        report({
          app: APP_NAME,
          type: 'RefreshFailed',
          message: `Token refresh failed (${res.status})`,
          statusCode: res.status,
          requestId: res.headers.get('x-request-id'),
        })
      }
      return false
    }
    setTokens((await res.json()) as AuthTokens)
    return true
  } catch (err) {
    report({
      app: APP_NAME,
      type: 'RefreshUnreachable',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { nimbus: nimbusUrl() },
    })
    return false
  }
}

function expireSession(): void {
  clearTokens()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

/* ---- the request core ---------------------------------------------- */

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Default true: attach the bearer token and refresh once on 401. */
  auth?: boolean
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /**
   * Extra request headers.
   *
   * Added for `Idempotency-Key`, which `micro-market` REQUIRES on every mutating route
   * (`market/src/server.ts:1152-1157`: an 8-to-200 character key, or the request is a 400). The
   * header is sent per request rather than per client because the key identifies the INTENT — one
   * key per Buy button press, replayed unchanged on every retry of that press.
   *
   * `authorization` and `content-type` are set by the request core and are not overridable here:
   * a caller that could replace the bearer token would be a caller that could send somebody
   * else's, and a caller that could change the content type would silently break the body.
   */
  headers?: Record<string, string>
}

/** Set by the request core itself; a caller's copy is ignored rather than allowed to win. */
const RESERVED_HEADERS = new Set(['authorization', 'content-type', 'accept'])

async function request<T>(base: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, query, signal, headers: extra } = opts

  // `base` may be '' (relative, same origin), so resolve against the page origin.
  const url = new URL(base + path, pageOrigin())
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
  }

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' }
    for (const [name, value] of Object.entries(extra ?? {})) {
      if (!RESERVED_HEADERS.has(name.toLowerCase())) headers[name] = value
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const token = getAccessToken()
    if (auth && token) headers['authorization'] = `Bearer ${token}`
    return fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
  }

  let res: Response
  try {
    res = await send()
  } catch (err) {
    // The user-facing sentence is the right one whether the cause is their wifi or our container.
    // The cause itself, though, only exists here — discarding it is how a service being down
    // looked exactly like a bad connection, for everyone, for as long as it lasted.
    report({
      app: APP_NAME,
      type: 'NetworkError',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { method, url: url.toString() },
    })
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }

  // One silent refresh and retry on expiry. Ten of these at once share one refresh.
  if (res.status === 401 && auth && getRefreshToken()) {
    if (await refreshSession()) {
      res = await send()
    } else {
      expireSession()
      throw new ApiError(
        401,
        'Your session expired. Sign in again.',
        'session_expired',
        res.headers.get('x-request-id') ?? undefined,
      )
    }
  }

  if (!res.ok) {
    // Every service sets this header on every response, error or not, so it is present even when
    // the body is a proxy's HTML page rather than ours.
    let requestId = res.headers.get('x-request-id') ?? undefined
    let message = res.statusText || `Request failed (${res.status})`
    let code: string | undefined
    try {
      const parsed = readErrorBody(await res.json())
      if (parsed.message) message = parsed.message
      if (parsed.code) code = parsed.code
      if (parsed.requestId) requestId = parsed.requestId
    } catch (err) {
      // A non-JSON error body means something in FRONT of the service answered — a gateway, a
      // CDN, a misrouted deploy — and the request never reached it. Nothing server-side logs
      // that, so it has to be reported from here.
      report({
        app: APP_NAME,
        type: 'NonJsonErrorBody',
        message: `${res.status} response from ${url.pathname} was not JSON`,
        stack: err instanceof Error ? (err.stack ?? null) : null,
        statusCode: res.status,
        requestId,
        context: { method, contentType: res.headers.get('content-type') },
      })
    }
    if (res.status === 401 && auth) expireSession()
    throw new ApiError(res.status, message, code, requestId)
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

/** This app's own API: relative in production, the registry's dev port under `pnpm dev`. */
export const api = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(apiBase(), path, opts)

/** Nimbus, which is cross-origin from everywhere. */
export const nimbus = <T,>(path: string, opts?: RequestOptions): Promise<T> =>
  request<T>(nimbusUrl(), path, opts)

/* ---- boot and sign-in --------------------------------------------- */

/**
 * Redeem an SSO hand-off code, if the Account portal sent us back with one.
 *
 * Called once from main.tsx BEFORE React renders, so the first paint already knows whether there
 * is a session and no screen flashes signed-out and then signed-in.
 *
 * The strip-then-exchange ordering inside `consumeAuthCallback` is load-bearing and is documented
 * where it is implemented: the code leaves the address bar before it goes over the wire, so it is
 * never in the history, in a referrer, or in a screenshot taken while the request is in flight.
 * Nothing here may reorder that, and nothing here may re-read `location.hash` afterwards.
 */
export async function bootstrapSession(): Promise<boolean> {
  try {
    const tokens = await consumeAuthCallback()
    if (tokens) {
      setTokens(tokens)
      return true
    }
  } catch (err) {
    // A failed exchange is a signed-out boot, not a broken app: the sign-in button is right there.
    report({
      app: APP_NAME,
      type: 'AuthCallbackFailed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
    })
  }
  return hasSession()
}

/**
 * Send the browser to the Account portal, returning here afterwards.
 *
 * `returnTo` defaults to the CURRENT URL including its path and query, which is what puts a user
 * who deep-linked into a protected page back on that page rather than on a dashboard they then
 * have to navigate out of.
 */
export function signIn(returnTo?: string): void {
  signInRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.href))
}

/** Clear this app's tokens FIRST — the portal cannot reach them — then end the shared session. */
export function signOut(returnTo?: string): void {
  clearTokens()
  signOutRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.origin))
}

/** Reset module state. Tests only. */
export function __resetAuth(): void {
  inflightRefresh = null
  memory.clear()
}
