import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationFixture } from './notification-fixture'
import { ensureEvaluationRun, closeEvaluationRun, type EvaluationRun } from '../src/survey/evaluation-runs'
import { evaluationRunExport, RUN_EXPORT_LIMITS } from '../src/survey/evaluation-run-export'
import { digest } from '../src/survey/privacy-crypto'
import type { Definition } from '../src/survey/types'

const now = new Date('2026-10-19T12:00:00.000Z')
const keyA = '00000000-0000-4000-8000-000000000001', keyB = '00000000-0000-4000-8000-000000000002'
const definition: Definition = { version: 'fixture-v1', introduction: ['Fictional immutable introduction.'], sections: [{ id: 'feedback', title: 'Fictional section', questions: [
  { id: 'RATING', block: 'Feedback', kind: 'stars', label: 'Fictional rating', optional: true },
  { id: 'ZERO', block: 'Feedback', kind: 'slider', label: 'Fictional zero', min: 0, max: 10, optional: true },
  { id: 'COMMENT', block: 'Feedback', kind: 'textarea', label: 'Fictional note', optional: true },
] }] }
async function fixture() {
  const f = await notificationFixture()
  const create = (key: string, contextRef: string) => ensureEvaluationRun(f.db, { key, contextRef, surveyID: 1,
    version: definition.version, expiresAt: '2026-11-01T00:00:00.000Z' }, definition, now)
  const a = (await create(keyA, '10000000-0000-4000-8000-000000000001')).run
  const b = (await create(keyB, '10000000-0000-4000-8000-000000000002')).run
  async function save(run: EvaluationRun, suffix = 'one', rating = 5) {
    const answers = { RATING: rating, ZERO: 0, COMMENT: `Private fictional note äö – ${run.key}` }
    return f.save({ ...f.input(`${run.key}:${suffix}`, now), answers, instrument: definition,
      digest: digest({ answers }), evaluationRun: { id: run.id, key: run.key } })
  }
  return { ...f, a, b, save }
}

test('portable export retains one frozen Run/version and raw answer semantics without credentials or other Runs', async () => {
  const f = await fixture()
  try {
    await f.save(f.a); await f.save(f.b, 'other', 1)
    const before = f.sqlite.prepare('SELECT total_changes() n').get()?.n
    const exported = await evaluationRunExport(f.db, keyA, now)
    assert.equal(exported.format, 'evaluation-run-export'); assert.equal(exported.formatVersion, 1)
    assert.equal(exported.containsRawAnswers, true); assert.equal(exported.run.key, keyA)
    assert.equal(exported.run.contextRef, f.a.context_ref); assert.equal(exported.responses.length, 1)
    assert.equal(exported.responses[0].answers.ZERO, 0)
    assert.match(String(exported.responses[0].answers.COMMENT), /äö/)
    assert.deepEqual(exported.questionnaire.definition, definition)
    assert.doesNotMatch(JSON.stringify(exported), /notificationReference|participationPath|reportCredential|submission_key|privateKey|contact_email/)
    assert.ok(!JSON.stringify(exported).includes(keyB))
    const { integrity, ...body } = exported
    assert.equal(integrity.digest, digest(body))
    assert.notEqual(integrity.digest, digest({ ...body, run: { ...body.run, contextRef: f.b.context_ref } }))
    assert.deepEqual(await evaluationRunExport(f.db, keyA, now), exported)
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get()?.n, before, 'export performs no writes')
    f.sqlite.exec("UPDATE surveys SET title='Changed current title',version='different-current-version'")
    assert.deepEqual((await evaluationRunExport(f.db, keyA, now)).questionnaire.definition, definition)
    await closeEvaluationRun(f.db, keyA, now)
    assert.equal((await evaluationRunExport(f.db, keyA, new Date('2030-01-01T00:00:00.000Z'))).run.state, 'closed', 'archiving does not reopen or require an unexpired group link')
  } finally { f.sqlite.close() }
})

test('missing/corrupt/mixed-version source remains an error, never an empty or silently filtered export', async () => {
  const f = await fixture()
  try {
    await assert.rejects(evaluationRunExport(f.db, 'invalid', now), { status: 400 })
    await assert.rejects(evaluationRunExport(f.db, '00000000-0000-4000-8000-000000000099', now), { status: 404 })
    await f.save(f.a)
    for (const sql of ["UPDATE responses SET answers='not-json'", "UPDATE responses SET version='wrong-version'", 'UPDATE responses SET test_only=0']) {
      f.sqlite.exec('SAVEPOINT corruption'); f.sqlite.exec(sql)
      await assert.rejects(evaluationRunExport(f.db, keyA, now), { status: 503 })
      f.sqlite.exec('ROLLBACK TO corruption'); f.sqlite.exec('RELEASE corruption')
    }
    for (const answers of ['{"RATING":1e400}', '{"RATING":"invalid"}', '{"UNKNOWN":1}', '{"COMMENT":{"invalid":true}}', '{"ZERO":null}']) {
      f.sqlite.exec('SAVEPOINT corruption')
      f.sqlite.prepare('UPDATE responses SET answers=?').run(answers)
      await assert.rejects(evaluationRunExport(f.db, keyA, now), { status: 503 }, 'corruption must not be normalized into a successful extract')
      f.sqlite.exec('ROLLBACK TO corruption'); f.sqlite.exec('RELEASE corruption')
    }
    f.sqlite.exec('DROP TABLE response_contacts')
    assert.equal((await evaluationRunExport(f.db, keyA, now)).responses.length, 1, 'contact/PII tables are not read for an answer extract')
    const broken = { ...f.db, async batch(): Promise<never> { throw new Error('PRIVATE_SQL_CREDENTIAL') } }
    await assert.rejects(evaluationRunExport(broken, keyA, now), error => (error as any).status === 503 && !String(error).includes('PRIVATE_SQL'))
  } finally { f.sqlite.close() }
})

test('count and UTF-8 byte bounds are enforced in SQL before any answer bodies are returned', async () => {
  for (const mode of ['count', 'bytes']) {
    const f = await fixture()
    try {
      if (mode === 'count') {
        const insert = f.sqlite.prepare('INSERT INTO responses(submission_key,survey_id,version,test_only,answers,instrument,evaluation_run_id) VALUES(?,1,?,1,?,?,?)')
        for (let i = 0; i <= RUN_EXPORT_LIMITS.responses; i++) insert.run(`row-${i}`, definition.version, '{}', JSON.stringify(definition), f.a.id)
      } else {
        await f.save(f.a)
        f.sqlite.prepare('UPDATE responses SET answers=?').run(JSON.stringify({ COMMENT: 'ä'.repeat(RUN_EXPORT_LIMITS.answerBytes / 2) }))
      }
      let returnedBodies = -1
      const inspected = { ...f.db, async batch(statements: any[]) {
        const result = await f.db.batch(statements); returnedBodies = result[2].results.length; return result
      } }
      await assert.rejects(evaluationRunExport(inspected, keyA, now), { status: 422 })
      assert.equal(returnedBodies, 0, 'large raw text must not be allocated in Worker memory or truncated')
    } finally { f.sqlite.close() }
  }
})
