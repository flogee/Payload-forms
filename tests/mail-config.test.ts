import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyMailConfig, verifyMailDestinations } from '../scripts/check-mail-config.mjs'
import { installFixture } from './install-fixture'
import { mailPolicy } from '../src/survey/notifications'

const active = () => installFixture().env.internal

test('runtime mail accepts the own validated install origin and rejects foreign or malformed origins', () => {
  const env = { ...active().vars, EMAIL: { send: async () => ({ messageId: 'simulated' }) } }
  assert.equal(mailPolicy(env).configured, true)
  for (const extra of [
    { MAIL_ORIGIN: 'https://foreign.fixture.dev' },
    { MAIL_ORIGIN: 'https://forms.fixture.dev/path' },
    { MAIL_ORIGIN: 'https://forms.fixture.dev/' },
    { SURVEY_ORIGINS: undefined },
    { SURVEY_ORIGINS: 'https://forms.fixture.dev,https://bad.fixture.dev/path' },
  ]) assert.equal(mailPolicy({ ...env, ...extra }).configured, false)
})

test('release requires own bounded non-test mail and the exact registered recipient binding', () => {
  assert.doesNotThrow(() => verifyMailConfig(active()))
  for (const key of ['MAIL_ENABLED', 'MAIL_LOCAL_TEST', 'MAIL_ORIGIN', 'MAIL_FROM', 'MAIL_MONTHLY_LIMIT', 'OPS_ALERT_RECIPIENT']) {
    const invalid = active(); invalid.vars[key] = key === 'MAIL_LOCAL_TEST' ? '1' : key === 'MAIL_ENABLED' ? '0' : key === 'MAIL_MONTHLY_LIMIT' ? '501' : 'unreviewed'
    assert.throws(() => verifyMailConfig(invalid))
  }
  const unrestricted = active(); delete unrestricted.send_email[0].allowed_destination_addresses
  assert.throws(() => verifyMailConfig(unrestricted), /begrenzt/)
  const extraRecipient = active(); extraRecipient.send_email[0].allowed_destination_addresses.push('unapproved@fixture.dev')
  assert.throws(() => verifyMailConfig(extraRecipient), /begrenzt/)
  const example = active(); example.vars.MAIL_FROM = 'forms@example.org'
  assert.throws(() => verifyMailConfig(example))
})

test('release verifies every destination in the selected account without sending mail', async () => {
  const internal = active()
  let calls = 0
  const env = { CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture-only' }
  const request: typeof fetch = async (url, options) => {
    calls++
    assert.match(String(url), /\/accounts\/fixture\/email\/routing\/addresses\?per_page=100$/)
    assert.equal(options.method, undefined)
    return Response.json({ success: true, result: [{ email: 'operator@fixture.dev', verified: '2026-10-01T00:00:00Z' }] })
  }
  await verifyMailDestinations(internal, env, request)
  assert.equal(calls, 1)
  for (const data of [{ success: true, result: [] as unknown[] }, { success: true, result: [{ email: 'operator@fixture.dev', verified: null }] },
    { success: true, result: [{ email: 'operator@fixture.dev', verified: 'invalid' }] },
    { success: true, result: [] as unknown[], result_info: { total_pages: 2 } }]) {
    await assert.rejects(verifyMailDestinations(internal, env, async () => Response.json(data)))
  }
})
