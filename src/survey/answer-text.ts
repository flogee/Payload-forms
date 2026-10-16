import type { Answer, Choice, Count, Question, Ranking } from './types'
import { ratingLabels } from './voting'

function countText(value: Count | undefined) {
  if (!value) return 'Keine Angabe'
  const text = value.status === 'value' ? String(value.value) : value.status === 'unknown' ? 'Weiß nicht' : 'Nicht zutreffend'
  return value.note ? `${text} (${value.note})` : text
}

export function answerText(question: Question, answer: Answer | undefined): string {
  if (answer == null || answer === '') return 'Keine Angabe'
  if (typeof answer === 'string') return answer
  if (typeof answer === 'number') return question.kind === 'stars' || question.kind === 'smiley'
    ? `${answer} / 5 · ${ratingLabels(question)[answer - 1]}` : String(answer)
  if (question.kind === 'ranking') return (answer as Ranking).order.map((code, i) => `${i + 1}. ${question.options?.find(o => o.value === code)?.label || code}`).join('\n') || 'Keine Angabe'
  if (question.kind === 'single' || question.kind === 'multiple') {
    const value = answer as Choice
    const choices = Array.isArray(value.choice) ? value.choice : [value.choice]
    const text = choices.map(choice => question.options?.find(option => option.value === choice)?.label || choice).join(', ')
    return value.other ? `${text}: ${value.other}` : text || 'Keine Angabe'
  }
  if (question.kind === 'count') return countText(answer as Count)
  if (question.kind === 'matrix' || question.kind === 'counts') {
    const values = answer as Record<string, string | Count>
    return question.rows!.map(row => `${row.label}: ${question.kind === 'counts' ? countText(values[row.key] as Count)
      : question.options?.find(option => option.value === values[row.key])?.label || values[row.key] || 'Keine Angabe'}`).join('\n')
  }
  if (Array.isArray(answer)) return answer.map(row => `${row.body}: ${row.volume || 'Keine Umfangsangabe'}`).join('\n') || 'Keine Angabe'
  return 'Keine Angabe'
}
