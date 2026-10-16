import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateInstallConfig, productionEnvironment, readInstallConfig } from '../scripts/install-config.mjs'
import { setupInstall } from '../scripts/setup-install.mjs'
import { installFixture } from './install-fixture'
import { parse } from 'dotenv'
import { mailPolicy } from '../src/survey/notifications'

const secret = 'fixture-stable-local-only-secret-'.repeat(2)

test('production accepts installer resources and rejects examples, mismatched origins and weakened protections', async () => {
  const config = installFixture()
  assert.deepEqual(validateInstallConfig(config).hostnames, ['forms.fixture.dev'])
  for (const mutate of [
    (c: any) => { c.env.internal.account_id = '0'.repeat(32) },
    (c: any) => { c.env.internal.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000' },
    (c: any) => { c.env.internal.routes[0].pattern = 'forms.example.org' },
    (c: any) => { c.env.internal.routes.push(c.env.internal.routes[0]) },
    (c: any) => { c.env.internal.routes[0].pattern = '*.fixture.dev' },
    (c: any) => { c.env.internal.vars.SURVEY_ORIGINS += ',https://attacker.test' },
    (c: any) => { c.env.internal.vars.ACCESS_ACCOUNT_ID = 'b'.repeat(32) },
    (c: any) => { c.env.internal.vars.PAYLOAD_SECRET = secret },
    (c: any) => { c.env.internal.vars.MAIL_ENABLED = '0' },
    (c: any) => { c.env.internal.ratelimits[1].namespace_id = c.env.internal.ratelimits[0].namespace_id },
    (c: any) => { c.env.internal.limits.cpu_ms = 1001 },
  ]) { const changed = structuredClone(config); mutate(changed); assert.throws(() => validateInstallConfig(changed)) }
  await assert.rejects(readInstallConfig({}), /PAYLOAD_FORMS_CONFIG/)
  await assert.rejects(readInstallConfig({ PAYLOAD_FORMS_CONFIG: 'wrangler.jsonc' }), /example|own/)
})

test('all production child processes receive the same config, stable secret and isolated binding mode', () => {
  const install = { ...validateInstallConfig(installFixture()), configPath: '/tmp/fixture/wrangler.install.jsonc' }
  assert.throws(() => productionEnvironment(install, {}), /stable/)
  assert.throws(() => productionEnvironment(install, { PAYLOAD_SECRET: secret, CLOUDFLARE_ACCOUNT_ID: 'wrong' }), /account/)
  const env = productionEnvironment(install, { PAYLOAD_SECRET: secret, MAIL_FROM: 'stale', SURVEY_ORIGIN: 'https://stale.test', FORMS_LOCAL_D1_PATH: '/tmp/stale' })
  assert.equal(env.PAYLOAD_FORMS_CONFIG, install.configPath)
  assert.equal(env.PAYLOAD_SECRET, secret)
  assert.equal(env.CLOUDFLARE_ENV, 'internal')
  assert.equal(env.FORMS_D1_REMOTE, '0')
  assert.equal(env.FORMS_LOCAL_D1_PATH, undefined)
  assert.equal(env.SURVEY_ORIGIN, undefined)
  assert.equal(env.MAIL_FROM, 'forms@fixture.dev')
  assert.equal(productionEnvironment(install, { PAYLOAD_SECRET: secret }, { remote: true }).FORMS_D1_REMOTE, '1')
})

test('setup is offline, creates private local-only secrets and refuses to overwrite either install file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'payload-forms-setup-'))
  try {
    await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify(installFixture()))
    const localMessage = await setupInstall('local', root)
    const first = await readFile(join(root, '.env.local'), 'utf8')
    assert.match(first, /^PAYLOAD_SECRET=[a-f0-9]{96}$/m)
    assert.match(first, /^MAIL_LOCAL_TEST=1$/m)
    assert.equal(mailPolicy({ ...parse(first), EMAIL: { send: async () => ({ messageId: 'simulated' }) } }).configured, true)
    assert.equal(localMessage.includes(first.match(/^PAYLOAD_SECRET=(.+)$/m)![1]), false)
    assert.equal((await stat(join(root, '.env.local'))).mode & 0o777, 0o600)
    await assert.rejects(setupInstall('local', root), { code: 'EEXIST' })
    assert.equal(await readFile(join(root, '.env.local'), 'utf8'), first)
    await setupInstall('cloudflare', root)
    const selected = await readInstallConfig({ PAYLOAD_FORMS_CONFIG: 'wrangler.install.jsonc' }, root)
    assert.equal(selected.configPath, join(root, 'wrangler.install.jsonc'))
    await assert.rejects(setupInstall('cloudflare', root), { code: 'EEXIST' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
