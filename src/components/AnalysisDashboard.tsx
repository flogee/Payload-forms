'use client'

import { useId, useState } from 'react'
import type { AnalysisReport, AnalysisSeries } from '@/survey/analysis-types'
import { AnalysisChart } from './AnalysisChart'
import './AnalysisDashboard.css'

type Props = {
  report: AnalysisReport
  surveys: { id: number; title: string; version: string; phase: string }[]
  demo?: boolean
}
const number = (value: number) => new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(value)
const date = (value: string) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date(value))
const phase = (value: string) => ({ draft: 'Entwurf', pretest: 'Pretest', closed: 'Geschlossen', live: 'Erhebung', demo: 'Demo' })[value] ?? value

function Denominators({ series }: { series: AnalysisSeries }) {
  return <dl className="analysis-denominators">
    <div><dt>Beantwortet · Bezugsgröße</dt><dd>{number(series.answered)}</dd></div>
    <div><dt>Für diese Frage vorgesehen</dt><dd>{number(series.eligible)}</dd></div>
    <div><dt>Fehlende Angaben</dt><dd>{number(series.missing)}</dd></div>
    <div><dt>Nicht gefragt · Sprungregel</dt><dd>{number(series.notAsked)}</dd></div>
  </dl>
}

export function AnalysisDashboard({ report, surveys, demo = false }: Props) {
  const id = useId()
  const [openSections, setOpenSections] = useState(() => new Set([report.sections[0]?.id]))
  const exportURL = (format: 'svg' | 'json', seriesID?: string) => `/api/survey/analysis?surveyID=${report.survey.id}&format=${format}${seriesID ? `&seriesID=${encodeURIComponent(seriesID)}` : ''}${demo ? '&demo=1' : ''}`
  const range = report.firstDate && report.lastDate ? `${date(report.firstDate)} – ${date(report.lastDate)}` : 'Noch keine Einsendungen'

  return <div className="analysis-dashboard">
    <header className="analysis-topbar">
      <a className="analysis-wordmark" href="/admin">Payload Forms <span>Auswertung</span></a>
      <a href="/admin">Zur Verwaltung ↗</a>
    </header>
    <main className="analysis-main">
      <div className="analysis-heading">
        <div><p className="analysis-eyebrow">Antworten verstehen</p><h1>Ein Blick auf die Einsendungen.</h1><p className="analysis-lead">Häufigkeiten und Antwortstatus je Frage – mit der passenden Bezugsgröße.</p></div>
        <span className="analysis-badge">{demo ? 'Demo · erfundene Angaben' : 'Testdaten · keine Erhebung'}</span>
      </div>
      <div className="analysis-toolbar">
        {!demo && <form action="/auswertung" method="get">
          <label htmlFor={`${id}-survey`}>Fragebogen & Fassung</label>
          <div className="analysis-select-row"><select id={`${id}-survey`} name="surveyID" defaultValue={report.survey.id}>
            {surveys.map(survey => <option key={survey.id} value={survey.id}>{survey.title} · {survey.version} · {phase(survey.phase)}</option>)}
          </select><button type="submit">Anzeigen</button></div>
        </form>}
        <a className="analysis-text-link" href={demo ? '/auswertung' : '/auswertung/demo'}>{demo ? 'Zu den tatsächlichen Testantworten →' : 'Mit erfundenen Demodaten ansehen →'}</a>
      </div>
      <section className="analysis-overview" aria-label="Datengrundlage">
        <div className="analysis-total"><strong>{number(report.responses)}</strong><span>Einsendungen</span></div>
        <div><span className="analysis-label">Gespeicherte Fassung</span><h2>{report.survey.title}</h2><p>Version {report.survey.version} · {phase(report.survey.phase)}</p></div>
        <div><span className="analysis-label">Eingangszeitraum</span><p>{range}</p><span className="analysis-small">Stand: {date(report.generatedAt)}</span></div>
      </section>
      <p className="analysis-unit">Gezählt werden einzelne Einsendungen, keine unabhängigen Organisationen. Mehrere Personen können für dieselbe Organisation antworten.</p>
      <div className="analysis-body">
        <aside className="analysis-sidebar"><p className="analysis-eyebrow">Abschnitte</p><nav aria-label="Auswertungsabschnitte"><ol>
          {report.sections.map((section, index) => <li key={section.id}><a href={`#${id}-section-${index}`} onClick={() => setOpenSections(previous => new Set([...previous, section.id]))}><span>{String(index + 1).padStart(2, '0')}</span>{section.title}</a></li>)}
        </ol></nav><div className="analysis-sharing"><h2>Weiterverwenden</h2><a className="analysis-download" href={exportURL('json')} download>JSON / MCP ↓</a><p>JSON und MCP blenden kleine Gruppen aus. Für die Weitergabe diese geschützte Zusammenfassung verwenden.</p><p>Diagramme und SVG zeigen interne Teamzahlen und können kleine Gruppen enthalten.</p></div></aside>
        <div className="analysis-sections">
          {!report.responses && <p className="analysis-empty" role="status">Für diese Fassung liegen noch keine Einsendungen vor. Die Bezugsgrößen bleiben sichtbar; Verteilungen erscheinen mit den ersten Antworten.</p>}
          {report.sections.map((section, index) => <details className="analysis-section" key={section.id} id={`${id}-section-${index}`} open={openSections.has(section.id)} onToggle={event => {
            const isOpen = event.currentTarget.open
            setOpenSections(previous => { if (previous.has(section.id) === isOpen) return previous; const next = new Set(previous); if (isOpen) next.add(section.id); else next.delete(section.id); return next })
          }}>
            <summary><span className="analysis-section-number">{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><span className="analysis-section-count">{section.series.length} Auswertungen</span></summary>
            <div className="analysis-section-content">{section.series.map(series => <article className="analysis-question" key={series.id} aria-labelledby={`${id}-${series.id}`}>
              <div className="analysis-question-heading"><div><p className="analysis-question-id">{series.questionID}{series.rowID ? ` · ${series.rowID}` : ''}</p><h3 id={`${id}-${series.id}`}>{series.label}</h3></div>{series.display !== 'completion' && series.options.length > 0 && <a href={exportURL('svg', series.id)} download aria-label={`SVG herunterladen: ${series.label}`}>SVG ↓</a>}</div>
              <Denominators series={series} />
              {series.display === 'completion' ? <p className="analysis-small">Hier wird nur der Antwortstatus ausgewertet. Textinhalte und einzelne Zahlenwerte werden nicht angezeigt.</p> : <>
                <p className="analysis-small">Anteile unter den {number(series.answered)} beantworteten Einsendungen.{series.multipleChoice && ' Mehrfachauswahl: Die Summe kann über 100 % liegen.'}</p>
                {openSections.has(section.id) && <AnalysisChart series={series} />}
                <table className="analysis-table"><caption>Vollständige Verteilung: {series.label}</caption><thead><tr><th scope="col">{series.display === 'count-status' ? 'Antwortstatus' : 'Antwortoption'}</th><th scope="col">Anzahl</th><th scope="col">Anteil</th></tr></thead><tbody>{series.options.map(option => <tr key={option.value}><th scope="row">{option.label}</th><td>{number(option.count)}</td><td>{series.answered ? `${number(option.percent)} %` : '–'}</td></tr>)}</tbody></table>
              </>}
            </article>)}</div>
          </details>)}
          {report.notes.length > 0 && <section className="analysis-notes" aria-labelledby={`${id}-notes`}><h2 id={`${id}-notes`}>Zur Einordnung</h2><ul>{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></section>}
        </div>
      </div>
      <footer className="analysis-footer"><span>Payload Forms · interne Testauswertung</span><span>Keine Gesamtnote. Jede Frage behält ihre eigene Bezugsgröße.</span></footer>
    </main>
  </div>
}
