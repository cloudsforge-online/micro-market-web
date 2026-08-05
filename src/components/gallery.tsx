/**
 * A listing's photographs: the gallery buyers see, and the editor its seller uses.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ## THREE STATES, NOT TWO — AND THE THIRD IS THE COMMON ONE TODAY
 *
 *   HAS IMAGES        — render them, in position order, `<img>` straight from studio's `bytesUrl`.
 *   HAS NONE          — say so quietly. A listing without photographs is ordinary, not broken.
 *   HAS SOME, NO URL  — the listing names images and this deployment does not know where a browser
 *                       reaches micro-studio, so `bytesUrl` is `null` on every one of them.
 *
 * The third state is why `bytesUrl` is nullable at all and why it is not collapsed into the second.
 * `STUDIO_PUBLIC_URL` is unset across the estate at the time of writing — studio has no gateway
 * router and no entry in the surface registry — and rendering "no photographs" for a listing whose
 * seller uploaded six would tell the seller their work vanished. The two are different facts and
 * they get different sentences.
 *
 * ## WHAT IS DELIBERATELY NOT ON SCREEN
 *
 * No tick, no shield, no "verified image", no checksum badge. An image here has a **recorded
 * content address** and NOT a chain attestation: Hearth has no Registry of Authorship contract
 * (`tessera/src/kiln.ts:373-392` — the Solidity has never been written), so studio's `anchor.state`
 * is `'unanchored'` on every asset in existence. A badge derived from any of it would be a check
 * that always passes, shown to people about to spend real money. `src/lib/market.ts` states the
 * rule on the type; this file is where it would have been broken.
 *
 * ## `<img>` RATHER THAN A BACKGROUND IMAGE, AND `loading="lazy"`
 *
 * A background image has no `alt`, so a screen reader gets nothing and a broken URL is invisible.
 * `alt` here names the ITEM rather than describing the picture — this app has no idea what the
 * picture shows, and inventing a description would be worse than a useful label. `loading="lazy"`
 * because a browse page can carry fifty listings and the gallery below the fold is not worth a
 * request until it is looked at.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useRef, useState } from 'react'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { useIntent } from '../lib/intent.ts'
import {
  attachListingImage,
  detachListingImage,
  getImageConfig,
  setListingGallery,
  type ListingImageView,
} from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { useSubmit } from '../lib/submit.ts'
import { ACCEPTED_MEDIA_TYPES, refusalMessage, uploadImage } from '../lib/studio.ts'

/* ------------------------------------------------------------------ the buyer's view */

