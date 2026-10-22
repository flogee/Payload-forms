import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { up as initial } from '../src/migrations/20261005_100813_initial_schema'
import { up as extend } from '../src/migrations/20261005_101926_mcp_drafts'
import { up as privacyMigration } from '../src/migrations/20261007_052947_privacy_controls'
import { up as mailMigration } from '../src/migrations/20261007_064226_email_notifications'
import { up as retentionMigration } from '../src/migrations/20261008_133131_retention_reminders'
import { saveSubmission, eraseResponse, readResponseExport, type Submission, type ResponseDatabase, type SQLValue } from '../src/survey/response-store'
import { digest, erasureKey, privacyHash } from '../src/survey/privacy-crypto'
import { privacyNotice } from '../src/survey/privacy'
import { sample } from '../src/survey/sample'
import { testPrivacy } from './privacy-fixture'

const fixtureSecret = 'fixture-only-secret-no-live-data'.repeat(2)
const now = '2026-10-07T08:00:00.000Z'
async function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  await initial(args); await extend(args); await privacyMigration(args); await mailMigration(args); await retentionMigration(args)
  sqlite.exec("INSERT INTO users (id,email) VALUES (1,'fixture@example.invalid'); INSERT INTO surveys (id,title,slug,version,phase) VALUES (1,'Fixture','fixture','fixture-v1','pretest')")
  const db: ResponseDatabase = {
    prepare(sql) {
      return { sql, values: [], bind(...values: SQLValue[]) { return { sql, values, bind: this.bind } } } as any
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map((statement: any) => {
          const results = sqlite.prepare(statement.sql).all(...statement.values)
          const changes = Number(sqlite.prepare('SELECT changes() AS changes').get()?.changes ?? 0)
          return { results, meta: { changes } }
        })
        sqlite.exec('COMMIT')
        return result
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  return { sqlite, db }
}

function submission(withContact = true, suffix = 'one'): Submission {
  const notice = privacyNotice(testPrivacy())!
  const receipt = withContact ? { notice, noticeHash: privacyHash(notice), recordedAt: now, consent: true, contactConsent: true } : undefined
  const contact = withContact ? { name: 'Fiktive Person', email: 'person@example.invalid' } : undefined
  const answers = { F01_name: 'Fiktive Organisation' }
  const key = `1:fixture-v1:fixture-${suffix}`
  return { key, erasureKey: erasureKey(key, fixtureSecret), surveyID: 1, version: 'fixture-v1', durationSeconds: 2,
    answers, instrument: { ...sample, version: 'fixture-v1' }, receipt, contact, now,
    digest: digest({ version: 'fixture-v1', answers, noticeHash: receipt?.noticeHash, consent: receipt?.consent,
      contactConsent: receipt?.contactConsent, contact }),
  }
}

test('answer/contact batch rolls back together and exact retries cannot replace either payload', async () => {
  const { sqlite, db } = await fixture()
  try {
    sqlite.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON response_contacts BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    await assert.rejects(saveSubmission(db, submission()), /fixture failure/)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 0)
    sqlite.exec('DROP TRIGGER fixture_failure')
    const first = await saveSubmission(db, submission())
    assert.equal(first.state, 'saved')
    assert.equal((await saveSubmission(db, { ...submission(), durationSeconds: 4 })).state, 'saved')
    const changed = { ...submission(), digest: 'changed', contact: { name: 'Other', email: 'other@example.invalid' } }
    assert.equal((await saveSubmission(db, changed)).state, 'conflict')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 1)
    assert.equal(sqlite.prepare('SELECT name FROM response_contacts').get()?.name, 'Fiktive Person')
    assert.equal(sqlite.prepare('SELECT duration_seconds FROM responses').get()?.duration_seconds, 2)
  } finally { sqlite.close() }
})

