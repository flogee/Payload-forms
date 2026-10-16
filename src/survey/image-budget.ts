import { APIError } from 'payload'
import { recordImageBlock } from './budget-alert-events'
import { IMAGE_LIMITS } from './image-limits'

export { IMAGE_LIMITS, IMAGE_PREFIX } from './image-limits'
export const validImageKey = (key: unknown): key is string => typeof key === 'string' && /^forms-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(key)
type BudgetDB = Pick<D1Database, 'prepare'>
const exhausted = () => new APIError('Das Bildkontingent ist ausgeschöpft. Weitere Bildzugriffe sind bis zur Prüfung oder zum nächsten Monat gesperrt.', 429, undefined, true)

export async function reserveImageOperation(db: BudgetDB, kind: 'reads' | 'writes', now = new Date()) {
  const month = now.toISOString().slice(0, 7), limit = kind === 'reads' ? IMAGE_LIMITS.monthlyReads : IMAGE_LIMITS.monthlyWrites
  // Count attempts before R2, including provider failures. A shared atomic D1 guard
  // prevents concurrent Workers from racing past the cap. No automatic refunds.
  const result = await db.prepare(`INSERT INTO image_request_usage (month, reads, writes) VALUES (?, ${kind === 'reads' ? '1, 0' : '0, 1'})
    ON CONFLICT(month) DO UPDATE SET ${kind} = ${kind} + 1 WHERE ${kind} < ?`).bind(month, limit).run()
  if (!result.success) throw new Error('Bildkontingent konnte nicht geprüft werden.')
  if (result.meta.changes !== 1) {
    try { await recordImageBlock(db, kind, limit, IMAGE_LIMITS.objects, 0, now) }
    catch { throw new APIError('Das Bildkontingent ist ausgeschöpft. Der Warnhinweis konnte nicht gespeichert werden; bitte den Betrieb prüfen.', 429, undefined, true) }
    throw exhausted()
  }
}
export async function reserveImageStorage(db: BudgetDB, size: number) {
  if (!Number.isSafeInteger(size) || size < 1 || size > IMAGE_LIMITS.fileBytes) throw new APIError('Bilder dürfen höchstens 2 MB groß sein.', 413, undefined, true)
  const result = await db.prepare('UPDATE image_storage_usage SET reserved_bytes = reserved_bytes + ?, reserved_objects = reserved_objects + 1 WHERE id = 1 AND reserved_bytes <= ? AND reserved_objects < ?')
    .bind(size, IMAGE_LIMITS.storageBytes - size, IMAGE_LIMITS.objects).run()
  if (!result.success) throw new Error('Bildspeicher konnte nicht geprüft werden.')
  if (result.meta.changes !== 1) {
    try { await recordImageBlock(db, 'storage', IMAGE_LIMITS.storageBytes, IMAGE_LIMITS.objects, size) }
    catch { throw new APIError('Das Bildkontingent ist ausgeschöpft. Der Warnhinweis konnte nicht gespeichert werden; bitte den Betrieb prüfen.', 429, undefined, true) }
    throw exhausted()
  }
}

export function budgetedImageBucket(bucket: R2Bucket, db: BudgetDB): R2Bucket {
  // Only these methods reach the real bucket; list/multipart/other operations fail closed.
  return new Proxy(bucket, { get(target, property) {
    if (property === 'get' || property === 'head') return async (key: string, ...args: any[]) => {
      if (!validImageKey(key)) throw new Error('Ungültiger Bildschlüssel.')
      await reserveImageOperation(db, 'reads')
      return (target[property] as Function).call(target, key, ...args)
    }
    if (property === 'put') return async (key: string, value: any, ...args: any[]) => {
      if (!validImageKey(key)) throw new Error('Ungültiger Bildschlüssel.')
      const size = value instanceof Blob ? value.size : value instanceof ArrayBuffer ? value.byteLength : ArrayBuffer.isView(value) ? value.byteLength : -1
      if (size < 1 || size > IMAGE_LIMITS.fileBytes) throw new APIError('Bilder dürfen höchstens 2 MB groß sein.', 413, undefined, true)
      await reserveImageOperation(db, 'writes')
      await reserveImageStorage(db, size)
      return (target.put as Function).call(target, key, value, ...args)
    }
    // Payload may clean up after failed uploads. Deletion is free in R2; do not
    // reclaim reservations because success/rollback state may be uncertain.
    if (property === 'delete') return async (key: string) => {
      if (!validImageKey(key)) throw new Error('Ungültiger Bildschlüssel.')
      return target.delete(key)
    }
    return () => { throw new Error('Diese R2-Operation ist für Formularbilder gesperrt.') }
  } })
}
