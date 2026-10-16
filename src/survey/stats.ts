import type { Answers, Choice, Definition, Question } from './types'
import { hasAnswer, questions, visible } from './validation'
// No raw strings, organisation names, committee names, or other-text leave this aggregator.
export function aggregate(def: Definition, records: Answers[]) {
  const out: Record<string, unknown> = {}
  function distribution(q: Question, values: unknown[]) {
    const counts: Record<string, number> = Object.fromEntries((q.options || []).map(o => [o.label, 0]))
    let answered = 0
    for (const v of values) {
      const choice = typeof v === 'string' ? v : (v as Choice | undefined)?.choice
      const codes = Array.isArray(choice) ? choice : choice ? [choice] : []
      if (codes.length) answered++
      for (const code of codes) { const label = q.options?.find(o => o.value === code)?.label; if (label) counts[label]++ }
    }
    return { eligible: values.length, answered, missing: values.length - answered, counts, multipleChoice: q.kind === 'multiple' }
  }
  for (const q of questions(def)) {
    const values = records.filter(a => visible(q, a)).map(a => a[q.id])
    if (q.kind === 'single' || q.kind === 'multiple') out[q.id] = distribution(q, values)
    else if (q.kind === 'matrix') out[q.id] = Object.fromEntries((q.rows || []).map(row => [row.label, distribution(q, values.map(v => v && !Array.isArray(v) && typeof v === 'object' ? (v as Record<string, unknown>)[row.key] : undefined))]))
    else out[q.id] = { eligible: values.length, answered: values.filter(hasAnswer).length, missing: values.filter(v => !hasAnswer(v)).length, note: 'Inhalte und einzelne Zahlen werden über MCP nicht ausgegeben.' }
  }
  return { responses: records.length, unit: 'Antworten, keine unabhängigen Organisationen', version: def.version, results: out }
}
