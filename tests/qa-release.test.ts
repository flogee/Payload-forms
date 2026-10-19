import test from 'node:test'
import assert from 'node:assert/strict'
import { qaReleaseFixture } from './qa-release-fixture'
import { validateInstallConfig, productionEnvironment } from '../scripts/install-config.mjs'
import { qaMachineInstallSettings, parseQAJSON } from '../scripts/qa-machine-config.mjs'
import { verifyAccess } from '../scripts/check-access.mjs'
import { qaMachineSettings } from '../src/auth/qa-machine'

const secret = 'fictional-stable-qa-release-secret-at-least-32'
function fixture() {
  const f = qaReleaseFixture()
  const install = { ...validateInstallConfig(f.config), configPath: '/tmp/qa-fixture/wrangler.install.jsonc' }
  const env = productionEnvironment(install, { PAYLOAD_SECRET: secret, CLOUDFLARE_API_TOKEN: 'fictional-provider-token' })
  const calls: { url: string; options: RequestInit }[] = []
  let detail: any = f.machine
  let applications: any[] = [f.human, f.machine, f.publicApp]
  const envelope = (result: any) => ({ success: true, result, ...(Array.isArray(result) ? {
    result_info: { page: 1, count: result.length, total_count: result.length, total_pages: 1 },
  } : {}) })
  const request: typeof fetch = async (input, options = {}) => {
    const url = String(input); calls.push({ url, options })
    assert.equal(options.redirect, 'manual'); assert.equal(options.method ?? 'GET', 'GET')
    let result: any
    if (url.endsWith('/apps?per_page=100')) result = applications
    else if (url.endsWith('/service_tokens?per_page=100')) result = f.tokens
    else if (url.endsWith(`/apps/${f.vars.QA_MACHINE_APP_ID}`)) result = detail
    else if (url.endsWith(`/apps/${f.vars.ACCESS_APP_ID}`)) result = f.human
    else if (url.endsWith(`/apps/${f.vars.QA_MACHINE_APP_ID}/policies?per_page=100`)) result = [f.machinePolicy]
    else if (url.endsWith(`/apps/${f.publicApp.id}/policies?per_page=100`)) result = [f.publicPolicy]
    else if (url.endsWith(`/apps/${f.vars.ACCESS_APP_ID}/policies?per_page=100`)) result = [f.humanPolicy]
    else if (url.endsWith(`/access/policies/${f.vars.QA_MACHINE_POLICY_ID}`)) result = { ...f.machinePolicy, app_count: 1 }
    else if (url.endsWith(`/access/policies/${f.vars.ACCESS_POLICY_ID}`)) result = { ...f.humanPolicy, app_count: 1 }
    else assert.fail('Unexpected provider URL')
    return Response.json(envelope(result))
  }
  const run = (selected = request) => verifyAccess(env, { audience: f.vars.ACCESS_AUD, policyID: f.vars.ACCESS_POLICY_ID, hostnames: f.hosts, request: selected })
  return { ...f, env, calls, run, request, envelope, setDetail: (value: any) => { detail = value }, setApplications: (value: any[]) => { applications = value } }
}

test('explicit complete QA configuration reaches the build/runtime unchanged, never from ambient values', () => {
  const f = qaReleaseFixture(), before = structuredClone(f.config)
  const install = { ...validateInstallConfig(f.config), configPath: '/tmp/fictional/wrangler.install.jsonc' }
  const env = productionEnvironment(install, { PAYLOAD_SECRET: secret, QA_MACHINE_ENABLED: '0', QA_MACHINE_AUD: 'ambient', QA_MACHINE_UNKNOWN: 'ambient' })
  assert.equal(install.qaMachine?.enabled, true)
  assert.equal(env.QA_MACHINE_ENABLED, '1'); assert.equal(env.QA_MACHINE_UNKNOWN, undefined)
  assert.deepEqual(qaMachineSettings(env)?.clients, f.clients)
  assert.deepEqual(f.config, before)
  f.vars.QA_MACHINE_ENABLED = '0'
  const off = productionEnvironment({ ...validateInstallConfig(f.config), configPath: install.configPath }, { PAYLOAD_SECRET: secret })
  assert.equal(off.QA_MACHINE_ENABLED, '0'); assert.equal(qaMachineSettings(off), null)
  assert.equal(off.QA_MACHINE_CLIENTS, env.QA_MACHINE_CLIENTS)
})

