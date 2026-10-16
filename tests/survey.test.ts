import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sample } from '../src/survey/sample'
import { fromStored, toStored } from '../src/survey/storage'
import { definitionSchema, validateAnswers, visible } from '../src/survey/validation'
import { aggregate } from '../src/survey/stats'
import { safeBatches } from '../src/survey/d1-batches'
import { csvCell, exportCSV } from '../src/survey/csv'
test('CSV preserves numeric status and escapes spreadsheet formulas', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  const csv = exportCSV(sample, [{ id: 1, version: sample.version, createdAt: '2026-10-05T10:00:00Z', answers: { F06_people: { r1: { status: 'value', value: 0 }, r2: { status: 'unknown' } } } }])
  assert.ok(csv.includes('F06_people_r1_status'))
  assert.ok(csv.includes('"value","0"'))
  assert.ok(csv.includes('"unknown"'))
  assert.ok(csv.includes('"missing"'))
})
test('sparse first rows do not overflow D1 bind limits', () => {
  const rows = [{ a: 1, b: 2 }, ...Array.from({ length: 30 }, () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }))]
  const batches = safeBatches(rows)
  assert.deepEqual(batches.flat(), rows)
  assert.ok(batches.every(b => b.reduce((sum, r) => sum + Object.keys(r).length, 0) <= 80))
})
test('all 25 draft blocks are covered and storage preserves the instrument', () => {
  assert.equal(new Set(sample.sections.flatMap(s => s.questions.map(q => q.block))).size, 25)
  assert.deepEqual(fromStored(toStored(sample)), JSON.parse(JSON.stringify(sample)))
  assert.equal(definitionSchema.safeParse(sample).success, true)
})
test('true zero, unknown, not applicable and missing remain distinct', () => {
  const r = validateAnswers(sample, { F06_people: { r1: { status: 'value', value: 0 }, r2: { status: 'unknown' }, r3: { status: 'na' } } })
  assert.deepEqual(r.errors, {})
  assert.deepEqual(r.answers.F06_people, { r1: { status: 'value', value: 0 }, r2: { status: 'unknown' }, r3: { status: 'na' } })
  assert.ok(!('r4' in (r.answers.F06_people as object)))
  assert.ok(validateAnswers(sample, { F08_count: { status: 'value', value: -1 } }).errors.F08_count)
  assert.ok(validateAnswers(sample, { F08_count: { status: 'unknown', value: 0 } }).errors.F08_count)
})
test('conditional questions exclude stale hidden values', () => {
  const reminders = sample.sections.flatMap(s => s.questions).find(q => q.id === 'F19_reminders')!
  assert.equal(visible(reminders, { F19_dates: { choice: '1' } }), true)
  const r = validateAnswers(sample, { F19_dates: { choice: '3' }, F19_reminders: { choice: ['1'] }, F19_adhoc: { choice: '1' } })
  assert.ok(!('F19_reminders' in r.answers))
  assert.ok('F19_adhoc' in r.answers)
})
test('reject invalid codes, exclusive combinations, injected keys and wrong shapes', () => {
  assert.ok(validateAnswers(sample, { F03_legal: { choice: 'invalid' } }).errors.F03_legal)
  assert.ok(validateAnswers(sample, { F09_individual: { choice: ['none', '1'] } }).errors.F09_individual)
  assert.ok(validateAnswers(sample, { surprise: 'value' }).errors.surprise)
  assert.ok(validateAnswers(sample, { F21_rating: { r99: '1' } }).errors.F21_rating)
  assert.ok(validateAnswers(sample, []).errors._form)
})
test('aggregation gives denominators and never includes raw text', () => {
  const result = aggregate(sample, [{ F01_name: 'SECRET ORG', F11_strengths: 'SECRET PERSON', F21_rating: { r1: '5' }, F19_dates: { choice: '3' } }, { F21_rating: { r1: '6' }, F19_dates: { choice: '1' }, F19_reminders: { choice: ['1', '2'] } }])
  assert.equal(result.responses, 2)
  const raw = JSON.stringify(result)
  assert.ok(!raw.includes('SECRET'))
  assert.deepEqual((result.results.F19_reminders as any).eligible, 1)
  const first = (result.results.F21_rating as any)[sample.sections[5].questions[0].rows![0].label]
  assert.equal(first.answered, 2)
  assert.equal(first.counts['Option 5'], 1)
  assert.equal(first.counts['Option 6'], 1)
})
