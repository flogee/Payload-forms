import test from 'node:test'
import assert from 'node:assert/strict'
import { readNotificationSettings, recipientAddresses, mailPolicy, notificationMessage, type MailEnvironment } from '../src/survey/notifications'
import { dispatchNotifications } from '../src/survey/notification-dispatch'
import { cancelNotification, claimNotification, maintainNotifications, notificationSummary, pendingNotifications } from '../src/survey/notification-store'
import { eraseResponse } from '../src/survey/response-store'
import { answerText } from '../src/survey/answer-text'
import { notificationFixture, notificationNow as now } from './notification-fixture'

function environment(send: NonNullable<MailEnvironment['EMAIL']>['send'], extra: Partial<MailEnvironment> = {}): MailEnvironment {
  return { EMAIL: { send }, MAIL_ENABLED: '1', MAIL_FROM: 'forms@example.org', MAIL_ORIGIN: 'https://forms.example.org', SURVEY_ORIGINS: 'https://forms.example.org',
    MAIL_ALLOWED_RECIPIENTS: 'notify@localhost.invalid,second@localhost.invalid', MAIL_MONTHLY_LIMIT: '500', ...extra }
}
const accepted = async () => ({ messageId: crypto.randomUUID() })

test('mail settings normalize recipients, bound the list and reject header injection or unsafe links', () => {
  assert.deepEqual(recipientAddresses(' A@Example.invalid;\nb@example.invalid,a@example.invalid '), ['a@example.invalid', 'b@example.invalid'])
  assert.throws(() => readNotificationSettings({ enabled: true, recipients: '' }), /mindestens/)
  assert.throws(() => recipientAddresses('a@example.invalid\rBcc: attacker@example.invalid'), /gültige/)
  assert.throws(() => recipientAddresses(Array.from({ length: 11 }, (_, i) => `${i}@example.invalid`).join('\n')), /zehn/)
  assert.equal(mailPolicy(environment(accepted)).configured, true)
  const invalid: Partial<MailEnvironment>[] = [{ MAIL_ORIGIN: 'https://attacker.invalid' }, { MAIL_ORIGIN: 'https://forms.example.org/path' },
    { MAIL_FROM: 'sender@example.invalid\nBcc: person@example.invalid' }, { MAIL_MONTHLY_LIMIT: '1001' }, { MAIL_ENABLED: '0' }, { MAIL_ALLOWED_RECIPIENTS: '' }, { EMAIL: undefined }]
  for (const extra of invalid) {
    assert.equal(mailPolicy(environment(accepted, extra)).configured, false)
  }
  const reference = crypto.randomUUID()
  const message = notificationMessage('forms@example.org', 'notify@localhost.invalid', 'https://forms.example.org', reference)
  assert.ok(message.text.includes(`/antwort/${reference}`))
  assert.equal('cc' in message, false)
})

test('answer and mail queue are atomic, exact retries never notify newly added recipients', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.exec("CREATE TRIGGER fail_mail BEFORE INSERT ON response_notifications BEGIN SELECT RAISE(ABORT,'queue unavailable'); END")
    const input = f.input()
    await assert.rejects(f.save(input), /queue unavailable/)
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM responses').get()?.n, 0)
    f.sqlite.exec('DROP TRIGGER fail_mail')
    assert.equal((await f.save(input)).state, 'saved')
    f.sqlite.prepare('UPDATE surveys SET notifications_recipients = ?').run('notify@localhost.invalid\nsecond@localhost.invalid')
    const retried = await f.save({ ...input, notificationReference: crypto.randomUUID(), notificationRecipients: ['notify@localhost.invalid', 'second@localhost.invalid'] })
    assert.equal(retried.state, 'saved')
    if (retried.state === 'saved') assert.equal(retried.duplicate, true)
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM response_notifications').get()?.n, 1)
    f.sqlite.exec('UPDATE surveys SET notifications_enabled=0')
    await f.save(f.input())
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM response_notifications').get()?.n, 1, 'a setting changed after the route read is respected in the transaction')
  } finally { f.sqlite.close() }
})

