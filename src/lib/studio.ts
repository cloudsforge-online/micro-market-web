/**
 * The one request this app makes to a service that is not `micro-market`: an image upload.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ## WHY THE BYTES DO NOT GO THROUGH MARKET
 *
 * `micro-studio` is the estate's single media service. It decides an image's format from its MAGIC
 * BYTES rather than from the `Content-Type` a browser sent, refuses SVG outright, bounds dimensions
 * and total pixels, strips EXIF and GPS, and serves the result with `nosniff` and a restrictive CSP
 * (`studio/src/server.ts`). Market stores a REFERENCE to what studio accepted and never sees a byte
 * — `market/src/listingimages.ts` sets out why at length. So this file talks to studio directly.
 *
 * ## THE BODY IS RAW BYTES, NOT `multipart/form-data`
 *
 * `POST /v1/uploads` takes the image as the whole request body. studio's own note gives the reason:
 * multipart would mean a parser for a format "whose edge cases — nested boundaries, header
 * injection in a part name, a filename of `../../etc` — are a well-known source of exactly the bugs
 * this endpoint must not have". A `FormData` here would therefore not merely be different, it would
 * be rejected: nothing on that route reads a part.
 *
 * `Content-Type` is sent for honesty and is **read but never trusted** by studio. That is worth
 * knowing before writing any validation here: nothing this file checks can make an upload safe, and
 * nothing it fails to check can make one unsafe.
 *
 * ## THE `accept` ATTRIBUTE IS A CONVENIENCE, NOT A CONTROL
 *
 * `ACCEPTED_MEDIA_TYPES` below feeds the file picker's `accept` attribute so the common case is
 * pleasant. Every operating system's file dialog has an "all files" option, and a renamed `.png` is
 * one drag away. **studio decides, on the bytes.** If this list and studio's rules ever disagree,
 * studio is right and the user finds out through `refusalMessage` — which is why that function
 * covers every refusal reason the service can produce rather than only the ones this filter lets
 * through.
 *
 * ## WHAT THIS FILE MAY NEVER SAY
 *
 * An uploaded image has a **recorded content address** and nothing more. Hearth has no Registry of
 * Authorship contract — `tessera/src/kiln.ts` records that the Solidity has never been
 * written — so studio's `anchor.state` is `'unanchored'` on every asset in existence, and this app
 * must never render an image as "verified", "attested", "anchored" or "on-chain". A badge that
 * always passes, on a surface where people spend real money, teaches buyers to trust a check that
 * has never once been performed. The `checksum` is carried because market's API requires it; it is
 * never shown as a claim.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { ApiError, getAccessToken, readErrorBody, refreshSession } from './api.ts'
import { report } from './obs.ts'
import { APP_NAME } from './hosts.ts'

/**
 * What the file picker offers. Mirrors `acceptedMediaTypes` from `GET /v1/images/config`
 * (`market/src/server.ts`), which is the authority; this constant is the value used before that
 * call has answered, so the control is not briefly unusable on a slow connection.
 */
export const ACCEPTED_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

/** The `accept` attribute string, spelled once. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MEDIA_TYPES.join(',')

/**
 * An asset as studio reports it, narrowed to the fields this app uses.
 *
 * Deliberately does NOT mirror `anchor`. The field exists on studio's asset and is
 * `{state: 'unanchored', …}` on every asset that exists; declaring it here would put it one
 * autocomplete away from a component that renders it, and the first thing anybody would render is a
 * tick. What cannot be reached cannot be misread.
 */
export interface UploadedAsset {
  readonly id: string
  readonly checksum: string
  readonly format: string
  readonly mediaType: string
  readonly actualWidth: number
  readonly actualHeight: number
  readonly byteSize: number
  readonly visibility: 'public' | 'private'
}

export interface UploadResult {
  readonly asset: UploadedAsset
  /**
   * True when these exact bytes were already stored for this owner and studio answered 200 rather
   * than 201. Not an error and not a duplicate to clean up — the same asset id comes back, so
   * attaching it produces the same gallery.
   */
  readonly deduplicated: boolean
  /** How many bytes of EXIF/GPS studio removed. Shown, so the privacy work is visible. */
  readonly metadataStrippedBytes: number
}

/**
 * Every reason `POST /v1/uploads` can refuse, in a sentence for the person who chose the file.
 *
 * The service answers 400 with `{error: {code: 'upload_<reason>', reason}}`. Both are read: `reason`
 * is the field studio documents, and the code is the fallback for the day a proxy rewrites the body
 * shape. An unknown reason falls through to the service's own message rather than to a guess —
 * "something went wrong" for a refusal that named itself is a support ticket this app created.
 */
const REFUSALS: Readonly<Record<string, string>> = {
  empty: 'That file is empty. Choose an image with something in it.',
  too_large:
    'That image is too large to upload. Export it at a smaller size or a lower quality and try again.',
  // The one worth the most words. A user who exported a logo from a design tool has an SVG and no
  // idea why it is special, and "unsupported format" would send them to try it again.
  svg_refused:
    'SVG images are not accepted anywhere on CloudsForge. An SVG is a document that can carry scripts, so it is refused for everyone’s safety. Export the picture as PNG, JPEG or WebP and upload that instead.',
  unrecognised_format:
    'That file is not a PNG, JPEG or WebP. The check is on the contents rather than the file name, so renaming it will not help — re-export it in one of those three formats.',
  dimensions_unreadable:
    'That image could not be read. It may be damaged; try opening it and saving a fresh copy.',
  dimensions_out_of_range:
    'That image’s width or height is outside the range we accept. Resize it and try again.',
  pixel_budget_exceeded:
    'That image has too many pixels overall, even though its file is small. Resize it to something closer to what a page displays.',
  truncated: 'That file is incomplete — the upload may have been interrupted. Try it again.',
  quota_exceeded:
    'You have uploaded a lot of images recently. Wait a moment and try again — nothing has been lost.',
}

