import type { Answers, Count, Definition, Ranking } from './types'
import { digest } from './privacy-crypto'
import { definitionSchema, answerSchema, questions } from './validation'
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text
  return `"${text.replaceAll('"', '""')}"`
}
type CSVResponse = { id: number; version: string; createdAt: string; durationSeconds?: number; testOnly?: boolean; answers: Answers; instrument?: unknown }
type Column = { id: string; key: string; get: (answers: Answers) => unknown }
function columns(def: Definition): Column[] {
  const specs: Column[] = []
  for (const q of questions(def)) {
    const add = (key: string, component: (string | number)[], get: Column['get']) => specs.push({ id: JSON.stringify([q.id, ...component]), key, get })
    if (q.kind === 'count' || q.kind === 'counts') {
      for (const r of q.kind === 'counts' ? q.rows! : [{ key: '', label: '' }]) for (const field of ['status', 'value', 'note'] as const) {
        add(`${q.id}${r.key ? '_' + r.key : ''}_${field}`, ['count', r.key, field], a => {
          const value = r.key ? (a[q.id] as Record<string, Count> | undefined)?.[r.key] : a[q.id] as Count | undefined
          return field === 'status' ? value?.status ?? 'missing' : value?.[field]
        })
      }
    } else if (q.kind === 'ranking') {
      const schema = answerSchema(q)
      for (let position = 0; position < (q.options?.length ?? 0); position++) add(`${q.id}_rank_${position + 1}`, ['rank', position], a => {
        const parsed = schema.safeParse(a[q.id])
        return parsed.success ? (parsed.data as Ranking).order[position] : undefined
      })
    } else if (q.kind === 'slider' || q.kind === 'stars' || q.kind === 'smiley') {
      const schema = answerSchema(q)
      add(q.id, ['answer'], a => { const parsed = schema.safeParse(a[q.id]); return parsed.success ? parsed.data : undefined })
    } else if (q.kind === 'matrix') {
      for (const r of q.rows!) add(`${q.id}_${r.key}`, ['row', r.key], a => (a[q.id] as Record<string, string> | undefined)?.[r.key])
    } else if (q.kind === 'single' || q.kind === 'multiple') {
      add(q.id, ['answer'], a => (a[q.id] as { choice: unknown } | undefined)?.choice)
      add(`${q.id}_other`, ['other'], a => (a[q.id] as { other?: string } | undefined)?.other)
    } else add(q.id, ['answer'], a => a[q.id])
  }
  return specs
}
export function exportCSV(def: Definition, docs: CSVResponse[]) {
  const hasSnapshots = docs.some(d => d.instrument != null)
  const definitions = docs.map(d => d.instrument == null ? def : definitionSchema.parse(d.instrument) as Definition)
  const specs = definitions.map(d => new Map(columns(d).map(s => [s.id, s])))
  const union = new Map([...columns(def), ...specs.flatMap(s => [...s.values()])].map(s => [s.id, s]))
  const headers = ['response_id', 'version', 'test_only', 'created_at', 'duration_seconds', ...(hasSnapshots ? ['instrument_revision'] : [])]
  const used = new Set(headers)
  for (const column of union.values()) {
    let header = column.key, suffix = 2
    while (used.has(header)) header = `${column.key}__${suffix++}`
    used.add(header); headers.push(header)
  }
  return '\uFEFF' + [headers.map(csvCell).join(','), ...docs.map((d, i) => [
    d.id, d.version, d.testOnly ?? true, d.createdAt, d.durationSeconds, ...(hasSnapshots ? [digest(definitions[i])] : []),
    ...[...union.keys()].map(id => specs[i].get(id)?.get(d.answers)),
  ].map(csvCell).join(','))].join('\r\n')
}
