import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'
import { down as runDowngrade } from '../src/migrations/20261018_155303_evaluation_runs'
import { ensureEvaluationRun, closeEvaluationRun, authorizedEvaluationRun, evaluationRunGrant,
  evaluationRunReport, type EvaluationRun } from '../src/survey/evaluation-runs'
import { runBatch, saveSubmission, type ResponseDatabase, type SQLValue, type Submission } from '../src/survey/response-store'
import { digest, erasureKey } from '../src/survey/privacy-crypto'
import type { Definition } from '../src/survey/types'

const secret = 'fictional-evaluation-run-fixture-secret-32-characters'
const now = new Date('2026-10-18T12:00:00.000Z'), expiresAt = '2026-11-18T12:00:00.000Z'
const keyA = '00000000-0000-4000-8000-000000000001', keyB = '00000000-0000-4000-8000-000000000002'
const contextA = '10000000-0000-4000-8000-000000000001', contextB = '10000000-0000-4000-8000-000000000002'
const definition: Definition = { version: 'fixture-run-v1', introduction: [], sections: [{ id: 'feedback', title: 'Fictional feedback', questions: [
  { id: 'RATING', block: 'Feedback', label: 'Fictional rating', kind: 'stars', optional: true },
  { id: 'COMMENT', block: 'Feedback', label: 'Fictional comment', kind: 'textarea', optional: true },
] }] }
async function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  for (const migration of migrations) await migration.up(args)
  sqlite.exec("INSERT INTO surveys (id,title,slug,version,phase) VALUES (1,'Fictional','fixture','fixture-run-v1','pretest')")
  const db: ResponseDatabase = {
    prepare(sql) { return { sql, values: [], bind(...values: SQLValue[]) { return { sql, values, bind: this.bind } } } as any },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((s: any) => ({ results: sqlite.prepare(s.sql).all(...s.values),
          meta: { changes: Number(sqlite.prepare('SELECT changes() AS changes').get()?.changes ?? 0) } }))
        sqlite.exec('COMMIT'); return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  return { sqlite, db }
}
const request = (key = keyA, contextRef = contextA) => ({ key, contextRef, surveyID: 1, version: definition.version, expiresAt })
const credential = (run: EvaluationRun, scope: 'participate' | 'report' = 'report') => ({ key: run.key, token: evaluationRunGrant(run, scope, secret, now) })
function submission(run: EvaluationRun, suffix = 'one', rating = 5): Submission {
  const key = `${run.survey_id}:${run.version}:${run.key}:${suffix}`, answers = { RATING: rating, COMMENT: `private-${run.key}` }
  return { key, erasureKey: erasureKey(key, secret), surveyID: 1, version: run.version,
    digest: digest({ version: run.version, evaluationRun: run.key, answers }), answers, instrument: definition,
    durationSeconds: 1, now: now.toISOString(), evaluationRun: { id: run.id, key: run.key } }
}

test('two runs share one immutable version; retry and racing ensures create no duplicates', async () => {
  const { sqlite, db } = await fixture()
  try {
    const [first, raced] = await Promise.all([ensureEvaluationRun(db, request(), definition, now), ensureEvaluationRun(db, request(), definition, now)])
    assert.equal(first.run.id, raced.run.id); assert.equal(raced.reused, true)
    const second = await ensureEvaluationRun(db, request(keyB, contextB), definition, now)
    assert.notEqual(first.run.id, second.run.id)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM surveys').get()?.n, 1)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_runs').get()?.n, 2)
    for (const change of [{ contextRef: contextB }, { expiresAt: '2026-11-19T12:00:00.000Z' }, { version: 'different' }]) {
      await assert.rejects(ensureEvaluationRun(db, { ...request(), ...change }, { ...definition, version: change.version ?? definition.version }, now))
    }
    await assert.rejects(ensureEvaluationRun(db, request(), { ...definition, introduction: ['changed'] }, now))
    assert.equal(first.run.instrument, second.run.instrument)
  } finally { sqlite.close() }
})

test('scope, run identity, expiry and strict fields cannot be exchanged', async () => {
  const { sqlite, db } = await fixture()
  try {
    const a = (await ensureEvaluationRun(db, request(), definition, now)).run
    const b = (await ensureEvaluationRun(db, request(keyB, contextB), definition, now)).run
    assert.equal((await authorizedEvaluationRun(db, credential(a), 'report', secret, now)).id, a.id)
    await assert.rejects(authorizedEvaluationRun(db, { ...credential(a), key: b.key }, 'report', secret, now))
    await assert.rejects(authorizedEvaluationRun(db, credential(a, 'participate'), 'report', secret, now))
    await assert.rejects(authorizedEvaluationRun(db, credential(a), 'participate', secret, now))
    await assert.rejects(authorizedEvaluationRun(db, credential(a), 'report', secret, new Date(now.getTime() + 16 * 60_000)))
    await assert.rejects(evaluationRunReport(db, { ...credential(a), contextRef: contextB }, secret, now))
    await assert.rejects(ensureEvaluationRun(db, { ...request(keyB, contextB), key: '00000000-0000-4000-8000-000000000003', expiresAt: '2027-11-18T12:00:00.000Z' }, definition, now))
  } finally { sqlite.close() }
})

