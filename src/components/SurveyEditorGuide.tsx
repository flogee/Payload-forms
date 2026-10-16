'use client'

import { FieldDescription, useFormFields } from '@payloadcms/ui'
import type { FieldDescriptionClientProps } from 'payload'
import { answerFormat, answerFormats } from './SurveyEditor.helpers'
import './SurveyEditor.css'

export function SurveyEditorGuide() {
  return <div className="survey-editor__guide">
    <p>Abschnitte und Fragen aufklappen, um sie zu bearbeiten. Die Überschriften zeigen den aktuellen Inhalt; die Reihenfolge lässt sich durch Ziehen am Griff ändern.</p>
    <details>
      <summary>Welches Antwortformat passt? Alle {Object.keys(answerFormats).length} Formate anzeigen</summary>
      <dl className="survey-editor__formats">{Object.entries(answerFormats).map(([kind, format]) => <div key={kind}>
        <dt>{format.label}</dt><dd>{format.description}</dd>
      </div>)}</dl>
      <p>Einleitungsabsätze sowie Text- und Bildblöcke vermitteln Inhalte und erzeugen keine Antwortfelder.</p>
    </details>
  </div>
}

export function SurveyEditorFormatDescription({ path }: FieldDescriptionClientProps) {
  const kind = useFormFields(([fields]) => fields[path]?.value)
  return <FieldDescription path={path} description={answerFormat(kind)?.description || 'Ein Antwortformat auswählen. Die Übersicht über alle Formate steht oberhalb der Einleitung.'} />
}