test('confirmed erasure removes linked contacts and locked references, while retries stay erased', async () => {
  const { sqlite, db } = await fixture()
  try {
    const input = submission(), result = await saveSubmission(db, input)
    assert.equal(result.state, 'saved')
    if (result.state !== 'saved') return
    const contactID = sqlite.prepare('SELECT id FROM response_contacts').get()?.id
    sqlite.prepare("INSERT INTO payload_locked_documents (id) VALUES (1)").run()
    sqlite.prepare("INSERT INTO payload_locked_documents_rels (parent_id,path,response_contacts_id,responses_id) VALUES (1,'document',?,?)").run(contactID as number, result.id)
    const erase = { id: result.id, key: input.key, erasureKey: input.erasureKey, expectedUpdatedAt: now,
      actorID: 1, reason: 'request' as const, now: '2026-10-07T09:00:00.000Z', retainUntil: '2026-11-06T09:00:00.000Z' }
    assert.equal(await eraseResponse(db, { ...erase, expectedUpdatedAt: '2026-10-06T00:00:00.000Z' }), undefined)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_erasure_logs').get()?.n, 0)
    const receipt = await eraseResponse(db, erase)
    assert.equal(receipt?.reason, 'request')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payload_locked_documents_rels').get()?.n, 0)
    const journal = JSON.stringify(sqlite.prepare('SELECT * FROM response_erasure_logs').get())
    for (const value of ['Fiktive', 'person@example.invalid', input.key]) assert.ok(!journal.includes(value))
    assert.equal((await saveSubmission(db, input)).state, 'erased')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 0)
  } finally { sqlite.close() }
})

test('legacy rows allow unchanged retry without attaching new consent or contacts', async () => {
  const { sqlite, db } = await fixture()
  try {
    const input = submission(false)
    sqlite.prepare('INSERT INTO responses (submission_key,survey_id,version,test_only,answers,instrument,created_at,updated_at) VALUES (?,1,?,1,?,?,?,?)')
      .run(input.key, input.version, JSON.stringify(input.answers), JSON.stringify(input.instrument), now, now)
    const retried = await saveSubmission(db, input)
    assert.equal(retried.state, 'saved')
    if (retried.state === 'saved') assert.equal(retried.duplicate, true)
    assert.equal((await saveSubmission(db, { ...input, digest: 'different' })).state, 'conflict')
    assert.equal((await saveSubmission(db, submission(true))).state, 'conflict')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 0)
    assert.equal(sqlite.prepare('SELECT submission_digest FROM responses').get()?.submission_digest, null)
  } finally { sqlite.close() }
})

test('a close between validation and insertion prevents storing a new response or contact', async () => {
  const { sqlite, db } = await fixture()
  try {
    sqlite.exec("UPDATE surveys SET phase='closed' WHERE id=1")
    assert.equal((await saveSubmission(db, submission())).state, 'closed')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 0)
  } finally { sqlite.close() }
})

test('export cannot combine an erased response with contacts from a reused numeric ID', async () => {
  const { sqlite, db } = await fixture()
  try {
    const a = submission(), saved = await saveSubmission(db, a)
    assert.equal(saved.state, 'saved')
    if (saved.state !== 'saved') return
    assert.equal((await readResponseExport(db, saved.id, a.key))?.contact?.name, 'Fiktive Person')
    // Emulate the request having authorized A before the erase/reinsert interleaving.
    await eraseResponse(db, { id: saved.id, key: a.key, erasureKey: a.erasureKey, expectedUpdatedAt: now,
      actorID: 1, reason: 'request', now, retainUntil: '2026-11-06T08:00:00.000Z' })
    const b = { ...submission(true, 'two'), contact: { name: 'Andere Testperson', email: 'other@example.invalid' } }
    const replaced = await saveSubmission(db, b)
    assert.equal(replaced.state, 'saved')
    if (replaced.state !== 'saved') return
    assert.equal(replaced.id, saved.id, 'SQLite can reuse the deleted highest ID')
    assert.equal(await readResponseExport(db, saved.id, a.key), undefined)
    assert.equal((await readResponseExport(db, replaced.id, b.key))?.contact?.name, 'Andere Testperson')
  } finally { sqlite.close() }
})

