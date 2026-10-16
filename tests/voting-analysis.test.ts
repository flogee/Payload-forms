import test from 'node:test'
import assert from 'node:assert/strict'
import type { Answers, Definition, Question } from '../src/survey/types'
import { analyze, forSharing } from '../src/survey/analysis'
import { demoDefinition, demoRecords, demoReport } from '../src/survey/analysis-demo'
import { csvCell, exportCSV } from '../src/survey/csv'
import { definitionSchema, validateAnswers } from '../src/survey/validation'

const meta = { id: 7, title: 'Test', slug: 'test', version: 'v1', phase: 'pretest' }
const ranking: Question = { id: 'rank', block: '1', label: 'Prioritäten', kind: 'ranking', options: [
  { value: 'a', label: 'Gleich' }, { value: 'b', label: 'Gleich' }, { value: 'c', label: 'Dritte Option' },
] }
const instrument = (...questions: Question[]): Definition => ({ version: 'v1', introduction: [], sections: [{ id: 's', title: 'Abschnitt', questions }] })
const records = (id: string, values: unknown[]) => values.map(value => ({ answers: { [id]: value } as Answers }))

test('slider distribution preserves zero, exact steps and excludes invalid stored numbers', () => {
  const def = instrument({ id: 'slider', block: '1', label: 'Skala', kind: 'slider', min: 0, max: 4, step: 2 })
  const report = analyze(def, records('slider', [0, 2, 4, 1, 6, '2', 2.5, null, undefined]), meta)
  const series = report.sections[0].series[0]
  assert.equal(series.display, 'distribution')
  assert.deepEqual([series.eligible, series.answered, series.missing], [9, 3, 6])
  assert.deepEqual(series.options.map(o => [o.value, o.label, o.count, o.percent]), [['0', '0', 1, 33.3], ['2', '2', 1, 33.3], ['4', '4', 1, 33.3]])
  const defaults = analyze(instrument({ id: 'slider', block: '1', label: 'Skala', kind: 'slider' }), records('slider', [0, 10]), meta).sections[0].series[0]
  assert.equal(defaults.options.length, 11)
  assert.equal(defaults.options[0].count, 1)
  assert.equal(defaults.options[10].count, 1)
  const maximum = analyze(instrument({ id: 'slider', block: '1', label: 'Skala', kind: 'slider', max: 100 }), records('slider', [100]), meta).sections[0].series[0]
  assert.equal(maximum.options.length, 101)
  assert.equal(maximum.options[100].percent, 100)
  const missing = analyze(def, [{ answers: {} }], meta).sections[0].series[0]
  assert.deepEqual([missing.answered, missing.missing], [0, 1])
  assert.ok(missing.options.every(o => o.count === 0 && o.percent === 0))
})

test('five-level ratings use numeric codes and endpoint labels with valid numeric denominators', () => {
  const def = instrument(
    { id: 'stars', block: '1', label: 'Sterne', kind: 'stars', lowLabel: 'Wenig', highLabel: 'Viel' },
    { id: 'smiley', block: '2', label: 'Smileys', kind: 'smiley' },
  )
  const report = analyze(def, [
    { answers: { stars: 1, smiley: 1 } }, { answers: { stars: 5, smiley: 3 } }, { answers: { stars: 0, smiley: 5 } },
    ...records('stars', [6, 2.5, '3', undefined]),
  ], meta)
  const [stars, smiley] = report.sections[0].series
  assert.deepEqual([stars.answered, stars.missing, smiley.answered, smiley.missing], [2, 5, 3, 4])
  assert.deepEqual(stars.options.map(o => [o.value, o.count, o.percent]), [['1', 1, 50], ['2', 0, 0], ['3', 0, 0], ['4', 0, 0], ['5', 1, 50]])
  assert.deepEqual([stars.options[0].label, stars.options[4].label], ['1 · Wenig', '5 · Viel'])
  assert.deepEqual([smiley.options[0].label, smiley.options[2].label, smiley.options[4].label], ['1 · Sehr unzufrieden', '3 · Neutral', '5 · Sehr zufrieden'])
})

