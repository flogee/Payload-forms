import { attemptMail } from './mail-attempt'
import { mailPolicy, type MailEnvironment } from './notifications'
import { retentionWindow } from './retention-policy'
import { runBatch, type ResponseDatabase, type Statement } from './response-store'

type ReminderJob = {
  id: number; survey_id: number; period: string; recipient: string; attempts: number
  within90: number; within30: number; overdue: number
}

const countsSQL = `SELECT coalesce(sum(retention_review_due_at > ? AND retention_review_due_at <= ?), 0) AS within90,
  coalesce(sum(retention_review_due_at > ? AND retention_review_due_at <= ?), 0) AS within30,
  coalesce(sum(retention_review_due_at <= ?), 0) AS overdue
  FROM responses WHERE survey_id = ? AND retention_review_due_at <= ?`
const countValues = (now: Date, surveyID: number) => {
  const w = retentionWindow(now)
  return [w.in30, w.in90, w.now, w.in30, w.now, surveyID, w.in90]
}

export function reminderClaimStatements(job: ReminderJob, token: string, now: Date, limit: number): Statement[] {
  const w = retentionWindow(now), month = w.now.slice(0, 7)
  return [
    { sql: `INSERT INTO email_usage (month, attempts, created_at, updated_at) VALUES (?, 0, ?, ?)
      ON CONFLICT (month) DO NOTHING`, values: [month, w.now, w.now] },
    { sql: `UPDATE retention_reminders AS n SET status = 'sending', claim_token = ?, claimed_at = ?,
        attempts = attempts + 1, updated_at = ?, (within90, within30, overdue) = (${countsSQL})
      WHERE id = ? AND survey_id = ? AND recipient = ? AND period = ? AND period = ? AND status = 'pending'
      AND next_attempt_at <= ? AND attempts < 3
      AND (SELECT attempts FROM email_usage WHERE month = ?) < ?
      AND EXISTS (SELECT 1 FROM surveys s JOIN responses r ON r.survey_id = s.id
        WHERE s.id = n.survey_id AND s.retention_reminders_enabled = 1 AND r.retention_review_due_at <= ?)`,
      values: [token, w.now, w.now, ...countValues(now, job.survey_id), job.id, job.survey_id, job.recipient,
        job.period, w.period, w.now, month, limit, w.in90] },
    { sql: `UPDATE email_usage SET attempts = attempts + 1, updated_at = ? WHERE month = ? AND changes() = 1
      AND EXISTS (SELECT 1 FROM retention_reminders WHERE id = ? AND claim_token = ? AND status = 'sending')`,
      values: [w.now, month, job.id, token] },
    { sql: `SELECT id, survey_id, period, recipient, attempts, within90, within30, overdue FROM retention_reminders
      WHERE id = ? AND claim_token = ? AND status = 'sending'`, values: [job.id, token] },
  ]
}

export function retentionReminderMessage(sender: string, recipient: string, origin: string, job: ReminderJob) {
  return { from: sender, to: recipient, subject: 'Payload Forms: Aufbewahrungsfristen prüfen',
    text: `Für Fragebogen ${job.survey_id} sind personenbezogene Angaben zu prüfen.\n\n` +
      `Frist in 31 bis 90 Tagen: ${job.within90}\nFrist in den nächsten 30 Tagen: ${job.within30}\nFrist bereits erreicht: ${job.overdue}\n\n` +
      `Antworten im geschützten Teamzugang öffnen:\n${origin}/admin/collections/responses?where[survey][equals]=${job.survey_id}\n\n` +
      'Bitte vor Fristablauf Anonymisierung oder Löschung prüfen und Exporte und Sicherungskopien berücksichtigen. ' +
      'Nur Name und E-Mail zu entfernen reicht bei identifizierbaren Freitexten nicht aus. ' +
      'Die App löscht und anonymisiert durch diese Erinnerung keine Daten.\n\n' +
      'Ein gebündelter Hinweis je Formular und UTC-Woche. Keine Antwortinhalte oder Kontaktangaben in dieser Nachricht. Payload Forms' }
}

