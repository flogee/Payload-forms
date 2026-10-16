import { z } from 'zod'
import type { Answers, Choice, Count, Definition, Question } from './types'
import { contentBlocksSchema } from './content'
import { sliderSettings } from './voting'
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)
const questionSchema = z.object({
  id: key, block: z.string().min(1).max(30), label: z.string().min(1).max(1000),
  kind: z.enum(['text', 'textarea', 'single', 'multiple', 'count', 'matrix', 'counts', 'committees', 'slider', 'stars', 'smiley', 'ranking']),
  help: z.string().max(4000).optional(), optional: z.boolean().optional(), allowNA: z.boolean().optional(),
  min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional(),
  step: z.number().int().min(1).max(100).optional(),
  lowLabel: z.string().max(200).optional(), highLabel: z.string().max(200).optional(),
  options: z.array(z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(1000), exclusive: z.boolean().optional() })).max(40).optional(),
  rows: z.array(z.object({ key, label: z.string().min(1).max(1000) })).max(30).optional(),
  showIf: z.object({ field: key, values: z.array(z.string()).min(1).max(40) }).optional()
})
export const definitionSchema = z.object({
  version: z.string().min(1).max(100), introduction: z.array(z.string().max(4000)).max(10), introContent: contentBlocksSchema.optional(),
  sections: z.array(z.object({ id: key, title: z.string().min(1).max(200), description: z.string().max(1000).optional(), questions: z.array(questionSchema).min(1).max(80), content: contentBlocksSchema.optional() })).min(1).max(15)
}).superRefine((def, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(def)).length > 256000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Die Fragebogenfassung ist zu groß (höchstens 256 KB).' })
  if (def.introContent?.some(block => block.afterQuestion)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Einleitungsblöcke haben keine Frageposition.' })
  for (const section of def.sections) for (const block of section.content ?? []) {
    if (block.afterQuestion && !section.questions.some(question => question.id === block.afterQuestion)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Die Position des Inhaltsblocks gehört zu keiner Frage dieses Abschnitts.' })
  }
  const seen = new Map<string, Question>()
  for (const section of def.sections) for (const q of section.questions) {
    const error = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${q.id}: ${message}` })
    if (seen.has(q.id)) error('Fragekennung doppelt')
    if (['single', 'multiple', 'matrix'].includes(q.kind) && !q.options?.length) error('Antwortoptionen fehlen')
    if (['counts', 'matrix'].includes(q.kind) && !q.rows?.length) error('Zeilen fehlen')
    if (q.options && new Set(q.options.map(o => o.value)).size !== q.options.length) error('Optionskennung doppelt')
    if (q.rows && new Set(q.rows.map(r => r.key)).size !== q.rows.length) error('Zeilenkennung doppelt')
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) error('Ungültige Zahlengrenzen')
    if (q.kind === 'slider') {
      const { min, max, step } = sliderSettings(q)
      if (min >= max || max > 100 || (max - min) % step !== 0) error('Slider: Bereich zwischen 0 und 100, oberer Wert größer als unterer; Schrittweite muss den Bereich gleichmäßig teilen.')
    }
    if (q.kind === 'ranking') {
      if (!q.options || q.options.length < 2 || q.options.length > 10) error('Rangfolge braucht zwei bis zehn Antwortoptionen.')
      if (q.options?.some(o => o.exclusive)) error('Rangfolge erlaubt keine ausschließenden Optionen.')
    }
    if (q.showIf) {
      const parent = seen.get(q.showIf.field)
      if (parent?.kind !== 'single' || q.showIf.values.some(v => !parent.options?.some(o => o.value === v))) error('Sprungregel braucht eine vorhergehende Einfachauswahl mit passenden Werten')
    }
    seen.set(q.id, q as Question)
  }
  if (new Set(def.sections.map(s => s.id)).size !== def.sections.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Abschnittkennung doppelt' })
})
export function visible(q: Question, answers: Answers) {
  if (!q.showIf) return true
  const answer = answers[q.showIf.field] as Choice | undefined
  return typeof answer?.choice === 'string' && q.showIf.values.includes(answer.choice)
}
export function questions(def: Definition) { return def.sections.flatMap(s => s.questions) }
export function countSchema(q: Question) {
  return z.object({ status: z.enum(q.allowNA ? ['value', 'unknown', 'na'] : ['value', 'unknown']), value: z.number().int().min(q.min ?? 0).max(q.max ?? 100000000).optional(), note: z.string().max(500).optional() }).strict().superRefine((v, ctx) => {
    if (v.status === 'value' && v.value === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bitte eine Zahl eingeben oder „weiß nicht“ auswählen.' })
    if (v.status !== 'value' && v.value !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Zahl und fehlende Angabe dürfen nicht gleichzeitig gespeichert werden.' })
  })
}
export function answerSchema(q: Question): z.ZodTypeAny {
  const codes = q.options?.map(o => o.value) || []
  const code = z.string().refine(v => codes.includes(v), 'Ungültige Antwortoption')
  if (q.kind === 'slider') {
    const { min, max, step } = sliderSettings(q)
    return z.number().int().min(min).max(max).refine(v => (v - min) % step === 0, 'Bitte einen Wert in der eingestellten Schrittweite wählen.')
  }
  if (q.kind === 'stars' || q.kind === 'smiley') return z.number().int().min(1).max(5)
  if (q.kind === 'ranking') return z.object({ order: z.array(code).length(codes.length, 'Bitte alle Optionen in eine Rangfolge bringen oder die Auswahl zurücksetzen.') }).strict().refine(v => new Set(v.order).size === codes.length, 'Jede Option darf nur einmal in der Rangfolge vorkommen.')
  if (q.kind === 'single' || q.kind === 'multiple') return z.object({ choice: q.kind === 'single' ? code : z.array(code).max(codes.length), other: z.string().max(2000).optional() }).strict().superRefine((v, ctx) => {
    const picked = Array.isArray(v.choice) ? v.choice : [v.choice]
    if (new Set(picked).size !== picked.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Antwort doppelt ausgewählt' })
    if (picked.length > 1 && picked.some(c => q.options?.find(o => o.value === c)?.exclusive)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Diese Antwort kann nicht mit anderen kombiniert werden.' })
    if (v.other && !picked.includes('other')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Freitext ohne Auswahl „Andere“' })
  })
  if (q.kind === 'count') return countSchema(q)
  if (q.kind === 'matrix' || q.kind === 'counts') return z.object(Object.fromEntries((q.rows || []).map(r => [r.key, (q.kind === 'matrix' ? code : countSchema(q)).optional()]))).strict()
  if (q.kind === 'committees') return z.array(z.object({ body: z.string().max(300), volume: z.string().max(200) }).strict()).max(30)
  return z.string().max(q.kind === 'textarea' ? 4000 : 1000)
}
export function validateAnswers(def: Definition, input: unknown): { answers: Answers; errors: Record<string, string> } {
  const answers: Answers = {}, errors: Record<string, string> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { answers, errors: { _form: 'Antworten müssen ein Objekt sein.' } }
  const raw = input as Record<string, unknown>
  const all = questions(def), ids = new Set(all.map(q => q.id))
  for (const k of Object.keys(raw)) if (!ids.has(k)) errors[k] = 'Unbekannte Fragekennung'
  for (const q of all) {
    if (!visible(q, answers)) continue // Branch on validated parent; stale hidden answers are discarded.
    const value = raw[q.id]
    if (value === undefined || value === null || value === '') continue
    const parsed = answerSchema(q).safeParse(value)
    if (parsed.success) answers[q.id] = parsed.data
    else errors[q.id] = parsed.error.issues[0].message
  }
  return { answers, errors }
}
export function hasAnswer(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(hasAnswer)
  if (typeof value === 'object') {
    if ('choice' in value) return hasAnswer((value as Choice).choice)
    if ('status' in value) return true
    return Object.values(value).some(hasAnswer)
  }
  return true
}

/** Validate the active step without discarding unfinished visible answers in other steps. */
export function validateSectionAnswers(def: Definition, input: Answers, sectionID: string) {
  const checked = validateAnswers(def, input)
  const section = def.sections.find(s => s.id === sectionID)
  if (!section) throw new Error('Unbekannter Abschnitt')
  const active = new Set(section.questions.map(q => q.id))
  const answers = { ...checked.answers }
  for (const q of questions(def)) {
    if (!active.has(q.id) && checked.errors[q.id] && visible(q, checked.answers)) answers[q.id] = input[q.id]
  }
  return { answers, errors: Object.fromEntries(Object.entries(checked.errors).filter(([id]) => active.has(id))) }
}