test('rankings count full valid permutations per stable option, excluding partial, duplicate and unknown codes', () => {
  const report = analyze(instrument(ranking), records('rank', [
    { order: ['a', 'b', 'c'] }, { order: ['b', 'c', 'a'] }, { order: ['c', 'a', 'b'] },
    { order: ['a', 'b'] }, { order: ['a', 'a', 'c'] }, { order: ['a', 'b', 'unknown'] },
    ['a', 'b', 'c'], { order: ['a', 'b', 'c'], other: 'PRIVATE' }, undefined,
  ]), meta)
  const series = report.sections[0].series
  assert.deepEqual(series.map(s => [s.id, s.rowID]), [['rank:rank:a', 'a'], ['rank:rank:b', 'b'], ['rank:rank:c', 'c']])
  assert.deepEqual(series.map(s => s.label), ['Prioritäten · Gleich', 'Prioritäten · Gleich', 'Prioritäten · Dritte Option'])
  for (const s of series) {
    assert.equal(s.display, 'distribution')
    assert.deepEqual([s.eligible, s.answered, s.missing, s.notAsked], [9, 3, 6, 0])
    assert.deepEqual(s.options.map(o => [o.value, o.label, o.count, o.percent]), [['1', 'Platz 1', 1, 33.3], ['2', 'Platz 2', 1, 33.3], ['3', 'Platz 3', 1, 33.3]])
  }
  assert.doesNotMatch(JSON.stringify(report), /unknown|PRIVATE|"order"/)
  assert.match(report.notes.join(' '), /nur vollständig gültige Rangordnungen/)
  const missing = analyze(instrument(ranking), records('rank', [{ order: ['a'] }, undefined]), meta).sections[0].series
  assert.ok(missing.every(s => s.answered === 0 && s.missing === 2 && s.options.every(o => o.count === 0 && o.percent === 0)))
})

test('ranking denominators follow visibility and distinguish invalid, missing and skipped answers', () => {
  const def = instrument({ id: 'gate', block: '1', label: 'Einstieg', kind: 'single', options: [{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }] },
    { ...ranking, showIf: { field: 'gate', values: ['yes'] } })
  const report = analyze(def, [
    { answers: { gate: { choice: 'yes' }, rank: { order: ['a', 'b', 'c'] } } },
    { answers: { gate: { choice: 'yes' }, rank: { order: ['a'] } } },
    { answers: { gate: { choice: 'yes' } } },
    { answers: { gate: { choice: 'no' }, rank: { order: ['c', 'b', 'a'] } } },
  ], meta)
  for (const s of report.sections[0].series.slice(1)) assert.deepEqual([s.eligible, s.answered, s.missing, s.notAsked], [3, 1, 2, 1])
  assert.deepEqual(report.sections[0].series[1].options.map(o => o.percent), [100, 0, 0])
})

test('sharing suppresses the whole ranking question when another option has a small rank cell', () => {
  const permutations = [
    ['b', 'a', 'c'], ...Array.from({ length: 4 }, () => ['c', 'a', 'b']), ...Array.from({ length: 5 }, () => ['a', 'b', 'c']),
  ]
  const report = analyze(instrument(ranking), records('rank', permutations.map(order => ({ order }))), meta)
  assert.deepEqual(report.sections[0].series[0].options.map(o => o.count), [5, 5, 0], 'this row has no small cells itself')
  const before = JSON.stringify(report), shared = forSharing(report)
  for (const s of shared.sections[0].series) {
    assert.equal(s.suppressed, true)
    assert.deepEqual([s.eligible, s.answered, s.missing, s.notAsked], [null, null, null, null])
    assert.deepEqual(s.options, [])
  }
  assert.equal(shared.responses, 10)
  assert.equal(JSON.stringify(report), before)
  const safe = analyze(instrument(ranking), records('rank', Array.from({ length: 15 }, (_, i) => ({ order: Array.from({ length: 3 }, (_, p) => ['a', 'b', 'c'][(i + p) % 3]) }))), meta)
  assert.ok(forSharing(safe).sections[0].series.every(s => !s.suppressed && s.answered === 15))
})

