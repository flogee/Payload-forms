import { APIError, type BaseDatabaseAdapter, type PayloadRequest } from 'payload'
import { responseDatabase, runBatch } from './response-store'
import { canonicalJSON } from './privacy-crypto'
import { editorialState, type EditorialCorrection } from './editorial-correction'

const instrumentArrays = ['introduction', 'introContent', 'sections'] as const
// Server-only snapshots from the validated collection hook, scoped to request + ID.
export const instrumentFields = ['title', 'slug', 'version', 'introduction', 'introContent', 'sections', 'privacy'] as const
type Snapshot = { arrays: string[]; instrument: string[]; phase: unknown; updatedAt: unknown; firstRealResponseAt: unknown; correction?: EditorialCorrection; approved?: Record<string, unknown>; approvedState?: string }
const originals = new WeakMap<Partial<PayloadRequest>, Map<string, Snapshot>>()

export function rememberSurveyArrays(req: PayloadRequest, id: string | number, doc: Record<string, unknown>, correction?: EditorialCorrection, approved?: Record<string, unknown>) {
  const documents = originals.get(req) ?? new Map<string, Snapshot>()
  documents.set(String(id), { arrays: instrumentArrays.map(field => canonicalJSON(doc[field])),
    instrument: instrumentFields.map(field => canonicalJSON(doc[field])), phase: doc.phase, updatedAt: doc.updatedAt,
    firstRealResponseAt: doc.firstRealResponseAt, correction,
    approved: correction && approved ? structuredClone(approved) : undefined,
    approvedState: correction && approved ? canonicalJSON(editorialState(approved)) : undefined })
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
    if (!original) {
      if (args.collection === 'surveys') throw new APIError('Die Bearbeitungsprüfung fehlt. Bitte die Verwaltung neu laden; bei lokaler Entwicklung den Server neu starten.', 409)
      return update.call(this, args)
    }
    const data = { ...args.data }
    delete data.firstRealResponseAt
    delete data.instrumentEditToken
    delete data.editorialCorrection
    delete data.correctionReason
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
      // Closing and other scalar saves must not race a full correction writer,
      // which carries the old phase. These safe scalar saves need no timestamp
      // CAS: stripped protected fields can never restore an older instrument.
      const db = responseDatabase({ db: this }), token = crypto.randomUUID()
      const [lock] = await runBatch(db, [{ sql: 'UPDATE surveys SET instrument_edit_token = ? WHERE id = ? AND instrument_edit_token IS NULL RETURNING id', values: [token, Number(args.id)] }])
      if (!lock.results.length) throw new APIError('Der Fragebogen wird gerade gespeichert. Bitte anschließend erneut versuchen.', 409)
      data.instrumentEditToken = token
      const result = await update.call(this, { ...args, data })
      const [released] = await runBatch(db, [{ sql: 'UPDATE surveys SET instrument_edit_token = NULL WHERE id = ? AND instrument_edit_token = ? RETURNING id', values: [Number(args.id), token] }])
      if (!released.results.length) throw new APIError('Die Speicherung konnte nicht abgeschlossen werden. Bitte den Betrieb kontaktieren.', 409)
      return result
    }
    const db = responseDatabase({ db: this }), token = crypto.randomUUID()
    const correction = original.correction
    let approved = false
    if (correction) try { approved = canonicalJSON(editorialState({ ...original.approved, ...data })) === original.approvedState } catch { /* Unknown post-validation fields fail closed. */ }
    if (correction && (!approved || (data.phase !== undefined && data.phase !== original.phase && data.phase !== 'closed'))) {
      throw new APIError('Die Korrektur wurde nach der Prüfung verändert. Bitte erneut laden und prüfen.', 409)
    }
    if (original.firstRealResponseAt && !correction) throw new APIError('Diese Fassung ist eingefroren. Bitte den Korrekturmodus verwenden.', 409)
    const now = new Date().toISOString()
    const locked = await runBatch(db, [{
      sql: `UPDATE surveys SET instrument_edit_token = ? WHERE id = ? AND updated_at = ?
        AND ${correction ? 'first_real_response_at = ?' : 'first_real_response_at IS NULL'} AND instrument_edit_token IS NULL RETURNING id`,
      values: [token, Number(args.id), String(original.updatedAt), ...(correction ? [String(original.firstRealResponseAt)] : [])],
    }, ...(correction ? [{
      sql: `INSERT INTO survey_corrections (survey_id, corrected_by_id, reason, status, "before", "after", before_hash, after_hash, edit_token, created_at, updated_at)
        SELECT id, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ? FROM surveys WHERE id = ? AND instrument_edit_token = ? RETURNING id`,
      values: [correction.actor, correction.reason, JSON.stringify(correction.before), JSON.stringify(correction.after), correction.beforeHash, correction.afterHash, token, now, now, Number(args.id), token],
    }] : [])])
    const [lock] = locked
    if (!lock.results.length) throw new APIError('Diese Fassung enthält bereits echte Antworten oder wird gerade geändert. Bitte lade sie neu.', 409)
    if (correction && !locked[1]?.results.length) throw new APIError('Das Korrekturprotokoll konnte nicht angelegt werden. Die Teilnahme bleibt bis zur Prüfung gesperrt.', 409)
    // The full-row writer must retain both the permanent freeze and our lock.
    data.instrumentEditToken = token
    if (original.firstRealResponseAt) data.firstRealResponseAt = original.firstRealResponseAt
    // Nested writes are not transactional. A failed replacement may be partial,
    // so keep its token for verified recovery instead of reopening participation.
    const result = await update.call(this, { ...args, data })
    const finished = await runBatch(db, [
      ...(correction ? [{ sql: `UPDATE survey_corrections SET status = 'committed', updated_at = ? WHERE edit_token = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM surveys WHERE id = ? AND instrument_edit_token = ?) RETURNING id`, values: [new Date().toISOString(), token, Number(args.id), token] }] : []),
      { sql: `UPDATE surveys SET instrument_edit_token = NULL WHERE id = ? AND instrument_edit_token = ?
        ${correction ? "AND EXISTS (SELECT 1 FROM survey_corrections WHERE edit_token = ? AND status = 'committed')" : ''} RETURNING id`,
        values: [Number(args.id), token, ...(correction ? [token] : [])] },
    ])
    if (finished.some(result => !result.results.length)) throw new APIError('Die Speicherung konnte nicht abgeschlossen werden. Bitte den Betrieb kontaktieren; die Teilnahme bleibt bis zur Prüfung gesperrt.', 409)
    return result
  }
}
