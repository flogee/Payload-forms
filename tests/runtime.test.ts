import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installFixture } from './install-fixture'
import { platformOptions, schemaPushAllowed } from '../src/survey/runtime'

test('runtime and ordinary CLI invocations never connect to remote D1 by default', () => {
  for (const isCLI of [false, true]) {
    assert.equal(platformOptions({ NODE_ENV: 'production', CLOUDFLARE_ENV: 'internal' }, isCLI).remoteBindings, false)
  }
  assert.deepEqual(platformOptions({ FORMS_LOCAL_D1_PATH: '/tmp/isolated-d1' }, false).persist, { path: '/tmp/isolated-d1' })
})

test('remote D1 requires the explicit production CLI and internal environment together', () => {
  const root = mkdtempSync(join(tmpdir(), 'payload-forms-runtime-'))
  const configPath = join(root, 'wrangler.install.jsonc')
  writeFileSync(configPath, JSON.stringify(installFixture()))
  const env = { NODE_ENV: 'production', FORMS_D1_REMOTE: '1', CLOUDFLARE_ENV: 'internal', PAYLOAD_FORMS_CONFIG: configPath, PAYLOAD_SECRET: 'fixture-local-only-stable-secret-'.repeat(2) }
  try {
  assert.equal(platformOptions(env, true).remoteBindings, true)
  assert.throws(() => platformOptions(env, false))
  assert.throws(() => platformOptions({ ...env, NODE_ENV: 'development' }, true))
  assert.throws(() => platformOptions({ ...env, CLOUDFLARE_ENV: 'other' }, true))
  assert.throws(() => platformOptions({ ...env, FORMS_LOCAL_D1_PATH: '/tmp/local' }, true))
  assert.throws(() => platformOptions({ ...env, PAYLOAD_FORMS_CONFIG: undefined }, true))
  assert.throws(() => platformOptions({ ...env, PAYLOAD_SECRET: undefined }, true))
  assert.equal(platformOptions(env, true).configPath, configPath)
  assert.deepEqual(platformOptions(env, true).envFiles, [join(root, 'scripts/config/empty.env')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('schema push stays disabled in production and migration CLI processes', () => {
  assert.equal(schemaPushAllowed({ NODE_ENV: 'production', DISABLE_SCHEMA_PUSH: '0' }, false), false)
  assert.equal(schemaPushAllowed({ NODE_ENV: 'development' }, true), false)
  assert.equal(schemaPushAllowed({ NODE_ENV: 'development', DISABLE_SCHEMA_PUSH: '1' }, false), false)
  assert.equal(schemaPushAllowed({ NODE_ENV: 'development', DISABLE_SCHEMA_PUSH: '0' }, false), true)
})
