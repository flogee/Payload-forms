import { participantText, type ParticipantLanguage } from './participant-language'
import type { Question } from './types'

export function sliderSettings(q: Pick<Question, 'min' | 'max' | 'step'>) {
  return { min: q.min ?? 0, max: q.max ?? 10, step: q.step ?? 1 }
}

export function ratingLabels(q: Question, language: ParticipantLanguage = 'de'): string[] {
  const t = participantText(language)
  const labels = q.kind === 'smiley'
    ? [t("Sehr unzufrieden"), t("Unzufrieden"), t("Neutral"), t("Zufrieden"), t("Sehr zufrieden")]
    : [t("1 Stern"), t("2 Sterne"), t("3 Sterne"), t("4 Sterne"), t("5 Sterne")]
  if (q.lowLabel) labels[0] = q.lowLabel
  if (q.highLabel) labels[4] = q.highLabel
  return labels
}
