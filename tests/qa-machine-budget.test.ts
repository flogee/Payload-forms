import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationFixture, notificationNow as now } from './notification-fixture'
import { reserveQAMachineRequest, recordQAMachineRateBlock, qaBudgetAlerts } from '../src/survey/qa-machine-budget'
import { QA_MACHINE_LIMITS as limits } from '../src/survey/qa-machine-limits'
import { budgetSnapshot, budgetAlertStatus, checkBudgetAlerts, dispatchBudgetAlerts, qaUsageStatus } from '../src/survey/budget-alerts'
import { QAMachineUsage } from '../src/collections/QAMachineUsage'
import { migrations } from '../src/migrations'

const a = '20000000-0000-4000-8000-000000000001', b = '20000000-0000-4000-8000-000000000002'
const month = now.toISOString().slice(0, 7)

test('client report and request reservations are atomic, scoped and never refunded; other actions remain available', async () => {
  const f = await notificationFixture()
  try {
    assert.throws(() => f.sqlite.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,?,?)').run(a, month, 30, limits.client.reports - 1), /CHECK constraint/)
  } finally { f.sqlite.close() }
  const g = await notificationFixture()
  try {
    g.sqlite.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,?,?)').run(a, month, 80, limits.client.reports - 1)
    g.sqlite.prepare("INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES('installation',?,?,?)").run(month, 80, limits.client.reports - 1)
    const attempts = await Promise.all(Array.from({ length: 12 }, () => reserveQAMachineRequest(g.db, a, true, now)))
    assert.equal(attempts.filter(Boolean).length, 1)
    assert.equal(g.sqlite.prepare('SELECT reports FROM qa_machine_usage WHERE scope=?').get(a)?.reports, limits.client.reports)
    assert.equal(g.sqlite.prepare('SELECT requests FROM qa_machine_usage WHERE scope=?').get(a)?.requests, 81)
    assert.equal(await reserveQAMachineRequest(g.db, a, false, now), true, 'report cap does not block participation/ensure')
    assert.equal(await reserveQAMachineRequest(g.db, b, true, now), true, 'another client retains its report quota')
    assert.equal(g.sqlite.prepare("SELECT requests FROM qa_machine_usage WHERE scope='installation'").get()?.requests, 83)
    g.sqlite.prepare('UPDATE qa_machine_usage SET requests=? WHERE scope=?').run(limits.client.requests, a)
    assert.equal(await reserveQAMachineRequest(g.db, a, false, now), false)
    assert.equal(g.sqlite.prepare("SELECT requests FROM qa_machine_usage WHERE scope='installation'").get()?.requests, 83, 'denied work spends neither counter')
  } finally { g.sqlite.close() }
})

test('installation caps span clients/hosts and UTC rollover does not reset previous reservations', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare("INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES('installation',?,?,0)").run(month, limits.installation.requests - 2)
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => reserveQAMachineRequest(f.db, index % 2 ? a : b, false, now)))
    assert.equal(attempts.filter(Boolean).length, 2)
    assert.equal(f.sqlite.prepare("SELECT requests FROM qa_machine_usage WHERE scope='installation'").get()?.requests, limits.installation.requests)
    assert.equal(f.sqlite.prepare("SELECT sum(requests) n FROM qa_machine_usage WHERE scope <> 'installation'").get()?.n, 2)
    assert.equal(await reserveQAMachineRequest(f.db, a, false, new Date('2026-11-01T00:00:00Z')), true)
    assert.equal(f.sqlite.prepare("SELECT requests FROM qa_machine_usage WHERE scope='installation' AND month=?").get(month)?.requests, limits.installation.requests)
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM budget_alerts WHERE metric='qaRequests' AND scope='installation' AND level='blocked'").get()?.n, 1)
  } finally { f.sqlite.close() }
})

test('QA warnings recover from usage, separate client scopes and reuse bounded operational mail/status', async () => {
  const f = await notificationFixture()
  try {
    for (const [scope, requests] of [[a, 500], [b, 400], ['installation', 900]] as const) f.sqlite.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,?,0)').run(scope, month, requests)
    await checkBudgetAlerts(f.db, {}, now); await checkBudgetAlerts(f.db, {}, now)
    const alerts = f.sqlite.prepare("SELECT scope,level,status FROM budget_alerts WHERE metric='qaRequests' ORDER BY scope").all()
    assert.equal(alerts.length, 2)
    assert.equal(alerts[0].level, 'blocked'); assert.equal(alerts[1].level, 'warning')
    assert.equal(alerts[1].status, 'pending', 'A blocked must not supersede B warning')
    const snapshot = await budgetSnapshot(f.db, now)
    assert.equal(snapshot.qa.length, 3); assert.equal(qaUsageStatus(snapshot.qa).find(row => row.scope === a)?.requests.limit, 500)
    assert.equal(qaUsageStatus([])[0].requests.used, 0)
    const messages: any[] = []
    const env = { EMAIL: { send: async (message: any) => { messages.push(message); return { messageId: 'accepted-not-delivered' } } },
      MAIL_ENABLED: '1', MAIL_FROM: 'forms@example.org', MAIL_ORIGIN: 'https://forms.example.org', SURVEY_ORIGINS: 'https://forms.example.org',
      MAIL_ALLOWED_RECIPIENTS: 'notify@localhost.invalid', OPS_ALERT_RECIPIENT: 'notify@localhost.invalid', MAIL_MONTHLY_LIMIT: '500' }
    f.sqlite.prepare('INSERT INTO email_usage(month,attempts) VALUES(?,460)').run(month)
    await Promise.all([dispatchBudgetAlerts(f.db, env, now), dispatchBudgetAlerts(f.db, env, now)])
    assert.equal(messages.length, 3, 'QA two + routine mail threshold warning, each once')
    assert.equal(f.sqlite.prepare('SELECT attempts FROM email_usage WHERE month=?').get(month)?.attempts, 463)
    assert.ok(messages.some(message => message.subject.includes(a)))
    assert.ok(messages.every(message => !message.text.includes('Never include')))
    const status = await budgetAlertStatus(f.db, env, now)
    assert.equal(status.stale, false); assert.ok(status.alerts.some(alert => alert.scope === b && alert.status === 'sent'))
  } finally { f.sqlite.close() }
})

