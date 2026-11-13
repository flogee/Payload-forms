import type { Choice, Count, Definition, Question, Ranking } from './types'
import { definitionSchema, hasAnswer, validateAnswers, visible } from './validation'
import { ratingLabels, sliderSettings } from './voting'

export type ReadableAnswer = {
  id: string; block: string; label: string
  state: 'answered' | 'missing' | 'hidden' | 'invalid'
  lines: string[]; ordered?: boolean; list?: boolean
  rows?: { label: string; lines: string[] }[]
}
export type ResponseView = {
  id: string; version: string; createdAt?: string; durationSeconds?: number; testOnly: boolean
  sections: { id: string; title: string; questions: ReadableAnswer[] }[]
}

const noAnswer = 'Keine Angabe'
function countLines(value?: Count): string[] {
  if (!value) return [noAnswer]
  const answer = value.status === 'unknown' ? 'Kann ich nicht beurteilen'
    : value.status === 'na' ? 'Nicht zutreffend' : String(value.value)
  return [answer, ...(value.note ? [`Anmerkung: ${value.note}`] : [])]
}
function optionLabel(q: Question, code: string) {
  return q.options?.find(option => option.value === code)?.label ?? code
}

/** Interpret only the immutable snapshot saved with this response. */
export function responseView(data: Record<string, unknown>): ResponseView | null {
  const snapshot = definitionSchema.safeParse(data.instrument)
  if (!snapshot.success || !data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) return null
  const definition = snapshot.data as Definition
  const raw = Object.assign(Object.create(null), data.answers) as Record<string, unknown>
  const checked = validateAnswers(definition, raw)
  return {
    id: String(data.id ?? ''), version: typeof data.version === 'string' ? data.version : definition.version,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    durationSeconds: typeof data.durationSeconds === 'number' && Number.isFinite(data.durationSeconds) ? data.durationSeconds : undefined,
    testOnly: data.testOnly !== false,
    sections: definition.sections.map(section => ({ id: section.id, title: section.title,
      questions: section.questions.map(q => {
        const base = { id: q.id, block: q.block, label: q.label }
        if (!visible(q, checked.answers)) return { ...base, state: 'hidden', lines: ['Nicht angezeigt (Sprungregel)'] }
        if (Object.hasOwn(checked.errors, q.id)) return { ...base, state: 'invalid', lines: ['Diese gespeicherte Angabe kann nicht lesbar dargestellt werden. Siehe technische Daten.'] }
        const value = Object.hasOwn(checked.answers, q.id) ? checked.answers[q.id] : undefined
        if (!hasAnswer(value)) return { ...base, state: 'missing', lines: [noAnswer] }
        const answer: ReadableAnswer = { ...base, state: 'answered', lines: [] }
        if (q.kind === 'single' || q.kind === 'multiple') {
          const choice = value as Choice
          const selected = Array.isArray(choice.choice) ? choice.choice : [choice.choice]
          answer.lines = selected.map(code => optionLabel(q, code))
          answer.list = q.kind === 'multiple'
          if (selected.includes('other') && choice.other) answer.lines.push(`Ergänzung: ${choice.other}`)
        } else if (q.kind === 'count') answer.lines = countLines(value as Count)
        else if (q.kind === 'matrix' || q.kind === 'counts') {
          const values = value as Record<string, string | Count>
          answer.rows = q.rows!.map(row => ({ label: row.label, lines: q.kind === 'counts'
            ? countLines(values[row.key] as Count | undefined)
            : [typeof values[row.key] === 'string' ? optionLabel(q, values[row.key] as string) : noAnswer] }))
        } else if (q.kind === 'ranking') {
          answer.ordered = true
          answer.lines = (value as Ranking).order.map(code => optionLabel(q, code))
        } else if (q.kind === 'committees') {
          answer.rows = (value as { body: string; volume: string }[]).map((row, index) => ({
            label: row.body || `Einheit ${index + 1}`, lines: [row.volume || noAnswer],
          }))
        } else if (q.kind === 'slider') {
          const { min, max } = sliderSettings(q)
          answer.lines = [`${value} (Skala ${min}–${max})`, ...(q.lowLabel || q.highLabel
            ? [`Skalenenden: ${min} = ${q.lowLabel || min}; ${max} = ${q.highLabel || max}`] : [])]
        } else if (q.kind === 'stars' || q.kind === 'smiley') answer.lines = [`${value} von 5 · ${ratingLabels(q)[Number(value) - 1]}`]
        else answer.lines = [String(value)]
        return answer
      }),
    })),
  }
}

export function responseDate(value?: string, timeZone = 'UTC') {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Nicht gespeichert'
  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(new Date(value))
}
export function responseDuration(seconds?: number) {
  if (seconds === undefined) return 'Nicht gespeichert'
  const rounded = Math.max(0, Math.round(seconds))
  return `${Math.floor(rounded / 60)} Min. ${rounded % 60} Sek.`
}
