import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { up as initial } from '../src/migrations/20261005_100813_initial_schema'
import { up as extend } from '../src/migrations/20261005_101926_mcp_drafts'
import { up as privacy, down as privacyDown } from '../src/migrations/20261007_052947_privacy_controls'
import { up as mail, down as mailDown } from '../src/migrations/20261007_064226_email_notifications'
import { up as content, down as contentDown } from '../src/migrations/20261007_134653_content_blocks'
import { up as images, down as imagesDown } from '../src/migrations/20261007_135122_image_budgets'
import { up as alerts } from '../src/migrations/20261007_155505_budget_alerts'
import { up as retention, down as retentionDown } from '../src/migrations/20261008_133131_retention_reminders'
import { migrations } from '../src/migrations'

test('evaluation-run upgrade preserves legacy instruments, responses, contacts and usage reservations', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    const index = migrations.findIndex(m => m.name.endsWith('evaluation_runs'))
    assert.ok(index > 0)
    for (const migration of migrations.slice(0, index)) await migration.up(args)
    sqlite.exec("INSERT INTO users(id,email,hash,salt,role,enabled) VALUES(1,'migration@localhost.invalid','fixture-hash','fixture-salt','admin',1); INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Legacy fixture','legacy','legacy-v1','pretest'); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument) VALUES(1,'legacy-key',1,'legacy-v1',1,'{}','{}'); INSERT INTO response_contacts(id,response_id,name,email,test_only,privacy_receipt) VALUES(1,1,'Fictional','fixture@localhost.invalid',1,'{}'); INSERT INTO public_request_usage(id,month,reads,submissions) VALUES(1,'2026-10',123,45);")
    sqlite.exec("INSERT INTO users(id,email,hash,salt,role,enabled) VALUES(2,'disabled@localhost.invalid','retained-legacy-hash','retained-salt','editor',0); INSERT INTO email_usage(id,month,attempts) VALUES(1,'2026-10',19); INSERT INTO image_request_usage(id,month,reads,writes) VALUES(1,'2026-10',21,3); UPDATE image_storage_usage SET reserved_bytes=1024,reserved_objects=2 WHERE id=1;")
    sqlite.exec("INSERT INTO budget_alerts(alert_key,metric,period,level,used,quota_limit,status,attempts) VALUES('mail:2026-10:warning','mail','2026-10','warning',400,460,'sent',1)")
    const tables = ['users', 'surveys', 'responses', 'response_contacts', 'public_request_usage', 'image_storage_usage', 'email_usage', 'image_request_usage', 'budget_alerts']
    const before = Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).all()]))
    for (const migration of migrations.slice(index)) await migration.up(args)
    for (const table of tables) {
      const after = sqlite.prepare(`SELECT * FROM ${table}`).all()
      assert.equal(after.length, before[table].length)
      for (let i = 0; i < after.length; i++) for (const [field, value] of Object.entries(before[table][i])) assert.equal(after[i][field], value, `${table}.${field}`)
    }
    assert.equal(sqlite.prepare('SELECT evaluation_run_id FROM responses').get()?.evaluation_run_id, null)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_runs').get()?.n, 0)
    assert.ok(sqlite.prepare('PRAGMA table_info(evaluation_runs)').all().some(row => row.name === 'integration_client'))
    assert.equal(sqlite.prepare('SELECT scope FROM budget_alerts').get()?.scope, '')
    assert.equal(sqlite.prepare('SELECT count(*) n FROM qa_machine_usage').get()?.n, 0)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(migrations[index].down(args), /Rückbau.*gesperrt/)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM responses').get()?.n, 1)
  } finally { sqlite.close() }
})

test('voting migration adds nullable settings without changing started questions or responses', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    const index = migrations.findIndex(m => m.name.endsWith('voting_fields'))
    for (const migration of migrations.slice(0, index)) await migration.up(args)
    sqlite.exec("INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Test','test','v1','pretest'); INSERT INTO surveys_sections(_order,_parent_id,id,key,title) VALUES(0,1,'section','feedback','Feedback'); INSERT INTO surveys_sections_questions(_order,_parent_id,id,code,block,label,kind) VALUES(0,'section','question','Q','Feedback','Testfrage','matrix'); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument) VALUES(1,'dummy',1,'v1',1,'{}','{\"version\":\"v1\"}')")
    const question = sqlite.prepare('SELECT * FROM surveys_sections_questions').get()!
    const response = sqlite.prepare('SELECT * FROM responses').get()!
    const migration = migrations[index]
    assert.match(migration.name, /voting_fields$/)
    await migration.up(args)
    const after = sqlite.prepare('SELECT * FROM surveys_sections_questions').get()!
    for (const [key, value] of Object.entries(question)) assert.equal(after[key], value)
    for (const key of ['step', 'low_label', 'high_label']) assert.equal(after[key], null)
    assert.deepEqual(sqlite.prepare('SELECT * FROM responses').get(), response)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(migration.down(args), /Rückbau.*gesperrt/)
  } finally { sqlite.close() }
})

