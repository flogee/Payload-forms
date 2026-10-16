import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationFixture, notificationNow as now } from './notification-fixture'
import { budgetAlertStatus, checkBudgetAlerts, dispatchBudgetAlerts } from '../src/survey/budget-alerts'
import { dispatchNotifications } from '../src/survey/notification-dispatch'
import { mailPolicy, type MailEnvironment } from '../src/survey/notifications'
import { budgetedImageBucket, IMAGE_LIMITS } from '../src/survey/image-budget'
import { BudgetAlerts, BudgetAlertMonitor } from '../src/collections/BudgetAlerts'

const env = (send: NonNullable<MailEnvironment['EMAIL']>['send'], extra: Partial<MailEnvironment> = {}): MailEnvironment => ({
  EMAIL: { send }, MAIL_ENABLED: '1', MAIL_FROM: 'forms@example.org', MAIL_ORIGIN: 'https://forms.example.org', SURVEY_ORIGINS: 'https://forms.example.org',
  MAIL_ALLOWED_RECIPIENTS: 'notify@localhost.invalid', OPS_ALERT_RECIPIENT: 'notify@localhost.invalid', MAIL_MONTHLY_LIMIT: '500', ...extra,
})
const accepted = async () => ({ messageId: 'accepted' })

test('80% warnings are durable, bounded and concurrent dispatch sends each warning only once', async () => {
  const f = await notificationFixture()
  try {
    await dispatchBudgetAlerts(f.db, env(accepted), now)
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM budget_alerts').get()?.n, 0)
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_objects=?').run(Math.ceil(IMAGE_LIMITS.objects * 0.8))
    f.sqlite.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,?,0)').run('2026-10', IMAGE_LIMITS.monthlyReads * 0.8)
    const messages: any[] = []
    const settings = env(async message => { messages.push(message); await new Promise(resolve => setTimeout(resolve, 2)); return { messageId: 'accepted' } })
    await Promise.all([dispatchBudgetAlerts(f.db, settings, now), dispatchBudgetAlerts(f.db, settings, now)])
    assert.equal(messages.length, 2)
    assert.ok(messages.every(message => message.to === 'notify@localhost.invalid' && message.text.includes('/admin/collections/media') && !message.text.includes('Never include')))
    await dispatchBudgetAlerts(f.db, settings, now)
    assert.equal(messages.length, 2)
    const status = await budgetAlertStatus(f.db, settings, now)
    assert.equal(status.configured, true); assert.equal(status.stale, false)
    assert.ok(status.alerts.every(alert => alert.status === 'sent'))
  } finally { f.sqlite.close() }
})

test('an upload that cannot fit queues one critical warning before R2; smaller uploads remain possible', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_bytes=?').run(IMAGE_LIMITS.storageBytes - 8)
    f.sqlite.prepare("INSERT INTO budget_alerts(alert_key,metric,period,level,used,quota_limit,status,attempts,next_attempt_at,created_at,updated_at) VALUES('storage:lifetime:warning','storage','lifetime','warning',?,?, 'pending',0,?,?,?)").run(IMAGE_LIMITS.storageBytes - 8, IMAGE_LIMITS.storageBytes, now.toISOString(), now.toISOString(), now.toISOString())
    const d1 = { prepare(sql: string) { return { bind(...values: any[]) { return { async run() {
      const result = f.sqlite.prepare(sql).run(...values)
      return { success: true, meta: { changes: Number(result.changes) } }
    } } } } } } as unknown as D1Database
    let writes = 0
    const bucket = budgetedImageBucket({ async put(): Promise<null> { writes++; return null } } as unknown as R2Bucket, d1)
    const key = 'forms-images/00000000-0000-4000-8000-000000000001.png'
    await Promise.all(Array.from({ length: 5 }, () => assert.rejects(bucket.put(key, new Uint8Array(9)), /ausgeschöpft/)))
    assert.equal(writes, 0)
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM budget_alerts WHERE level='blocked'").get()?.n, 1)
    let sent = 0
    await dispatchBudgetAlerts(f.db, env(async () => { sent++; return { messageId: 'accepted' } }), new Date())
    assert.equal(sent, 1, 'critical warning supersedes pending 80% warning')
    assert.equal(f.sqlite.prepare("SELECT status FROM budget_alerts WHERE level='warning'").get()?.status, 'superseded')
    await bucket.put(key, new Uint8Array(1))
    assert.equal(writes, 1)
  } finally { f.sqlite.close() }
})

