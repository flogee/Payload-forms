import { APIError, type BaseDatabaseAdapter, type PayloadRequest } from 'payload'
import { responseDatabase, runBatch } from './response-store'
import { canonicalJSON } from './privacy-crypto'

const instrumentArrays = ['introduction', 'introContent', 'sections'] as const
// Server-only snapshots from the validated collection hook, scoped to request + ID.
export const instrumentFields = ['title', 'slug', 'version', 'introduction', 'introContent', 'sections', 'privacy'] as const
type Snapshot = { arrays: string[]; instrument: string[]; phase: unknown; updatedAt: unknown }
const originals = new WeakMap<Partial<PayloadRequest>, Map<string, Snapshot>>()

export function rememberSurveyArrays(req: PayloadRequest, id: string | number, doc: Record<string, unknown>) {
  const documents = originals.get(req) ?? new Map<string, Snapshot>()
  documents.set(String(id), { arrays: instrumentArrays.map(field => canonicalJSON(doc[field])),
    instrument: instrumentFields.map(field => canonicalJSON(doc[field])), phase: doc.phase, updatedAt: doc.updatedAt })
  originals.set(req, documents)
}

export function preserveUnchangedSurveyArrays(update: BaseDatabaseAdapter['updateOne']): BaseDatabaseAdapter['updateOne'] {
  return async function (this: BaseDatabaseAdapter, args) {
    const documents = args.req && originals.get(args.req)
    const key = String(args.id)
    const original = args.collection === 'surveys' ? documents?.get(key) : undefined
    if (original) documents!.delete(key)
    // Drizzle replaces all child tables when ANY array is written. Only take its
    // scalar-update path when ALL instrument arrays match the persisted document.
    // The field hooks/validation have already run; changed arrays use the full path.
    if (!original || instrumentArrays.some((field, index) => canonicalJSON(args.data[field]) !== original.arrays[index])) {
      return update.call(this, args)
    }
    const data = { ...args.data }
    for (const field of instrumentArrays) delete data[field]
    return update.call(this, { ...args, data })
  }
}

// D1 cannot hold a transaction across Payload's nested writes. Acquire an atomic,
// fail-closed edit token before those writes so the first real response cannot
// arrive halfway through a replacement. A crashed writer leaves the token in
// place: recovery must verify that writer has stopped before clearing it.
export function guardSurveyEdits(update: BaseDatabaseAdapter['updateOne']): BaseDatabaseAdapter['updateOne'] {
  return async function (this: BaseDatabaseAdapter, args) {
    const original = args.collection === 'surveys' && args.req ? originals.get(args.req)?.get(String(args.id)) : undefined
    if (!original) return update.call(this, args)
    const data = { ...args.data }
    delete data.firstRealResponseAt
    delete data.instrumentEditToken
    const changed = instrumentFields.some((field, index) => data[field] !== undefined && canonicalJSON(data[field]) !== original.instrument[index])
      || (data.phase !== undefined && data.phase !== original.phase && data.phase !== 'closed')
    if (!changed) {
      // Only scalar operational saves may omit unchanged protected fields.
      // A full array replacement needs every merged NOT NULL scalar and array;
      // its edit token/CAS protects that complete replacement from stale writes.
      instrumentFields.forEach((field, index) => {
        if (!instrumentArrays.some(array => array === field) && canonicalJSON(data[field]) === original.instrument[index]) delete data[field]
      })
      if (data.phase === original.phase) delete data.phase
      return update.call(this, { ...args, data })
    }
    const db = responseDatabase({ db: this }), token = crypto.randomUUID()
    const [lock] = await runBatch(db, [{
      sql: `UPDATE surveys SET instrument_edit_token = ? WHERE id = ? AND updated_at = ?
        AND first_real_response_at IS NULL AND instrument_edit_token IS NULL RETURNING id`,
      values: [token, Number(args.id), String(original.updatedAt)],
    }])
    if (!lock.results.length) throw new APIError('Diese Fassung enthält bereits echte Antworten oder wird gerade geändert. Bitte lade sie neu.', 409)
    // Nested writes are not transactional. A failed replacement may be partial,
    // so keep its token for verified recovery instead of reopening participation.
    const result = await update.call(this, { ...args, data })
    await runBatch(db, [{ sql: 'UPDATE surveys SET instrument_edit_token = NULL WHERE id = ? AND instrument_edit_token = ?', values: [Number(args.id), token] }])
    return result
  }
}
