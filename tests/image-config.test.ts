import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyImageConfig } from '../scripts/check-image-config.mjs'
import { installFixture } from './install-fixture'

test('release requires exactly one private EU image binding and active installer warnings', () => {
  const internal = installFixture().env.internal
  assert.doesNotThrow(() => verifyImageConfig(internal))
  const ownBucket = structuredClone(internal); ownBucket.r2_buckets[0].bucket_name = 'another-install-images'
  assert.doesNotThrow(() => verifyImageConfig(ownBucket))
  for (const field of ['binding', 'bucket_name', 'jurisdiction', 'remote']) {
    const changed = structuredClone(internal); delete changed.r2_buckets[0][field]
    assert.throws(() => verifyImageConfig(changed))
  }
  for (const field of ['MAIL_ENABLED', 'OPS_ALERT_RECIPIENT']) {
    const changed = structuredClone(internal); delete changed.vars[field]
    assert.throws(() => verifyImageConfig(changed), /Warnversand/)
  }
  const extra = structuredClone(internal); extra.r2_buckets.push({ binding: 'UNMETERED', bucket_name: 'other' })
  assert.throws(() => verifyImageConfig(extra))
})