test('concurrent claims send once and reserve the monthly cap atomically', async () => {
  const f = await notificationFixture()
  try {
    await f.save(); await f.save()
    const pending = await pendingNotifications(f.db, now.toISOString())
    const tokens = [crypto.randomUUID(), crypto.randomUUID()]
    const claims = await Promise.all(tokens.map(token => claimNotification(f.db, pending[0], token, now.toISOString(), 1)))
    assert.equal(claims.filter(Boolean).length, 1)
    assert.equal(await claimNotification(f.db, pending[1], crypto.randomUUID(), now.toISOString(), 1), undefined)
    assert.equal((await notificationSummary(f.db, 1, now.toISOString())).used, 1)
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications WHERE id=2').get()?.status, 'pending')
  } finally { f.sqlite.close() }
})

test('each recipient receives only a protected reference and acceptance is recorded without answers', async () => {
  const f = await notificationFixture()
  try {
    f.sqlite.prepare('UPDATE surveys SET notifications_recipients = ?').run('notify@localhost.invalid\nsecond@localhost.invalid')
    const input = { ...f.input(), notificationRecipients: ['notify@localhost.invalid', 'second@localhost.invalid'] }
    await f.save(input)
    const messages: unknown[] = []
    await dispatchNotifications(f.db, environment(async message => { messages.push(message); return { messageId: 'accepted' } }), now)
    assert.equal(messages.length, 2)
    assert.equal(new Set(messages.map((message: any) => message.to)).size, 2)
    assert.ok(!JSON.stringify(messages).includes(input.answers.F01_name as string))
    const summary = await notificationSummary(f.db, 1, now.toISOString())
    assert.equal(summary.counts.sent, 2); assert.equal(summary.used, 2)
    await dispatchNotifications(f.db, environment(async () => { throw new Error('must not resend') }), now)
    assert.equal((await notificationSummary(f.db, 1, now.toISOString())).used, 2)
  } finally { f.sqlite.close() }
})

test('removed, disabled and unregistered recipients are cancelled before any external send', async () => {
  const f = await notificationFixture()
  try {
    await f.save()
    f.sqlite.exec("UPDATE surveys SET notifications_recipients='second@localhost.invalid'")
    await dispatchNotifications(f.db, environment(async () => { throw new Error('must not send') }), now)
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications').get()?.status, 'cancelled')
    await f.save({ ...f.input(), notificationRecipients: ['second@localhost.invalid'] })
    await dispatchNotifications(f.db, environment(async () => { throw new Error('must not send') }, { MAIL_ALLOWED_RECIPIENTS: 'notify@localhost.invalid' }), now)
    assert.equal((await notificationSummary(f.db, 1, now.toISOString())).counts.cancelled, 2)
    assert.equal((await notificationSummary(f.db, 1, now.toISOString())).used, 0)
  } finally { f.sqlite.close() }
})

test('only definite throttling is retried; ambiguous network results are never replayed or logged verbatim', async () => {
  const f = await notificationFixture()
  try {
    await f.save()
    let calls = 0
    const env = environment(async () => { if (++calls === 1) throw Object.assign(new Error('private provider details'), { code: 'E_RATE_LIMIT_EXCEEDED' }); return { messageId: 'accepted' } })
    await dispatchNotifications(f.db, env, now)
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications').get()?.status, 'pending')
    await dispatchNotifications(f.db, env, now)
    assert.equal(calls, 1)
    await dispatchNotifications(f.db, env, new Date(now.getTime() + 300000))
    assert.equal(calls, 2)
    await f.save()
    await dispatchNotifications(f.db, environment(async () => { throw new Error('response or contact data must never be logged') }), now)
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications WHERE id=2').get()?.status, 'uncertain')
    assert.equal(f.sqlite.prepare('SELECT last_error FROM response_notifications WHERE id=2').get()?.last_error, 'UNCONFIRMED')
    await dispatchNotifications(f.db, environment(async () => { throw new Error('must not retry uncertain') }), new Date(now.getTime() + 3600000))
    assert.equal((await notificationSummary(f.db, 1, now.toISOString())).used, 3)
  } finally { f.sqlite.close() }
})

test('crashed sends become uncertain and stale pending jobs expire without sending', async () => {
  const f = await notificationFixture()
  try {
    await f.save(); await f.save()
    const pending = await pendingNotifications(f.db, now.toISOString())
    await claimNotification(f.db, pending[0], crypto.randomUUID(), now.toISOString(), 500)
    await maintainNotifications(f.db, new Date(now.getTime() + 16 * 60000))
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications WHERE id=1').get()?.status, 'uncertain')
    await dispatchNotifications(f.db, environment(async () => { throw new Error('must not send stale data') }), new Date(now.getTime() + 25 * 3600000))
    assert.equal(f.sqlite.prepare('SELECT status FROM response_notifications WHERE id=2').get()?.status, 'cancelled')
  } finally { f.sqlite.close() }
})