test('partial, aliased, duplicate, malformed or secret-bearing QA selections fail offline without leaking values', () => {
  const mutations: ((v: any) => void)[] = [
    v => { delete v.QA_MACHINE_ENABLED }, v => { delete v.QA_MACHINE_POLICY_ID }, v => { v.QA_MACHINE_ENABLED = 'true' },
    v => { v.QA_MACHINE_APP_ID = v.ACCESS_APP_ID }, v => { v.QA_MACHINE_POLICY_ID = v.ACCESS_POLICY_ID },
    v => { v.QA_MACHINE_AUD = v.ACCESS_AUD }, v => { v.QA_MACHINE_AUD = '0'.repeat(64) },
    v => { v.QA_MACHINE_SECRET = 'PRIVATE_SECRET' }, v => { v.QA_MACHINE_CLIENTS = 'PRIVATE_SECRET' },
    v => { v.QA_MACHINE_CLIENTS = 'x'.repeat(16385) }, v => { v.QA_MACHINE_SERVICE_TOKEN_IDS = '{}' },
    v => { const c = JSON.parse(v.QA_MACHINE_CLIENTS); c[0].serviceTokenID = 'PRIVATE_SECRET'; v.QA_MACHINE_CLIENTS = JSON.stringify(c) },
    v => { const c = JSON.parse(v.QA_MACHINE_CLIENTS); c[1].key = c[0].key; v.QA_MACHINE_CLIENTS = JSON.stringify(c) },
    v => { const c = JSON.parse(v.QA_MACHINE_CLIENTS); c[1].accessClientID = c[0].accessClientID; v.QA_MACHINE_CLIENTS = JSON.stringify(c) },
    v => { const c = JSON.parse(v.QA_MACHINE_CLIENTS); c[0].surveyVersions = ['v1', 'v1']; v.QA_MACHINE_CLIENTS = JSON.stringify(c) },
    v => { const c = JSON.parse(v.QA_MACHINE_CLIENTS); c[0].surveyVersions = ['']; v.QA_MACHINE_CLIENTS = JSON.stringify(c) },
    v => { const ids = JSON.parse(v.QA_MACHINE_SERVICE_TOKEN_IDS), keys = Object.keys(ids); ids[keys[1]] = ids[keys[0]]; v.QA_MACHINE_SERVICE_TOKEN_IDS = JSON.stringify(ids) },
    v => { v.QA_MACHINE_SERVICE_TOKEN_IDS = v.QA_MACHINE_SERVICE_TOKEN_IDS.replace('{', '{"ignored":"PRIVATE_SECRET",') },
  ]
  for (const mutate of mutations) {
    const f = qaReleaseFixture(); mutate(f.vars)
    assert.throws(() => validateInstallConfig(f.config), error => !String(error).includes('PRIVATE_SECRET'))
  }
  for (const input of ['{"key":1,"key":2}', '{"key":1,"\\u006bey":2}', '['.repeat(20) + '0' + ']'.repeat(20)]) assert.throws(() => parseQAJSON(input))
  assert.equal(qaMachineInstallSettings({}), null)
})

test('read-only live preflight validates QA plus unchanged human and public boundaries', async () => {
  const f = fixture()
  assert.deepEqual(await f.run(), { publicParticipation: true, qaMachine: true })
  assert.ok(f.calls.some(call => call.url.endsWith('/service_tokens?per_page=100')))
  assert.ok(f.calls.some(call => call.url.includes(`/apps/${f.publicApp.id}/policies?`)))
  assert.ok(f.calls.some(call => call.url.endsWith(`/access/policies/${f.vars.ACCESS_POLICY_ID}`)))
  assert.ok(f.calls.every(call => (call.options.headers as any).Authorization === 'Bearer fictional-provider-token'))
})