function prepareLive(sqlite: DatabaseSync) {
  const settings = testPrivacy({ reviewed: true })
  const entries = Object.entries(settings)
  sqlite.prepare(`UPDATE surveys SET phase='live', ${entries.map(([key]) => `privacy_${key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())}=?`).join(',')} WHERE id=1`)
    .run(...entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value))
  const input = submission()
  return { ...input, mode: 'live' as const, livePrivacy: settings,
    contact: { name: '', email: 'fixture@example.org' }, digest: digest({ mode: 'live', payload: input.digest }) }
}

test('live submissions preserve real markers, separate optional contacts and mode-specific retries', async () => {
  const { sqlite, db } = await fixture()
  const previous = process.env.FORMS_REAL_SURVEYS_ENABLED
  try {
    const input = prepareLive(sqlite)
    delete process.env.FORMS_REAL_SURVEYS_ENABLED
    assert.equal((await saveSubmission(db, input)).state, 'closed')
    process.env.FORMS_REAL_SURVEYS_ENABLED = '1'
    const saved = await saveSubmission(db, input)
    assert.equal(saved.state, 'saved')
    if (saved.state !== 'saved') return
    assert.equal(sqlite.prepare('SELECT test_only FROM responses').get()?.test_only, 0)
    assert.equal(sqlite.prepare('SELECT test_only FROM response_contacts').get()?.test_only, 0)
    assert.equal((await readResponseExport(db, saved.id, input.key))?.contact?.email, 'fixture@example.org')
    assert.equal((await saveSubmission(db, { ...input, durationSeconds: 8 }) as any).duplicate, true)
    assert.equal((await saveSubmission(db, { ...input, mode: 'pretest' })).state, 'conflict')
    const noContact = { ...input, key: 'live-no-contact', erasureKey: 'live-no-contact-marker', contact: undefined as undefined,
      receipt: { ...input.receipt!, contactConsent: false } }
    assert.equal((await saveSubmission(db, noContact)).state, 'saved')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 1)
    delete process.env.FORMS_REAL_SURVEYS_ENABLED
    assert.equal((await saveSubmission(db, input)).state, 'closed')
    assert.equal(sqlite.prepare('SELECT test_only FROM responses LIMIT 1').get()?.test_only, 0, 'disable never relabels stored real data')
  } finally {
    if (previous === undefined) delete process.env.FORMS_REAL_SURVEYS_ENABLED
    else process.env.FORMS_REAL_SURVEYS_ENABLED = previous
    sqlite.close()
  }
})

test('live insertion fails atomically after close, privacy revocation, stale profile, or missing reviewed receipt', async () => {
  const previous = process.env.FORMS_REAL_SURVEYS_ENABLED
  process.env.FORMS_REAL_SURVEYS_ENABLED = '1'
  try {
    for (const mutate of [
      (sqlite: DatabaseSync) => sqlite.exec("UPDATE surveys SET phase='closed'"),
      (sqlite: DatabaseSync) => sqlite.exec('UPDATE surveys SET privacy_reviewed=0'),
      (sqlite: DatabaseSync) => sqlite.exec("UPDATE surveys SET privacy_notice_version='changed'"),
      (sqlite: DatabaseSync) => sqlite.exec("UPDATE surveys SET privacy_purpose='changed'"),
      (sqlite: DatabaseSync) => sqlite.exec("UPDATE surveys SET privacy_controller_name=''"),
    ]) {
      const { sqlite, db } = await fixture()
      try {
        const input = prepareLive(sqlite)
        mutate(sqlite)
        assert.equal((await saveSubmission(db, input)).state, 'closed')
        assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 0)
        assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 0)
      } finally { sqlite.close() }
    }
    const { sqlite, db } = await fixture()
    try {
      const input = prepareLive(sqlite)
      for (const missing of [{ receipt: undefined as undefined }, { livePrivacy: undefined as undefined }, { livePrivacy: testPrivacy() }, { evaluationRun: { id: 1, key: 'fictional-run' } }]) {
        assert.equal((await saveSubmission(db, { ...input, ...missing })).state, 'closed')
      }
    } finally { sqlite.close() }
  } finally {
    if (previous === undefined) delete process.env.FORMS_REAL_SURVEYS_ENABLED
    else process.env.FORMS_REAL_SURVEYS_ENABLED = previous
  }
})
