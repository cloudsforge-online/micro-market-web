/**
 * The key that stops one click becoming two orders.
 *
 * `market/src/server.ts:1152-1157` refuses a mutating request without an `Idempotency-Key`
 * matching `/^[A-Za-z0-9_:.-]{8,200}$/` (server.ts:237). Both halves are tested: the generator
 * must produce keys the service accepts, and `idempotentHeaders` must refuse one it would not —
 * because a 400 saying "an Idempotency-Key header of 8 to 200 characters is required", for a key
 * this app generated, is a bug in this app failing where it was rejected rather than where it was
 * made.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  IDEMPOTENCY_HEADER,
  SAFE_IDEMPOTENCY_KEY,
  idempotentHeaders,
  newIdempotencyKey,
} from '../src/lib/idempotency.ts'

describe('the pattern, restated from market/src/server.ts:237', () => {
  it('is exactly the service’s own', () => {
    assert.equal(SAFE_IDEMPOTENCY_KEY.source, '^[A-Za-z0-9_:.-]{8,200}$')
  })

  it('accepts the characters the service accepts', () => {
    assert.ok(SAFE_IDEMPOTENCY_KEY.test('abcdefgh'))
    assert.ok(SAFE_IDEMPOTENCY_KEY.test('market-web:buy:0123'))
    assert.ok(SAFE_IDEMPOTENCY_KEY.test('a'.repeat(200)))
  })

  it('refuses what the service refuses', () => {
    assert.equal(SAFE_IDEMPOTENCY_KEY.test('short'), false, 'seven characters or fewer')
    assert.equal(SAFE_IDEMPOTENCY_KEY.test('a'.repeat(201)), false)
    assert.equal(SAFE_IDEMPOTENCY_KEY.test('has space'), false)
    assert.equal(SAFE_IDEMPOTENCY_KEY.test('has/slash'), false)
    assert.equal(SAFE_IDEMPOTENCY_KEY.test(''), false)
  })
})

describe('newIdempotencyKey', () => {
  it('produces a key the service would accept', () => {
    for (const prefix of ['buy', 'bid', 'offer', 'listing', 'activate', 'dispute']) {
      const key = newIdempotencyKey(prefix)
      assert.ok(SAFE_IDEMPOTENCY_KEY.test(key), `${prefix} produced ${key}`)
    }
  })

  it('names the intent, so a key in a log says what it was for', () => {
    assert.match(newIdempotencyKey('buy'), /^market-web:buy:/)
  })

  it('produces a DIFFERENT key each call: two intents are two keys', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey('buy')))
    assert.equal(keys.size, 200)
  })

  it('strips characters the pattern would reject rather than emitting an invalid key', () => {
    const key = newIdempotencyKey('buy now!/../etc')
    assert.ok(SAFE_IDEMPOTENCY_KEY.test(key))
    assert.equal(key.includes('/'), false)
    assert.equal(key.includes(' '), false)
  })

  it('falls back to a usable prefix when every character is stripped', () => {
    const key = newIdempotencyKey('!!!')
    assert.ok(SAFE_IDEMPOTENCY_KEY.test(key))
    assert.match(key, /^market-web:intent:/)
  })
})

describe('idempotentHeaders', () => {
  it('spells the header the way the service reads it', () => {
    assert.equal(IDEMPOTENCY_HEADER, 'idempotency-key')
    assert.deepEqual(idempotentHeaders('abcdefgh'), { 'idempotency-key': 'abcdefgh' })
  })

  it('refuses a key the service would 400, before the round trip', () => {
    assert.throws(() => idempotentHeaders('short'), /idempotency key must match/)
    assert.throws(() => idempotentHeaders(''), /idempotency key must match/)
    assert.throws(() => idempotentHeaders('has a space'), /idempotency key must match/)
  })

  it('names the offending key in the message, so the bug is findable', () => {
    assert.throws(() => idempotentHeaders('short'), /"short"/)
  })

  it('accepts a generated key, which is the whole point', () => {
    assert.doesNotThrow(() => idempotentHeaders(newIdempotencyKey('buy')))
  })
})