test('installation report exhaustion stops all clients but not other QA actions', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare("INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES('installation',?,?,?)").run(month, limits.installation.reports - 1, limits.installation.reports - 1)
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => reserveQAMachineRequest(f.db, index % 2 ? a : b, true, now)))
    assert.equal(attempts.filter(Boolean).length, 1)
    assert.equal(f.sqlite.prepare("SELECT reports FROM qa_machine_usage WHERE scope='installation'").get()?.reports, limits.installation.reports)
    assert.equal(f.sqlite.prepare("SELECT sum(reports) n FROM qa_machine_usage WHERE scope <> 'installation'").get()?.n, 1)
    assert.equal(await reserveQAMachineRequest(f.db, a, false, now), true)
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM budget_alerts WHERE metric='qaReports' AND scope='installation' AND level='blocked'").get()?.n, 1)
  } finally { f.sqlite.close() }
})

test('concurrent failed rate-warning capture is remembered without repeat writes or a false successful retry', async () => {
  const f = await notificationFixture()
  try {
    let attempts = 0
    const unavailable = { ...f.db, async batch(): Promise<never> { attempts++; throw new Error('private rate event failure') } }
    const calls = await Promise.allSettled(Array.from({ length: 10 }, () => recordQAMachineRateBlock(unavailable, a, now)))
    assert.ok(calls.every(call => call.status === 'rejected')); assert.equal(attempts, 1)
    await assert.rejects(recordQAMachineRateBlock(unavailable, a, now)); assert.equal(attempts, 1)
    await assert.rejects(recordQAMachineRateBlock(unavailable, a, new Date('2026-11-01T00:00:00Z'))); assert.equal(attempts, 2)
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM budget_alerts').get()?.n, 0, 'never claim a queued warning after failed capture')
  } finally { f.sqlite.close() }
})

test('malformed persisted scopes and unsafe counters fail closed without fabricated budget status', async () => {
  const f = await notificationFixture()
  try {
    assert.throws(() => qaBudgetAlerts([{ scope: 'unapproved-scope', requests: 1, reports: 0 }], now), /Kontingentbereich/)
    assert.throws(() => qaBudgetAlerts([{ scope: a, requests: Number.MAX_SAFE_INTEGER + 1, reports: 0 }], now), /Kontingentstand/)
    f.sqlite.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,9007199254740992,0)').run(a, month)
    // Native node:sqlite can reject an unsafe integer before it reaches the
    // application validator; both adapters must refuse it rather than round.
    await assert.rejects(reserveQAMachineRequest(f.db, a, false, now), /Kontingentstand|too large to be represented/)
    await assert.rejects(budgetSnapshot(f.db, now), /Kontingentstand|too large to be represented/)
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM budget_alerts').get()?.n, 0)
  } finally { f.sqlite.close() }
})

test('failed alert recording stays fail closed without refund, while periodic inspection recovers it', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,399,0)').run(a, month)
    const failing = { ...f.db, async batch(statements: any[]) {
      if (statements.some(s => s.sql.includes('INSERT INTO budget_alerts'))) throw new Error('private warning capture failure')
      return f.db.batch(statements)
    } }
    await assert.rejects(reserveQAMachineRequest(failing, a, false, now), /warning capture/)
    assert.equal(f.sqlite.prepare('SELECT requests FROM qa_machine_usage WHERE scope=?').get(a)?.requests, 400)
    await checkBudgetAlerts(f.db, {}, now)
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM budget_alerts WHERE scope=? AND metric='qaRequests'").get(a)?.n, 1)
    for (const operation of ['create', 'update', 'delete'] as const) {
      assert.equal((QAMachineUsage.access![operation] as Function)(), false)
      assert.throws(() => (QAMachineUsage.hooks!.beforeOperation![0] as Function)({ operation, args: { overrideAccess: true } }), /atomar/)
    }
    await assert.rejects(migrations.at(-1)!.down({} as any), /Rückbau.*gesperrt/)
  } finally { f.sqlite.close() }
})
