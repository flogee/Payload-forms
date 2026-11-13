import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSurveyReport } from '../src/survey/report-build'
import type { AnalysisReport, AnalysisSeries } from '../src/survey/analysis-types'
import type { ReportRecord } from '../src/survey/report-types'
import type { Answers, Definition, Question } from '../src/survey/types'

const question = (id: string, kind: Question['kind'], extra: Partial<Question> = {}): Question => ({ id, kind, label: `Saved ${id}`, block: id, ...extra })
const definition = (...questions: Question[]): Definition => ({ version: 'fictional-v1', introduction: [], sections: [{ id: 'saved', title: 'Saved section', questions }] })
const aggregate: AnalysisReport = { schemaVersion: 1, survey: { id: 1, title: 'Fictional', slug: 'fictional', version: 'fictional-v1', phase: 'pretest' },
  dataset: 'test', responses: 0, unit: 'Responses', generatedAt: '2026-11-13T00:00:00Z', firstDate: null, lastDate: null, sections: [], notes: [] }
const record = (answers: Answers, id: number | string = 1): ReportRecord => ({ id, answers })
const build = (def: Definition, records: ReportRecord[], extra = {}) => buildSurveyReport({ definition: def, records, aggregate, dataset: 'test', excludedResponses: 0, ...extra })
const choices = [{ value: 'yes', label: 'Yes' }, { value: 'other', label: 'Other' }]
const rows = [{ key: 'first', label: 'Saved first' }, { key: 'second', label: 'Saved second' }]

test('collects only validated qualitative content, retaining saved order, labels and response IDs', () => {
  const def = definition(question('text', 'text', { help: 'Saved help' }), question('area', 'textarea'),
    question('single', 'single', { options: choices }), question('multi', 'multiple', { options: choices }),
    question('count', 'count'), question('counts', 'counts', { rows, allowNA: true }), question('bodies', 'committees'),
    question('rating', 'stars'), question('matrix', 'matrix', { rows, options: choices }), question('rank', 'ranking', { options: choices }))
  const result = build(def, [record({ text: 'Plain', area: 'Line one\nLine two', single: { choice: 'other', other: 'Single addition' },
    multi: { choice: ['yes', 'other'], other: 'Multiple addition' }, count: { status: 'unknown', note: 'Uncertain' },
    counts: { first: { status: 'value', value: 0, note: 'Zero note' }, second: { status: 'na', note: 'NA note' } },
    bodies: [{ body: 'Fictional board', volume: 'Monthly' }, { body: '', volume: 'Yearly' }, { body: 'Body alone', volume: '' }, { body: '', volume: '' }],
    rating: 5, matrix: { first: 'yes' }, rank: { order: ['other', 'yes'] },
  }, 'fictional-response')])
  const questions = result.sections[0].questions
  assert.equal(result.sections[0].title, 'Saved section')
  assert.deepEqual(questions.map(q => q.id), def.sections[0].questions.map(q => q.id))
  assert.equal(questions[0].help, 'Saved help')
  assert.equal(questions[0].label, 'Saved text')
  assert.deepEqual(questions.map(q => q.entries.map(e => e.text)), [['Plain'], ['Line one\nLine two'], ['Single addition'], ['Multiple addition'], ['Uncertain'],
    ['Saved first: Zero note', 'Saved second: NA note'], ['Fictional board: Monthly', 'Einheit 2: Yearly', 'Body alone'], [], [], []])
  assert.ok(questions.flatMap(q => q.entries).every(e => e.responseID === 'fictional-response'))
  assert.equal(questions[4].numeric.length, 0)
  assert.equal(questions[5].numeric[0].minimum, 0)
})

test('skips missing, hidden, malformed, overlong and unselected other content', () => {
  const def = definition(question('parent', 'single', { options: choices }), question('hidden', 'textarea', { showIf: { field: 'parent', values: ['other'] } }),
    question('missing', 'text'), question('text', 'text'), question('single', 'single', { options: choices }), question('counts', 'counts', { rows }), question('bodies', 'committees'))
  const result = build(def, [record({ parent: { choice: 'yes' }, hidden: 'HIDDEN', text: 'x'.repeat(1001), single: { choice: 'yes', other: 'UNSELECTED' },
    counts: { first: { status: 'value', value: -1, note: 'INVALID' } }, bodies: [{ body: 'INVALID', volume: 7 }] } as unknown as Answers),
    record({ parent: { choice: 'invalid' }, hidden: 'HIDDEN', text: '   ', single: { choice: 'other', other: '' } }, 2)])
  assert.ok(result.sections[0].questions.every(q => !q.entries.length && !q.numeric.length))
  const shown = build(def, [record({ parent: { choice: 'other' }, hidden: 'VISIBLE' })])
  assert.deepEqual(shown.sections[0].questions[1].entries, [{ responseID: 1, text: 'VISIBLE' }])
})

