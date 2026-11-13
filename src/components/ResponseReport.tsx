import type { ReactNode } from 'react'
import type { ResponseView } from '../survey/response-view'
import { responseDate, responseDuration } from '../survey/response-view'

function AnswerLines({ lines, ordered = false, list = false }: { lines: string[]; ordered?: boolean; list?: boolean }) {
  if (ordered) return <ol className="response-reader__values">{lines.map((line, i) => <li key={i}>{line}</li>)}</ol>
  if (list) return <ul className="response-reader__values">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
  return <>{lines.map((line, i) => <p className="response-reader__value" key={i}>{line}</p>)}</>
}

export function ResponseReport({ view, timeZone = 'UTC', actions }: { view: ResponseView; timeZone?: string; actions?: ReactNode }) {
  return <>
    <header className="response-reader__header">
      <div><h2>Antwort {view.id}</h2><p className="response-reader__version">Fragebogenfassung {view.version}</p></div>
      {actions}
    </header>
    <dl className="response-reader__metadata">
      <div><dt>Eingegangen</dt><dd><time dateTime={view.createdAt}>{responseDate(view.createdAt, timeZone)}</time></dd></div>
      <div><dt>Teilnahme</dt><dd>{view.testOnly ? 'Testantwort' : 'Echte Antwort'}</dd></div>
      <div><dt>Bearbeitungsdauer</dt><dd>{responseDuration(view.durationSeconds)}</dd></div>
    </dl>
    {view.sections.map(section => <section className="response-reader__section" key={section.id}>
      <h3>{section.title}</h3>
      {section.questions.map(question => <div className={`response-reader__question${question.rows ? ' response-reader__question--rows' : ''}`} key={question.id}>
        <h4><span className="response-reader__code">{question.block}</span>{question.label}</h4>
        <div className={`response-reader__answer response-reader__answer--${question.state}`}>
          {question.rows ? <dl className="response-reader__rows">{question.rows.map((row, index) => <div key={index}>
            <dt>{row.label}</dt><dd><AnswerLines lines={row.lines} /></dd>
        </div>)}</dl> : <AnswerLines lines={question.lines} ordered={question.ordered} list={question.list} />}
        </div>
      </div>)}
    </section>)}
    <footer className="response-reader__footer">Antwort {view.id} · Fassung {view.version} · {view.testOnly ? 'Testdaten' : 'Interne Einzelantwort'}</footer>
  </>
}
