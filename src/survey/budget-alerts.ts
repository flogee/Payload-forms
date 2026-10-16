import { IMAGE_LIMITS } from './image-limits'
import { alertInsert, type BudgetMetric, type AlertLevel } from './budget-alert-events'
import { runBatch, type ResponseDatabase, type Statement } from './response-store'
import { mailPolicy, type MailEnvironment } from './notifications'
import { attemptMail } from './mail-attempt'
import { PUBLIC_LIMITS } from './public-limits'

export const budgetLabels: Record<BudgetMetric, string> = { storage: 'Reservierter Bildspeicher', objects: 'Reservierte Bildplätze', reads: 'Bildabrufe', writes: 'Bild-Uploads', mail: 'Einsendungsbenachrichtigungen', participation: 'Öffentliche Formularabrufe', submissions: 'Öffentliche Absendeversuche', rate: 'Kurzzeitige Ratenbegrenzung' }
type Alert = { id: number; metric: BudgetMetric; period: string; level: AlertLevel; used: number; quota_limit: number; status: string; attempts: number }

export async function budgetSnapshot(db: ResponseDatabase, now = new Date()) {
  const month = now.toISOString().slice(0, 7)
  const [storageResult, usageResult, emailResult, publicResult] = await runBatch(db, [
    { sql: 'SELECT reserved_bytes, reserved_objects FROM image_storage_usage WHERE id = 1', values: [] },
    { sql: 'SELECT reads, writes FROM image_request_usage WHERE month = ?', values: [month] },
    { sql: 'SELECT attempts FROM email_usage WHERE month = ?', values: [month] },
    { sql: 'SELECT reads, submissions FROM public_request_usage WHERE month = ?', values: [month] },
  ])
  const storage = storageResult.results[0], usage = usageResult.results[0]
  if (!storage) throw new Error('Bildkontingent ist nicht eingerichtet.')
  const used = { storage: Number(storage.reserved_bytes), objects: Number(storage.reserved_objects),
    reads: Number(usage?.reads ?? 0), writes: Number(usage?.writes ?? 0), mail: Number(emailResult.results[0]?.attempts ?? 0),
    participation: Number(publicResult.results[0]?.reads ?? 0), submissions: Number(publicResult.results[0]?.submissions ?? 0) }
  if (Object.values(used).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Kontingentprüfung fehlgeschlagen.')
  return { month, used }
}

export async function checkBudgetAlerts(db: ResponseDatabase, env: MailEnvironment, now = new Date()) {
  const { month, used } = await budgetSnapshot(db, now), stamp = now.toISOString(), policy = mailPolicy(env)
  const limits = { storage: IMAGE_LIMITS.storageBytes, objects: IMAGE_LIMITS.objects, reads: IMAGE_LIMITS.monthlyReads, writes: IMAGE_LIMITS.monthlyWrites, mail: policy.routineLimit, participation: PUBLIC_LIMITS.reads, submissions: PUBLIC_LIMITS.submissions }
  const statements: Statement[] = [
    { sql: "UPDATE budget_alerts SET status = 'uncertain', last_error = 'UNCONFIRMED', updated_at = ? WHERE status = 'sending' AND claimed_at < ?", values: [stamp, new Date(now.getTime() - 15 * 60000).toISOString()] },
    { sql: "UPDATE budget_alerts SET status = 'superseded', updated_at = ? WHERE status = 'pending' AND period <> 'lifetime' AND period < ?", values: [stamp, month] },
    // Keep lifetime deduplication keys permanently; monthly keys are never reused.
    { sql: "DELETE FROM budget_alerts WHERE period <> 'lifetime' AND period < ?", values: [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 7)] },
    { sql: 'DELETE FROM public_request_usage WHERE month < ?', values: [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 7)] },
  ]
  for (const metric of Object.keys(limits) as Exclude<BudgetMetric, 'rate'>[]) {
    const limit = limits[metric]
    if (limit < 1 || used[metric] < Math.ceil(limit * 0.8)) continue
    const period = metric === 'storage' || metric === 'objects' ? 'lifetime' : month
    // A maximum-size upload no longer fits. This durable headroom check
    // recovers a blocked-upload warning even if its event INSERT failed.
    const level = used[metric] >= limit || (metric === 'storage' && used.storage > limit - IMAGE_LIMITS.fileBytes) ? 'blocked' : 'warning'
    statements.push({ sql: alertInsert, values: [`${metric}:${period}:${level}`, metric, period, level, used[metric], limit, stamp, stamp, stamp] })
  }
  statements.push({ sql: `UPDATE budget_alerts AS a SET status = 'superseded', updated_at = ? WHERE a.status = 'pending' AND a.level = 'warning'
    AND EXISTS (SELECT 1 FROM budget_alerts b WHERE b.metric = a.metric AND b.period = a.period AND b.level = 'blocked')`, values: [stamp] },
  { sql: 'INSERT INTO budget_alert_monitor(id, checked_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at WHERE excluded.checked_at > budget_alert_monitor.checked_at', values: [stamp] })
  await runBatch(db, statements)
}

