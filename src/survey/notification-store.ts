import { runBatch, type ResponseDatabase, type Statement } from './response-store'
import { notificationStates, type NotificationState } from './notifications'

export type NotificationJob = { id: number; recipient: string; response_reference: string; attempts: number }
type NotificationSelection = Pick<NotificationJob, 'id' | 'recipient' | 'response_reference'>
const membership = `s.notifications_enabled = 1 AND
  instr(char(10) || coalesce(s.notifications_recipients, '') || char(10), char(10) || n.recipient || char(10)) > 0`
const existingResponse = `r.id = n.response_id AND r.notification_reference = n.response_reference`

export async function maintainNotifications(db: ResponseDatabase, now: Date) {
  const stamp = now.toISOString()
  await runBatch(db, [{
    sql: `UPDATE response_notifications AS n SET status = 'cancelled', last_error = 'SETTINGS_CHANGED', updated_at = ?
      WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM responses r JOIN surveys s ON s.id = r.survey_id
      WHERE ${existingResponse} AND ${membership})`, values: [stamp],
  }, {
    sql: `UPDATE response_notifications SET status = 'cancelled', last_error = 'EXPIRED', updated_at = ?
      WHERE status = 'pending' AND created_at < ?`, values: [stamp, new Date(now.getTime() - 86400000).toISOString()],
  }, {
    // A crashed sender may already have handed the email to Cloudflare.
    // Never automatically replay an ambiguous external side effect.
    sql: `UPDATE response_notifications SET status = 'uncertain', last_error = 'UNCONFIRMED', updated_at = ?
      WHERE status = 'sending' AND claimed_at < ?`, values: [stamp, new Date(now.getTime() - 15 * 60000).toISOString()],
  }, {
    sql: `DELETE FROM response_notifications WHERE status IN ('sent', 'failed', 'cancelled', 'uncertain') AND updated_at < ?`,
    values: [new Date(now.getTime() - 30 * 86400000).toISOString()],
  }])
}

export async function pendingNotifications(db: ResponseDatabase, now: string) {
  const [result] = await runBatch(db, [{ sql: `SELECT id, recipient, response_reference, attempts FROM response_notifications
    WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 10`, values: [now] }])
  return result.results as NotificationJob[]
}

export async function cancelNotification(db: ResponseDatabase, job: NotificationSelection, now: string) {
  await runBatch(db, [{ sql: `UPDATE response_notifications SET status = 'cancelled', last_error = 'RECIPIENT_NOT_CONFIGURED', updated_at = ?
    WHERE id = ? AND response_reference = ? AND recipient = ? AND status = 'pending'`, values: [now, job.id, job.response_reference, job.recipient] }])
}

export function claimStatements(job: NotificationSelection, token: string, now: string, limit: number): Statement[] {
  const month = now.slice(0, 7)
  return [{ sql: `INSERT INTO email_usage (month, attempts, created_at, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT (month) DO NOTHING`, values: [month, now, now] }, {
    sql: `UPDATE response_notifications AS n SET status = 'sending', claim_token = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND response_reference = ? AND recipient = ? AND status = 'pending' AND next_attempt_at <= ? AND attempts < 3
      AND (SELECT attempts FROM email_usage WHERE month = ?) < ?
      AND EXISTS (SELECT 1 FROM responses r JOIN surveys s ON s.id = r.survey_id WHERE ${existingResponse} AND ${membership})`,
    values: [token, now, now, job.id, job.response_reference, job.recipient, now, month, limit],
  }, {
    sql: `UPDATE email_usage SET attempts = attempts + 1, updated_at = ? WHERE month = ?
      AND changes() = 1
      AND EXISTS (SELECT 1 FROM response_notifications WHERE id = ? AND claim_token = ? AND status = 'sending')`,
    values: [now, month, job.id, token],
  }, {
    sql: `SELECT n.id, n.recipient, n.response_reference, n.attempts FROM response_notifications n
      JOIN responses r ON ${existingResponse} JOIN surveys s ON s.id = r.survey_id
      WHERE n.id = ? AND n.claim_token = ? AND n.status = 'sending' AND ${membership}`, values: [job.id, token],
  }]
}

export async function claimNotification(db: ResponseDatabase, job: NotificationSelection, token: string, now: string, limit: number) {
  const result = await runBatch(db, claimStatements(job, token, now, limit))
  if (result[1].meta.changes !== 1) return undefined
  return result.at(-1)!.results[0] as NotificationJob | undefined
}

export async function finishNotification(db: ResponseDatabase, id: number, token: string, state: NotificationState,
  now: string, options: { error?: string; messageId?: string; nextAttemptAt?: string } = {}) {
  await runBatch(db, [{
    sql: `UPDATE response_notifications SET status = ?, last_error = ?, provider_message_id = ?, sent_at = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND claim_token = ? AND status = 'sending'`,
    values: [state, options.error ?? null, options.messageId ?? null, state === 'sent' ? now : null, options.nextAttemptAt ?? null, now, id, token],
  }])
}

export async function notificationSummary(db: ResponseDatabase, surveyID: number, now: string) {
  const result = await runBatch(db, [{ sql: 'SELECT status, count(*) AS count FROM response_notifications WHERE survey_id = ? GROUP BY status', values: [surveyID] },
    { sql: 'SELECT attempts FROM email_usage WHERE month = ?', values: [now.slice(0, 7)] }])
  const counts = Object.fromEntries(notificationStates.map(state => [state, 0])) as Record<NotificationState, number>
  for (const row of result[0].results) if (notificationStates.includes(row.status as NotificationState)) counts[row.status as NotificationState] = Number(row.count)
  return { counts, used: Number(result[1].results[0]?.attempts || 0) }
}