test('retention migration preserves records, leaves legacy deadlines empty, mail disabled, and blocks rollback', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    await initial(args); await extend(args); await privacy(args); await mail(args); await content(args); await images(args); await alerts(args)
    sqlite.exec("INSERT INTO users (id,email,hash,salt) VALUES (1,'migration@localhost.invalid','dummy-hash','dummy-salt'); INSERT INTO surveys (id,title,slug,version,phase,privacy_enabled,privacy_retention) VALUES(1,'Dummy','dummy','dummy-v1','pretest',1,'Three years in prose'); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument,privacy_receipt) VALUES(1,'dummy',1,'dummy-v1',1,'{}','{}','{\"consent\":true}')")
    const before = Object.fromEntries(['users', 'surveys', 'responses'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).get()!]))
    await retention(args)
    for (const [table, row] of Object.entries(before)) {
      const after = sqlite.prepare(`SELECT * FROM ${table}`).get()!
      for (const [field, value] of Object.entries(row)) assert.equal(after[field], value, `${table}.${field} preserved`)
    }
    assert.equal(sqlite.prepare('SELECT retention_reminders_enabled FROM surveys').get()?.retention_reminders_enabled, 0)
    assert.equal(sqlite.prepare('SELECT privacy_retention_years FROM surveys').get()?.privacy_retention_years, 0)
    assert.equal(sqlite.prepare('SELECT retention_review_due_at FROM responses').get()?.retention_review_due_at, null)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(retentionDown(args), /Rückbau.*gesperrt/)
  } finally { sqlite.close() }
})

test('content migrations preserve started instruments, snapshots, privacy and account rights; quota rollback is blocked', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    await initial(args); await extend(args); await privacy(args); await mail(args)
    sqlite.exec("INSERT INTO users (id,email,hash,salt) VALUES (1,'migration@localhost.invalid','dummy-hash','dummy-salt'); INSERT INTO surveys (id,title,slug,version,phase,privacy_enabled,privacy_purpose) VALUES(1,'Dummy','dummy','dummy-v1','pretest',1,'Preserve purpose'); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument,privacy_receipt) VALUES(1,'dummy',1,'dummy-v1',1,'{}','{}','{\"consent\":true}'); INSERT INTO payload_mcp_api_keys(id,user_id,label,surveys_find) VALUES(1,1,'dummy-key',1)")
    const before = Object.fromEntries(['users', 'surveys', 'responses', 'payload_mcp_api_keys'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).get()!]))
    await content(args); await images(args)
    for (const [table, row] of Object.entries(before)) {
      const after = sqlite.prepare(`SELECT * FROM ${table}`).get()!
      for (const [field, value] of Object.entries(row)) assert.equal(after[field], value, `${table}.${field} preserved`)
    }
    assert.deepEqual({ ...sqlite.prepare('SELECT * FROM image_storage_usage').get() }, { id: 1, reserved_bytes: 0, reserved_objects: 0 })
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(contentDown(args), /Rückbau.*gesperrt/)
    await assert.rejects(imagesDown(args), /Rückbau.*gesperrt/)
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM image_storage_usage').get()?.n, 1)
  } finally { sqlite.close() }
})

test('MCP migration preserves existing keys and permission values', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    await initial(args)
    sqlite.exec("INSERT INTO users (id,email) VALUES (1,'migration-test@localhost.invalid'); INSERT INTO payload_mcp_api_keys (id,user_id,label,surveys_create,surveys_update) VALUES (1,1,'migration-test',1,1);")
    await extend(args)
    const key = sqlite.prepare('SELECT surveys_create, surveys_update, payload_mcp_tool_create_survey_draft, payload_mcp_tool_update_survey_draft FROM payload_mcp_api_keys WHERE id=1').get()
    assert.deepEqual({ ...key }, { surveys_create: 1, surveys_update: 1, payload_mcp_tool_create_survey_draft: 0, payload_mcp_tool_update_survey_draft: 0 })
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payload_mcp_api_keys').get()?.n, 1)
  } finally { sqlite.close() }
})