test('scoped aggregate reuses the real analyzer, suppresses small groups and never returns free text', async () => {
  const { sqlite, db } = await fixture()
  try {
    const a = (await ensureEvaluationRun(db, request(), definition, now)).run
    const b = (await ensureEvaluationRun(db, request(keyB, contextB), definition, now)).run
    for (let i = 0; i < 6; i++) assert.equal((await saveSubmission(db, submission(a, String(i)))).state, 'saved')
    for (let i = 0; i < 2; i++) await saveSubmission(db, submission(b, String(i), 1))
    assert.equal((await evaluationRunReport(db, credential(b), secret, now)).report.responses, null)
    for (let i = 2; i < 5; i++) await saveSubmission(db, submission(b, String(i), 1))
    const reportA = await evaluationRunReport(db, credential(a), secret, now)
    const reportB = await evaluationRunReport(db, credential(b), secret, now)
    assert.equal(reportA.report.responses, 6); assert.equal(reportB.report.responses, 5)
    assert.equal(reportA.report.sections[0].series[0].options.find(o => o.value === '5')?.count, 6)
    assert.equal(reportB.report.sections[0].series[0].options.find(o => o.value === '1')?.count, 5)
    assert.equal(reportA.contextRef, contextA); assert.equal(reportB.contextRef, contextB)
    for (const report of [reportA, reportB]) assert.ok(!JSON.stringify(report).includes('private-'))
    // A subsequent instrument exists independently and cannot mutate old runs.
    sqlite.exec("INSERT INTO surveys (id,title,slug,version,phase) VALUES (2,'Next','next','fixture-run-v2','pretest')")
    const v2 = { ...definition, version: 'fixture-run-v2', introduction: ['A later revision'] }
    await ensureEvaluationRun(db, { ...request('00000000-0000-4000-8000-000000000003'), surveyID: 2, version: v2.version }, v2, now)
    assert.deepEqual(await evaluationRunReport(db, credential(a), secret, now), reportA)
  } finally { sqlite.close() }
})

test('lost acknowledgement, closure and retries preserve the saved receipt without reopening', async () => {
  const { sqlite, db } = await fixture()
  try {
    const a = (await ensureEvaluationRun(db, request(), definition, now)).run, input = submission(a)
    const first = await saveSubmission(db, input)
    assert.equal(first.state, 'saved')
    const replay = await saveSubmission(db, input)
    assert.equal(replay.state, 'saved'); if (replay.state === 'saved') assert.equal(replay.duplicate, true)
    await closeEvaluationRun(db, a.key, now); await closeEvaluationRun(db, a.key, now)
    assert.equal((await ensureEvaluationRun(db, request(), definition, now)).run.status, 'closed')
    const afterClose = await saveSubmission(db, input)
    assert.equal(afterClose.state, 'saved')
    if (afterClose.state === 'saved' && first.state === 'saved') assert.equal(afterClose.id, first.id)
    assert.equal((await saveSubmission(db, submission(a, 'late'))).state, 'closed')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 1)
    assert.equal((await evaluationRunReport(db, credential(a), secret, now)).state, 'closed')
  } finally { sqlite.close() }
})

test('database fault rolls back and report outage never fabricates a fallback aggregate', async () => {
  const { sqlite, db } = await fixture()
  try {
    const a = (await ensureEvaluationRun(db, request(), definition, now)).run
    sqlite.exec("CREATE TRIGGER fixture_fault BEFORE INSERT ON responses BEGIN SELECT RAISE(ABORT, 'fictional storage fault'); END")
    await assert.rejects(saveSubmission(db, submission(a)), /fictional storage fault/)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 0)
    sqlite.exec('DROP TRIGGER fixture_fault')
    assert.equal((await saveSubmission(db, submission(a))).state, 'saved')
    await assert.rejects(runDowngrade({} as any), /gesperrt/, 'downgrade must retain run evidence instead of dropping referenced tables')
    const failing: ResponseDatabase = { ...db, async batch() { throw new Error('fictional provider outage') } }
    await assert.rejects(evaluationRunReport(failing, credential(a), secret, now), /fictional provider outage/)
    assert.equal((await runBatch(db, [{ sql: 'SELECT COUNT(*) AS n FROM evaluation_runs', values: [] }]))[0].results[0].n, 1)
  } finally { sqlite.close() }
})

test('automatic expiry permits only exact receipt recovery, never a new response or page/report access', async () => {
  const { sqlite, db } = await fixture()
  try {
    const a = (await ensureEvaluationRun(db, request(), definition, now)).run, input = submission(a)
    const saved = await saveSubmission(db, input)
    const later = new Date(Date.parse(expiresAt) + 1000), grant = credential(a, 'participate')
    await assert.rejects(authorizedEvaluationRun(db, grant, 'participate', secret, later))
    assert.equal((await authorizedEvaluationRun(db, grant, 'participate', secret, later, { allowExpiredReceipt: true })).id, a.id)
    const recovered = await saveSubmission(db, { ...input, now: later.toISOString() })
    assert.equal(recovered.state, 'saved')
    if (recovered.state === 'saved' && saved.state === 'saved') { assert.equal(recovered.id, saved.id); assert.equal(recovered.duplicate, true) }
    assert.equal((await saveSubmission(db, { ...submission(a, 'late'), now: later.toISOString() })).state, 'closed')
    await assert.rejects(authorizedEvaluationRun(db, credential(a), 'report', secret, later, { allowExpiredReceipt: true }))
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 1)
  } finally { sqlite.close() }
})
