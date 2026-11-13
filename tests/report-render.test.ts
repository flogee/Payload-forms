import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { analyze } from '../src/survey/analysis'
import { buildSurveyReport } from '../src/survey/report-build'
import { QuestionResult } from '../src/components/report/ReportQuestion'
import { MatrixOverview } from '../src/components/report/ReportCharts'
import type { Definition } from '../src/survey/types'

const meta = { id: 1, title: 'Fictional', slug: 'fixture', version: 'v1', phase: 'pretest' }
test('multi-row reports display each rows own response base rather than the first rows base', () => {
  const definition: Definition = { version: 'v1', introduction: [], sections: [{ id: 's', title: 'Fixture', questions: [{
    id: 'Q', block: 'Q', label: 'Numeric rows', kind: 'counts', rows: [{ key: 'a', label: 'Missing row' }, { key: 'b', label: 'Complete row' }],
  }] }] }
  const records = [1, 2].map(id => ({ id, answers: { Q: { b: { status: 'value' as const, value: id } } }, testOnly: true }))
  const aggregate = analyze(definition, records, meta)
  const report = buildSurveyReport({ definition, records, aggregate, dataset: 'test', excludedResponses: 0 })
  const markup = renderToStaticMarkup(createElement(QuestionResult, { question: report.sections[0].questions[0], total: 2 }))
  assert.match(markup, /0 von 2 beantwortet · 2 ohne Angabe/)
  assert.match(markup, /2 von 2 beantwortet · 0 ohne Angabe/)
})

test('print scale order matches legend even when the stored five-level options are reversed', () => {
  const definition: Definition = { version: 'v1', introduction: [], sections: [{ id: 's', title: 'Fixture', questions: [{
    id: 'Q', block: 'Q', label: 'Scale', kind: 'matrix', rows: [{ key: 'a', label: 'Statement' }],
    options: ['5', '4', '3', '2', '1', 'unknown'].map(value => ({ value, label: `Option ${value}` })),
  }] }] }
  const records = ['1', '1', '2', '3', '4', '5', 'unknown'].map(value => ({ answers: { Q: { a: value } }, testOnly: true }))
  const series = analyze(definition, records, meta).sections[0].series
  const markup = renderToStaticMarkup(createElement(MatrixOverview, { series, questionLabel: 'Scale' }))
  const print = markup.slice(markup.indexOf('report-print-stack'))
  assert.ok(print.indexOf('background:#a65d42') < print.indexOf('background:#28665c'))
  assert.match(print, /width:33\.3333/)
  assert.match(markup, /6 bewertet/); assert.match(markup, /1 nicht beurteilbar/)
})