test('QA overlap is exempted only after exact inventory/detail/policy/client checks', async () => {
  for (const mutate of [
    (f: any) => { f.machine.destinations[0].uri = f.hosts[0] + '/api/*' },
    (f: any) => { f.machine.aud = f.vars.ACCESS_AUD },
    (f: any) => { f.machinePolicy.decision = 'bypass' },
    (f: any) => { f.machinePolicy.include = [{ everyone: {} }] },
    (f: any) => { f.machinePolicy.include[0].service_token.token_id = f.clients[0].accessClientID },
    (f: any) => { f.setDetail({ ...f.machine, destinations: [{ type: 'public', uri: f.hosts[0] }] }) },
    (f: any) => { f.setApplications([f.human, f.publicApp]) },
    (f: any) => { f.setApplications([f.human, f.machine, f.publicApp, { id: '99999999-1111-4111-8111-111111111111', domain: '*.fixture.dev/admin' }]) },
    (f: any) => { f.humanPolicy.decision = 'non_identity' },
    (f: any) => { f.publicPolicy.decision = 'allow' },
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.run()) }
})

test('current and historical expiry metadata must bind active unexpired tokens; leaked/disabled/missing tokens fail', async () => {
  const historical = fixture()
  for (const token of historical.tokens) { token.expires_on = token.expires_at; delete token.expires_at }
  assert.equal((await historical.run()).qaMachine, true)
  for (const mutate of [
    (t: any) => { t.enabled = false }, (t: any) => { t.expires_at = '2020-01-01T00:00:00Z' },
    (t: any) => { t.expires_on = '2030-01-01T00:00:00Z' },
    (t: any) => { t.leak_reported_at = '2026-10-19T00:00:00Z' },
    (t: any) => { t.client_id = 'a'.repeat(32) + '.access' },
  ]) { const f = fixture(); mutate(f.tokens[0]); await assert.rejects(f.run()) }
  const missing = fixture(); missing.tokens.pop(); await assert.rejects(missing.run())
})

test('explicit off retains stable mappings and exact route protection without needing an active/deleted credential', async () => {
  const f = fixture(); f.env.QA_MACHINE_ENABLED = '0'; f.tokens.length = 0
  assert.deepEqual(await f.run(), { publicParticipation: true, qaMachine: false })
  assert.equal(f.calls.some(call => call.url.includes('/service_tokens')), false)
  assert.equal(qaMachineSettings(f.env), null)
  f.machine.destinations[0].uri = f.hosts[0] + '/admin'
  await assert.rejects(f.run())
})

test('missing, inconsistent or multi-page inventories stop the QA release; redirects/body parse errors do not expose provider content', async () => {
  for (const patch of [undefined, { page: 2, total_pages: 2, total_count: 3 }, { page: 1, total_pages: 1, total_count: 99 },
    { page: 1, total_pages: 1, total_count: 3, count: 99 }]) {
    const f = fixture()
    await assert.rejects(f.run(async (url, options) => {
      const response = await f.request(url, options)
      if (!String(url).endsWith('/apps?per_page=100')) return response
      const data: any = await response.json(); data.result_info = patch
      return Response.json(data)
    }))
  }
  for (const response of [new Response('PRIVATE_PROVIDER_DETAIL', { status: 302, headers: { Location: 'https://other.example.invalid' } }),
    new Response('PRIVATE_PROVIDER_DETAIL'), new Response('x'.repeat(1024 * 1024 + 1))]) {
    const f = fixture()
    await assert.rejects(f.run(async () => response), error => !String(error).includes('PRIVATE_PROVIDER_DETAIL'))
  }
})
