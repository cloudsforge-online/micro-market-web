/**
 * Session state for the tree, and the gate in front of protected routes.
 *
 * Hiding a route is NOT the security boundary — every service verifies the token and the scope on
 * the request itself. This exists so that a signed-out user is sent to sign in instead of being
 * shown a screen made entirely of failures, and so that a signed-in one is not asked again.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { AccountState } from '@cloudsforge/ui'
import { AUTH_EXPIRED_EVENT, clearTokens, hasSession, nimbus, signIn, signOut } from './api.ts'

/**
 * What Nimbus answers at `GET /auth/me` — **`identity/src/server.ts:891-903`**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE PROFILE IS NESTED UNDER `user`, AND EVERY FRONTEND IN THIS ESTATE READS IT FLAT.**
 *
 * `server.ts:895-902` returns `{ user, session, organisations }`, where `user` is `toPublicUser`
 * (`identity/src/users.ts:52-63`): `{ id, email, emailVerifiedAt, handle, status, roles,
 * createdAt, lastSeenAt }`.
 *
 * `web-template/src/lib/auth.tsx:13-17` declares `interface Me { handle?, roles? }` at the TOP
 * level and assigns `me?.handle` into the bar's account state. There is no `handle` at the top
 * level, so it is `undefined` in every app cut from that template — the account menu shows no
 * name and no roles for a signed-in user, and no type error is possible because both fields are
 * optional. Same defect class as the seven route defects: a client reading a shape somebody
 * imagined. Reported for `web-template`, `hub-web`, `site`, `foresight-web` and
 * `foresight-admin-web`; corrected here, because this file is now this repository's.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
interface Me {
  user?: {
    id?: string | null
    handle?: string | null
    roles?: readonly string[] | null
  } | null
}

export type SessionStatus = 'loading' | 'anonymous' | 'signedIn'

export interface Session {
  status: SessionStatus
  account: AccountState
  /**
   * The signed-in user's LEDGER SUBJECT — `user:<id>` — or null.
   *
   * `market/src/server.ts:1293-1297` builds exactly this string from the token and compares
   * listings and orders against it, so it is the value `?sellerSubject=` has to carry for the
   * seller's own listings to come back. Composed here, from the id Nimbus returns, rather than in
   * each page: a page that spelled it `user-<id>` would silently get an empty market.
   */
  subject: string | null
  signIn: (returnTo?: string) => void
  signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const value = useContext(SessionContext)
  // Throwing beats returning a signed-out default: a component rendered outside the provider
  // would otherwise show an anonymous UI to a signed-in user and nobody would ever see why.
  if (!value) throw new Error('useSession must be used inside <AuthProvider>')
  return value
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(() => (hasSession() ? 'loading' : 'anonymous'))
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    if (!hasSession()) return
    let live = true
    // The identity call is the one request that is allowed to fail quietly: an unreachable Nimbus
    // must not sign anyone out — that is the cascade the estate's readiness rules exist to avoid.
    nimbus<Me>('/auth/me')
      .then((profile) => {
        if (!live) return
        setMe(profile)
        setStatus('signedIn')
      })
      .catch(() => {
        if (!live) return
        setStatus(hasSession() ? 'signedIn' : 'anonymous')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onExpired = () => {
      clearTokens()
      setMe(null)
      setStatus('anonymous')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const doSignOut = useCallback(() => {
    setMe(null)
    setStatus('anonymous')
    signOut()
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      account: {
        signedIn: status === 'signedIn',
        handle: me?.user?.handle ?? null,
        roles: me?.user?.roles ?? null,
      },
      subject: me?.user?.id ? `user:${me.user.id}` : null,
      signIn,
      signOut: doSignOut,
    }),
    [status, me, doSignOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Gate a route behind a session.
 *
 * The redirect carries the CURRENT path, search and hash, so a user who followed a link to a deep
 * page lands back on that page rather than on the dashboard. It is fired from an effect rather
 * than during render because a redirect during render runs twice under StrictMode, and the second
 * one would overwrite the first's return address.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, signIn: go } = useSession()
  const location = useLocation()

  useEffect(() => {
    if (status !== 'anonymous') return
    const back = `${window.location.origin}${location.pathname}${location.search}${location.hash}`
    go(back)
  }, [status, location.pathname, location.search, location.hash, go])

  if (status === 'loading') {
    return <LoadingGate label="Checking your session" />
  }
  if (status === 'anonymous') {
    return <LoadingGate label="Taking you to sign in" />
  }
  return <>{children}</>
}

/**
 * The panel a reader sees for the moment a gated route is deciding whether to let them in.
 *
 * `mk-`, NOT `wt-`. This markup arrived from `web-template`, kept that template's class prefix,
 * and `src/styles.css` has never defined a single `wt-` rule — so both gates rendered completely
 * unstyled: no padding, no centring, and a `<span>` where the spinner should be, which is an
 * empty inline box a reader cannot see at all. It looked like a blank page with one line of text
 * on it, which is exactly what "Checking your session" must not look like.
 *
 * The class names are the ones `components/states.tsx` uses for the same three elements, so the
 * two loading panels in this app are now one design rather than one design and one accident.
 */
function LoadingGate({ label }: { label: string }) {
  return (
    <div className="mk-state mk-state--loading" role="status">
      <span className="mk-spinner" aria-hidden="true" />
      <p className="mk-state__title">{label}</p>
    </div>
  )
}
