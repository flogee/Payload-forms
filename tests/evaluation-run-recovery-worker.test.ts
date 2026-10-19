import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import { migrations } from '../src/migrations'
import { ensureEvaluationRun, closeEvaluationRun, evaluationRunGrant, evaluationRunReport } from '../src/survey/evaluation-runs'
import { evaluationRunExport } from '../src/survey/evaluation-run-export'
import { saveSubmission, eraseResponse, type ResponseDatabase, type Submission } from '../src/survey/response-store'
import { reserveQAMachineRequest } from '../src/survey/qa-machine-budget'
import { handleQAMachineRequest } from '../src/survey/qa-machine'
import { digest, erasureKey } from '../src/survey/privacy-crypto'
import type { Definition } from '../src/survey/types'

const execute = promisify(execFile)
const secret = 'fictional-disposable-recovery-key-32-characters-only'
const client = '20000000-0000-4000-8000-000000000001'
const otherClient = '20000000-0000-4000-8000-000000000002'
const keyA = '00000000-0000-4000-8000-000000000001', keyB = '00000000-0000-4000-8000-000000000002'
const definition: Definition = { version: 'recovery-fixture-v1', introduction: [], sections: [{ id: 'feedback', title: 'Fictional feedback', questions: [
  { id: 'RATING', block: 'Feedback', kind: 'stars', label: 'Fictional rating', optional: true },
  { id: 'NOTE', block: 'Feedback', kind: 'textarea', label: 'Fictional note', optional: true },
] }] }

