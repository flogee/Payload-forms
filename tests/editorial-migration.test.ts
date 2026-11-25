import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'

test('editorial upgrade is additive and preserves prior responses, permanent freezes, locks, users and budgets', async () => {
  const db = new DatabaseSync(':memory:'), dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => db.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    db.exec('PRAGMA foreign_keys=ON')
    const index = migrations.findIndex(migration => migration.name === '20261116_081552_editorial_corrections')
    assert.ok(index >= 0)
    for (const migration of migrations.slice(0, index)) await migration.up(args)
    db.exec(`INSERT INTO users(id,email) VALUES(1,'synthetic@localhost.invalid');
      INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Synthetic','synthetic','synthetic-v1','live');
      INSERT INTO responses(submission_key,survey_id,version,test_only,answers,instrument) VALUES('synthetic',1,'synthetic-v1',0,'{}','{}');
      INSERT INTO payload_locked_documents(id) VALUES(1);
      INSERT INTO payload_locked_documents_rels(parent_id,path,surveys_id) VALUES(1,'document',1);`)
    const tables = ['users', 'surveys', 'responses', 'payload_locked_documents_rels', 'email_usage', 'image_storage_usage', 'public_request_usage']
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all())
    const fk = db.prepare('PRAGMA foreign_key_list(payload_locked_documents_rels)').all()
    await migrations[index].up(args)
    tables.forEach((table, i) => {
      const rows = db.prepare(`SELECT * FROM ${table}`).all().map(row => { if (table === 'payload_locked_documents_rels') delete row.survey_corrections_id; return row })
      assert.deepEqual(rows, before[i], table)
    })
    assert.deepEqual(db.prepare('PRAGMA foreign_key_list(payload_locked_documents_rels)').all().filter(row => row.from !== 'survey_corrections_id').map(({ id: _id, ...row }) => row), fk.map(({ id: _id, ...row }) => row))
    assert.equal(db.prepare('SELECT count(*) n FROM survey_corrections').get()!.n, 0)
    assert.throws(() => db.exec('UPDATE surveys SET first_real_response_at=NULL'), /permanent/)
    await assert.rejects(migrations[index].down(args), /gesperrt/)
  } finally { db.close() }
})