export function Gallery({
  images,
  itemUrn,
}: {
  images: readonly ListingImageView[]
  /** What the listing is selling. Used as the `alt`, because it is the only true label we have. */
  itemUrn: string
}) {
  if (images.length === 0) return null

  const renderable = images.filter((image) => image.bytesUrl !== null)
  if (renderable.length === 0) {
    // The third state. See the file header: this is not "no photographs".
    return (
      <section className="mk-gallery mk-gallery--unavailable" aria-label="Photographs">
        <p className="mk-note mk-note--strong">
          This listing has {images.length === 1 ? 'a photograph' : `${images.length} photographs`},
          but images are not available on this deployment. Nothing has been lost — the listing still
          names them, and they will appear once the image service has a public address.
        </p>
      </section>
    )
  }

  return (
    <section className="mk-gallery" aria-label="Photographs">
      <ul className="mk-gallery__list">
        {renderable.map((image, index) => (
          <li key={image.studioAssetId} className="mk-gallery__item">
            <img
              className="mk-gallery__img"
              src={image.bytesUrl as string}
              // Positional, and honest about being positional. This app has never seen the picture.
              alt={`${itemUrn} — photograph ${index + 1} of ${renderable.length}`}
              loading="lazy"
              decoding="async"
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ the seller's editor */

/**
 * Upload an image, attach it, remove one, and change the order.
 *
 * Only rendered for a listing the signed-in user sells, and only while it is a `draft` or `active`:
 * `market` answers 409 for any other status, because a sold listing's photographs are part of the
 * record of what was sold. The caller decides that; this component renders whatever it is given and
 * surfaces the service's refusal if the caller is wrong.
 */
export function GalleryEditor({
  listingId,
  images,
  itemUrn,
  onChanged,
}: {
  listingId: string
  images: readonly ListingImageView[]
  itemUrn: string
  onChanged: () => void
}) {
  const config = useResource(
    (signal) => getImageConfig({ signal }),
    () => 1,
    'We could not check whether images are available.',
  )
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { busy, run } = useSubmit()
  const intent = useIntent('image')
  const fileInput = useRef<HTMLInputElement | null>(null)

  const accepted = config.data?.acceptedMediaTypes ?? ACCEPTED_MEDIA_TYPES
  const max = config.data?.maxImagesPerListing ?? null
  const uploadUrl = config.data?.uploadUrl ?? null
  const full = max !== null && images.length >= max

  const choose = useCallback((file: File | null) => {
    if (!file || !uploadUrl) return
    void run(async () => {
      setError(null)
      setNote(null)
      try {
        // TWO calls, in this order, and the order is the point: bytes to studio, then a reference
        // to market. A failure between them leaves an orphaned asset in studio and no broken
        // listing — the harmless direction. The reverse would attach an id to a listing before
        // anything existed behind it.
        const uploaded = await uploadImage({ uploadUrl, file })
        await attachListingImage(intent.key, listingId, {
          studioAssetId: uploaded.asset.id,
          checksum: uploaded.asset.checksum,
        })
        intent.renew()
        setNote(
          uploaded.metadataStrippedBytes > 0
            ? 'Added. Location and camera information was removed from the file before it was stored.'
            : 'Added.',
        )
        onChanged()
      } catch (err) {
        // studio's own reason first, in plain language — `svg_refused` and `too_large` are the two
        // a person hits most, and "Bad Request" for either is a dead end.
        const refusal = refusalMessage(err)
        setError(
          refusal
            ? { message: refusal, requestId: undefined, forbidden: false }
            : noticeFor(err, 'That image was not added.'),
        )
      } finally {
        // So choosing the SAME file again fires `change`. Without this, a user whose first attempt
        // was refused for a fixable reason cannot retry with the corrected file of the same name.
        if (fileInput.current) fileInput.current.value = ''
      }
    })
  }, [uploadUrl, listingId, intent, onChanged, run])

  const remove = (studioAssetId: string) =>
    void run(async () => {
      setError(null)
      setNote(null)
      try {
        await detachListingImage(intent.key, listingId, studioAssetId)
        intent.renew()
        onChanged()
      } catch (err) {
        setError(noticeFor(err, 'That image was not removed.'))
      }
    })

  const move = (from: number, to: number) =>
    void run(async () => {
      setError(null)
      setNote(null)
      const next = [...images]
      const moved = next[from]
      if (!moved || to < 0 || to >= next.length) return
      next.splice(from, 1)
      next.splice(to, 0, moved)
      try {
        // The WHOLE gallery, every time. `PUT` of the complete representation is what makes a
        // retried reorder idempotent; a "move" verb applied twice moves twice.
        await setListingGallery(
          intent.key,
          listingId,
          next.map((image) => ({
            studioAssetId: image.studioAssetId,
            checksum: image.checksum,
          })),
        )
        intent.renew()
        onChanged()
      } catch (err) {
        setError(noticeFor(err, 'The order was not changed.'))
      }
    })

  return (
    <div className="mk-gallery-edit">
      <h3 className="mk-gallery-edit__title">Photographs</h3>

      {config.state === 'failed' && (
        <p className="mk-note mk-note--strong">
          We could not check whether images are available right now. Nothing already on this listing
          has changed.
        </p>
      )}

      {config.state !== 'loading' && uploadUrl === null && (
        // Said once, plainly, instead of a control that fails on click. `uploadUrl` is null when
        // `STUDIO_PUBLIC_URL` is unset on the service, which is every deployment today.
        <p className="mk-note mk-note--strong">
          Image uploads are not available on this deployment yet. Everything else about this listing
          works as normal.
        </p>
      )}

      {images.length > 0 && (
        <ul className="mk-gallery-edit__list">
          {images.map((image, index) => (
            <li key={image.studioAssetId} className="mk-gallery-edit__row">
              {image.bytesUrl ? (
                <img
                  className="mk-gallery-edit__thumb"
                  src={image.bytesUrl}
                  alt={`${itemUrn} — photograph ${index + 1}`}
                  loading="lazy"
                />
              ) : (
                <span className="mk-gallery-edit__thumb mk-gallery-edit__thumb--absent" aria-hidden="true">
                  ◇
                </span>
              )}
              <span className="mk-gallery-edit__ord">{index + 1}</span>
              <button
                type="button"
                className="cf-btn"
                disabled={busy || index === 0}
                onClick={() => move(index, index - 1)}
                aria-label={`Move photograph ${index + 1} earlier`}
              >
                ↑
              </button>
              <button
                type="button"
                className="cf-btn"
                disabled={busy || index === images.length - 1}
                onClick={() => move(index, index + 1)}
                aria-label={`Move photograph ${index + 1} later`}
              >
                ↓
              </button>
              <button
                type="button"
                className="cf-btn"
                disabled={busy}
                onClick={() => remove(image.studioAssetId)}
                aria-label={`Remove photograph ${index + 1}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploadUrl !== null && (
        <label className="mk-field">
          <span className="mk-field__label">
            Add a photograph{max !== null && ` (${images.length} of ${max})`}
          </span>
          <input
            ref={fileInput}
            className="cf-input"
            type="file"
            // A CONVENIENCE, NOT A CONTROL. Every file dialog has an "all files" option and a
            // renamed `.png` is one drag away; micro-studio decides on magic bytes and is the only
            // thing standing between this form and a hostile file. Said here because the next
            // person to read this line will otherwise assume it is doing security work.
            accept={accepted.join(',')}
            disabled={busy || full}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
        </label>
      )}

      {full && (
        <p className="mk-note">
          This listing is holding as many photographs as it can. Remove one to add another.
        </p>
      )}

      {busy && (
        <p className="mk-note" role="status">
          Working…
        </p>
      )}

      {note && (
        <p className="mk-note mk-note--strong" role="status">
          {note}
        </p>
      )}

      {error && (
        <div className="mk-notice mk-notice--error" role="alert">
          <p className="mk-notice__title">
            <span aria-hidden="true">■ </span>
            That did not work
          </p>
          <p className="mk-notice__body">{error.message}</p>
          {error.requestId && (
            <p className="mk-notice__meta">
              Quote this to support: <code className="cf-num mk-reqid">{error.requestId}</code>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