export async function dispatchRetentionReminders(db: ResponseDatabase, env: MailEnvironment, now = new Date(), timeoutMs = 10000) {
  const w = retentionWindow(now), policy = mailPolicy(env)
  await runBatch(db, [
    { sql: `UPDATE retention_reminders SET status = 'uncertain', last_error = 'UNCONFIRMED', updated_at = ?
      WHERE status = 'sending' AND claimed_at < ?`, values: [w.now, new Date(now.getTime() - 15 * 60000).toISOString()] },
    { sql: `UPDATE retention_reminders AS n SET status = 'cancelled', last_error = 'NO_LONGER_ELIGIBLE', updated_at = ?
      WHERE status = 'pending' AND period <= ? AND (period < ? OR recipient <> ? OR NOT EXISTS
        (SELECT 1 FROM surveys s JOIN responses r ON r.survey_id = s.id
         WHERE s.id = n.survey_id AND s.retention_reminders_enabled = 1 AND r.retention_review_due_at <= ?))`,
      values: [w.now, w.period, w.period, policy.alertRecipient ?? '', w.in90] },
    { sql: `DELETE FROM retention_reminders WHERE status IN ('sent','failed','cancelled','uncertain') AND updated_at < ?`,
      values: [new Date(now.getTime() - 90 * 86400000).toISOString()] },
  ])
  if (policy.configured && policy.alertRecipient) {
    // At most 20 new form digests per invocation; existing weekly keys do not
    // occupy the selection and therefore cannot starve additional forms.
    await runBatch(db, [{ sql: `INSERT INTO retention_reminders
      (reminder_key, survey_id, period, recipient, status, attempts, within90, within30, overdue, next_attempt_at, created_at, updated_at)
      SELECT cast(s.id AS text) || ':' || ?, s.id, ?, ?, 'pending', 0,
        sum(r.retention_review_due_at > ? AND r.retention_review_due_at <= ?),
        sum(r.retention_review_due_at > ? AND r.retention_review_due_at <= ?),
        sum(r.retention_review_due_at <= ?), ?, ?, ?
      FROM surveys s JOIN responses r ON r.survey_id = s.id
      LEFT JOIN retention_reminders n ON n.reminder_key = cast(s.id AS text) || ':' || ?
      WHERE s.retention_reminders_enabled = 1 AND r.retention_review_due_at <= ? AND n.id IS NULL
      GROUP BY s.id ORDER BY min(r.retention_review_due_at), s.id LIMIT 20
      ON CONFLICT (reminder_key) DO NOTHING`, values: [w.period, w.period, policy.alertRecipient, w.in30, w.in90,
        w.now, w.in30, w.now, w.now, w.now, w.now, w.period, w.in90] }])
    const [pending] = await runBatch(db, [{ sql: `SELECT id, survey_id, period, recipient, attempts, within90, within30, overdue
      FROM retention_reminders WHERE status = 'pending' AND period = ? AND recipient = ? AND next_attempt_at <= ? ORDER BY id LIMIT 5`,
      values: [w.period, policy.alertRecipient, w.now] }])
    for (const candidate of pending.results as ReminderJob[]) {
      const token = crypto.randomUUID()
      const result = await runBatch(db, reminderClaimStatements(candidate, token, now, policy.routineLimit))
      if (result[1].meta.changes !== 1) continue
      const job = result.at(-1)!.results[0] as ReminderJob
      const outcome = await attemptMail(env.EMAIL!, retentionReminderMessage(policy.sender!, job.recipient, policy.origin!, job), job.attempts, now, timeoutMs)
      await runBatch(db, [{ sql: `UPDATE retention_reminders SET status = ?, last_error = ?, provider_message_id = ?, next_attempt_at = ?, updated_at = ?
        WHERE id = ? AND claim_token = ? AND status = 'sending'`,
        values: [outcome.state, 'error' in outcome ? outcome.error : null, 'messageId' in outcome ? outcome.messageId : null,
          'nextAttemptAt' in outcome ? outcome.nextAttemptAt ?? null : null, w.now, job.id, token] }])
    }
  }
  await runBatch(db, [{ sql: `INSERT INTO retention_reminder_monitor (id,checked_at) VALUES (1,?)
    ON CONFLICT (id) DO UPDATE SET checked_at = max(checked_at, excluded.checked_at)`, values: [w.now] }])
}

export async function retentionSummary(db: ResponseDatabase, surveyID: number, now = new Date()) {
  const w = retentionWindow(now)
  const result = await runBatch(db, [
    { sql: countsSQL, values: countValues(now, surveyID) },
    { sql: 'SELECT count(*) AS count FROM responses WHERE survey_id = ? AND retention_review_due_at IS NULL', values: [surveyID] },
    { sql: 'SELECT checked_at FROM retention_reminder_monitor WHERE id = 1', values: [] },
    { sql: `SELECT period, status, attempts, last_error, updated_at FROM retention_reminders WHERE survey_id = ? ORDER BY id DESC LIMIT 1`, values: [surveyID] },
    { sql: 'SELECT attempts FROM email_usage WHERE month = ?', values: [w.now.slice(0, 7)] },
  ])
  const row = result[0].results[0], latest = result[3].results[0], checkedAt = result[2].results[0]?.checked_at as string | undefined
  return {
    counts: { within90: Number(row.within90), within30: Number(row.within30), overdue: Number(row.overdue), unconfigured: Number(result[1].results[0]?.count ?? 0) },
    checkedAt: checkedAt ?? null, stale: !checkedAt || now.getTime() - new Date(checkedAt).getTime() > 15 * 60000,
    latest: latest ? { period: latest.period, status: latest.status, attempts: latest.attempts, lastError: latest.last_error, updatedAt: latest.updated_at } : null,
    used: Number(result[4].results[0]?.attempts ?? 0),
  }
}
