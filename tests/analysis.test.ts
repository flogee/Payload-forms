import test from 'node:test'
import assert from 'node:assert/strict'
import type { Payload } from 'payload'
import type { Definition } from '../src/survey/types'
import { analyze, forSharing } from '../src/survey/analysis'
import { demoDefinition, demoRecords, demoReport } from '../src/survey/analysis-demo'
import { analysisSVG } from '../src/survey/analysis-svg'
import { loadAnalysis, parseSurveyID } from '../src/survey/analysis-load'
import { toStored } from '../src/survey/storage'
import { definitionSchema } from '../src/survey/validation'

const meta = { id: 7, title: 'Test', slug: 'test', version: 'v1', phase: 'pretest' }
const def: Definition = { version: 'v1', introduction: [], sections: [{ id: 's', title: 'Abschnitt', questions: [
  { id: 'gate', block: '1', label: 'Einstieg', kind: 'single', options: [{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }] },
  { id: 'multi', block: '2', label: 'Mehrfach', kind: 'multiple', showIf: { field: 'gate', values: ['yes'] }, options: [{ value: 'a', label: 'Gleich' }, { value: 'b', label: 'Gleich' }] },
  { id: 'matrix', block: '3', label: 'Matrix', kind: 'matrix', rows: [{ key: 'one', label: 'Gleich' }, { key: 'two', label: 'Gleich' }], options: [{ value: 'a', label: 'Gleich' }, { value: 'b', label: 'Gleich' }] },
  { id: 'counts', block: '4', label: 'Zahl', kind: 'counts', allowNA: true, rows: [{ key: 'one', label: 'Zeile' }] },
  { id: 'text', block: '5', label: 'Text', kind: 'text' },
] }] }

test('analysis uses stable codes, deduplicates multiple choices and keeps question denominators', () => {
  const report = analyze(def, [
    { answers: { gate: { choice: 'yes' }, multi: { choice: ['a', 'a', 'b'], other: 'SECRET OTHER' }, matrix: { one: 'a', two: 'b' }, counts: { one: { status: 'value', value: 987654 } }, text: 'SECRET NAME' } },
    { answers: { gate: { choice: 'no' }, multi: { choice: ['b'] }, matrix: { one: 'b' }, counts: { one: { status: 'unknown' } } } },
    { answers: { gate: { choice: 'yes' }, multi: { choice: ['invalid'] }, counts: { one: { status: 'na' } } } },
    { answers: {} },
  ], meta)
  const [gate, multi, one, two, counts, text] = report.sections[0].series
  assert.deepEqual([gate.eligible, gate.answered, gate.missing], [4, 3, 1])
  assert.deepEqual([multi.eligible, multi.answered, multi.missing, multi.notAsked], [2, 1, 1, 2])
  assert.deepEqual(multi.options.map(o => [o.value, o.count, o.percent]), [['a', 1, 100], ['b', 1, 100]])
  assert.equal(one.id, 'matrix:one'); assert.equal(two.id, 'matrix:two')
  assert.deepEqual(one.options.map(o => o.count), [1, 1]); assert.deepEqual(two.options.map(o => o.count), [0, 1])
  assert.deepEqual([counts.answered, counts.missing], [3, 1])
  assert.deepEqual(counts.options.map(o => [o.value, o.count]), [['value', 1], ['unknown', 1], ['na', 1]])
  assert.equal(text.answered, 1); assert.deepEqual(text.options, [])
  assert.doesNotMatch(JSON.stringify(report), /SECRET|987654|invalid/)
})

