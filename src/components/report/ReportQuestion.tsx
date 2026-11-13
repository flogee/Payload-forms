'use client'

import type { ReportQuestion } from '@/survey/report-types'
import { FrequencyChart, isFiveLevelMatrix, MatrixOverview, reportNumber } from './ReportCharts'

export function QuestionResult({ question, total }: { question: ReportQuestion; total: number }) {
  const first = question.series[0]
  const matrix = isFiveLevelMatrix(question.series)
  return <article className={`report-question${matrix ? ' report-question--matrix' : ''}`} id={`report-${question.id}`}>
    <h3><span>{question.block}</span>{question.label}</h3>
    {question.help && <details className="report-help"><summary>Hinweis zur Frage</summary><p>{question.help}</p></details>}
    {!matrix && first && question.series.length === 1 && <p className="report-question__base">{first.answered} von {first.eligible} beantwortet · {first.missing} ohne Angabe{first.notAsked > 0 && ` · ${first.notAsked} nicht gefragt`}</p>}
    {matrix ? <MatrixOverview series={question.series} questionLabel={question.label} /> : question.series.map(series => <div className="report-question__series" key={series.id}>
      {question.series.length > 1 && <h4>{series.label.startsWith(`${question.label} · `) ? series.label.slice(question.label.length + 3) : series.label}</h4>}
      {question.series.length > 1 && <p className="report-question__base">{series.answered} von {series.eligible} beantwortet · {series.missing} ohne Angabe{series.notAsked > 0 && ` · ${series.notAsked} nicht gefragt`}</p>}
      {series.display === 'completion' ? null : <>
        <FrequencyChart options={series.options} base={series.answered} caption={series.label} />
        <p className="report-caption">Prozente der {series.answered} beantworteten Angaben.{series.multipleChoice && ' Mehrfachauswahl; die Summe kann über 100 % liegen.'}</p>
      </>}
    </div>)}
    {question.numeric.map(numeric => <div className="report-numeric" key={numeric.rowID ?? question.id}>
      {question.numeric.length > 1 && <h4>{numeric.label}</h4>}
      <dl><div><dt>Zahlenangaben</dt><dd>{numeric.observations}</dd></div><div><dt>Kleinster Wert</dt><dd>{reportNumber(numeric.minimum)}</dd></div><div><dt>Median</dt><dd>{reportNumber(numeric.median)}</dd></div><div><dt>Größter Wert</dt><dd>{reportNumber(numeric.maximum)}</dd></div></dl>
      <FrequencyChart options={numeric.bins} base={numeric.observations} caption={`Gemeldete Zahlen: ${numeric.label}`} />
      <p className="report-caption">Nur gültige Zahlenangaben; „weiß nicht“ und „nicht zutreffend“ stehen im Antwortstatus.</p>
    </div>)}
    {question.entries.length > 0 ? <details className="report-open-answers" data-report-expand>
      <summary>{question.entries.length} {['text', 'textarea'].includes(question.kind) ? 'offene Antworten' : 'Ergänzungen und Notizen'} ansehen</summary>
      <ol>{question.entries.map((entry, index) => <li key={`${entry.responseID}-${index}`}>
        <p>{entry.text}</p>{typeof entry.responseID === 'number' && <a href={`/admin/collections/responses/${entry.responseID}`}>Antwort {entry.responseID} öffnen</a>}
      </li>)}</ol>
    </details> : ['text', 'textarea', 'committees'].includes(question.kind) && <p className="report-empty-inline">{total ? 'Keine offenen Angaben vorhanden.' : 'Noch keine Einsendungen.'}</p>}
  </article>
}