test('routine mail stops at 460 attempts while urgent warnings use the reserved capacity within 500', async () => {
  const f = await notificationFixture()
  try {
    await f.save()
    f.sqlite.prepare('INSERT INTO email_usage(month,attempts,created_at,updated_at) VALUES(?,?,?,?)').run('2026-10', 460, now.toISOString(), now.toISOString())
    let sent = 0
    const settings = env(async () => { sent++; return { messageId: 'accepted' } })
    await dispatchNotifications(f.db, settings, now)
    assert.equal(sent, 0)
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications').get()?.status, 'pending')
    await dispatchBudgetAlerts(f.db, settings, now)
    assert.equal(sent, 1)
    assert.equal(f.sqlite.prepare('SELECT attempts FROM email_usage').get()?.attempts, 461)
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_objects=?').run(IMAGE_LIMITS.objects)
    f.sqlite.exec('UPDATE email_usage SET attempts=500')
    await dispatchBudgetAlerts(f.db, settings, now)
    assert.equal(sent, 1)
    assert.equal(f.sqlite.prepare("SELECT status FROM budget_alerts WHERE metric='objects'").get()?.status, 'pending')
    assert.equal(mailPolicy(settings).routineLimit, 460)
  } finally { f.sqlite.close() }
})

test('only definite throttling retries, at most three attempts; timeouts and provider failures surface safely', async () => {
  for (const mode of ['retry', 'permanent', 'uncertain', 'timeout']) {
    const f = await notificationFixture()
    try {
      f.sqlite.prepare('UPDATE image_storage_usage SET reserved_objects=?').run(IMAGE_LIMITS.objects)
      let calls = 0
      const settings = env(async () => {
        calls++
        if (mode === 'timeout') return new Promise(() => {})
        throw Object.assign(new Error('PRIVATE PROVIDER DATA'), { code: mode === 'retry' ? 'E_RATE_LIMIT_EXCEEDED' : mode === 'permanent' ? 'E_RECIPIENT_NOT_ALLOWED' : 'UNEXPECTED_SECRET' })
      })
      for (const offset of [0, 0, 300000, 900000, 1800000]) await dispatchBudgetAlerts(f.db, settings, new Date(now.getTime() + offset), 5)
      assert.equal(calls, mode === 'retry' ? 3 : 1)
      const alert = f.sqlite.prepare('SELECT * FROM budget_alerts').get()!
      assert.equal(alert.status, ['retry', 'permanent'].includes(mode) ? 'failed' : 'uncertain')
      assert.ok(!JSON.stringify(alert).includes('PRIVATE') && !JSON.stringify(alert).includes('UNEXPECTED_SECRET'))
    } finally { f.sqlite.close() }
  }
})

test('monthly rollover renews deduplication, supersedes stale jobs and preserves lifetime warning keys', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_objects=?').run(IMAGE_LIMITS.objects)
    f.sqlite.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,?,0)').run('2026-10', IMAGE_LIMITS.monthlyReads)
    await checkBudgetAlerts(f.db, env(accepted), now)
    const next = new Date('2026-11-01T00:00:01Z')
    f.sqlite.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,?,0)').run('2026-11', IMAGE_LIMITS.monthlyReads)
    let sent = 0
    await dispatchBudgetAlerts(f.db, env(async () => { sent++; return { messageId: 'accepted' } }), next)
    assert.equal(sent, 2)
    assert.equal(f.sqlite.prepare("SELECT status FROM budget_alerts WHERE period='2026-10'").get()?.status, 'superseded')
    await checkBudgetAlerts(f.db, env(accepted), new Date('2027-03-01T00:00:00Z'))
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM budget_alerts WHERE period='lifetime'").get()?.n, 1)
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM budget_alerts WHERE period='2026-10'").get()?.n, 0)
  } finally { f.sqlite.close() }
})

test('missing configuration, overdue checks and interrupted sends are visible without repeated messages', async () => {
  const f = await notificationFixture()
  try {
    const settings = env(accepted, { OPS_ALERT_RECIPIENT: 'unregistered@example.invalid' })
    assert.equal((await budgetAlertStatus(f.db, settings, now)).stale, true)
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_objects=?').run(IMAGE_LIMITS.objects)
    await dispatchBudgetAlerts(f.db, settings, now)
    assert.equal((await budgetAlertStatus(f.db, settings, now)).configured, false)
    assert.equal(f.sqlite.prepare('SELECT attempts FROM budget_alerts').get()?.attempts, 0)
    f.sqlite.prepare("UPDATE budget_alerts SET status='sending', claimed_at=?").run(now.toISOString())
    const later = new Date(now.getTime() + 16 * 60000)
    assert.equal((await budgetAlertStatus(f.db, settings, later)).stale, true)
    await dispatchBudgetAlerts(f.db, env(async () => { throw new Error('must not replay crashed send') }), later)
    assert.equal(f.sqlite.prepare('SELECT status FROM budget_alerts').get()?.status, 'uncertain')
  } finally { f.sqlite.close() }
})