export async function budgetAlertStatus(db: ResponseDatabase, env: MailEnvironment, now = new Date()) {
  const [monitor, alerts] = await runBatch(db, [
    { sql: 'SELECT checked_at FROM budget_alert_monitor WHERE id = 1', values: [] },
    { sql: `SELECT metric, period, level, used, quota_limit, status, attempts, updated_at FROM budget_alerts
      WHERE period IN ('lifetime', ?) AND status <> 'superseded' ORDER BY id DESC LIMIT 16`, values: [now.toISOString().slice(0, 7)] },
  ])
  const policy = mailPolicy(env), checkedAt = monitor.results[0]?.checked_at as string | undefined
  return { recipient: policy.alertRecipient ?? null, configured: policy.configured && !!policy.alertRecipient,
    checkedAt: checkedAt ?? null, stale: !checkedAt || !Number.isFinite(Date.parse(checkedAt)) || now.getTime() - Date.parse(checkedAt) > 15 * 60000,
    mailUsedLimit: policy.routineLimit, mailTotalLimit: policy.limit, alerts: alerts.results }
}

export function budgetAlertMessage(sender: string, recipient: string, origin: string, alert: Pick<Alert, 'metric' | 'level' | 'period' | 'used' | 'quota_limit'>) {
  const label = budgetLabels[alert.metric], blocked = alert.level === 'blocked'
  const affected = alert.metric === 'reads' ? 'Weitere Bildabrufe pausieren bei ausgeschöpfter Quote. Bildplätze zeigen dann einen Texthinweis; der Fragebogen bleibt ausfüllbar.'
    : alert.metric === 'rate' ? 'Mindestens eine öffentliche Anfrage wurde vor Datenbank- und Formularzugriffen kurzzeitig begrenzt. Betroffene Teilnehmende sehen einen Hinweis und können nach einer Minute erneut versuchen. Bitte mögliche ungewöhnliche Zugriffe prüfen. Das Backend bleibt verfügbar. Diese Ereignismeldung wird je UTC-Monat einmal vorgemerkt; sie enthält keine IP-Adressen.'
    : alert.metric === 'participation' ? 'Weitere öffentliche Formular-, Datenschutz- und Bildabrufe pausieren. Das geschützte Backend, vorhandene Antworten und Absendeversuche bereits geöffneter Formulare bleiben verfügbar.'
    : alert.metric === 'submissions' ? 'Weitere öffentliche Absendeversuche pausieren. Die Angaben bleiben im geöffneten Browser erhalten; Teilnehmende sollten den Tab offen halten. Formularabrufe, das geschützte Backend und vorhandene Antworten bleiben verfügbar.'
    : alert.metric === 'mail' ? 'Neue Einsendungen werden weiterhin gespeichert. Reguläre Eingangsmails warten bei ausgeschöpfter Quote und können nach 24 Stunden verfallen.'
    : 'Mindestens ein weiterer Bild-Upload kann nicht ausgeführt werden. Bestehende Formulare und Einsendungen funktionieren weiterhin; kleinere Uploads können noch in den Restspeicher passen.'
  return { from: sender, to: recipient, subject: `Payload Forms: ${blocked ? 'Kontingent begrenzt Vorgänge' : 'Kontingentwarnung ab 80 %'} – ${label}`,
    text: `${alert.metric === 'rate' ? `${label} wurde ausgelöst (UTC-Monat ${alert.period}).` : `${label}: ${alert.used} von ${alert.quota_limit} reservierten Einheiten (${alert.period === 'lifetime' ? 'dauerhaft' : `UTC-Monat ${alert.period}`}).`}\n\n${blocked ? affected : 'Bitte die Nutzung prüfen, bevor Vorgänge durch die feste Grenze begrenzt werden.'}\n\nGeschützte Verwaltung und Warnstatus:\n${origin}/admin/collections/media\n\nMaßnahmen: Nutzung und Ursache prüfen, weitere Uploads vorerst vermeiden bzw. bei Monatsquoten den nächsten UTC-Monat abwarten. Dauerhafte Reservierungen werden nicht automatisch freigegeben. Eine Erhöhung der Grenzen erfordert eine bewusste technische und finanzielle Prüfung.\n\nDiese App-Quoten sind keine kontoweite Kostenobergrenze für Cloudflare. Die Nachricht enthält keine Formularantworten.\n\nPayload Forms` }
}

