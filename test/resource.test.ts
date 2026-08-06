/**
 * `resourceState` — the four-way decision every screen on this surface routes through.
 *
 * It had no test of its own. That was found by mutation: reordering its first two lines so that
 * `loading` is checked before `error` left the whole suite green, because `useResource` happens
 * never to hold both at once (`setLoading(true)` and `setError(null)` are batched in the same
 * effect). The ordering is still the rule — `src/lib/resource.ts`, "FAILURE OUTRANKS
 * EMPTINESS, in both directions" — and a rule stated in a comment with nothing asserting it is a
 * rule the next refactor reorders for tidiness.
 *
 * These are pure-function tests, so they are here rather than in the DOM harness: `test/dom.ts`
 * exists for scenarios that need a document, and putting one under a function is pure cost
 * (`test/browser-stubs.ts`).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resourceState } from '../src/lib/resource.ts'
import type { ErrorNotice } from '../src/lib/api.ts'

const failure: ErrorNotice = { message: 'the market did not answer', requestId: 'req-1', forbidden: false }
const refusal: ErrorNotice = { message: 'not yours to read', requestId: 'req-2', forbidden: true }

describe('resourceState — failure outranks everything it could be mistaken for', () => {
  it('a failure while still loading is a failure, not a spinner', () => {
    // The ordering the mutation reversed. A retry that has begun does not un-fail the answer
    // already on screen, and a spinner in place of a failure is a page that looks like it is
    // getting somewhere.
    assert.equal(
      resourceState({ loading: true, error: failure, count: null }),
      'failed',
      'a resource holding an error was reported as loading; the error would never be shown',
    )
  })

  it('a failure with a zero count is a failure, not emptiness', () => {
    // The sentence in the file header, and the one the estate has already paid for: "reporting
    // 'nothing here' for a timeout is how an outage reads as a quiet week".
    assert.equal(resourceState({ loading: false, error: failure, count: 0 }), 'failed')
  })

  it('a failure with rows already in hand is still a failure', () => {
    assert.equal(resourceState({ loading: false, error: failure, count: 7 }), 'failed')
  })

  it('a refusal outranks a generic failure, because the remedies differ', () => {
    assert.equal(resourceState({ loading: false, error: refusal, count: 0 }), 'forbidden')
    assert.equal(resourceState({ loading: true, error: refusal, count: null }), 'forbidden')
  })

  it('no answer yet is loading, and a null count is no answer yet', () => {
    assert.equal(resourceState({ loading: true, error: null, count: null }), 'loading')
    // `count: null` means `data === null` — the request resolved to nothing this function can
    // count, which is not the same as counting zero.
    assert.equal(resourceState({ loading: false, error: null, count: null }), 'loading')
  })

  it('and only a clean answer of zero is empty', () => {
    assert.equal(resourceState({ loading: false, error: null, count: 0 }), 'empty')
    assert.equal(resourceState({ loading: false, error: null, count: 1 }), 'ok')
  })
})
