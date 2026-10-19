import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import { migrations } from '../src/migrations'
import { accessStrategy } from '../src/auth/access'
import { QA_MACHINE_PATH, qaMachineSettings, type QAMachineEnvironment } from '../src/auth/qa-machine'
import { handleQAMachineRequest, type QAMachineContext } from '../src/survey/qa-machine'
import { ensureEvaluationRun, evaluationRunGrant, authorizedEvaluationRun } from '../src/survey/evaluation-runs'
import { canonicalJSON } from '../src/survey/privacy-crypto'
import { createHmac } from 'node:crypto'
import type { Definition } from '../src/survey/types'
import type { ResponseDatabase, SQLValue } from '../src/survey/response-store'

const issuer = 'https://fixture-team.cloudflareaccess.com', origin = 'https://forms.example.invalid'
const clientA = '20000000-0000-4000-8000-000000000001', clientB = '20000000-0000-4000-8000-000000000002'
const idA = `${'a'.repeat(32)}.access`, idB = `${'b'.repeat(32)}.access`
const keyA = '00000000-0000-4000-8000-000000000001', keyB = '00000000-0000-4000-8000-000000000002'
const contextA = '10000000-0000-4000-8000-000000000001', contextB = '10000000-0000-4000-8000-000000000002'
const secret = 'fictional-qa-machine-only-application-secret-32-characters'
const definition: Definition = { version: 'fixture-machine-v1', introduction: [], sections: [] }
const env: QAMachineEnvironment = { ACCESS_LOGIN_ENABLED: '1', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'c'.repeat(64),
  QA_MACHINE_ENABLED: '1', QA_MACHINE_AUD: 'd'.repeat(64), SURVEY_ORIGINS: origin,
  D1: { prepare() { throw new Error('Unexpected test DB read') }, async batch() { throw new Error('Unexpected test DB work') } },
  PUBLIC_IP_RATE: { limit: async () => ({ success: true }) } as any,
  PUBLIC_TOTAL_RATE: { limit: async () => ({ success: true }) } as any,
  QA_MACHINE_CLIENTS: JSON.stringify([{ key: clientA, accessClientID: idA, surveyVersions: [definition.version] },
    { key: clientB, accessClientID: idB, surveyVersions: [definition.version] }]) }
const pair = await generateKeyPair('RS256'), rogue = await generateKeyPair('RS256')
const key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture' }] })
async function token(changes: Record<string, unknown> = {}, foreign = false) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ type: 'app', sub: '', common_name: idA, iss: issuer, aud: env.QA_MACHINE_AUD, iat: now, exp: now + 60, ...changes })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(foreign ? rogue.privateKey : pair.privateKey)
}
function request(body: unknown, assertion?: string, url = `${origin}${QA_MACHINE_PATH}`, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body) })
}
const input = (key = keyA, contextRef = contextA) => ({ action: 'ensure', key, contextRef, surveyID: 1, version: definition.version,
  expiresAt: new Date(Date.now() + 86400000).toISOString() })
async function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  for (const migration of migrations) await migration.up(args)
  sqlite.prepare("INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Fictional machine QA','fixture',?,'pretest')").run(definition.version)
  const db: ResponseDatabase = {
    prepare(sql) { return { sql, values: [], bind(...values: SQLValue[]) { return { sql, values, bind: this.bind } } } as any },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map((statement: any) => ({ results: sqlite.prepare(statement.sql).all(...statement.values),
          meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get()?.n ?? 0) } }))
        sqlite.exec('COMMIT'); return result
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  const context: QAMachineContext = { db, secret, loadInstrument: async id => id === 1 ? { id: 1, slug: 'fixture', phase: 'pretest', definition } : null }
  return { sqlite, db, context, environment: { ...env, D1: db } }
}

