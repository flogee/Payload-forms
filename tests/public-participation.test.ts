import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'
import { guardPublicParticipation, publicRequestKind } from '../src/auth/public-participation'
import { reservePublicRequest } from '../src/survey/public-budget'
import { PUBLIC_LIMITS } from '../src/survey/public-limits'
import { boundedBody, BodyTooLarge } from '../src/survey/bounded-body'
import { verifyPublicConfig } from '../scripts/check-public-config.mjs'
import { readFileSync } from 'node:fs'
import { notificationFixture, notificationNow } from './notification-fixture'
import { checkBudgetAlerts, budgetAlertMessage } from '../src/survey/budget-alerts'

async function fixture() {
  const sqlite = new DatabaseSync(':memory:'), dialect = new SQLiteSyncDialect()
  for (const migration of migrations) await migration.up({ db: { run: async (s: any) => sqlite.exec(dialect.sqlToQuery(s).sql) } } as any)
  let calls = 0
  const db = { prepare(sql: string) { calls++; return { bind(...values: any[]) { return { async run() {
    const result = sqlite.prepare(sql).run(...values)
    return { success: true, meta: { changes: Number(result.changes) } }
  } } } } } } as unknown as D1Database
  const env = { PUBLIC_GUARD_ENABLED: '1', D1: db,
    PUBLIC_IP_RATE: { limit: async () => ({ success: true }) } as any,
    PUBLIC_TOTAL_RATE: { limit: async () => ({ success: true }) } as any }
  return { sqlite, db, env, calls: () => calls }
}

test('public routes are narrowly classified; private data and administration never enter the public budget', () => {
  for (const path of ['/f/demo', '/f/demo/', '/f/demo/images/1', '/datenschutz/demo']) assert.equal(publicRequestKind(path), 'participation')
  assert.equal(publicRequestKind('/api/survey/submit'), 'submissions')
  assert.equal(publicRequestKind('/_next/static/chunks/a.js'), 'static')
  for (const path of ['/f/demo/api/users', '/f/%2fadmin', '/datenschutz/demo/extra', '/api/survey/submit/extra']) assert.equal(publicRequestKind(path), 'invalid')
  for (const path of ['/admin', '/api/surveys', '/api/responses', '/api/mcp', '/antwort/a', '/auswertung', '/', '/_next/image']) assert.equal(publicRequestKind(path), undefined)
})

test('concurrent requests on both hosts stop at the shared budget before handler work; attempts and failed calls are not refunded', async () => {
  const f = await fixture(), month = new Date().toISOString().slice(0, 7)
  try {
    f.sqlite.prepare('INSERT INTO public_request_usage(month,reads,submissions) VALUES(?,?,?)').run(month, PUBLIC_LIMITS.reads - 2, PUBLIC_LIMITS.submissions - 1)
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => guardPublicParticipation(new Request(`https://${i % 2 ? 'forms.example.net' : 'forms.example.org'}/f/demo`), f.env)))
    assert.equal(responses.filter(r => !r).length, 2)
    assert.equal(responses.filter(r => r?.status === 429).length, 18)
    assert.equal(await reservePublicRequest(f.db, 'submissions'), true)
    assert.equal(await reservePublicRequest(f.db, 'submissions'), false)
    const usage = f.sqlite.prepare('SELECT reads,submissions FROM public_request_usage').get()!
    assert.equal(usage.reads, PUBLIC_LIMITS.reads); assert.equal(usage.submissions, PUBLIC_LIMITS.submissions)
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM budget_alerts WHERE level=\'blocked\'').get()?.n, 2)
    assert.equal(await guardPublicParticipation(new Request('https://forms.example.net/admin'), f.env), undefined)
  } finally { f.sqlite.close() }
})

