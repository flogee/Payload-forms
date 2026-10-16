import { alertInsert } from './budget-alert-events'
import { PUBLIC_LIMITS, type PublicMetric } from './public-limits'

const rateWarningAttempts = new WeakMap<object, string>()
export async function recordPublicRateBlock(db: Pick<D1Database, 'prepare'>, now = new Date()) {
  const stamp = now.toISOString(), month = stamp.slice(0, 7)
  // At most one recording attempt per isolate/binding/month; D1 also deduplicates
  // globally. Blocked bursts must not create a DB write or mail per request.
  if (rateWarningAttempts.get(db) === month) return
  rateWarningAttempts.set(db, month)
  const result = await db.prepare(alertInsert).bind(`rate:${month}:blocked`, 'rate', month, 'blocked', 1, 1, stamp, stamp, stamp).run()
  if (!result.success) throw new Error('PUBLIC_RATE_ALERT_UNAVAILABLE')
}

export async function reservePublicRequest(db: Pick<D1Database, 'prepare'>, metric: PublicMetric, now = new Date()) {
  const stamp = now.toISOString(), month = stamp.slice(0, 7)
  const field = metric === 'participation' ? 'reads' : 'submissions', limit = PUBLIC_LIMITS[field]
  // Atomic across both domains and all locations. Count attempts before Payload
  // initialization/queries, including invalid requests and provider failures.
  const result = await db.prepare(`INSERT INTO public_request_usage (month, reads, submissions) VALUES (?, ${field === 'reads' ? '1, 0' : '0, 1'})
    ON CONFLICT(month) DO UPDATE SET ${field} = ${field} + 1 WHERE ${field} < ?`).bind(month, limit).run()
  if (!result.success) throw new Error('PUBLIC_BUDGET_UNAVAILABLE')
  if (result.meta.changes === 1) return true
  const alert = await db.prepare(alertInsert).bind(`${metric}:${month}:blocked`, metric, month, 'blocked', limit, limit, stamp, stamp, stamp).run()
  if (!alert.success) throw new Error('PUBLIC_BUDGET_ALERT_UNAVAILABLE')
  return false
}