test('numeric statistics distinguish zero, unknown, NA and missing using only numeric observations', () => {
  const def = definition(question('n', 'count', { allowNA: true }), question('rows', 'counts', { rows }))
  const result = build(def, [record({ n: { status: 'value', value: 0 }, rows: { first: { status: 'value', value: 4 } } }),
    record({ n: { status: 'value', value: 10 }, rows: { first: { status: 'unknown' }, second: { status: 'value', value: 8 } } }),
    record({ n: { status: 'unknown' } }), record({ n: { status: 'na' } }), record({}), record({ n: { status: 'value', value: 2.5 } })])
  const questions = result.sections[0].questions
  assert.deepEqual(questions[0].numeric, [{ label: 'Saved n', observations: 2, minimum: 0, maximum: 10, median: 5,
    bins: [{ value: '0', label: '0', count: 1, percent: 50 }, { value: '10', label: '10', count: 1, percent: 50 }] }])
  assert.deepEqual(questions[1].numeric.map(n => [n.rowID, n.label, n.observations, n.median]), [['first', 'Saved first', 1, 4], ['second', 'Saved second', 1, 8]])
  assert.deepEqual(build(def, []).sections[0].questions.map(q => q.numeric), [[], []])
})

test('uses exact bins up to ten values and bounded integer ranges with every observation counted once', () => {
  const def = definition(question('n', 'count'))
  const samples = Array.from({ length: 24 }, (_, i) => i * 7).concat([0, 0, 161])
  const numeric = build(def, samples.map(value => record({ n: { status: 'value', value } }))).sections[0].questions[0].numeric[0]
  assert.ok(numeric.bins.length <= 8)
  assert.equal(numeric.observations, samples.length)
  assert.equal(numeric.minimum, 0)
  assert.equal(numeric.maximum, 161)
  assert.equal(numeric.median, [...samples].sort((a, b) => a - b)[13])
  assert.equal(numeric.bins.reduce((sum, bin) => sum + bin.count, 0), samples.length)
  for (const bin of numeric.bins) {
    const [low, high] = bin.value.split('-').map(Number)
    assert.equal(bin.count, samples.filter(value => value >= low && value <= high).length)
    assert.equal(bin.percent, Math.round(bin.count / samples.length * 1000) / 10)
  }
  const exact = build(def, Array.from({ length: 10 }, (_, value) => record({ n: { status: 'value', value } }))).sections[0].questions[0].numeric[0]
  assert.equal(exact.bins.length, 10)
  assert.equal(exact.bins.reduce((sum, bin) => sum + bin.percent, 0), 100)
})

test('matches series using safe question keys and ignores inherited answers and rows', () => {
  const def = definition(question('constructor', 'text'), question('toString', 'text'), question('rows', 'counts', { rows: [{ key: 'constructor', label: 'Own row' }] }))
  const series = (questionID: string): AnalysisSeries => ({ id: questionID, questionID, block: 'b', label: questionID, kind: 'text', display: 'completion', eligible: 1, answered: 1, missing: 0, notAsked: 0, multipleChoice: false, options: [] })
  const reportAggregate = { ...aggregate, sections: [{ id: 's', title: 'Aggregate', series: [series('constructor'), series('constructor')] }] }
  const inherited = Object.assign(Object.create({ constructor: 'INHERITED', toString: 'INHERITED' }), { rows: Object.create({ constructor: { status: 'value', value: 99, note: 'INHERITED' } }) })
  const result = build(def, [record(inherited), record({ constructor: 'OWN', toString: 'Own string', rows: Object.assign(Object.create(null), { constructor: { status: 'value', value: 0 } }) })], { aggregate: reportAggregate })
  assert.deepEqual(result.sections[0].questions[0].entries, [{ responseID: 1, text: 'OWN' }])
  assert.equal(result.sections[0].questions[0].series.length, 2)
  assert.equal(result.sections[0].questions[1].series.length, 0)
  assert.deepEqual(result.sections[0].questions[1].entries.map(e => e.text), ['Own string'])
  assert.equal(result.sections[0].questions[2].numeric[0].observations, 1)
})

test('bounds duration, preserves caller dataset and excluded count, and does not mutate input', () => {
  const def = definition(question('n', 'count'), question('text', 'text'))
  const records = [0, 10, 20, 86400, -1, 86401, Infinity, NaN, '30', undefined].map((durationSeconds, i) =>
    ({ ...record({ n: { status: 'value', value: i }, text: 'Saved text' }, i), durationSeconds } as ReportRecord))
  const before = structuredClone({ def, records, aggregate })
  const result = build(def, records, { dataset: 'real', excludedResponses: 3 })
  assert.equal(result.totalResponses, 13)
  assert.equal(result.excludedResponses, 3)
  assert.equal(result.dataset, 'real')
  assert.equal(result.medianDurationSeconds, 15)
  assert.equal(build(def, [record({})]).medianDurationSeconds, null)
  assert.deepEqual({ def, records, aggregate }, before)
  assert.doesNotMatch(JSON.stringify(aggregate), /Saved text/)
})
