import { APIError } from 'payload'
import { managesTeam } from '../auth/team'
import { canonicalJSON, digest } from './privacy-crypto'
import { definitionStructureHash } from './questionnaire-structure'
import { fromStored } from './storage'

type Document = Record<string, any>
export type EditorialCorrection = {
  actor: number; reason: string; beforeHash: string; afterHash: string
  before: { title: string; definition: ReturnType<typeof fromStored> }
  after: { title: string; definition: ReturnType<typeof fromStored> }
}

// Reject unrecognized stored logic before the normal parser can discard it.
// Payload row IDs and block names are editor metadata, not research identifiers.
function known(value: Document, keys: string[]) {
  for (const key of Object.keys(value)) if (!['id', 'blockName', ...keys].includes(key)) throw new Error(`Unbekanntes Strukturfeld: ${key}`)
}
function checkStored(doc: Document) {
  const blocks = (items: Document[] = []) => items.forEach(b => known(b,
    b.blockType === 'text' ? ['blockType', 'content', 'afterQuestion'] : ['blockType', 'image', 'alt', 'caption', 'afterQuestion']))
  doc.introduction?.forEach((p: Document) => known(p, ['text']))
  blocks(doc.introContent ?? [])
  doc.sections?.forEach((s: Document) => {
    known(s, ['key', 'title', 'description', 'questions', 'content']); blocks(s.content ?? [])
    s.questions?.forEach((q: Document) => {
      known(q, ['code', 'block', 'label', 'kind', 'help', 'options', 'rows', 'allowNA', 'min', 'max', 'step', 'lowLabel', 'highLabel', 'showIf', 'optional'])
      q.options?.forEach((o: Document) => known(o, ['value', 'label', 'exclusive']))
      q.rows?.forEach((r: Document) => known(r, ['key', 'label']))
      if (q.showIf) known(q.showIf, ['field', 'values'])
    })
  })
}

/** Compare validated participant-visible content, not transient Payload/Lexical metadata. */
export function editorialState(doc: Document) {
  checkStored(doc)
  return { title: doc.title, slug: doc.slug, privacy: doc.privacy, definition: fromStored(doc) }
}

export function prepareEditorialCorrection(original: Document, next: Document, user: unknown, confirmation: unknown, reason: unknown): EditorialCorrection {
  if (!managesTeam(user)) throw new APIError('Nur menschliche Administratoren dürfen eine gestartete Fassung korrigieren.', 403)
  if (confirmation !== true || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
    throw new APIError('Diese Fassung ist eingefroren. Für kleine Korrekturen den Korrekturmodus bestätigen und einen Grund angeben.', 400)
  }
  try {
    const before = editorialState(original).definition, after = editorialState(next).definition
    if (original.slug !== next.slug || canonicalJSON(original.privacy) !== canonicalJSON(next.privacy)
      || definitionStructureHash(before) !== definitionStructureHash(after)) throw new Error('Die Struktur, Antwortwerte, Skalen, Sprungregeln, Linkkennung und Datenschutzangaben bleiben eingefroren. Dafür ist eine neue Fassung erforderlich.')
    return { actor: (user as { id: number }).id, reason: reason.trim(),
      beforeHash: digest({ version: before.version, sections: before.sections }), afterHash: digest({ version: after.version, sections: after.sections }),
      before: { title: original.title, definition: before }, after: { title: next.title, definition: after } }
  } catch (error) { throw new APIError(error instanceof Error ? error.message : 'Unzulässige Strukturänderung.', 400) }
}
