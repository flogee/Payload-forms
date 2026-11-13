'use client'

import { useEffect, useRef, useState } from 'react'
import type { SurveyReport as Report } from '@/survey/report-types'
import { responseDuration } from '@/survey/response-view'
import { QuestionResult } from './ReportQuestion'
import './SurveyReport.css'

type Survey = { id: number; title: string; version: string; phase: string }
const reportDate = (value: string) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
const reportStamp = (value: string) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna', timeZoneName: 'short' }).format(new Date(value))


export function SurveyReport({ data, surveys, demo = false }: { data: Report; surveys: Survey[]; demo?: boolean }) {
  const report = data.aggregate
  const [includeOpen, setIncludeOpen] = useState(true)
  const expanded = useRef<HTMLDetailsElement[]>([])
  useEffect(() => {
    const before = () => {
      expanded.current = Array.from(document.querySelectorAll<HTMLDetailsElement>('.survey-report details[data-report-expand]:not([open])'))
      expanded.current.forEach(detail => { detail.open = true })
    }
    const after = () => { expanded.current.forEach(detail => { detail.open = false }); expanded.current = [] }
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after() }
  }, [])

  const totalQuestions = data.sections.reduce((n, section) => n + section.questions.length, 0)
  return <div className={`survey-report${includeOpen ? '' : ' survey-report--no-open-print'}`}>
    <header className="report-topbar report-no-print"><a href={`/auswertung?surveyID=${report.survey.id}`}>Forms · Auswertung</a><a href="/admin">Zur Verwaltung</a></header>
    <main className="report-main">
      <div className="report-heading"><div><h1>Gesamtbericht</h1><p>{report.survey.title}</p></div><span className="report-mode">{demo ? 'Erfundene Beispieldaten' : data.dataset === 'real' ? 'Echte Einsendungen · intern' : 'Pretest · nur Testdaten'}</span></div>
      <div className="report-toolbar report-no-print">
        {!demo && <form action="/auswertung/bericht" method="get"><label>Fragebogenfassung<select name="surveyID" defaultValue={report.survey.id}>{surveys.map(survey => <option key={survey.id} value={survey.id}>{survey.title} · {survey.version}</option>)}</select></label>
          <label>Datenbasis<select name="dataset" defaultValue={data.dataset}><option value="real">Echte Einsendungen</option><option value="test">Pretest-Antworten</option></select></label><button type="submit">Bericht aktualisieren</button></form>}
        <div className="report-print-controls"><button type="button" className="report-print-button" onClick={() => window.print()}>Drucken / als PDF speichern</button>
          <label><input type="checkbox" checked={includeOpen} onChange={event => setIncludeOpen(event.target.checked)} />Offene Antworten im PDF</label></div>
      </div>
      <section className="report-basis" aria-label="Datengrundlage"><dl>
        <div><dt>Einsendungen im Bericht</dt><dd>{report.responses}</dd></div>
        <div><dt>Zeitraum</dt><dd>{report.firstDate && report.lastDate ? `${reportDate(report.firstDate)} – ${reportDate(report.lastDate)}` : 'Noch keine Einsendungen'}</dd></div>
        <div><dt>Erhebungsfassung</dt><dd>{report.survey.version}</dd></div>
        <div><dt>Berichtsstand</dt><dd>{reportStamp(report.generatedAt)}</dd></div>
      </dl><p>{totalQuestions} Fragen in {data.sections.length} Abschnitten · {data.excludedResponses} Einsendungen der anderen Datenbasis nicht einbezogen{data.medianDurationSeconds !== null && ` · gemeldete Bearbeitungsdauer (Median): ${responseDuration(data.medianDurationSeconds)}`}</p></section>
      <p className="report-context">Gezählt werden einzelne Einsendungen, keine unabhängigen Organisationen. Eine Person kann ihre Organisation beschreiben; mehrere Personen können derselben Organisation angehören.</p>
      <p className="report-internal">Interner Bericht: kleine Fallzahlen und offene Antworten können Rückschlüsse auf Personen zulassen. Separat gespeicherte Kontaktangaben werden nicht einbezogen.</p>
      <div className="report-content"><aside className="report-navigation report-no-print"><nav aria-label="Berichtsabschnitte">{data.sections.map(section => <a key={section.id} href={`#section-${section.id}`}>{section.title}</a>)}</nav><a className="report-existing" href={`/auswertung?surveyID=${report.survey.id}`}>Zur bisherigen Diagrammauswertung</a></aside>
        <div className="report-sections">{!report.responses && <p className="report-empty">Für diese Auswahl gibt es noch keine Einsendungen. Die Fragen bleiben als Übersicht sichtbar.</p>}
          {data.sections.map(section => <section className="report-section" id={`section-${section.id}`} key={section.id}><h2>{section.title}</h2><div className="report-questions">{section.questions.map(question => <QuestionResult key={question.id} question={question} total={report.responses} />)}</div></section>)}
        </div></div>
      <section className="report-method"><h2>Hinweise zur Auswertung</h2><ul>
        <li>Jede Frage und Bewertungszeile hat ihre eigene Bezugsgröße. Fehlende und durch Sprungregeln nicht gestellte Fragen werden getrennt gezählt.</li>
        <li>Bei Mehrfachauswahl kann die Summe über 100 % liegen. Nichtbeurteilbarkeit ist eine eigene Angabe und kein Skalenwert.</li>
        <li>Die Aussagen werden einzeln betrachtet. Es wird keine gemeinsame Gesamtnote aus unterschiedlichen Merkmalen gebildet.</li>
        <li>Offene Antworten sind unveränderte Angaben aus der gewählten Datenbasis. Sie sind noch keine thematisch codierte oder repräsentative Auswertung.</li>
        <li>Für eine externe Weitergabe bleiben die geschützten, aggregierten Exportdaten der bisherigen Auswertung verfügbar.</li>
      </ul></section>
      <footer className="report-footer">Forms · Interner Gesamtbericht · {report.survey.version} · {report.responses} Einsendungen</footer>
    </main>
  </div>
}