test('machine boundary defaults off; malformed identity/config/browser requests never initialize data', async () => {
  let initialized = 0
  const context = async (): Promise<QAMachineContext> => { initialized++; throw new Error('PRIVATE_DATA_CONTEXT') }
  const valid = await token()
  assert.equal((await handleQAMachineRequest(request(input()), {}, context, key)).status, 404)
  assert.equal(qaMachineSettings({}), null)
  for (const change of [{ ACCESS_LOGIN_ENABLED: '0' }, { QA_MACHINE_AUD: env.ACCESS_AUD }, { ACCESS_TEAM_DOMAIN: 'https://untrusted.example.invalid' },
    { QA_MACHINE_CLIENTS: '[]' }, { QA_MACHINE_CLIENTS: 'PRIVATE_INVALID_JSON' }, { SURVEY_ORIGINS: `${origin}/path` }]) {
    const response = await handleQAMachineRequest(request(input(), valid), { ...env, ...change }, context, key)
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('PRIVATE_'))
  }
  for (const changes of [{ common_name: idB.replace('b', 'f') }, { sub: 'human', email: 'human@example.invalid' }, { email: 'human@example.invalid' },
    { type: 'other' }, { aud: env.ACCESS_AUD }, { aud: [env.ACCESS_AUD, env.QA_MACHINE_AUD] }, { iss: 'https://other.cloudflareaccess.com' }, { exp: 1 }, { iat: Math.floor(Date.now() / 1000) + 60 }]) {
    assert.equal((await handleQAMachineRequest(request(input(), await token(changes)), env, context, key)).status, 401)
  }
  assert.equal((await handleQAMachineRequest(request(input(), await token({}, true)), env, context, key)).status, 401)
  assert.equal((await handleQAMachineRequest(request(input(), undefined, undefined, { 'cf-access-client-id': idA, 'cf-access-client-secret': 'fictional-only' }), env, context, key)).status, 401)
  for (const header of [{ origin }, { cookie: 'human=fictional' }, { authorization: 'Bearer fictional' }, { 'sec-fetch-site': 'same-origin' }, { host: 'untrusted.example.invalid' }] as Record<string, string>[]) {
    assert.equal((await handleQAMachineRequest(request(input(), valid, undefined, header), env, context, key)).status, 403)
  }
  for (const url of [`${origin}${QA_MACHINE_PATH}?key=${keyA}`, `${origin}${QA_MACHINE_PATH}/`, `https://untrusted.example.invalid${QA_MACHINE_PATH}`]) {
    assert.equal((await handleQAMachineRequest(request(input(), valid, url), env, context, key)).status, 403)
  }
  assert.equal((await handleQAMachineRequest(new Request(`${origin}${QA_MACHINE_PATH}`, { headers: { 'cf-access-jwt-assertion': valid } }), env, context, key)).status, 403)
  assert.equal(initialized, 0)
})

test('strict bounded commands and version scope reject before Payload/data initialization', async () => {
  let initialized = 0
  const context = async (): Promise<QAMachineContext> => { initialized++; throw new Error('PRIVATE_DATA_CONTEXT') }
  const valid = await token()
  for (const body of ['{', { action: 'close', key: keyA }, { ...input(), userID: 1 }, { action: 'report', key: keyA, contextRef: contextA }]) {
    assert.equal((await handleQAMachineRequest(request(body, valid), env, context, key)).status, 400)
  }
  assert.equal((await handleQAMachineRequest(request({ ...input(), version: 'not-allowlisted' }, valid), env, context, key)).status, 403)
  assert.equal((await handleQAMachineRequest(request('x'.repeat(4097), valid), env, context, key)).status, 413)
  assert.equal((await handleQAMachineRequest(request(input(), valid, undefined, { 'content-type': 'text/plain' }), env, context, key)).status, 415)
  assert.equal(initialized, 0)
})

