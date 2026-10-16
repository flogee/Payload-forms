import type { BaseDatabaseAdapter, PayloadRequest } from 'payload'
import { canonicalJSON } from './privacy-crypto'

const instrumentArrays = ['introduction', 'introContent', 'sections'] as const
// Server-only snapshots from the validated collection hook, scoped to request + ID.
const originals = new WeakMap<Partial<PayloadRequest>, Map<string, string[]>>()

export function rememberSurveyArrays(req: PayloadRequest, id: string | number, doc: Record<string, unknown>) {
  const documents = originals.get(req) ?? new Map<string, string[]>()
  documents.set(String(id), instrumentArrays.map(field => canonicalJSON(doc[field])))
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
    if (!original || instrumentArrays.some((field, index) => canonicalJSON(args.data[field]) !== original[index])) {
      return update.call(this, args)
    }
    const data = { ...args.data }
    for (const field of instrumentArrays) delete data[field]
    return update.call(this, { ...args, data })
  }
}