test('erasure deletes all queued mail and locks, preserves the cap and cannot redirect old references to reused IDs', async () => {
  const f = await notificationFixture()
  try {
    const input = f.input(), saved = await f.save(input)
    assert.equal(saved.state, 'saved'); if (saved.state !== 'saved') return
    await dispatchNotifications(f.db, environment(accepted), now)
    f.sqlite.exec("INSERT INTO payload_locked_documents (id) VALUES (1); INSERT INTO payload_locked_documents_rels(parent_id,path,response_notifications_id) VALUES(1,'document',1)")
    const erased = await eraseResponse(f.db, { id: saved.id, key: input.key, erasureKey: input.erasureKey, expectedUpdatedAt: input.now,
      actorID: 1, reason: 'test-cleanup', now: input.now, retainUntil: '2026-11-06T08:00:00.000Z' })
    assert.ok(erased)
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM response_notifications').get()?.n, 0)
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM payload_locked_documents_rels').get()?.n, 0)
    assert.equal((await notificationSummary(f.db, 1, input.now)).used, 1)
    assert.equal((await f.save(input)).state, 'erased')
    const replacement = await f.save()
    assert.equal(replacement.state, 'saved'); if (replacement.state !== 'saved') return
    assert.equal(replacement.id, saved.id, 'exercise SQLite integer ID reuse')
    assert.equal(f.sqlite.prepare('SELECT id FROM responses WHERE notification_reference=?').get(input.notificationReference!)?.id, undefined)
  } finally { f.sqlite.close() }
})

test('mail log retention does not remove answers or invalidate immutable response references', async () => {
  const f = await notificationFixture()
  try {
    const input = f.input(); await f.save(input)
    await dispatchNotifications(f.db, environment(accepted), now)
    await maintainNotifications(f.db, new Date(now.getTime() + 31 * 86400000))
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM response_notifications').get()?.n, 0)
    assert.equal(f.sqlite.prepare('SELECT notification_reference FROM responses').get()?.notification_reference, input.notificationReference)
    assert.equal(f.sqlite.prepare('SELECT attempts FROM email_usage').get()?.attempts, 1)
  } finally { f.sqlite.close() }
})

test('stale queue selections cannot claim or cancel a replacement with a reused numeric ID', async () => {
  const f = await notificationFixture()
  try {
    const input = f.input(), saved = await f.save(input)
    assert.equal(saved.state, 'saved'); if (saved.state !== 'saved') return
    const [stale] = await pendingNotifications(f.db, input.now)
    assert.ok(await eraseResponse(f.db, { id: saved.id, key: input.key, erasureKey: input.erasureKey, expectedUpdatedAt: input.now,
      actorID: 1, reason: 'test-cleanup', now: input.now, retainUntil: '2026-11-06T08:00:00.000Z' }))
    f.sqlite.exec("UPDATE surveys SET notifications_recipients='second@localhost.invalid'")
    await f.save({ ...f.input(), notificationRecipients: ['second@localhost.invalid'] })
    const [replacement] = await pendingNotifications(f.db, input.now)
    assert.equal(replacement.id, stale.id, 'exercise queue ID reuse after erasure')
    assert.notEqual(replacement.response_reference, stale.response_reference)
    await cancelNotification(f.db, stale, input.now)
    assert.equal(await claimNotification(f.db, stale, crypto.randomUUID(), input.now, 500), undefined)
    const summary = await notificationSummary(f.db, 1, input.now)
    assert.equal(summary.counts.pending, 1); assert.equal(summary.used, 0)
    assert.equal(f.sqlite.prepare('SELECT attempts FROM response_notifications').get()?.attempts, 0)
  } finally { f.sqlite.close() }
})

test('human answer rendering preserves zero, option labels and missing rows', () => {
  assert.equal(answerText({ id: 'q', block: 'q', label: 'Q', kind: 'count' }, { status: 'value', value: 0 }), '0')
  assert.equal(answerText({ id: 'q', block: 'q', label: 'Q', kind: 'single', options: [{ value: '1', label: 'Ja' }] }, { choice: '1' }), 'Ja')
  assert.equal(answerText({ id: 'q', block: 'q', label: 'Q', kind: 'counts', rows: [{ key: 'one', label: 'Eins' }] }, {}), 'Eins: Keine Angabe')
})