test('two machine Runs share an instrument without sharing context; owners cannot claim each other or human Runs', async () => {
  const { sqlite, db, context, environment } = await fixture()
  try {
    const valid = await token(), other = await token({ common_name: idB }), a = input(), b = { ...input(keyB, contextB), expiresAt: a.expiresAt }
    const call = (body: unknown, jwt = valid) => handleQAMachineRequest(request(body, jwt), environment, async () => context, key)
    assert.equal((await call(a)).status, 201)
    assert.equal((await call(a)).status, 200)
    assert.equal((await call(b)).status, 201)
    for (const runKey of [keyA, keyB]) {
      assert.equal((await call({ action: 'participation', key: runKey })).status, 200)
      assert.equal((await call({ action: 'report', key: runKey }, other)).status, 404)
      assert.equal((await call({ action: 'participation', key: runKey }, other)).status, 404)
    }
    assert.equal((await call(a, other)).status, 409)
    const legacyKey = '00000000-0000-4000-8000-000000000003'
    const { action: _, ...legacyInput } = { ...a, key: legacyKey }
    const legacy = (await ensureEvaluationRun(db, legacyInput, definition)).run
    assert.equal(legacy.integration_client, null)
    assert.equal((await call({ action: 'report', key: legacyKey })).status, 404)
    assert.equal((await call({ ...a, key: legacyKey })).status, 409)
    const reports = await Promise.all([call({ action: 'report', key: keyA }), call({ action: 'report', key: keyB })])
    type ReportScope = { contextRef: string; report: { responses: number | null } }
    const ra = await reports[0].json() as ReportScope, rb = await reports[1].json() as ReportScope
    assert.equal(ra.contextRef, contextA); assert.equal(rb.contextRef, contextB)
    assert.equal(ra.report.responses, null); assert.equal(rb.report.responses, null)
    assert.ok(!JSON.stringify([ra, rb]).includes('token'))
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM surveys').get()?.n, 1)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_runs').get()?.n, 3)
    const deniedVersionEnv = { ...environment, QA_MACHINE_CLIENTS: JSON.stringify([{ key: clientA, accessClientID: idA, surveyVersions: ['another-version'] }]) }
    assert.equal((await handleQAMachineRequest(request({ action: 'report', key: keyA }, valid), deniedVersionEnv, async () => context, key)).status, 404)
  } finally { sqlite.close() }
})

test('outage is sanitized and never replaced with a fabricated empty report or new Run', async () => {
  const { sqlite, environment } = await fixture()
  try {
    let initialized = false
    const response = await handleQAMachineRequest(request({ action: 'report', key: keyA }, await token()), environment,
      async () => { initialized = true; throw new Error('PRIVATE_DATA_CONTEXT credential') }, key)
    assert.equal(initialized, true); assert.equal(response.status, 503)
    assert.ok(!(await response.text()).includes('PRIVATE_DATA_CONTEXT'))
    assert.match(response.headers.get('cache-control')!, /no-store/)
    assert.equal(sqlite.prepare("SELECT requests FROM qa_machine_usage WHERE scope='installation'").get()?.requests, 1)
    assert.equal(sqlite.prepare('SELECT reports FROM qa_machine_usage WHERE scope=?').get(clientA)?.reports, 1)
  } finally { sqlite.close() }
})

test('missing guards and exhausted/rate-blocked requests never initialize Payload or read a Run', async () => {
  const { sqlite, environment } = await fixture()
  let initialized = 0
  const context = async (): Promise<QAMachineContext> => { initialized++; throw new Error('PRIVATE_DATA_CONTEXT') }
  const valid = await token()
  const call = (settings = environment) => handleQAMachineRequest(request({ action: 'report', key: keyA }, valid), settings, context, key)
  try {
    for (const missing of ['D1', 'PUBLIC_IP_RATE', 'PUBLIC_TOTAL_RATE'] as const) assert.equal((await call({ ...environment, [missing]: undefined } as any)).status, 503)
    const blocked = { ...environment, PUBLIC_IP_RATE: { limit: async () => ({ success: false }) } as any }
    const rate = await call(blocked)
    assert.equal(rate.status, 429); assert.equal(rate.headers.get('retry-after'), '60')
    await call(blocked)
    assert.equal(sqlite.prepare("SELECT count(*) n FROM budget_alerts WHERE metric='qaRate'").get()?.n, 1)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM qa_machine_usage').get()?.n, 0)
    const month = new Date().toISOString().slice(0, 7)
    sqlite.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,500,50)').run(clientA, month)
    assert.equal((await call()).status, 429)
    assert.equal(initialized, 0)
    assert.equal(sqlite.prepare('SELECT requests FROM qa_machine_usage WHERE scope=?').get(clientA)?.requests, 500)
    sqlite.exec('DROP TABLE qa_machine_usage')
    assert.equal((await call()).status, 503); assert.equal(initialized, 0)
  } finally { sqlite.close() }
})

