import type { Question } from './types'

export function sliderSettings(q: Pick<Question, 'min' | 'max' | 'step'>) {
  return { min: q.min ?? 0, max: q.max ?? 10, step: q.step ?? 1 }
}

export function ratingLabels(q: Question): string[] {
  const labels = q.kind === 'smiley'
    ? ['Sehr unzufrieden', 'Unzufrieden', 'Neutral', 'Zufrieden', 'Sehr zufrieden']
    : ['1 Stern', '2 Sterne', '3 Sterne', '4 Sterne', '5 Sterne']
  if (q.lowLabel) labels[0] = q.lowLabel
  if (q.highLabel) labels[4] = q.highLabel
  return labels
}