test('operational state cannot be reset by team, MCP or local API overrides', async () => {
  for (const collection of [BudgetAlerts, BudgetAlertMonitor]) {
    for (const operation of ['create', 'update', 'delete'] as const) {
      assert.equal((collection.access![operation] as Function)(), false)
      assert.throws(() => (collection.hooks!.beforeOperation![0] as Function)({ operation, args: { overrideAccess: true } }), /atomar/)
    }
  }
})

test('failed blocked-event capture remains fail closed and the durable headroom check recovers its critical warning', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_bytes=?').run(IMAGE_LIMITS.storageBytes - 8)
    const d1 = { prepare(sql: string) { return { bind(...values: any[]) { return { async run() {
      if (sql.startsWith('INSERT INTO budget_alerts')) throw new Error('temporary event capture failure')
      const result = f.sqlite.prepare(sql).run(...values)
      return { success: true, meta: { changes: Number(result.changes) } }
    } } } } } } as unknown as D1Database
    let writes = 0
    const bucket = budgetedImageBucket({ async put(): Promise<null> { writes++; return null } } as unknown as R2Bucket, d1)
    await assert.rejects(bucket.put('forms-images/00000000-0000-4000-8000-000000000001.png', new Uint8Array(9)), /Warnhinweis konnte nicht gespeichert/)
    assert.equal(writes, 0)
    let sent = 0
    await dispatchBudgetAlerts(f.db, env(async message => { sent++; assert.ok(message.subject.includes('begrenzt')); return { messageId: 'accepted' } }), now)
    assert.equal(sent, 1)
    assert.equal(f.sqlite.prepare('SELECT level,status FROM budget_alerts').get()?.level, 'blocked')
  } finally { f.sqlite.close() }
})

test('concurrent routine and operational claims preserve both monthly boundaries', async () => {
  const f = await notificationFixture()
  try {
    await f.save(); await f.save()
    f.sqlite.prepare('INSERT INTO email_usage(month,attempts,created_at,updated_at) VALUES(?,?,?,?)').run('2026-10', 459, now.toISOString(), now.toISOString())
    f.sqlite.prepare('UPDATE image_storage_usage SET reserved_objects=?').run(IMAGE_LIMITS.objects)
    let calls = 0
    const settings = env(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 2)); return { messageId: 'accepted' } })
    await Promise.all([dispatchNotifications(f.db, settings, now), dispatchBudgetAlerts(f.db, settings, now), dispatchNotifications(f.db, settings, now)])
    assert.ok(calls >= 1 && calls <= 3)
    assert.ok(Number(f.sqlite.prepare('SELECT attempts FROM email_usage').get()?.attempts) <= 462)
    assert.ok(Number(f.sqlite.prepare("SELECT count(*) AS n FROM response_notifications WHERE status='sent'").get()?.n) <= 1)
    const acceptedBefore = Number(f.sqlite.prepare("SELECT count(*) AS n FROM budget_alerts WHERE status='sent'").get()?.n)
    f.sqlite.exec('UPDATE email_usage SET attempts=499')
    f.sqlite.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,?,?)').run('2026-10', IMAGE_LIMITS.monthlyReads, IMAGE_LIMITS.monthlyWrites)
    await Promise.all([dispatchBudgetAlerts(f.db, settings, now), dispatchBudgetAlerts(f.db, settings, now), dispatchNotifications(f.db, settings, now)])
    assert.equal(f.sqlite.prepare('SELECT attempts FROM email_usage').get()?.attempts, 500)
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM budget_alerts WHERE status='sent'").get()?.n, acceptedBefore + 1)
  } finally { f.sqlite.close() }
})

test('an overlapping older-month check cannot cancel a newer-month warning or move the heartbeat backwards', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('INSERT INTO image_request_usage(month,reads,writes) VALUES(?,?,0)').run('2026-11', IMAGE_LIMITS.monthlyReads)
    const newer = new Date('2026-11-01T00:00:01Z')
    await checkBudgetAlerts(f.db, env(accepted), newer)
    await checkBudgetAlerts(f.db, env(accepted), new Date('2026-10-31T23:59:59Z'))
    assert.equal(f.sqlite.prepare("SELECT status FROM budget_alerts WHERE period='2026-11'").get()?.status, 'pending')
    assert.equal((await budgetAlertStatus(f.db, env(accepted), newer)).checkedAt, newer.toISOString())
  } finally { f.sqlite.close() }
})
