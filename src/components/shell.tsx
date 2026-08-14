/**
 * The app shell: the company bar, this app's own navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented — it is the thing
 * that makes moving between surfaces feel like one application.
 *
 * `current={PRODUCT}` marks Forge Market as the current entry in the switcher:
 * `ui/packages/ui/src/surfaces.ts` registers it as a product with `inSwitcher: true`.
 */
import { useEffect, useState } from 'react'
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
  SubNav,
  miningOnHub,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta } from '@cloudsforge/ui/seo'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { PRODUCT, hosts } from '../lib/hosts.ts'
import { NAV, ROUTES } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'
import { setViewedNetwork, viewedNetwork, type ViewedNetwork } from '../lib/viewed.ts'

export function AppShell() {
  // The viewed network: in-tab memory, defaulting to the hostname's own (micro-org#459).
  // `setViewedNetwork` runs first in the handler below so the remounted tree reads the new value
  // on its very first render.
  const [viewed, setViewed] = useState<ViewedNetwork>(viewedNetwork())
  const { account, signIn, signOut } = useSession()

  return (
    <>
      {/*
        The skip link is the first focusable thing in the document, and it is now the SHARED one.
        This surface wrote its own — an `.mk-skip` anchor reading "Skip to the listings", pointed at
        `#main` — and the anchor was only half of what a skip link needs: a plain `<main>` is not
        focusable, so in Chrome and Safari the fragment scrolled the page and left focus on the
        link, and the next Tab went back into the bar. `MainRegion` below is the other half. It
        sets `tabIndex={-1}` on the landmark, which is what actually moves focus into the page.

        The wording goes from "Skip to the listings" to the shared "Skip to content" deliberately:
        four of this app's six routes are not listings, so the old sentence was accurate on the
        front page and wrong on Sell, Orders and Fees.
      */}
      <SkipLink />
      {/*
        `mining` is the design system's own control, immediately before the account menu.

        The owner's report was that starting a browser miner is "hidden deep in mining page"; the
        answer is a control in the one piece of chrome every surface renders. This surface passes
        `miningOnHub()`, which is the `elsewhere` state: the miner is a WebSocket and two Web
        Workers on ONE origin, `hub.<apex>` is a different origin from this one, and nothing here
        can observe, start or stop a session over there. So it renders an ANCHOR to the page that
        can — middle-clickable, openable in a new tab, and visible to every check that reads links,
        which is the argument `accountSettingsUrl` makes about the account entry.

        `hosts().hub` rather than a literal. This bundle is served from localhost, from a preview
        host and from the apex, and a written-out URL would be right on exactly one of them.
      */}
      {/*
        In-app network context (micro-org#459, the combined view). The reader's choice lives in
        `lib/viewed.ts` — module memory, never storage — and the `key` on the Outlet below is the
        refetch mechanism: switching remounts the page tree, and `apiBase()` reads `viewedHosts()`,
        so the same page re-reads itself from the other estate WITHOUT going anywhere. The band and
        the switcher both follow the selection, so testnet data under a mainnet address bar is
        never unmarked. The bar also stamps `?net=` onto its product links, which is what carries
        the choice across a product switch — every surface is its own origin, so nothing else can.
      */}
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        mining={miningOnHub(hosts().hub)}
        networkSwitch={{
          selected: viewed,
          onSelect: (n) => {
            setViewedNetwork(n)
            setViewed(n)
          },
        }}
      />
      {/*
        `SubNav` from @cloudsforge/ui, rather than the `.mk-subnav` this file used to write itself.

        Measured 2026-08-10: ten frontends declared this row in their own stylesheet under six
        different class prefixes, from one original that had been copied and then edited in place.
        This copy had two of the three defects that produced. It was `display: flex` with no
        `overflow-x` and its links had no `white-space: nowrap`, so on a phone SIX labels — plus
        the wordmark — squeezed, broke mid-word, and the ones past the edge could not be reached at
        all; and its measure was `78rem`, 1248px, against the 1200px `.cf-bar__inner` and
        `.cf-foot__inner` use, so the strip sat 24px proud of the bar on each side.

        `.mk-wordmark` STAYS, as a local class layered on the shared strip. It is the one piece of
        this row that is genuinely this surface's: no other frontend puts a product wordmark inside
        its sections, and `SubNav` takes children precisely so that a surface with something extra
        to put in the row does not need a second strip to put it in.
      */}
      <SubNav label="Sections">
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
            className={({ isActive }) =>
              `cf-subnav__link${isActive ? ' cf-subnav__link--current' : ''}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </SubNav>
      <DocumentMeta />
      {/*
        `MainRegion` rather than a bare `<main>`: same landmark, same class, plus the `id` the
        shared `SkipLink` points at and the `tabIndex={-1}` that makes the jump land focus here.
      */}
      <MainRegion className="mk-main">
        <Outlet key={viewed} />
      </MainRegion>
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

      {/*
        Last in the document, and therefore last in the tab order. That is deliberate: the banner
        is a dialog and is explicitly NOT modal, so a reader who came here to look at a listing can
        look at it and answer afterwards. A consent banner that traps focus is the coercion the
        regulation is about. It renders nothing at all until it knows this reader has not already
        answered, and nothing on an origin where analytics would not report anyway — which is why
        it does not appear under `pnpm dev`.
      */}
      <CookieBanner />
    </>
  )
}

/**
 * The page title, description, Open Graph tags and canonical, kept in step with the address.
 *
 * A component in the shell rather than a hook each page calls, because the failure mode of the
 * second shape is the page that forgets — and the page that forgets is the one added last, which
 * is the one nobody has bookmarked and therefore the one nobody notices is titled with the
 * previous page's title.
 *
 * Everything but the DOM write is `@cloudsforge/ui/seo`, which derives a surface's title and
 * description from the registry rather than from a string typed here. The only thing this file
 * decides is which of THIS app's routes the reader is on, and that is read off `ROUTES` rather
 * than restated — `test/routes.test.ts` already fails the build when that table drifts from the
 * router and from nginx, so deriving from it means the head cannot drift on its own.
 *
 * `index.html` keeps its static title and card. Those are what a link-preview fetcher that does
 * not execute JavaScript gets, for every address; the tags written here are what a browser and
 * every crawler that does execute it sees. That trade is inherited from the design system and is
 * written out at the top of `seo.ts` rather than discovered later in a link preview.
 */
function DocumentMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    applyHead(surfaceMeta(PRODUCT, pageMeta(pathname)), window.location.origin)
  }, [pathname])

  return null
}

/**
 * A title for a route that has no navigation label.
 *
 * `listings` is the only one: `ROUTES` gives it `label: null` because the index already IS the
 * list of listings, so there is nothing to put in the sub-nav — but `/listings/<id>` is the
 * address people paste at each other, and it is the single most-shared page on this surface. A
 * tab reading "Forge Market" for all of them is a browser session nobody can navigate.
 */
const UNLABELLED_TITLES: Readonly<Record<string, string>> = { listings: 'Listing' }

/** What this address is, as far as the head is concerned. Derived from `ROUTES`, never restated. */
function pageMeta(pathname: string): { title?: string; path: string; robots?: string } {
  const segment = pathname.replace(/^\/+/, '').split('/')[0] ?? ''
  // The index is the surface itself, and `surfaceMeta` refuses to title it "Forge Market — Forge
  // Market" — passing no title is how it is told so.
  if (segment === '') return { path: pathname }

  const declared = ROUTES.find((route) => route.path === segment)
  if (!declared) {
    /*
     * An address this app does not route. nginx answers it with a 404 status and this shell
     * inside it, so the page a reader sees is NotFoundPage — and the head must say the same
     * thing. `noindex` because a not-found page that invites indexing is how a broken link
     * becomes a search result; `follow` because the links on it (Browse, Collections) are real.
     */
    return { title: 'Not found', path: pathname, robots: 'noindex, follow' }
  }

  const title = declared.label ?? UNLABELLED_TITLES[declared.path]
  return title === undefined ? { path: pathname } : { title, path: pathname }
}
