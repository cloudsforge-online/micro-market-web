/**
 * The upload: the exact request `micro-studio` receives, and the sentence a refusal becomes.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Same discipline as `market.test.ts`, for the same reason: this estate has shipped seven clients
 * written against a surface somebody imagined. So these assert the OUTGOING call — the URL, the
 * query string, the method, the headers and the KIND of body — rather than a parsed response.
 *
 * The body assertion is the one that matters most here and it is easy to get wrong in a way no
 * response-shaped test can see. `POST /v1/uploads` takes **raw image bytes as the whole request
 * body**; studio has no multipart parser and reads no part, so a `FormData` — the reflex for
 * "upload a file" in a browser — would be sent happily, accepted by the stub, and refused by the
 * real service as an unrecognised format. `test/browser-stubs.ts` records the body before it is
 * narrowed to the string case precisely so this file can tell a Blob from a FormData.
 *
 * The second half is `refusalMessage`. Studio names why it refused — `svg_refused`, `too_large`,
 * six more — and the person who chose the file is the only one who can act on any of it. A client
 * that rendered "Bad Request" would be discarding the one piece of information that makes the
 * refusal fixable, so each mapping is pinned here.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'
import { ApiError, __resetAuth, setTokens } from '../src/lib/api.ts'
import {
  ACCEPTED_MEDIA_TYPES,
  ACCEPT_ATTRIBUTE,
  refusalMessage,
  uploadImage,
} from '../src/lib/studio.ts'

const STUDIO = 'https://studio.cloudsforge.test'
const UPLOAD = `${STUDIO}/v1/uploads`

/** studio's asset, as `POST /v1/uploads` returns it. */
const ASSET = {
  id: '11111111-2222-4333-8444-555555555555',
  checksum: `sha256:${'a'.repeat(64)}`,
  format: 'png',
  mediaType: 'image/png',
  actualWidth: 800,
  actualHeight: 600,
  byteSize: 1234,
  visibility: 'public' as const,
}

/** Eight bytes that are not an image. studio decides on content; this suite never pretends to. */
const file = (type = 'image/png'): Blob => new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type })

let fetchStub: FetchStub

function onlyCall() {
  assert.equal(fetchStub.calls.length, 1, `expected one request, saw ${fetchStub.calls.length}`)
  const call = fetchStub.calls[0]
  assert.ok(call)
  return { ...call, url: new URL(call.url) }
}

beforeEach(() => {
  installWindow('http://localhost:5187/')
  installStorage()
  __resetAuth()
  setTokens({ accessToken: 'access-token', refreshToken: 'refresh-token' })
  fetchStub = installFetch(() => json(201, { asset: ASSET, deduplicated: false, metadataStrippedBytes: 0 }))
})

afterEach(() => {
  fetchStub.restore()
  removeStorage()
  removeWindow()
  __resetAuth()
})

describe('POST /v1/uploads — studio/src/server.ts, the uploads route', () => {
  it('sends the bytes to the address market gave it, and nowhere else', async () => {
    await uploadImage({ uploadUrl: UPLOAD, file: file() })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.origin, STUDIO)
    assert.equal(call.url.pathname, '/v1/uploads')
  })

  it('asks for a PUBLIC asset, because a browser sends no bearer token on an <img>', async () => {
    // studio serves public bytes with NO authentication and refuses private bytes to anyone but
    // their owner. A private listing photograph would render for the seller and be broken for every
    // buyer — the one failure mode the person who caused it cannot see.
    await uploadImage({ uploadUrl: UPLOAD, file: file() })
    assert.equal(onlyCall().url.searchParams.get('visibility'), 'public')
  })

  it('sends the Blob itself — not FormData, not JSON, not base64', async () => {
    await uploadImage({ uploadUrl: UPLOAD, file: file() })
    const call = onlyCall()
    assert.ok(call.raw instanceof Blob, `expected a Blob body, got ${Object.prototype.toString.call(call.raw)}`)
    assert.equal(call.raw instanceof FormData, false)
    // And nothing stringified it on the way past: `body` is the string case, which must be empty.
    assert.equal(call.body, undefined)
  })

  it('presents the bearer token, because an upload is attributed to whoever made it', async () => {
    await uploadImage({ uploadUrl: UPLOAD, file: file() })
    assert.equal(onlyCall().headers['authorization'], 'Bearer access-token')
  })

  it('sends the content type it has, and does not pretend it means anything', async () => {
    await uploadImage({ uploadUrl: UPLOAD, file: file('image/webp') })
    // studio reads magic bytes and ignores this header. It is sent because it is true.
    assert.equal(onlyCall().headers['content-type'], 'image/webp')
  })

  it('treats a 200 with deduplicated: true as the success it is', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() =>
      json(200, { asset: ASSET, deduplicated: true, metadataStrippedBytes: 0 }),
    )
    const result = await uploadImage({ uploadUrl: UPLOAD, file: file() })
    // The same asset id comes back, so attaching it produces the same gallery. A client that read
    // 200-instead-of-201 as a failure would re-upload for ever and never attach anything.
    assert.equal(result.deduplicated, true)
    assert.equal(result.asset.id, ASSET.id)
  })

  it('reports how many bytes of location and camera data were removed', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() =>
      json(201, { asset: ASSET, deduplicated: false, metadataStrippedBytes: 4096 }),
    )
    const result = await uploadImage({ uploadUrl: UPLOAD, file: file() })
    // Surfaced so the privacy work is visible rather than merely done: a phone photograph carries
    // GPS coordinates, and a seller is entitled to be told they were taken out.
    assert.equal(result.metadataStrippedBytes, 4096)
  })

  it('refreshes once and retries when the token expired while a file was being chosen', async () => {
    let attempt = 0
    fetchStub.restore()
    fetchStub = installFetch((call) => {
      if (call.url.includes('/auth/refresh')) {
        return json(200, { accessToken: 'fresh', refreshToken: 'fresh-refresh' })
      }
      attempt += 1
      return attempt === 1
        ? json(401, { error: { code: 'unauthenticated', message: 'expired' } })
        : json(201, { asset: ASSET, deduplicated: false, metadataStrippedBytes: 0 })
    })
    const result = await uploadImage({ uploadUrl: UPLOAD, file: file() })
    assert.equal(result.asset.id, ASSET.id)
    // The second upload carries the NEW token, or the retry is the same failure again.
    const uploads = fetchStub.calls.filter((call) => call.url.startsWith(UPLOAD))
    assert.equal(uploads.length, 2)
    assert.equal(uploads[1]?.headers['authorization'], 'Bearer fresh')
  })

  it('does not reach the network at all when there is nothing to reach it with', async () => {
    // The caller is expected to check `uploadUrl !== null` first; this pins what happens if it
    // does not, because a thrown TypeError from `new URL('')` is a white screen rather than a
    // message.
    await assert.rejects(() => uploadImage({ uploadUrl: '', file: file() }))
    assert.equal(fetchStub.calls.length, 0)
  })
})