test('sharing removes small complementary cells and all denominators without altering internal results', () => {
  const report = demoReport(), before = JSON.stringify(report), shared = forSharing(report)
  assert.equal(shared.responses, 60); assert.equal(shared.firstDate, null); assert.equal(shared.lastDate, null)
  const rare = shared.sections[2].series.find(s => s.questionID === 'Q7')!
  assert.equal(rare.suppressed, true)
  assert.deepEqual([rare.eligible, rare.answered, rare.missing, rare.notAsked], [null, null, null, null]); assert.deepEqual(rare.options, [])
  assert.equal(JSON.stringify(report), before)
  assert.equal(shared.sections[0].series[0].suppressed, false)
  const one = analyze(def, [{ answers: {} }], meta)
  assert.equal(forSharing(one).responses, null)
  assert.ok(forSharing(one).sections[0].series.every(s => s.suppressed))
  const five = analyze(def, Array.from({ length: 5 }, () => ({ answers: { gate: { choice: 'yes' } } })), meta)
  assert.equal(forSharing(five).sections[0].series[0].suppressed, false, 'five and zero are allowed')
  const missingOne = analyze(def, [...Array.from({ length: 5 }, () => ({ answers: { gate: { choice: 'yes' } } })), { answers: {} }], meta)
  assert.equal(forSharing(missingOne).sections[0].series[0].suppressed, true, 'a missing cell of one also suppresses totals')
})

test('fictional report has validated instrument, true conditional denominators and no content leaks', () => {
  assert.ok(definitionSchema.safeParse(demoDefinition).success)
  const report = demoReport()
  assert.equal(report.responses, 60)
  const conditional = report.sections[0].series[2]
  assert.deepEqual([conditional.eligible, conditional.answered, conditional.missing, conditional.notAsked], [30, 25, 5, 30])
  assert.deepEqual(conditional.options.map(o => o.percent), [40, 40, 20])
  assert.equal(report.sections[1].series[0].options.reduce((n, o) => n + o.count, 0), 60)
  assert.doesNotMatch(JSON.stringify(report), /Demo-Freitext|"answers"/)
  assert.throws(() => analyze(def, Array.from({ length: 1001 }, () => ({ answers: {} })), meta), /keine Teilergebnisse/)
})

test('standalone SVG escapes labels and cannot contain active markup', () => {
  const report = demoReport(), series = report.sections[0].series[0]
  series.label = '<script>alert("x")</script>'
  series.options[0].label = '<image onload="evil()" href="https://evil.invalid" />'
  const svg = analysisSVG(report, series)
  assert.match(svg, /&lt;script&gt;/); assert.match(svg, /&lt;image/)
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|onload="|<style/)
  assert.match(svg, /viewBox="0 0 1040/); assert.match(svg, /Beantwortet: 60/)
})

test('loader preserves access, selects minimal replies, filters test data/version, rejects truncation', async () => {
  const calls: any[] = [], user = { id: 9, collection: 'users' as const, enabled: true, role: 'admin' as const, email: 'test@localhost.invalid', createdAt: '2026-10-09T12:00:00.000Z', updatedAt: '2026-10-09T12:00:00.000Z' }
  const payload = { find: async (args: any) => { calls.push(args); return args.collection === 'surveys'
    ? { docs: [{ ...meta, ...toStored(demoDefinition) }] } : { totalDocs: 60, docs: demoRecords() } } } as unknown as Payload
  await assert.rejects(loadAnalysis(payload, 7, {}), /Teamzugang/)
  const result = await loadAnalysis(payload, 7, { user })
  assert.equal(result.responses, 60)
  for (const call of calls) { assert.equal(call.user, user); assert.equal(call.overrideAccess, false); assert.equal(call.depth, 0) }
  assert.deepEqual(calls[1].select, { answers: true, createdAt: true })
  assert.deepEqual(calls[1].where.and, [{ survey: { equals: 7 } }, { version: { equals: 'demo-1' } }, { testOnly: { equals: true } }])
  const tooMany = { find: async (args: any) => args.collection === 'surveys' ? { docs: [{ ...meta, ...toStored(demoDefinition) }] } : { totalDocs: 1001, docs: [] as unknown[] } } as unknown as Payload
  await assert.rejects(loadAnalysis(tooMany, 7, { user }), /keine Teilergebnisse/)
  for (const input of ['0', '1 OR 1', '1e3', '-1', '2147483648', ['1']]) assert.equal(parseSurveyID(input), null)
  assert.equal(parseSurveyID('2147483647'), 2147483647)
})
