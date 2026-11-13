import type { AnalysisSeries } from './analysis-types'
import type { NumericReport, ReportBuildInput, ReportEntry, SurveyReport } from './report-types'
import type { Answers, Choice, Count } from './types'
import { validateAnswers, visible } from './validation'

// Validation must see stored own properties only, including inside row/choice objects.
function ownData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ownData)
  if (!value || typeof value !== 'object') return value
  return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ownData(entry)])))
}
function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
function numericReport(values: number[], label: string, rowID?: string): NumericReport[] {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const minimum = sorted[0], maximum = sorted.at(-1)!
  const frequencies = new Map<number, number>()
  for (const value of sorted) frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
  const bins = frequencies.size <= 10
    ? [...frequencies].map(([value, count]) => ({ value: String(value), label: String(value), count }))
    : (() => {
      const width = Math.ceil((maximum - minimum + 1) / 8)
      return Array.from({ length: Math.ceil((maximum - minimum + 1) / width) }, (_, index) => {
        const low = minimum + index * width, high = Math.min(maximum, low + width - 1)
        return { value: `${low}-${high}`, label: `${low}–${high}`, count: 0 }
      }).map((bin, index) => ({ ...bin, count: sorted.filter(value => Math.floor((value - minimum) / width) === index).length }))
    })()
  return [{ ...(rowID === undefined ? {} : { rowID }), label, observations: sorted.length, minimum, maximum,
    median: median(sorted), bins: bins.map(bin => ({ ...bin, percent: Math.round(bin.count / sorted.length * 1000) / 10 })) }]
}

/** Human-only detail from the selected saved instrument and already-filtered records. */
export function buildSurveyReport(input: ReportBuildInput): SurveyReport {
  const { definition, records, aggregate, dataset, excludedResponses } = input
  const seriesByQuestion = new Map<string, AnalysisSeries[]>()
  for (const section of aggregate.sections) for (const series of section.series) {
    const group = seriesByQuestion.get(series.questionID) ?? []
    group.push(series)
    seriesByQuestion.set(series.questionID, group)
  }
  const checked = records.map(record => ({ id: record.id,
    answers: Object.assign(Object.create(null), validateAnswers(definition,
      Object.assign(Object.create(null), ownData(record.answers))).answers) as Answers,
  }))
  const durations = records.map(record => record.durationSeconds).filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400).sort((a, b) => a - b)
  return {
    aggregate, dataset, excludedResponses, totalResponses: records.length + excludedResponses,
    medianDurationSeconds: durations.length ? median(durations) : null,
    sections: definition.sections.map(section => ({ id: section.id, title: section.title,
      questions: section.questions.map(question => {
        const entries: ReportEntry[] = [], numbers: number[] = []
        const rowNumbers = new Map((question.rows ?? []).map(row => [row.key, [] as number[]]))
        for (const record of checked) {
          if (!visible(question, record.answers) || !Object.hasOwn(record.answers, question.id)) continue
          const value = record.answers[question.id]
          const add = (text: string | undefined) => { if (text?.trim()) entries.push({ responseID: record.id, text }) }
          const count = (answer: Count, values: number[], prefix = '') => {
            if (answer.status === 'value' && typeof answer.value === 'number') values.push(answer.value)
            if (answer.note?.trim()) add(`${prefix}${answer.note}`)
          }
          if (question.kind === 'text' || question.kind === 'textarea') add(value as string)
          else if (question.kind === 'single' || question.kind === 'multiple') {
            const choice = value as Choice
            if (Array.isArray(choice.choice) ? choice.choice.includes('other') : choice.choice === 'other') add(choice.other)
          } else if (question.kind === 'count') count(value as Count, numbers)
          else if (question.kind === 'counts') {
            const rows = value as Record<string, Count>
            for (const row of question.rows ?? []) if (Object.hasOwn(rows, row.key) && rows[row.key]) {
              count(rows[row.key], rowNumbers.get(row.key)!, `${row.label}: `)
            }
          } else if (question.kind === 'committees') {
            for (const [index, row] of (value as { body: string; volume: string }[]).entries()) {
              if (row.body.trim() || row.volume.trim()) add(`${row.body.trim() || `Einheit ${index + 1}`}${row.volume.trim() ? `: ${row.volume}` : ''}`)
            }
          }
        }
        return { id: question.id, block: question.block, label: question.label, kind: question.kind,
          ...(question.help === undefined ? {} : { help: question.help }), series: seriesByQuestion.get(question.id) ?? [], entries,
          numeric: question.kind === 'count' ? numericReport(numbers, question.label)
            : question.kind === 'counts' ? (question.rows ?? []).flatMap(row => numericReport(rowNumbers.get(row.key)!, row.label, row.key)) : [],
        }
      }),
    })),
  }
}
