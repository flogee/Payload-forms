import type { Answers, Count, Definition, Ranking } from './types'
import { answerSchema, questions } from './validation'
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text
  return `"${text.replaceAll('"', '""')}"`
}
export function exportCSV(def: Definition, docs: { id: number; version: string; createdAt: string; durationSeconds?: number; testOnly?: boolean; answers: Answers }[]) {
  const headers = ['response_id', 'version', 'test_only', 'created_at', 'duration_seconds'], specs: { key: string; get: (a: Answers) => unknown }[] = []
  for (const q of questions(def)) {
    if (q.kind === 'count' || q.kind === 'counts') {
      for (const r of q.kind === 'counts' ? q.rows! : [{ key: '', label: '' }]) for (const field of ['status', 'value', 'note'] as const) specs.push({ key: `${q.id}${r.key ? '_' + r.key : ''}_${field}`, get: a => { const v = r.key ? (a[q.id] as Record<string, Count> | undefined)?.[r.key] : a[q.id] as Count | undefined; return field === 'status' ? v?.status ?? 'missing' : v?.[field] } })
    } else if (q.kind === 'ranking') {
      const schema = answerSchema(q)
      for (let position = 0; position < (q.options?.length ?? 0); position++) specs.push({ key: `${q.id}_rank_${position + 1}`, get: a => {
        const parsed = schema.safeParse(a[q.id])
        return parsed.success ? (parsed.data as Ranking).order[position] : undefined
      } })
    } else if (q.kind === 'slider' || q.kind === 'stars' || q.kind === 'smiley') {
      const schema = answerSchema(q)
      specs.push({ key: q.id, get: a => { const parsed = schema.safeParse(a[q.id]); return parsed.success ? parsed.data : undefined } })
    } else if (q.kind === 'matrix') for (const r of q.rows!) specs.push({ key: `${q.id}_${r.key}`, get: a => (a[q.id] as Record<string, string> | undefined)?.[r.key] })
    else if (q.kind === 'single' || q.kind === 'multiple') {
      specs.push({ key: q.id, get: a => (a[q.id] as { choice: unknown } | undefined)?.choice })
      specs.push({ key: `${q.id}_other`, get: a => (a[q.id] as { other?: string } | undefined)?.other })
    } else specs.push({ key: q.id, get: a => a[q.id] })
  }
  headers.push(...specs.map(s => s.key))
  return '\uFEFF' + [headers.map(csvCell).join(','), ...docs.map(d => [d.id, d.version, d.testOnly ?? true, d.createdAt, d.durationSeconds, ...specs.map(s => s.get(d.answers))].map(csvCell).join(','))].join('\r\n')
}
