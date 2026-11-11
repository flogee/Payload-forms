import test from 'node:test'
import assert from 'node:assert/strict'
import { matrixSliderOptions } from '../src/survey/matrix'
import { definitionSchema, validateAnswers } from '../src/survey/validation'
import { fromStored, toStored } from '../src/survey/storage'
import type { Definition, Question } from '../src/survey/types'

const question: Question = { id: 'Rating', block: 'Feedback', label: 'Eine fiktive Bewertung', kind: 'matrix', optional: true,
  options: [...[1, 2, 3, 4, 5].map(value => ({ value: String(value), label: `Stufe ${value}` })), { value: 'unknown', label: 'Kann ich nicht beurteilen' }],
  rows: [{ key: 'one', label: 'Fiktive Aussage A' }, { key: 'two', label: 'Fiktive Aussage B' }] }
const definition: Definition = { version: 'fictional-matrix-v1', introduction: [], sections: [{ id: 'feedback', title: 'Feedback', questions: [question] }] }

test('only the exact ordered five-step matrix with an unknown option uses sliders', () => {
  const result = matrixSliderOptions(question)!
  assert.deepEqual(result.scale.map(option => option.value), ['1', '2', '3', '4', '5'])
  assert.equal(result.unknown.value, 'unknown')
  for (const other of [
    { ...question, kind: 'single' as const },
    { ...question, options: question.options!.slice(0, 5) },
    { ...question, options: [...question.options!].reverse() },
    { ...question, options: question.options!.map(option => option.value === '3' ? { ...option, value: 'middle' } : option) },
    { ...question, options: question.options!.map(option => option.value === '1' ? { ...option, exclusive: true } : option) },
    { ...question, options: [...question.options!, { value: 'na', label: 'Nicht zutreffend' }] },
  ]) assert.equal(matrixSliderOptions(other), undefined)
})

test('all five ratings, unknown and unanswered rows keep the existing matrix contract', () => {
  assert.deepEqual(fromStored(toStored(definition)), definitionSchema.parse(definition))
  assert.deepEqual(validateAnswers(definition, {}), { answers: {}, errors: {} })
  for (const value of ['1', '2', '3', '4', '5', 'unknown']) {
    const answers = { Rating: { one: value } }
    assert.deepEqual(validateAnswers(definition, answers), { answers, errors: {} })
  }
  assert.ok(validateAnswers(definition, { Rating: { one: ['3', 'unknown'] } }).errors.Rating)
  assert.ok(validateAnswers(definition, { Rating: { one: '6' } }).errors.Rating)
  assert.deepEqual(validateAnswers(definition, { Rating: { two: 'unknown' } }).answers, { Rating: { two: 'unknown' } })
})