// Exercise the supported Wrangler LOCAL SQL export/import, not a custom
// restore engine or an existing installation. The empty Worker has no mail,
// cron, Access API credentials or ability to deploy anything.
test('native local SQL recovery preserves current state; a stale point exposes erasure/quota loss and both copies remain disabled', { timeout: 180000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'payload-forms-recovery-'))
  const configuration = join(root, 'wrangler.jsonc'), currentSQL = join(root, 'current.sql'), staleSQL = join(root, 'stale.sql')
  const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
  const ids = { D1: '30000000-0000-4000-8000-000000000001', RESTORED: '30000000-0000-4000-8000-000000000002', STALE: '30000000-0000-4000-8000-000000000003' }
  await mkdir(join(root, 'config')); await mkdir(join(root, 'cache'))
  const env: NodeJS.ProcessEnv = { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: root,
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), CI: '1', NODE_ENV: 'test', PUBLIC_GUARD_ENABLED: '1', WRANGLER_SEND_METRICS: 'false' }
  await writeFile(configuration, JSON.stringify({ name: 'fictional-recovery-local', compatibility_date: '2026-10-05',
    workers_dev: false, preview_urls: false, d1_databases: Object.entries(ids).map(([binding, database_id]) => ({
      binding, database_id, database_name: `recovery-${binding.toLowerCase()}`,
    })) }), { mode: 0o600 })
  async function wrangler(...args: string[]) {
    try { await execute(process.execPath, [cli, ...args, '--config', configuration], { cwd: root, env, timeout: 45000, maxBuffer: 1024 * 1024 }) }
    catch (error) {
      // This fixture has no real data or credentials; keep bounded LOCAL CLI
      // diagnostics so a failing restore can be investigated, not retried blind.
      const failure = error as { stdout?: string; stderr?: string }
      throw new Error(`Fictional LOCAL Wrangler ${args[1]} failed: ${`${failure.stderr || ''}\n${failure.stdout || ''}`.slice(-5000)}`)
    }
  }
  async function exportLocal(output: string) {
    // Cloudflare requires referenced tables to exist before their data is
    // inserted. A plain local full dump interleaves CREATE/INSERT and fails
    // for Payload's cross-table relations. With all writers stopped, use the
    // documented schema-only/data-only exports, then import one SQL file:
    // all DDL first, all rows second, constraints deferred only in this import.
    await wrangler('d1', 'export', 'recovery-d1', '--local', '--no-data', '--output', `${output}.schema`)
    await wrangler('d1', 'export', 'recovery-d1', '--local', '--no-schema', '--output', `${output}.data`)
    const schema = await readFile(`${output}.schema`, 'utf8'), data = await readFile(`${output}.data`, 'utf8')
    await writeFile(output, `PRAGMA defer_foreign_keys=ON;\n${schema}\n${data}\n`, { mode: 0o600 })
  }
  let runtime: Miniflare | undefined
  async function open() {
    runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {}',
      compatibilityDate: '2026-10-05', d1Databases: ids, resourcePersistencePath: join(root, '.wrangler/state/v3') }))
    return runtime.getD1Database('D1')
  }
  async function close() { if (runtime) await runtime.dispose(); runtime = undefined }
  async function state(db: D1Database) {
    const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all<{ name: string }>()).results
      .map(row => row.name).filter(name => !name.startsWith('_cf_') && !name.startsWith('sqlite_'))
    const result: Record<string, unknown> = {}
    for (const table of tables) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/)
      const rows = (await db.prepare(`SELECT * FROM "${table}"`).all()).results
      result[table] = rows.map(row => JSON.stringify(row)).sort()
    }
    return result
  }
  try {
    let source = await open()
    const dialect = new SQLiteSyncDialect()
    for (const migration of migrations) await migration.up({ db: { run: async (statement: any) => source.prepare(dialect.sqlToQuery(statement).sql).run() } } as any)
    await source.prepare("INSERT INTO users(id,email,role,enabled) VALUES(1,'fictional-admin@localhost.invalid','admin',1),(2,'fictional-disabled@localhost.invalid','editor',0)").run()
    await source.prepare("INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Fictional recovery','recovery-fixture',?,'pretest')").bind(definition.version).run()
    const now = new Date(), expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString()
    const binding = (key: string, contextRef: string) => ({ key, contextRef, surveyID: 1, version: definition.version, expiresAt })
    const aInput = binding(keyA, '10000000-0000-4000-8000-000000000001'), bInput = binding(keyB, '10000000-0000-4000-8000-000000000002')
    const a = (await ensureEvaluationRun(source, aInput, definition, now, { integrationClient: client })).run
    const b = (await ensureEvaluationRun(source, bInput, definition, now, { integrationClient: client })).run
    const inputs: Submission[] = []
    for (const run of [a, b]) for (let i = 0; i < 6; i++) {
      const key = `${run.key}:fictional-${i}`, answers = { RATING: run.key === keyA ? 5 : 1, NOTE: 'Fictional recovery text, not a real participant.' }
      const input: Submission = { key, erasureKey: erasureKey(key, secret), surveyID: 1, version: run.version, answers,
        digest: digest({ answers, run: run.key }), instrument: definition, durationSeconds: 1, now: now.toISOString(), evaluationRun: { id: run.id, key: run.key } }
      inputs.push(input); assert.equal((await saveSubmission(source, input)).state, 'saved')
    }
    const erased = inputs[0]
    const savedRow = await source.prepare('SELECT id,updated_at FROM responses WHERE submission_key=?').bind(erased.key).first<{ id: number; updated_at: string }>()
    assert.ok(savedRow)
    await source.prepare("INSERT INTO response_contacts(response_id,name,email,test_only,privacy_receipt) VALUES(?,'Fictional contact','fictional@localhost.invalid',1,'{}')").bind(savedRow.id).run()
    await source.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,498,48)').bind(client, now.toISOString().slice(0, 7)).run()
    await source.prepare("INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES('installation',?,1998,198)").bind(now.toISOString().slice(0, 7)).run()
    await source.prepare('INSERT INTO public_request_usage(month,reads,submissions) VALUES(?,12,6)').bind(now.toISOString().slice(0, 7)).run()
    await source.prepare('INSERT INTO email_usage(month,attempts) VALUES(?,19)').bind(now.toISOString().slice(0, 7)).run()
    await source.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,10,1)').bind(now.toISOString().slice(0, 7)).run()
    await source.prepare('UPDATE image_storage_usage SET reserved_bytes=1024,reserved_objects=2').run()
    await close(); await exportLocal(staleSQL)
    source = await open()
    // Events after the old recovery point must not disappear unnoticed.
    assert.ok(await eraseResponse(source, { id: savedRow.id, key: erased.key, erasureKey: erased.erasureKey,
      expectedUpdatedAt: savedRow.updated_at, actorID: 1, reason: 'test-cleanup', now: now.toISOString(), retainUntil: '2036-01-01T00:00:00.000Z' }))
    await closeEvaluationRun(source, keyA, now)
    assert.equal(await reserveQAMachineRequest(source, client, true, now), true)
    assert.equal(await reserveQAMachineRequest(source, client, true, now), true)
    await source.prepare('UPDATE email_usage SET attempts=23').run()
    const expectedState = await state(source)
    const exports = await Promise.all([evaluationRunExport(source, keyA, now), evaluationRunExport(source, keyB, now)])
    assert.deepEqual(exports.map(item => item.responses.length), [5, 6])
    await writeFile(join(root, 'run-a.json'), JSON.stringify(exports[0]), { mode: 0o600 })
    await close(); await exportLocal(currentSQL)
    assert.ok(!(await readFile(currentSQL, 'utf8')).includes(secret), 'stable app key is managed outside the DB dump')
    await wrangler('d1', 'execute', 'recovery-restored', '--local', '--file', currentSQL)
    await wrangler('d1', 'execute', 'recovery-stale', '--local', '--file', staleSQL)
    source = await open()
    const restored = await runtime!.getD1Database('RESTORED'), stale = await runtime!.getD1Database('STALE')
    assert.deepEqual(await state(restored), expectedState, 'current full SQL restore retains every application table/row')
    assert.deepEqual((await restored.prepare('PRAGMA foreign_key_check').all()).results, [])
    const restoredExports = await Promise.all([evaluationRunExport(restored, keyA, now), evaluationRunExport(restored, keyB, now)])
    assert.deepEqual(restoredExports, exports)
    for (const [run, count] of [[a, 5], [b, 6]] as const) {
      const report = await evaluationRunReport(restored, { key: run.key, token: evaluationRunGrant(run, 'report', secret, now) }, secret, now)
      assert.equal(report.report.responses, count)
    }
    assert.equal((await ensureEvaluationRun(restored, aInput, definition, now, { integrationClient: client })).run.status, 'closed')
    assert.equal((await saveSubmission(restored, erased)).state, 'erased', 'erased answer cannot resurrect after full restore')
    assert.equal((await saveSubmission(restored, inputs.at(-1)!)).state, 'saved', 'unchanged committed retry remains recoverable')
    assert.equal((await restored.prepare('SELECT count(*) n FROM response_contacts').first())?.n, 0)
    assert.equal((await restored.prepare('SELECT enabled FROM users WHERE id=2').first())?.enabled, 0)
    assert.equal(await reserveQAMachineRequest(restored, client, true, now), false, 'restoring must not renew consumed QA quota')
    // This detects the known stale fixture by comparison to the latest source.
    // It is NOT an automated freshness gate or a production erasure reconciler.
    assert.notDeepEqual(await state(stale), expectedState)
    assert.equal((await stale.prepare('SELECT count(*) n FROM response_erasure_logs').first())?.n, 0)
    assert.equal((await stale.prepare('SELECT count(*) n FROM response_contacts').first())?.n, 1)
    assert.equal((await stale.prepare('SELECT requests FROM qa_machine_usage WHERE scope=?').bind(client).first())?.requests, 498)

    let initialized = 0
    const context = async (): Promise<never> => { initialized++; throw new Error('Must not initialize the application') }
    const request = (assertion?: string) => new Request('https://forms.example.invalid/api/integrations/qa', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}) }, body: JSON.stringify({ action: 'report', key: keyB }) })
    assert.equal((await handleQAMachineRequest(request(), { QA_MACHINE_ENABLED: '0', D1: restored }, context)).status, 404)
    assert.equal((await handleQAMachineRequest(request(), { QA_MACHINE_ENABLED: '0', D1: stale }, context)).status, 404)
    const pair = await generateKeyPair('RS256'), verifier = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture' }] })
    const issuer = 'https://fictional-recovery.cloudflareaccess.com', aud = 'd'.repeat(64), clientID = `${'a'.repeat(32)}.access`
    const jwt = await new SignJWT({ type: 'app', sub: '', common_name: clientID }).setIssuer(issuer).setAudience(aud)
      .setIssuedAt().setExpirationTime('1m').setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(pair.privateKey)
    const settings = { QA_MACHINE_ENABLED: '1', QA_MACHINE_AUD: aud, ACCESS_LOGIN_ENABLED: '1', ACCESS_AUD: 'c'.repeat(64), ACCESS_TEAM_DOMAIN: issuer,
      SURVEY_ORIGINS: 'https://forms.example.invalid', D1: restored as ResponseDatabase,
      PUBLIC_IP_RATE: { limit: async () => ({ success: true }) } as any, PUBLIC_TOTAL_RATE: { limit: async () => ({ success: true }) } as any,
      QA_MACHINE_CLIENTS: JSON.stringify([{ key: client, accessClientID: clientID, surveyVersions: [definition.version] }]) }
    assert.equal((await handleQAMachineRequest(request(jwt), settings, context, verifier)).status, 429)
    assert.equal((await handleQAMachineRequest(request(jwt), { ...settings, QA_MACHINE_CLIENTS: JSON.stringify([{ key: otherClient,
      accessClientID: `${'b'.repeat(32)}.access`, surveyVersions: [definition.version] }]) }, context, verifier)).status, 401, 'removed native client remains denied')
    assert.equal(initialized, 0)
  } finally {
    await close()
    await rm(root, { recursive: true, force: true }) // Only this newly created fictional fixture.
  }
})
