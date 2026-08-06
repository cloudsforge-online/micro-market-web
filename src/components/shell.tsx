/**
 * The app shell: the company bar, this app's own navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented — it is the thing
 * that makes moving between surfaces feel like one application.
 *
 * `current={PRODUCT}` marks Forge Market as the current entry in the switcher:
 * `ui/packages/ui/src/surfaces.ts:227` registers it as a product with `inSwitcher: true`.
 */
import { CloudsForgeBar, CloudsForgeFooter } from '@cloudsforge/ui'
import { NavLink, Outlet } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { NAV } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'

export function AppShell() {
  const { account, signIn, signOut } = useSession()

  return (
    <>
      <a className="mk-skip" href="#main">
        Skip to the listings
      </a>
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
      />
      {/*
        Sticky at exactly `var(--cf-bar-h)` — the bar's own height token, not a number copied out
        of it. When the bar's height changes this moves with it; a hard-coded 46px would leave a
        seam that only appears on the surfaces nobody rechecked.
      */}
      <nav className="mk-subnav" aria-label="Sections">
        <div className="mk-subnav__inner">
          <span className="mk-wordmark">
            Forge <b>Market</b>
          </span>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // `end` only on the index: without it, `/` matches every path and the Browse tab
              // stays highlighted on every page.
              end={item.to === '/'}
              className={({ isActive }) => `mk-subnav__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="mk-main" id="main">
        <Outlet />
      </main>
      {/*
        The company footer, from @cloudsforge/ui, REPLACING the `mk-footer` this file used to
        write itself. The paragraph is kept verbatim as `note` — it is the sentence this surface
        turns on — and everything a footer is otherwise for arrives with it: the other products,
        the platform surfaces, the developer console, the status page and the legal pages, all
        derived from the surface registry rather than typed here.
      */}
      <CloudsForgeFooter
        current={PRODUCT}
        account={account}
        note={
          <>
            Money on this surface is held by Forge Ledger, never by Forge Market: an escrow here is
            a reference to a reservation, not a balance. Fees and royalties are posted in the same
            entry as the sale, which is why they add up to the price exactly.
          </>
        }
      />
    </>
  )
}
