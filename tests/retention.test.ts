import test from 'node:test'
import assert from 'node:assert/strict'
import { retentionReviewDueAt, retentionWindow } from '../src/survey/retention-policy'
import { dispatchRetentionReminders, retentionSummary, reminderClaimStatements } from '../src/survey/retention-reminders'
import { notificationFixture, notificationNow } from './notification-fixture'
import { saveSubmission } from '../src/survey/response-store'
import type { MailEnvironment } from '../src/survey/notifications'

const env = (send: NonNullable<MailEnvironment['EMAIL']>['send']): MailEnvironment => ({
  EMAIL: { send }, MAIL_ENABLED: '1', MAIL_FROM: 'forms@example.invalid', MAIL_ORIGIN: 'http://127.0.0.1:3213',
  MAIL_LOCAL_TEST: '1', SURVEY_ORIGIN: 'http://127.0.0.1:3213', MAIL_ALLOWED_RECIPIENTS: 'notify@localhost.invalid', OPS_ALERT_RECIPIENT: 'notify@localhost.invalid', MAIL_MONTHLY_LIMIT: '500',
})

async function fixture(deadlines: (string | null)[] = []) {
  const f = await notificationFixture()
  f.sqlite.exec('UPDATE surveys SET retention_reminders_enabled = 1, privacy_retention_years = 3 WHERE id = 1')
  for (const deadline of deadlines) {
    const saved = await saveSubmission(f.db, { ...f.input(), notificationRecipients: [] })
    assert.equal(saved.state, 'saved')
    if (saved.state === 'saved') f.sqlite.prepare('UPDATE responses SET retention_review_due_at = ? WHERE id = ?').run(deadline, saved.id)
  }
  return f
}

test('retention uses UTC calendar years, clamps leap day, and does not guess a disabled policy', () => {
  assert.equal(retentionReviewDueAt('2024-02-29T23:59:59.123Z', 3), '2027-02-28T23:59:59.123Z')
  assert.equal(retentionReviewDueAt('2024-02-29T23:59:59.123Z', 4), '2028-02-29T23:59:59.123Z')
  assert.equal(retentionReviewDueAt('2026-12-31T01:02:03.000Z', 3), '2029-12-31T01:02:03.000Z')
  assert.equal(retentionReviewDueAt('2026-10-08T13:00:00.000Z', 0), null)
  for (const years of [-1, 1.5, 21, NaN]) assert.throws(() => retentionReviewDueAt('2026-10-08', years))
  assert.throws(() => retentionReviewDueAt('invalid', 3))
  assert.equal(retentionWindow(new Date('2027-01-03T23:59:59Z')).period, '2026-12-28')
})

test('submission snapshots its deadline atomically and retries cannot move it', async () => {
  const f = await fixture()
  try {
    const input = { ...f.input(), retentionYears: 3 }
    await saveSubmission(f.db, input)
    const expected = retentionReviewDueAt(input.now, 3)
    assert.equal(f.sqlite.prepare('SELECT retention_review_due_at FROM responses').get()?.retention_review_due_at, expected)
    await saveSubmission(f.db, { ...input, now: '2028-01-01T00:00:00.000Z', retentionYears: 1 })
    assert.equal(f.sqlite.prepare('SELECT retention_review_due_at FROM responses').get()?.retention_review_due_at, expected)
  } finally { f.sqlite.close() }
})

test('weekly digest has exclusive boundary counts, no contents, and one atomic claim across competing cron runs', async () => {
  const now = notificationNow, day = 86400000
  const f = await fixture([now.toISOString(), new Date(+now + 30 * day).toISOString(),
    new Date(+now + 90 * day).toISOString(), new Date(+now + 91 * day).toISOString(), null])
  const messages: { text: string }[] = []
  const e = env(async message => { messages.push(message); return { messageId: 'fixture-accepted' } })
  try {
    await Promise.all([dispatchRetentionReminders(f.db, e, now), dispatchRetentionReminders(f.db, e, now)])
    assert.equal(messages.length, 1)
    assert.match(messages[0].text, /31 bis 90 Tagen: 1/)
    assert.match(messages[0].text, /nächsten 30 Tagen: 1/)
    assert.match(messages[0].text, /bereits erreicht: 1/)
    assert.ok(!messages[0].text.includes('Never include this answer'))
    assert.match(messages[0].text, /\/admin\/collections\/responses\?where\[survey\]\[equals\]=1/)
    const summary = await retentionSummary(f.db, 1, now)
    assert.deepEqual(summary.counts, { within90: 1, within30: 1, overdue: 1, unconfigured: 1 })
    assert.equal(summary.latest?.status, 'sent')
    assert.equal(summary.stale, false)
    assert.equal(summary.used, 1)
    await dispatchRetentionReminders(f.db, e, new Date(+now + 86400000))
    assert.equal(messages.length, 1)
    await dispatchRetentionReminders(f.db, e, new Date(+now + 7 * day))
    assert.equal(messages.length, 2, 'unresolved deadlines are reminded again the following UTC week')
  } finally { f.sqlite.close() }
})