export async function dispatchBudgetAlerts(db: ResponseDatabase, env: MailEnvironment, now = new Date(), timeoutMs = 10000) {
  await checkBudgetAlerts(db, env, now)
  const policy = mailPolicy(env), stamp = now.toISOString(), month = stamp.slice(0, 7)
  if (!policy.configured || !policy.alertRecipient) return
  const [pending] = await runBatch(db, [{ sql: `SELECT id FROM budget_alerts WHERE status = 'pending' AND next_attempt_at <= ? AND period IN ('lifetime', ?)
    ORDER BY CASE level WHEN 'blocked' THEN 0 ELSE 1 END, id LIMIT 10`, values: [stamp, month] }])
  for (const candidate of pending.results) {
    const id = Number(candidate.id), token = crypto.randomUUID()
    const result = await runBatch(db, [
      { sql: 'INSERT INTO email_usage(month, attempts, created_at, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT(month) DO NOTHING', values: [month, stamp, stamp] },
      { sql: `UPDATE budget_alerts SET status = 'sending', claim_token = ?, claimed_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND next_attempt_at <= ? AND attempts < 3
        AND (SELECT attempts FROM email_usage WHERE month = ?) < ?`, values: [token, stamp, stamp, id, stamp, month, policy.limit] },
      { sql: `UPDATE email_usage SET attempts = attempts + 1, updated_at = ? WHERE month = ? AND changes() = 1
        AND EXISTS (SELECT 1 FROM budget_alerts WHERE id = ? AND claim_token = ? AND status = 'sending')`, values: [stamp, month, id, token] },
      { sql: "SELECT * FROM budget_alerts WHERE id = ? AND claim_token = ? AND status = 'sending'", values: [id, token] },
    ])
    if (result[1].meta.changes !== 1) continue
    const job = result[3].results[0] as Alert
    const outcome = await attemptMail(env.EMAIL!, budgetAlertMessage(policy.sender!, policy.alertRecipient, policy.origin!, job), job.attempts, now, timeoutMs)
    await runBatch(db, [{ sql: `UPDATE budget_alerts SET status = ?, last_error = ?, provider_message_id = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND claim_token = ? AND status = 'sending'`, values: [outcome.state, outcome.error ?? null, outcome.messageId ?? null, outcome.nextAttemptAt ?? null, stamp, id, token] }])
  }
}