test('mail migration preserves existing records, keeps sending off and refuses a destructive rollback', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    await initial(args); await extend(args); await privacy(args)
    sqlite.exec("INSERT INTO users (id,email,hash,salt) VALUES (1,'migration@localhost.invalid','dummy-hash','dummy-salt'); INSERT INTO surveys (id,title,slug,version,phase,privacy_enabled,privacy_purpose) VALUES(1,'Dummy','dummy','dummy-v1','pretest',1,'Preserve purpose'); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument,privacy_receipt) VALUES(1,'dummy',1,'dummy-v1',1,'{}','{}','{\"consent\":true}')")
    const before = Object.fromEntries(['users', 'surveys', 'responses'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).get()!]))
    await mail(args)
    for (const [table, row] of Object.entries(before)) {
      const after = sqlite.prepare(`SELECT * FROM ${table}`).get()!
      for (const [field, value] of Object.entries(row)) assert.equal(after[field], value, `${table}.${field} preserved`)
    }
    assert.equal(sqlite.prepare('SELECT notifications_enabled FROM surveys').get()?.notifications_enabled, 0)
    assert.equal(sqlite.prepare('SELECT notification_reference FROM responses').get()?.notification_reference, null)
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM response_notifications').get()?.n, 0)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(mailDown(args), /Rückbau.*gesperrt/)
  } finally { sqlite.close() }
})

test('privacy migration preserves existing forms, answers, account and MCP rights without inventing consent', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    await initial(args); await extend(args)
    sqlite.exec("INSERT INTO users (id,email,hash,salt) VALUES (1,'migration-test@localhost.invalid','dummy-hash','dummy-salt'); INSERT INTO surveys (id,title,slug,version,phase) VALUES (1,'Migration dummy','migration-dummy','dummy-v1','pretest'); INSERT INTO payload_mcp_api_keys (id,user_id,label,surveys_find,payload_mcp_tool_create_survey_draft) VALUES (1,1,'dummy-key',1,1)")
    sqlite.prepare('INSERT INTO responses (id,submission_key,survey_id,version,test_only,answers,instrument) VALUES (1,?,1,?,1,?,?)')
      .run('dummy-submission', 'dummy-v1', '{"F01_name":"Fiktiver Verein"}', '{"version":"dummy-v1"}')
    const before = Object.fromEntries(['users', 'surveys', 'responses', 'payload_mcp_api_keys'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).get()!]))
    await privacy(args)
    for (const [table, row] of Object.entries(before)) {
      const after = sqlite.prepare(`SELECT * FROM ${table}`).get()!
      for (const [field, value] of Object.entries(row)) assert.equal(after[field], value, `${table}.${field} preserved`)
    }
    assert.equal(sqlite.prepare('SELECT privacy_enabled FROM surveys').get()?.privacy_enabled, 0)
    assert.equal(sqlite.prepare('SELECT privacy_receipt FROM responses').get()?.privacy_receipt, null)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_contacts').get()?.n, 0)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM response_erasure_logs').get()?.n, 0)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(privacyDown(args), /Rückbau.*gesperrt/)
    assert.equal(sqlite.prepare('SELECT answers FROM responses').get()?.answers, before.responses.answers)
  } finally { sqlite.close() }
})


test('branding migration preserves started instruments and snapshots and keeps old headers unchanged', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys=ON')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  try {
    const index = migrations.findIndex(m => m.name.endsWith('survey_branding'))
    for (const migration of migrations.slice(0, index)) await migration.up(args)
    sqlite.exec("INSERT INTO surveys(id,title,slug,version,phase) VALUES(1,'Test','test','v1','pretest'); INSERT INTO responses(id,submission_key,survey_id,version,test_only,answers,instrument) VALUES(1,'dummy',1,'v1',1,'{}','{}')")
    const survey = sqlite.prepare('SELECT * FROM surveys').get()!
    const response = sqlite.prepare('SELECT * FROM responses').get()!
    await migrations[index].up(args)
    const after = sqlite.prepare('SELECT * FROM surveys').get()!
    for (const [key, value] of Object.entries(survey)) assert.equal(after[key], value)
    assert.equal(after.branding_mode, 'default')
    assert.equal(after.branding_text, null)
    assert.equal(after.branding_logo_id, null)
    assert.deepEqual(sqlite.prepare('SELECT * FROM responses').get(), response)
    assert.throws(() => sqlite.exec('UPDATE surveys SET branding_logo_id=123'), /FOREIGN KEY/)
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])
    await assert.rejects(migrations[index].down(args), /Rückbau.*gesperrt/)
  } finally { sqlite.close() }
})
