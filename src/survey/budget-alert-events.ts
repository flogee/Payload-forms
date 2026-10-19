export type BudgetMetric = 'storage' | 'objects' | 'reads' | 'writes' | 'mail' | 'participation' | 'submissions' | 'rate' | 'qaRequests' | 'qaReports' | 'qaRate'
export type AlertLevel = 'warning' | 'blocked'
export const alertInsert = `INSERT INTO budget_alerts
  (alert_key, metric, period, level, used, quota_limit, status, attempts, next_attempt_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?) ON CONFLICT(alert_key) DO NOTHING`

// Record the actual rejected operation, including an upload that does not fit
// in the remaining bytes even though the total has not reached exactly 100%.
export async function recordImageBlock(db: Pick<D1Database, 'prepare'>, metric: 'reads' | 'writes' | 'storage', limit: number, objectsLimit: number, size = 0, now = new Date()) {
  const stamp = now.toISOString(), month = stamp.slice(0, 7)
  const result = metric === 'storage'
    ? await db.prepare(`INSERT INTO budget_alerts
      (alert_key, metric, period, level, used, quota_limit, status, attempts, next_attempt_at, created_at, updated_at)
      SELECT CASE WHEN reserved_objects >= ? THEN 'objects:lifetime:blocked' ELSE 'storage:lifetime:blocked' END,
      CASE WHEN reserved_objects >= ? THEN 'objects' ELSE 'storage' END, 'lifetime', 'blocked',
      CASE WHEN reserved_objects >= ? THEN reserved_objects ELSE reserved_bytes END,
      CASE WHEN reserved_objects >= ? THEN ? ELSE ? END, 'pending', 0, ?, ?, ?
      FROM image_storage_usage WHERE id = 1 AND (reserved_bytes > ? OR reserved_objects >= ?)
      ON CONFLICT(alert_key) DO NOTHING`).bind(objectsLimit, objectsLimit, objectsLimit, objectsLimit, objectsLimit, limit,
        stamp, stamp, stamp, limit - size, objectsLimit).run()
    : await db.prepare(`INSERT INTO budget_alerts
      (alert_key, metric, period, level, used, quota_limit, status, attempts, next_attempt_at, created_at, updated_at)
      SELECT ?, ?, ?, 'blocked', ${metric}, ?, 'pending', 0, ?, ?, ?
      FROM image_request_usage WHERE month = ? AND ${metric} >= ? ON CONFLICT(alert_key) DO NOTHING`)
      .bind(`${metric}:${month}:blocked`, metric, month, limit, stamp, stamp, stamp, month, limit).run()
  if (!result.success) throw new Error('Kontingentwarnung konnte nicht gespeichert werden.')
}