test('rate checks, method/content/size validation and static assets bypass costly DB work; limiter errors fail closed', async () => {
  const f = await fixture()
  try {
    assert.equal((await guardPublicParticipation(new Request('https://example.org/f/demo', { method: 'POST' }), f.env))?.status, 405)
    assert.equal((await guardPublicParticipation(new Request('https://example.org/api/survey/submit', { method: 'POST' }), f.env))?.status, 415)
    assert.equal((await guardPublicParticipation(new Request('https://example.org/api/survey/submit', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '100001' } }), f.env))?.status, 413)
    assert.equal(await guardPublicParticipation(new Request('https://example.org/_next/static/chunks/a.js'), f.env), undefined)
    f.env.PUBLIC_IP_RATE.limit = async () => ({ success: false })
    const rate = await guardPublicParticipation(new Request('https://example.org/f/demo'), f.env)
    assert.equal(rate?.status, 429); assert.equal(rate?.headers.get('retry-after'), '60')
    await guardPublicParticipation(new Request('https://example.org/f/demo'), f.env)
    assert.equal(f.calls(), 1, 'a rate-blocked burst records one warning without reading or incrementing participation usage')
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM budget_alerts WHERE metric='rate'").get()?.n, 1)
    f.env.PUBLIC_IP_RATE.limit = async () => { throw Error('secret provider detail') }
    const failure = await guardPublicParticipation(new Request('https://example.org/f/demo'), f.env)
    assert.equal(failure?.status, 503); assert.doesNotMatch(await failure!.text(), /secret/)
    assert.equal(f.calls(), 1)
  } finally { f.sqlite.close() }
})

test('missing budget table blocks participation and HTML communicates recovery; UTC month rollover creates a fresh bounded quota', async () => {
  const f = await fixture()
  try {
    f.sqlite.prepare('INSERT INTO public_request_usage(month,reads,submissions) VALUES(?,?,0)').run('2026-10', PUBLIC_LIMITS.reads)
    assert.equal(await reservePublicRequest(f.db, 'participation', new Date('2026-10-31T23:59:59Z')), false)
    assert.equal(await reservePublicRequest(f.db, 'participation', new Date('2026-11-01T00:00:00Z')), true)
    f.sqlite.exec('DROP TABLE public_request_usage')
    const blocked = await guardPublicParticipation(new Request('https://example.org/f/demo', { headers: { accept: 'text/html' } }), f.env)
    assert.equal(blocked?.status, 503); assert.equal(blocked?.headers.get('cache-control'), 'private, no-store')
    assert.match(await blocked!.text(), /Formularverwaltung kontaktieren/)
    assert.equal(await guardPublicParticipation(new Request('https://example.org/antwort/a'), f.env), undefined)
  } finally { f.sqlite.close() }
})

test('streamed bodies are bounded in bytes without trusting content-length and reject invalid UTF-8', async () => {
  const req = (stream: ReadableStream<Uint8Array>, headers?: HeadersInit) => new Request('https://example.org/api/survey/submit', { method: 'POST', body: stream, duplex: 'half', headers } as any)
  const bytes = new TextEncoder().encode('ä'.repeat(10))
  assert.equal(await boundedBody(req(new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } })), 20), 'ä'.repeat(10))
  let cancelled = false
  await assert.rejects(boundedBody(req(new ReadableStream({ start(c) { c.enqueue(bytes); c.enqueue(bytes) }, cancel() { cancelled = true } }), { 'content-length': '1' }), 20), BodyTooLarge)
  assert.equal(cancelled, true)
  await assert.rejects(boundedBody(req(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([255])); c.close() } }))), TypeError)
})

test('public quota warnings use the existing deduplicated monitor and reserved mail budget', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('INSERT INTO public_request_usage(month,reads,submissions) VALUES(?,?,?)').run('2026-10', PUBLIC_LIMITS.reads * .8, PUBLIC_LIMITS.submissions)
    await checkBudgetAlerts(f.db, {}, notificationNow); await checkBudgetAlerts(f.db, {}, notificationNow)
    const rows = f.sqlite.prepare("SELECT metric,level FROM budget_alerts WHERE metric IN ('participation','submissions') ORDER BY metric").all()
    assert.deepEqual(rows.map(r => ({ ...r })), [{ metric: 'participation', level: 'warning' }, { metric: 'submissions', level: 'blocked' }])
    const message = budgetAlertMessage('forms@example.org', 'notify@localhost.invalid', 'https://example.org', { metric: 'submissions', level: 'blocked', period: '2026-10', used: PUBLIC_LIMITS.submissions, quota_limit: PUBLIC_LIMITS.submissions })
    assert.match(message.text, /Tab offen halten/); assert.match(message.text, /Backend/)
  } finally { f.sqlite.close() }
})

test('release configuration cannot disable or weaken the public safeguards', () => {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8')).env.internal
  verifyPublicConfig(config)
  for (const mutate of [(c: any) => { c.vars.PUBLIC_GUARD_ENABLED = '0' }, (c: any) => { c.ratelimits[0].simple.limit++ }, (c: any) => { c.ratelimits.pop() }]) {
    const copy = structuredClone(config); mutate(copy); assert.throws(() => verifyPublicConfig(copy))
  }
})