test('sharing suppresses a numeric series with positive small cells and preserves zero cells', () => {
  const def = instrument({ id: 'slider', block: '1', label: 'Skala', kind: 'slider', min: 0, max: 2 })
  const five = Array.from({ length: 5 }, () => 0)
  const safe = forSharing(analyze(def, records('slider', five), meta)).sections[0].series[0]
  assert.equal(safe.suppressed, false)
  assert.deepEqual(safe.options.map(o => o.count), [5, 0, 0])
  const small = forSharing(analyze(def, records('slider', [...five, 2]), meta)).sections[0].series[0]
  assert.equal(small.suppressed, true)
  assert.equal(small.answered, null)
  assert.deepEqual(small.options, [])
})

test('CSV preserves numeric zero and exports rankings as escaped position codes, with invalid or missing answers blank', () => {
  const def = instrument({ id: 'slider', block: '1', label: 'Skala', kind: 'slider' },
    { id: 'stars', block: '2', label: 'Sterne', kind: 'stars' }, { id: 'smiley', block: '3', label: 'Smileys', kind: 'smiley' },
    { ...ranking, options: [{ value: ' =SUM(1,2)', label: 'Erste' }, { value: '@code', label: 'Zweite' }, { value: 'stable', label: 'Dritte' }] })
  const answers = [
    { slider: 0, stars: 1, smiley: 5, rank: { order: ['stable', ' =SUM(1,2)', '@code'] } },
    {}, { slider: '0', stars: 0, smiley: 6, rank: { order: ['stable', '@code'] } },
    { rank: { order: ['stable', 'stable', '@code'] } }, { rank: { order: ['stable', '@code', 'unknown'] } },
  ] as Answers[]
  const csv = exportCSV(def, answers.map((a, i) => ({ id: i + 1, version: 'v1', createdAt: '2026-10-09T12:00:00.000Z', answers: a })))
  const lines = csv.split('\r\n')
  assert.ok(lines[0].endsWith(['slider', 'stars', 'smiley', 'rank_rank_1', 'rank_rank_2', 'rank_rank_3'].map(csvCell).join(',')))
  assert.ok(lines[1].endsWith([0, 1, 5, 'stable', ' =SUM(1,2)', '@code'].map(csvCell).join(',')))
  assert.match(lines[1], /"' =SUM\(1,2\)"/)
  assert.match(lines[1], /"'@code"/)
  for (const line of lines.slice(2)) assert.ok(line.endsWith(Array.from({ length: 6 }, () => csvCell(undefined)).join(',')))
  assert.doesNotMatch(csv, /order|Erste|Zweite|Dritte/)
})

test('new fictional demo section validates all 60 answers and has balanced shareable distributions', () => {
  assert.ok(definitionSchema.safeParse(demoDefinition).success)
  for (const record of demoRecords()) assert.deepEqual(validateAnswers(demoDefinition, record.answers).errors, {})
  const report = demoReport(), shared = forSharing(report)
  assert.equal(report.sections[2].series[1].questionID, 'Q7', 'existing section indexes remain stable')
  assert.equal(report.sections[3].id, 'feedback')
  const newSeries = report.sections[3].series
  assert.equal(newSeries.length, 6)
  for (const s of newSeries) {
    assert.equal(s.answered, 60)
    assert.equal(s.missing, 0)
    assert.deepEqual(s.options.map(o => o.count), s.kind === 'ranking' ? [20, 20, 20] : [12, 12, 12, 12, 12])
  }
  assert.ok(shared.sections[3].series.every(s => !s.suppressed))
})
