'use client'

import { useRowLabel } from '@payloadcms/ui'
import { contentRowLabel, itemRowLabel, questionRowLabel, sectionRowLabel, type EditorRow, type EditorRowLabel } from './SurveyEditor.helpers'
import './SurveyEditor.css'

function Label({ title, detail }: EditorRowLabel) {
  return <span className="row-label survey-editor__row-label">
    <span className="survey-editor__row-title">{title}</span>
    {detail && <span className="survey-editor__row-detail">{detail}</span>}
  </span>
}

export function SurveyEditorSectionLabel() {
  const { data, rowNumber } = useRowLabel<EditorRow>()
  return <Label {...sectionRowLabel(data || {}, rowNumber)} />
}

export function SurveyEditorQuestionLabel() {
  const { data, rowNumber } = useRowLabel<EditorRow>()
  return <Label {...questionRowLabel(data || {}, rowNumber)} />
}

export function SurveyEditorIntroductionLabel() {
  const { data, rowNumber } = useRowLabel<EditorRow>()
  return <Label {...itemRowLabel(data || {}, 'text', 'Neuer Einleitungsabsatz', rowNumber)} />
}

export function SurveyEditorOptionLabel() {
  const { data, rowNumber } = useRowLabel<EditorRow>()
  return <Label {...itemRowLabel(data || {}, 'label', 'Neue Antwortoption', rowNumber)} />
}

export function SurveyEditorAnswerRowLabel() {
  const { data, rowNumber } = useRowLabel<EditorRow>()
  return <Label {...itemRowLabel(data || {}, 'label', 'Neue Bewertungs- oder Zahlenzeile', rowNumber)} />
}

export function SurveyEditorContentLabel() {
  const { data, rowNumber } = useRowLabel<EditorRow>()
  return <Label {...contentRowLabel(data || {}, rowNumber)} />
}
