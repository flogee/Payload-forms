import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'
import { digest, erasureKey } from '../src/survey/privacy-crypto'
import { saveSubmission, type ResponseDatabase, type SQLValue, type Submission } from '../src/survey/response-store'
import { sample } from '../src/survey/sample'

export const notificationNow = new Date('2026-10-07T08:00:00.000Z')
export async function notificationFixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  for (const migration of migrations) await migration.up(args)
  sqlite.exec("INSERT INTO users (id,email) VALUES (1,'team@localhost.invalid'); INSERT INTO surveys (id,title,slug,version,phase,notifications_enabled,notifications_recipients) VALUES (1,'Fixture','fixture','fixture-v1','pretest',1,'notify@localhost.invalid')")
  const db: ResponseDatabase = {
    prepare(sql) { return { sql, values: [], bind(...values: SQLValue[]) { return { sql, values, bind: this.bind } } } as any },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map((statement: any) => ({ results: sqlite.prepare(statement.sql).all(...statement.values),
          meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get()?.n) } }))
        sqlite.exec('COMMIT'); return result
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  function input(key = crypto.randomUUID(), now = notificationNow): Submission {
    const answers = { F01_name: 'Never include this answer in an email' }
    return { key, erasureKey: erasureKey(key, 'fixture-only-key-no-production-data'.repeat(2)), surveyID: 1, version: 'fixture-v1',
      digest: digest({ version: 'fixture-v1', answers }), durationSeconds: 2, answers, instrument: { ...sample, version: 'fixture-v1' },
      now: now.toISOString(), notificationReference: crypto.randomUUID(), notificationRecipients: ['notify@localhost.invalid'] }
  }
  return { sqlite, db, input, save: (value = input()) => saveSubmission(db, value) }
}