test('shared mail budget reserves warning capacity and paused reminders resume only within their week', async () => {
  const f = await fixture([notificationNow.toISOString()])
  let sent = 0
  const e = env(async () => { sent++; return { messageId: 'fixture' } })
  try {
    f.sqlite.prepare('INSERT INTO email_usage (month,attempts) VALUES (?,460)').run('2026-10')
    await dispatchRetentionReminders(f.db, e, notificationNow)
    assert.equal(sent, 0)
    assert.equal((await retentionSummary(f.db, 1, notificationNow)).latest?.status, 'pending')
    assert.equal((await retentionSummary(f.db, 1, notificationNow)).used, 460)
    f.sqlite.prepare('UPDATE email_usage SET attempts = 459').run()
    await Promise.all([dispatchRetentionReminders(f.db, e, notificationNow), dispatchRetentionReminders(f.db, e, notificationNow)])
    assert.equal(sent, 1)
    assert.equal((await retentionSummary(f.db, 1, notificationNow)).used, 460)
    await dispatchRetentionReminders(f.db, e, new Date('2026-11-02T08:00:00Z'))
    assert.equal(sent, 2, 'new month gets a new budget; previous week is not replayed')
  } finally { f.sqlite.close() }
})

test('claim rechecks removals and settings before charging the mail budget', async () => {
  const f = await fixture([notificationNow.toISOString()])
  try {
    const e = env(async () => { throw new Error('must not send') })
    f.sqlite.prepare('INSERT INTO email_usage (month,attempts) VALUES (?,460)').run('2026-10')
    await dispatchRetentionReminders(f.db, e, notificationNow)
    const candidate = f.sqlite.prepare('SELECT * FROM retention_reminders').get() as any
    f.sqlite.exec('UPDATE surveys SET retention_reminders_enabled = 0; UPDATE email_usage SET attempts = 0')
    const { runBatch } = await import('../src/survey/response-store')
    const claim = await runBatch(f.db, reminderClaimStatements(candidate, 'claim-fixture', notificationNow, 460))
    assert.equal(claim[1].meta.changes, 0)
    assert.equal((await retentionSummary(f.db, 1, notificationNow)).used, 0)
    f.sqlite.exec('UPDATE surveys SET retention_reminders_enabled = 1; DELETE FROM responses')
    const removed = await runBatch(f.db, reminderClaimStatements(candidate, 'claim-fixture-2', notificationNow, 460))
    assert.equal(removed[1].meta.changes, 0)
    await dispatchRetentionReminders(f.db, e, notificationNow)
    assert.equal((await retentionSummary(f.db, 1, notificationNow)).latest?.status, 'cancelled')
  } finally { f.sqlite.close() }
})

test('definite throttling retries at most three times; uncertain sends and crashes never replay the weekly job', async () => {
  const f = await fixture([notificationNow.toISOString()])
  let attempts = 0
  const e = env(async () => { attempts++; throw { code: 'E_RATE_LIMIT_EXCEEDED' } })
  try {
    await dispatchRetentionReminders(f.db, e, notificationNow)
    await dispatchRetentionReminders(f.db, e, new Date(+notificationNow + 5 * 60000))
    await dispatchRetentionReminders(f.db, e, new Date(+notificationNow + 15 * 60000))
    assert.equal(attempts, 3)
    assert.equal((await retentionSummary(f.db, 1, notificationNow)).latest?.status, 'failed')
    await dispatchRetentionReminders(f.db, e, new Date(+notificationNow + 20 * 60000))
    assert.equal(attempts, 3)
    const nextWeek = new Date(+notificationNow + 7 * 86400000)
    await dispatchRetentionReminders(f.db, env(async () => { attempts++; throw new Error('unknown') }), nextWeek)
    assert.equal((await retentionSummary(f.db, 1, nextWeek)).latest?.status, 'uncertain')
    await dispatchRetentionReminders(f.db, e, new Date(+nextWeek + 60000))
    assert.equal(attempts, 4)
    f.sqlite.exec("UPDATE retention_reminders SET status = 'sending', claimed_at = '2026-01-01T00:00:00.000Z' WHERE period = '2026-10-12'")
    await dispatchRetentionReminders(f.db, e, nextWeek)
    assert.equal(attempts, 4)
    assert.equal((await retentionSummary(f.db, 1, nextWeek)).latest?.status, 'uncertain')
  } finally { f.sqlite.close() }
})

test('disabled or unavailable mail leaves current deadline counts visible without inventing legacy deadlines', async () => {
  const f = await fixture([null, notificationNow.toISOString()])
  try {
    await dispatchRetentionReminders(f.db, {}, notificationNow)
    const summary = await retentionSummary(f.db, 1, notificationNow)
    assert.equal(summary.counts.overdue, 1)
    assert.equal(summary.counts.unconfigured, 1)
    assert.equal(summary.latest, null)
    assert.equal(summary.used, 0)
    assert.equal(summary.stale, false)
    assert.equal((await retentionSummary(f.db, 1, new Date(+notificationNow + 16 * 60000))).stale, true)
  } finally { f.sqlite.close() }
})

test('an overlapping older-week invocation cannot cancel a newer-week reminder or move the check timestamp backwards', async () => {
  const f = await fixture([notificationNow.toISOString()])
  const newer = new Date(+notificationNow + 7 * 86400000)
  try {
    f.sqlite.prepare('INSERT INTO email_usage (month,attempts) VALUES (?,460)').run('2026-10')
    const e = env(async () => { throw new Error('must not send') })
    await dispatchRetentionReminders(f.db, e, newer)
    await dispatchRetentionReminders(f.db, e, notificationNow)
    const job = f.sqlite.prepare("SELECT status FROM retention_reminders WHERE period = '2026-10-12'").get()
    assert.equal(job?.status, 'pending')
    assert.equal((await retentionSummary(f.db, 1, newer)).checkedAt, newer.toISOString())
  } finally { f.sqlite.close() }
})
