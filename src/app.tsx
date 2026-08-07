/**
 * The route table: which component renders at each address.
 *
 * The ADDRESSES themselves are declared once, in `src/lib/routes.ts`, which the navigation derives
 * from and which `test/routes.test.ts` checks this file and `nginx.conf` against. nginx serves the
 * bundle only for the paths it enumerates and 404s everything else on purpose, so a route added
 * here and not there works under `pnpm dev` and dies on the first hard refresh in production. The
 * test is the mechanism; "remember to update nginx.conf" is not.
 *
 * ── Browsing is public; selling and orders are not ────────────────────────────────────────────
 *
 * A marketplace whose catalogue is behind a sign-in is a catalogue nobody can link to, and a
 * listing nobody can link to is a listing nobody shares. So `/`, `/listings/*` and `/collections/*`
 * are open, and the two things that genuinely need a session ask for it: `/sell` and `/orders/*`
 * are wrapped in `ProtectedRoute`, because `GET /v1/orders` derives the subject from the token
 * (`market/src/server.ts`) and there is nothing to render without one.
 *
 * `/fees` is public and deliberately so: 15-monetisation-model.md §3.4 sets the take rate at 250
 * bps of the sale paid by the seller, and a rate a seller cannot read before listing is a rate
 * they find out about afterwards.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ScrollToTop } from './components/scroll-to-top.tsx'
import { AppShell } from './components/shell.tsx'
import { AuthProvider, ProtectedRoute } from './lib/auth.tsx'
import { BrowsePage } from './pages/browse.tsx'
import { CollectionsPage } from './pages/collections.tsx'
import { FeesPage } from './pages/fees.tsx'
import { ListingPage } from './pages/listing.tsx'
import { NotFoundPage } from './pages/not-found.tsx'
import { OrdersPage } from './pages/orders.tsx'
import { SellPage } from './pages/sell.tsx'

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<BrowsePage />} />
            {/* `listings/*`, because `/listings/<uuid>` is the address people share. */}
            <Route path="listings/*" element={<ListingPage />} />
            <Route path="collections/*" element={<CollectionsPage />} />
            <Route
              path="sell"
              element={
                <ProtectedRoute>
                  <SellPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="orders/*"
              element={
                <ProtectedRoute>
                  <OrdersPage />
                </ProtectedRoute>
              }
            />
            <Route path="fees" element={<FeesPage />} />
            {/* Unknown paths render inside the shell, so the reader keeps the navigation they need
                to get back out. The STATUS is nginx's doing, not this route's — see
                pages/not-found.tsx. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
