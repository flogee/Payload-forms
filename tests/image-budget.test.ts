import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'
import { budgetedImageBucket, IMAGE_LIMITS, reserveImageOperation } from '../src/survey/image-budget'

async function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  const dialect = new SQLiteSyncDialect()
  const args = { db: { run: async (statement: any) => sqlite.exec(dialect.sqlToQuery(statement).sql) } } as any
  for (const migration of migrations) await migration.up(args)
  const db = { prepare(sql: string) { return { bind(...values: any[]) { return { async run() {
    const result = sqlite.prepare(sql).run(...values)
    return { success: true, meta: { changes: Number(result.changes) } }
  } } } } } } as unknown as D1Database
  const calls = { reads: 0, writes: 0, deletes: 0 }
  let fail = false
  const underlying = { async get(): Promise<null> { calls.reads++; if (fail) throw new Error('provider failure'); return null },
    async head(): Promise<null> { calls.reads++; return null }, async put(): Promise<null> { calls.writes++; if (fail) throw new Error('provider failure'); return null },
    async delete() { calls.deletes++ }, async list() { throw new Error('UNMETERED') } } as unknown as R2Bucket
  return { sqlite, db, calls, bucket: budgetedImageBucket(underlying, db), fail: () => { fail = true } }
}
const key = 'forms-images/00000000-0000-4000-8000-000000000001.png'

test('simultaneous uploads cannot over-reserve the last storage bytes or object slot', async () => {
  for (const boundary of ['bytes', 'objects']) {
    const f = await fixture()
    try {
      f.sqlite.prepare('UPDATE image_storage_usage SET reserved_bytes=?,reserved_objects=?').run(
        boundary === 'bytes' ? IMAGE_LIMITS.storageBytes - 8 : 0,
        boundary === 'objects' ? IMAGE_LIMITS.objects - 1 : 0)
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => f.bucket.put(key, new Uint8Array(4))))
      assert.equal(results.filter(r => r.status === 'fulfilled').length, boundary === 'bytes' ? 2 : 1)
      assert.equal(f.calls.writes, boundary === 'bytes' ? 2 : 1)
      const row = f.sqlite.prepare('SELECT * FROM image_storage_usage').get()!
      assert.ok(Number(row.reserved_bytes) <= IMAGE_LIMITS.storageBytes)
      assert.ok(Number(row.reserved_objects) <= IMAGE_LIMITS.objects)
    } finally { f.sqlite.close() }
  }
})

test('shared atomic caps stop simultaneous reads and writes before the R2 call', async () => {
  const f = await fixture()
  try {
    const month = new Date().toISOString().slice(0, 7)
    f.sqlite.prepare('INSERT INTO image_request_usage(month, reads, writes) VALUES(?,?,?)').run(month, IMAGE_LIMITS.monthlyReads - 3, IMAGE_LIMITS.monthlyWrites - 2)
    const reads = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => i % 2 ? f.bucket.get(key) : f.bucket.head(key)))
    assert.equal(reads.filter(r => r.status === 'fulfilled').length, 3)
    assert.equal(f.calls.reads, 3)
    const writes = await Promise.allSettled(Array.from({ length: 20 }, () => f.bucket.put(key, new Uint8Array(5))))
    assert.equal(writes.filter(r => r.status === 'fulfilled').length, 2)
    assert.equal(f.calls.writes, 2)
    assert.equal(f.sqlite.prepare('SELECT reserved_objects FROM image_storage_usage').get()?.reserved_objects, 2)
    assert.deepEqual({ ...f.sqlite.prepare('SELECT reads,writes FROM image_request_usage WHERE month=?').get(month) }, { reads: IMAGE_LIMITS.monthlyReads, writes: IMAGE_LIMITS.monthlyWrites })
  } finally { f.sqlite.close() }
})

test('lifetime byte and object reservations count failures and cannot be refunded through deletion', async () => {
  const f = await fixture()
  try {
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_bytes=?, reserved_objects=?').run(IMAGE_LIMITS.storageBytes - 8, IMAGE_LIMITS.objects - 2)
    f.fail()
    await assert.rejects(f.bucket.put(key, new Uint8Array(8)), /provider failure/)
    await assert.rejects(f.bucket.put(key, new Uint8Array(1)), /ausgeschöpft/)
    assert.equal(f.calls.writes, 1)
    await f.bucket.delete(key)
    assert.equal(f.sqlite.prepare('SELECT reserved_bytes FROM image_storage_usage').get()?.reserved_bytes, IMAGE_LIMITS.storageBytes)
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_bytes=0,reserved_objects=?').run(IMAGE_LIMITS.objects)
    await assert.rejects(f.bucket.put(key, new Uint8Array(1)), /ausgeschöpft/)
    assert.equal(f.calls.writes, 1)
  } finally { f.sqlite.close() }
})

test('database failures, missing singleton, unsafe keys and unbudgeted methods fail closed; monthly rollover is explicit', async () => {
  const f = await fixture()
  try {
    for (const invalid of ['other/object.png', 'forms-images/../object.png', 'forms-images/anything.png']) await assert.rejects(f.bucket.get(invalid))
    await assert.rejects(f.bucket.put(key, new Uint8Array(IMAGE_LIMITS.fileBytes + 1)))
    await assert.rejects(f.bucket.put(key, 'unbounded stream'))
    assert.throws(() => f.bucket.list(), /gesperrt/)
    assert.throws(() => f.bucket.createMultipartUpload(key), /gesperrt/)
    f.sqlite.exec('DELETE FROM image_storage_usage')
    await assert.rejects(f.bucket.put(key, new Uint8Array(1)))
    assert.equal(f.calls.writes, 0)
    f.sqlite.exec('DROP TABLE image_request_usage')
    await assert.rejects(f.bucket.get(key))
    assert.equal(f.calls.reads, 0)
  } finally { f.sqlite.close() }
  const fresh = await fixture()
  try {
    fresh.sqlite.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,?,0)').run('2026-10', IMAGE_LIMITS.monthlyReads)
    await assert.rejects(reserveImageOperation(fresh.db, 'reads', new Date('2026-10-31T23:59:59Z')))
    await reserveImageOperation(fresh.db, 'reads', new Date('2026-11-01T00:00:00Z'))
    assert.equal(fresh.sqlite.prepare("SELECT reads FROM image_request_usage WHERE month='2026-11'").get()?.reads, 1)
  } finally { fresh.sqlite.close() }
})