describe('refusalMessage — the eight reasons studio can give', () => {
  const refused = async (status: number, code: string, reason: string, headers?: HeadersInit) => {
    fetchStub.restore()
    fetchStub = installFetch(
      () =>
        new Response(JSON.stringify({ error: { code, reason } }), {
          status,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-0001', ...headers },
        }),
    )
    try {
      await uploadImage({ uploadUrl: UPLOAD, file: file() })
      assert.fail('the upload should have been refused')
    } catch (err) {
      return err
    }
  }

  it('explains an SVG refusal in terms a person can act on', async () => {
    const err = await refused(400, 'upload_svg_refused', 'svg_refused')
    const message = refusalMessage(err)
    assert.ok(message)
    // The three things that make it actionable: what was refused, WHY, and what to do instead.
    assert.match(message, /SVG/)
    assert.match(message, /scripts/)
    assert.match(message, /PNG, JPEG or WebP/)
  })

  it('tells someone with a large image to make it smaller', async () => {
    const message = refusalMessage(await refused(400, 'upload_too_large', 'too_large'))
    assert.ok(message)
    assert.match(message, /too large/i)
    assert.match(message, /smaller/i)
  })

  it('says the check is on the contents, so renaming the file will not help', async () => {
    const message = refusalMessage(
      await refused(400, 'upload_unrecognised_format', 'unrecognised_format'),
    )
    assert.ok(message)
    assert.match(message, /file name/i)
  })

  it('has a sentence for every reason the service can produce', async () => {
    // Taken from studio's own refusal set. A reason with no mapping falls through to the service's
    // message, which is English but not advice — this is what stops that being the normal case.
    const reasons = [
      'empty',
      'too_large',
      'svg_refused',
      'unrecognised_format',
      'dimensions_unreadable',
      'dimensions_out_of_range',
      'pixel_budget_exceeded',
      'truncated',
    ]
    for (const reason of reasons) {
      const message = refusalMessage(await refused(400, `upload_${reason}`, reason))
      assert.ok(message, `no sentence for ${reason}`)
      // Not the raw code. A user must never be shown `upload_pixel_budget_exceeded`, and the
      // underscore is the tell — no sentence in `REFUSALS` contains one, every reason does.
      assert.equal(message.includes('_'), false, `${reason} leaked its code into the sentence`)
      assert.ok(message.length > 30, `the sentence for ${reason} is too short to be advice`)
    }
  })

  it('turns a quota refusal into a wait with a number in it', async () => {
    const err = await refused(429, 'upload_quota_exceeded', 'quota_exceeded', { 'retry-after': '30' })
    const message = refusalMessage(err)
    assert.ok(message)
    assert.match(message, /30 seconds/)
    assert.equal((err as ApiError).status, 429)
  })

  it('leaves anything that is not an upload refusal alone', async () => {
    // A 500, a network failure, or market's own errors must not be dressed up as advice about a
    // file. `null` means "not mine", and the caller falls back to `noticeFor`.
    assert.equal(refusalMessage(new Error('boom')), null)
    assert.equal(refusalMessage(new ApiError(500, 'internal', 'internal')), null)
    assert.equal(refusalMessage(new ApiError(409, 'conflict', 'state_conflict')), null)
  })
})

describe('the accept attribute', () => {
  it('offers exactly the three formats studio stores, and says nothing about safety', () => {
    assert.deepEqual([...ACCEPTED_MEDIA_TYPES], ['image/png', 'image/jpeg', 'image/webp'])
    assert.equal(ACCEPT_ATTRIBUTE, 'image/png,image/jpeg,image/webp')
    // SVG is absent from the picker AND refused by the service. Only the second one is a control:
    // every file dialog has an "all files" option, so this list is a convenience and the estate's
    // safety comes from studio reading magic bytes.
    assert.equal(ACCEPT_ATTRIBUTE.includes('svg'), false)
  })
})