test('service JWT cannot impersonate a human on the unchanged Forms Access strategy', async () => {
  let lookedUp = false
  const result = await accessStrategy(env, key).authenticate({ headers: new Headers({ 'cf-access-jwt-assertion': await token() }),
    payload: { find: async () => { lookedUp = true; return { docs: [] as never[] } } }, req: {} } as any)
  assert.equal(result.user, null); assert.equal(lookedUp, false)
})

test('owner-only additive upgrade retains legacy data, budgets and old grant signatures', async () => {
  const sqlite = new DatabaseSync(':memory:'), dialect = new SQLiteSyncDialect()
  sqlite.exec('PRAGMA foreign_keys=ON')
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    const index = migrations.findIndex(m => m.name.endsWith('qa_machine_owner')); assert.ok(index > 0)
    for (const migration of migrations.slice(0, index)) await migration.up(args)
    const binding = input(); const instrument = canonicalJSON(definition)
    sqlite.prepare("INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Fictional','fixture',?,'pretest')").run(definition.version)
    sqlite.prepare("INSERT INTO evaluation_runs(id,key,context_ref,survey_id,version,instrument,status,expires_at) VALUES(1,?,?,1,?,?,'open',?)")
      .run(keyA, contextA, definition.version, instrument, binding.expiresAt)
    sqlite.exec("INSERT INTO users(id,email,hash,salt,role,enabled) VALUES(1,'migration@example.invalid','fixture-hash','fixture-salt','admin',1); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument) VALUES(1,'legacy-key',1,'fixture-machine-v1',1,'{}','{}'); INSERT INTO response_contacts(id,response_id,name,email,test_only,privacy_receipt) VALUES(1,1,'Fictional','fixture@example.invalid',1,'{}'); INSERT INTO public_request_usage(id,month,reads,submissions) VALUES(1,'2026-10',123,45)")
    const tables = ['users', 'surveys', 'responses', 'response_contacts', 'public_request_usage', 'image_storage_usage']
    const before = Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).all()]))
    const expires = Math.floor(Date.now() / 1000) + 600
    const oldMac = createHmac('sha256', secret).update(canonicalJSON({ format: 'evaluation-run-v1', key: keyA, context: contextA,
      survey: 1, version: definition.version, scope: 'report', expires, closes: binding.expiresAt })).digest('hex')
    await migrations[index].up(args)
    for (const table of tables) assert.deepEqual(sqlite.prepare(`SELECT * FROM ${table}`).all(), before[table])
    assert.equal(sqlite.prepare('SELECT integration_client FROM evaluation_runs').get()?.integration_client, null)
    const db: ResponseDatabase = { prepare(sql) { return { sql, values: [], bind(...values: SQLValue[]) { return { sql, values, bind: this.bind } } } as any },
      async batch(statements) { return statements.map((s: any) => ({ results: sqlite.prepare(s.sql).all(...s.values), meta: { changes: 0 } })) } }
    const run = await authorizedEvaluationRun(db, { key: keyA, token: `${expires}.${oldMac}` }, 'report', secret)
    assert.equal(run.id, 1)
    assert.equal(evaluationRunGrant(run, 'participate', secret), evaluationRunGrant({ ...run, integration_client: undefined }, 'participate', secret))
    await assert.rejects(migrations[index].down(args), /Rückbau.*gesperrt/)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { sqlite.close() }
})
