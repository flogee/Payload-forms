import assert from 'node:assert/strict'
import { test } from 'node:test'
import { votingDefinition as def } from './voting-fixture'
import { definitionSchema, validateAnswers, validateSectionAnswers, hasAnswer } from '../src/survey/validation'
import { fromStored, toStored } from '../src/survey/storage'
import { answerText } from '../src/survey/answer-text'
import { questionnaireMarkdown } from '../src/survey/survey-tools'

test('new voting formats round-trip without injecting defaults into stored instruments', () => {
  assert.deepEqual(fromStored(toStored(def)), def)
  assert.deepEqual(validateAnswers(def, {}).answers, {})
  assert.equal(hasAnswer(0), true)
  assert.equal(hasAnswer(undefined), false)
  const valid = { Slider: 0, Wide: 100, Stars: 5, Mood: 1, Rank: { order: ['exchange', 'clarity', 'decisions'] } }
  assert.deepEqual(validateAnswers(def, valid), { answers: valid, errors: {} })
})

test('numeric bounds, steps and rating endpoints are validated on the server', () => {
  for (const invalid of [-1, 11, 1.5, '5', { value: 5 }, NaN]) assert.ok(validateAnswers(def, { Slider: invalid }).errors.Slider)
  assert.ok(validateAnswers(def, { Wide: 15 }).errors.Wide)
  for (const kind of ['Stars', 'Mood']) for (const invalid of [0, 6, 2.5, '3']) assert.ok(validateAnswers(def, { [kind]: invalid }).errors[kind])
  const slider = (settings: object) => ({ ...def, sections: [{ ...def.sections[0], questions: [{ ...def.sections[0].questions[0], ...settings }] }] })
  for (const settings of [{ min: 10, max: 0 }, { min: 0, max: 101 }, { step: 3 }, { min: 10 }, { step: 0 }]) assert.equal(definitionSchema.safeParse(slider(settings)).success, false)
  assert.equal(definitionSchema.safeParse(slider({ min: 2, max: 8, step: 2 })).success, true)
})

test('rankings require a complete permutation of stable option codes', () => {
  for (const order of [[], ['clarity'], ['clarity', 'clarity', 'exchange'], ['clarity', 'exchange', 'unknown']]) assert.ok(validateAnswers(def, { Rank: { order } }).errors.Rank)
  assert.ok(validateAnswers(def, { Rank: { order: ['clarity', 'exchange', 'decisions'], other: 'injected' } }).errors.Rank)
  const rank = def.sections[0].questions[4]
  for (const options of [rank.options!.slice(0, 1), [...rank.options!, { value: 'clarity', label: 'duplicate' }], rank.options!.map(o => ({ ...o, exclusive: true }))]) {
    assert.equal(definitionSchema.safeParse({ ...def, sections: [{ ...def.sections[0], questions: [{ ...rank, options }] }] }).success, false)
  }
})

test('protected answer view and instrument download describe new formats', () => {
  const q = def.sections[0].questions
  assert.equal(answerText(q[0], 0), '0')
  assert.equal(answerText(q[2], 5), '5 / 5 · Sehr hilfreich')
  assert.equal(answerText(q[3], 3), '3 / 5 · Neutral')
  assert.match(answerText(q[4], { order: ['exchange', 'clarity', 'decisions'] }), /^1\. Mehr Zeit/)
  const markdown = questionnaireMarkdown({ id: 1, title: 'Fiktiver Test', slug: 'fixture', ...toStored(def) })
  assert.match(markdown, /Slider: 0–10; Schrittweite 1/)
  assert.match(markdown, /Slider: 0–100; Schrittweite 10/)
  assert.match(markdown, /Platz 1 hat die höchste Priorität/)
  assert.doesNotMatch(markdown, /Antwortformat: undefined/)
})

test('going back and forward preserves unfinished future rankings while hidden answers are discarded', () => {
  const gate = { id: 'Gate', block: 'Test', label: 'Anzeigen?', kind: 'single' as const, options: [{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }] }
  const twoSteps = { ...def, sections: [
    { id: 'first', title: 'Anfang', questions: [gate] },
    { id: 'second', title: 'Prioritäten', questions: [{ ...def.sections[0].questions[4], showIf: { field: 'Gate', values: ['yes'] } }] },
  ] }
  const partial = { Gate: { choice: 'yes' }, Rank: { order: ['exchange'] } }
  const next = validateSectionAnswers(twoSteps, partial, 'first')
  assert.deepEqual(next, { answers: partial, errors: {} })
  assert.ok(validateSectionAnswers(twoSteps, next.answers, 'second').errors.Rank)
  assert.ok(validateAnswers(twoSteps, next.answers).errors.Rank, 'partial rankings cannot reach storage')
  const changedBranch = validateSectionAnswers(twoSteps, { ...partial, Gate: { choice: 'no' } }, 'first')
  assert.deepEqual(changedBranch.answers, { Gate: { choice: 'no' } })
})
