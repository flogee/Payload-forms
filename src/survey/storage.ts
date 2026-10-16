import type { Definition, Question } from './types'
import { definitionSchema } from './validation'
const compact = (value: unknown): unknown => Array.isArray(value) ? value.map(compact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k, v]) => k !== 'id' && v !== null && v !== undefined).map(([k, v]) => [k, compact(v)])) : value
export function toStored(def: Definition) {
  return { version: def.version, introduction: def.introduction.map(text => ({ text })), introContent: def.introContent ?? [], sections: def.sections.map(({ id, questions, ...s }) => ({ ...s, content: s.content ?? [], key: id, questions: questions.map(({ id, ...q }) => ({ ...q, code: id })) })) }
}
export function fromStored(doc: Record<string, any>): Definition {
  const blocks = (value: any) => value?.length ? value.map((block: any) => ({ ...block, ...(block.image != null ? { image: typeof block.image === 'object' ? block.image.id : block.image } : {}), ...(block.afterQuestion === '' ? { afterQuestion: undefined } : {}) })) : undefined
  const input = compact({ version: doc.version, introduction: doc.introduction?.map((x: { text: string }) => x.text), introContent: blocks(doc.introContent), sections: doc.sections?.map((s: any) => ({ id: s.key, title: s.title, description: s.description, content: blocks(s.content), questions: s.questions?.map((q: any) => ({ ...q, id: q.code })) })) }) as Record<string, any>
  // compact removes Payload array IDs; re-add the stable research IDs explicitly.
  input.sections?.forEach((s: any, i: number) => { s.id = doc.sections[i].key; s.questions.forEach((q: Question, j: number) => { q.id = doc.sections[i].questions[j].code }) })
  return definitionSchema.parse(input) as Definition
}