/**
 * Turn a caught upload failure into a sentence, or `null` if it is not a refusal at all.
 *
 * Exported and tested on its own because the mapping is the part of this file with all the
 * judgement in it, and a mapping that lives inside a component is a mapping only a rendered test
 * can reach.
 */
export function refusalMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  const code = err.code ?? ''
  if (!code.startsWith('upload_')) return null
  const reason = readReason(err.body) ?? code.slice('upload_'.length)
  const known = REFUSALS[reason]
  if (known) {
    // The 429 carries `Retry-After`, and a wait with a number in it is a different sentence from a
    // wait without one.
    const retry = retryAfterSeconds(err)
    return retry === null ? known : `${known} (about ${retry} seconds.)`
  }
  return err.message
}

function readReason(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const envelope = (body as { error?: unknown }).error
  if (typeof envelope !== 'object' || envelope === null) return null
  const reason = (envelope as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.length > 0 ? reason : null
}

/** Stashed on the error when studio sends one, because `ApiError` has nowhere else to put it. */
const RETRY_AFTER = new WeakMap<ApiError, number>()

function retryAfterSeconds(err: ApiError): number | null {
  return RETRY_AFTER.get(err) ?? null
}

export interface UploadOptions {
  /**
   * The base studio address, from `GET /v1/images/config` — `market/src/server.ts`.
   *
   * Passed in rather than resolved here, and that is the whole design: `@cloudsforge/ui`'s surface
   * registry has no `studio` key, so `cloudsforgeHosts()` cannot compose an address for it, and a
   * hostname invented in this bundle would be one the estate promises and does not serve. The one
   * process that knows where a browser reaches studio is `micro-market`, which reads it from its
   * own environment; a `null` from that route means this deployment has not been told, and the
   * caller must not offer an upload control at all.
   */
  readonly uploadUrl: string
  readonly file: Blob
  readonly signal?: AbortSignal
}

/**
 * Upload one image and get back the asset market will be asked to reference.
 *
 * `?visibility=public` is deliberate and is stated at the call rather than baked into the URL: a
 * listing photograph is shown to buyers who are not signed in, and studio serves PUBLIC bytes with
 * no `Authorization` header at all — which is the only thing that makes an `<img src>` work, since
 * a browser sends no bearer token on one. A private asset here would render as a broken image for
 * everybody except its owner, who would therefore never notice.
 *
 * One silent refresh and retry on a 401, matching `api.ts`'s request core: a token that expired
 * while the user was choosing a file is the ordinary case, not an exception.
 */
export async function uploadImage(options: UploadOptions): Promise<UploadResult> {
  const url = new URL(options.uploadUrl)
  url.searchParams.set('visibility', 'public')

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' }
    // Sent because it is true, not because it decides anything. studio reads magic bytes.
    if (options.file.type) headers['content-type'] = options.file.type
    const token = getAccessToken()
    if (token) headers['authorization'] = `Bearer ${token}`
    return fetch(url, {
      method: 'POST',
      headers,
      // The Blob itself. No FormData, no base64, no JSON wrapper — see the file header.
      body: options.file,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }

  let res: Response
  try {
    res = await send()
  } catch (err) {
    report({
      app: APP_NAME,
      type: 'StudioUnreachable',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { uploadUrl: options.uploadUrl },
    })
    throw new ApiError(0, 'The image service could not be reached. Check your connection and try again.')
  }

  if (res.status === 401 && (await refreshSession())) res = await send()

  if (!res.ok) throw await failure(res)

  // 201 for a new asset, 200 for a deduplicated retry. Both are successes and the body is the same
  // shape; a client that treated 200 as "something else happened" would re-upload for ever.
  const body = (await res.json()) as {
    asset: UploadedAsset
    deduplicated?: boolean
    metadataStrippedBytes?: number
  }
  return {
    asset: body.asset,
    deduplicated: body.deduplicated === true,
    metadataStrippedBytes:
      typeof body.metadataStrippedBytes === 'number' ? body.metadataStrippedBytes : 0,
  }
}

async function failure(res: Response): Promise<ApiError> {
  let requestId = res.headers.get('x-request-id') ?? undefined
  let message = res.statusText || `The upload failed (${res.status})`
  let code: string | undefined
  let raw: unknown
  try {
    raw = await res.json()
    const parsed = readErrorBody(raw)
    if (parsed.message) message = parsed.message
    if (parsed.code) code = parsed.code
    if (parsed.requestId) requestId = parsed.requestId
  } catch {
    // A non-JSON body from an upload endpoint is usually a proxy refusing the request BEFORE it
    // reached studio — a body-size limit in nginx is the classic one, and it answers 413 in HTML.
    // Saying so is the difference between a user shrinking their image and a user retrying for ever.
    if (res.status === 413) {
      message = 'That image was rejected as too large before it reached the image service.'
    }
  }
  const err = new ApiError(res.status, message, code, requestId, raw)
  const retry = Number(res.headers.get('retry-after') ?? '')
  if (Number.isFinite(retry) && retry > 0) RETRY_AFTER.set(err, Math.ceil(retry))
  return err
}
