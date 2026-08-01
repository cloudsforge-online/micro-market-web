/**
 * The unknown-path page.
 *
 * It is rendered under an HTTP 404, not a 200 — nginx.conf enumerates the app's real routes and
 * lets everything else fall through to `error_page 404 /index.html`, which serves this bundle
 * while KEEPING the status. The estate's current site returns 200 for every unknown path, so its
 * "page not found" screen is served as a success: crawlers index it, monitors call it healthy,
 * and a broken link in a deploy looks exactly like a working one.
 */
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="mk-state mk-state--empty" role="status">
      <span className="mk-state__icon" aria-hidden="true">
        ◇
      </span>
      <p className="mk-state__title">There is no page at this address</p>
      <p className="mk-state__hint">
        The link may be out of date, or the page may have moved. This response carries a 404
        status, so whatever sent you here can be fixed.
      </p>
      <div className="mk-state__action">
        <Link className="cf-btn" to="/">
          Back to the listings
        </Link>
      </div>
    </div>
  )
}
