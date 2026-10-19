import { runBatch, type ResponseDatabase, type Statement } from './response-store'
import { QA_MACHINE_LIMITS } from './qa-machine-limits'

export type QAUsage = { scope: string; requests: number; reports: number }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const scopedAlertInsert = `INSERT INTO budget_alerts
  (alert_key, metric, scope, period, level, used, quota_limit, status, attempts, next_attempt_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?) ON CONFLICT(alert_key) DO NOTHING`

export function qaBudgetAlerts(usage: QAUsage[], now: Date): Statement[] {
  const stamp = now.toISOString(), month = stamp.slice(0, 7)
  return usage.flatMap(row => {
    if (row.scope !== 'installation' && !uuid.test(row.scope)) throw new Error('Ungültiger QA-Kontingentbereich.')
    const limits = QA_MACHINE_LIMITS[row.scope === 'installation' ? 'installation' : 'client']
    return (['requests', 'reports'] as const).flatMap(kind => {
      if (!Number.isSafeInteger(row[kind]) || row[kind] < 0) throw new Error('Ungültiger QA-Kontingentstand.')
      if (row[kind] < Math.ceil(limits[kind] * 0.8)) return []
      const metric = kind === 'requests' ? 'qaRequests' : 'qaReports'
      const level = row[kind] >= limits[kind] ? 'blocked' : 'warning'
      return [{ sql: scopedAlertInsert, values: [`${metric}:${row.scope}:${month}:${level}`, metric,
        row.scope, month, level, row[kind], limits[kind], stamp, stamp, stamp] }]
    })
  })
}

// Global and client reservations are made in ONE native D1 transaction.
// The global update checks both headrooms; changes() gates the client update.
// Report requests reserve both counters or neither. Failures/retries are not
// refunded, and cannot reset counters or spend another client's quota.
export async function reserveQAMachineRequest(db: ResponseDatabase, client: string, report: boolean, now = new Date()) {
  if (!uuid.test(client)) throw new Error('Ungültiger QA-Client.')
  const month = now.toISOString().slice(0, 7), delta = report ? 1 : 0
  const global = QA_MACHINE_LIMITS.installation, local = QA_MACHINE_LIMITS.client
  const [_, __, reserved, clientReserved, rows] = await runBatch(db, [
    { sql: "INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES('installation',?,0,0) ON CONFLICT(scope,month) DO NOTHING", values: [month] },
    { sql: 'INSERT INTO qa_machine_usage(scope,month,requests,reports) VALUES(?,?,0,0) ON CONFLICT(scope,month) DO NOTHING', values: [client, month] },
    { sql: `UPDATE qa_machine_usage SET requests = requests + 1, reports = reports + ?
      WHERE scope = 'installation' AND month = ? AND requests < ? AND reports <= ?
      AND EXISTS (SELECT 1 FROM qa_machine_usage c WHERE c.scope = ? AND c.month = ? AND c.requests < ? AND c.reports <= ?)`,
      values: [delta, month, global.requests, global.reports - delta, client, month, local.requests, local.reports - delta] },
    { sql: 'UPDATE qa_machine_usage SET requests = requests + 1, reports = reports + ? WHERE scope = ? AND month = ? AND changes() = 1', values: [delta, client, month] },
    { sql: "SELECT scope,requests,reports FROM qa_machine_usage WHERE month = ? AND scope IN ('installation', ?)", values: [month, client] },
  ])
  if (reserved.meta.changes !== clientReserved.meta.changes) throw new Error('QA-Reservierung nicht bestätigt.')
  // Notification failure never authorizes work: counters remain consumed and
  // the scheduled checker recovers missing threshold alerts from durable usage.
  const alerts = qaBudgetAlerts(rows.results as QAUsage[], now)
  if (alerts.length) await runBatch(db, alerts)
  return reserved.meta.changes === 1
}

// Bound blocked-burst D1 writes to one attempt per client/month/isolate. The
// durable key deduplicates isolates. Failed recording stays a sanitized 503;
// it is not a claim that an operator received a warning.
const rateRecorded = new WeakMap<ResponseDatabase, { month: string; clients: Map<string, Promise<unknown>> }>()
export async function recordQAMachineRateBlock(db: ResponseDatabase, client: string, now = new Date()) {
  if (!uuid.test(client)) throw new Error('Ungültiger QA-Client.')
  const stamp = now.toISOString(), month = stamp.slice(0, 7)
  let state = rateRecorded.get(db)
  if (!state || state.month !== month) { state = { month, clients: new Map() }; rateRecorded.set(db, state) }
  let recorded = state.clients.get(client)
  if (!recorded) {
    recorded = runBatch(db, [{ sql: scopedAlertInsert, values: [`qaRate:${client}:${month}:blocked`, 'qaRate', client, month,
      'blocked', 1, 1, stamp, stamp, stamp] }]).catch(error => { console.error('QA_RATE_WARNING_UNAVAILABLE'); throw error })
    state.clients.set(client, recorded)
  }
  await recorded // Remember failures as well: never claim successful capture on retry.
}
