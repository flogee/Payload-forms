import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { responseView, responseDate, responseDuration } from '../src/survey/response-view'
import { ResponseReport } from '../src/components/ResponseReport'
import type { Definition, Question } from '../src/survey/types'

const choice = [{ value: 'a', label: 'Ursprüngliche Auswahl' }, { value: 'other', label: 'Andere' }]
const question = (id: string, kind: Question['kind'], extra: Partial<Question> = {}): Question => ({ id, block: id, kind, label: `Frage ${id}`, ...extra })
const instrument = (...questions: Question[]): Definition => ({ version: 'fictional-v1', introduction: [], sections: [{ id: 's', title: 'Beispielabschnitt', questions }] })
const data = (definition: Definition, answers: unknown) => ({ id: 123, version: 'fictional-v1', testOnly: false, createdAt: '2026-11-13T10:30:00.000Z', durationSeconds: 208, instrument: definition, answers })

test('response view uses saved labels and keeps missing, skipped and invalid answers distinct', () => {
  const saved = instrument(question('parent', 'single', { options: choice }), question('missing', 'text'),
    question('skipped', 'textarea', { showIf: { field: 'parent', values: ['other'] } }), question('bad', 'single', { options: choice }))
  const current = structuredClone(saved)
  current.sections[0].questions[0].options![0].label = 'Später geänderte Auswahl'
  const view = responseView(data(saved, { parent: { choice: 'a' }, bad: { choice: 'not-in-snapshot' } }))!
  const questions = view.sections[0].questions
  assert.deepEqual(questions.map(q => q.state), ['answered', 'missing', 'hidden', 'invalid'])
  assert.deepEqual(questions[0].lines, ['Ursprüngliche Auswahl'])
  assert.equal(questions[1].lines[0], 'Keine Angabe')
  assert.match(questions[2].lines[0], /Nicht angezeigt/)
  assert.doesNotMatch(JSON.stringify(view), /Später geänderte Auswahl|not-in-snapshot/)
  assert.equal(responseView({ answers: {} }), null)
  assert.equal(responseView({ instrument: saved, answers: [] }), null)
})

test('choice, numeric and rating formats retain zero, other text and meaningful labels', () => {
  const def = instrument(question('single', 'single', { options: choice }), question('multi', 'multiple', { options: choice }),
    question('zero', 'count'), question('unknown', 'count'), question('na', 'count', { allowNA: true }),
    question('slide', 'slider', { min: 0, max: 10, lowLabel: 'Wenig', highLabel: 'Viel' }),
    question('stars', 'stars'), question('smile', 'smiley'))
  const view = responseView(data(def, {
    single: { choice: 'other', other: 'Eigene Bezeichnung' }, multi: { choice: ['a', 'other'], other: 'Zusatz' },
    zero: { status: 'value', value: 0, note: 'Geschätzt' }, unknown: { status: 'unknown' }, na: { status: 'na' },
    slide: 0, stars: 4, smile: 5,
  }))!
  const q = Object.fromEntries(view.sections[0].questions.map(q => [q.id, q]))
  assert.deepEqual(q.single.lines, ['Andere', 'Ergänzung: Eigene Bezeichnung'])
  assert.deepEqual(q.multi.lines, ['Ursprüngliche Auswahl', 'Andere', 'Ergänzung: Zusatz'])
  assert.deepEqual(q.zero.lines, ['0', 'Anmerkung: Geschätzt'])
  assert.deepEqual(q.unknown.lines, ['Kann ich nicht beurteilen'])
  assert.deepEqual(q.na.lines, ['Nicht zutreffend'])
  assert.match(q.slide.lines[0], /^0 \(Skala 0–10\)$/)
  assert.match(q.stars.lines[0], /4 von 5 · 4 Sterne/)
  assert.match(q.smile.lines[0], /5 von 5 · Sehr zufrieden/)
})

test('legal question IDs matching object properties render saved values and missing answers correctly', () => {
  const def = instrument(question('constructor', 'text'), question('toString', 'text'))
  const filled = responseView(data(def, { constructor: 'Erste Antwort', toString: 'Zweite Antwort' }))!
  assert.deepEqual(filled.sections[0].questions.map(q => [q.state, q.lines]), [
    ['answered', ['Erste Antwort']], ['answered', ['Zweite Antwort']],
  ])
  const empty = responseView(data(def, {}))!
  assert.deepEqual(empty.sections[0].questions.map(q => [q.state, q.lines]), [
    ['missing', ['Keine Angabe']], ['missing', ['Keine Angabe']],
  ])
})

test('matrix, counts, committees and ranking preserve row labels, omissions and order', () => {
  const rows = [{ key: 'first', label: 'Erste Aussage' }, { key: 'second', label: 'Zweite Aussage' }]
  const def = instrument(question('matrix', 'matrix', { rows, options: choice }), question('counts', 'counts', { rows, allowNA: true }),
    question('committees', 'committees'), question('rank', 'ranking', { options: choice }))
  const view = responseView(data(def, { matrix: { first: 'a' }, counts: { first: { status: 'value', value: 0 }, second: { status: 'na' } },
    committees: [{ body: 'Beispielkreis', volume: 'Monatlich' }], rank: { order: ['other', 'a'] } }))!
  const q = Object.fromEntries(view.sections[0].questions.map(q => [q.id, q]))
  assert.deepEqual(q.matrix.rows, [{ label: 'Erste Aussage', lines: ['Ursprüngliche Auswahl'] }, { label: 'Zweite Aussage', lines: ['Keine Angabe'] }])
  assert.deepEqual(q.counts.rows?.map(row => row.lines), [['0'], ['Nicht zutreffend']])
  assert.deepEqual(q.committees.rows, [{ label: 'Beispielkreis', lines: ['Monatlich'] }])
  assert.deepEqual(q.rank.lines, ['Andere', 'Ursprüngliche Auswahl'])
  assert.equal(q.rank.ordered, true)
})

test('report safely renders multiline text and the complete answer content without raw technical records', () => {
  const payload = '<script>alert("fictional")</script>\nZweite Zeile'
  const view = responseView({ ...data(instrument(question('text', 'textarea')), { text: payload }),
    submissionKey: 'HIDDEN-SUBMISSION-KEY', privacyReceipt: { private: 'HIDDEN-RECEIPT' }, contact: { email: 'HIDDEN-CONTACT' } })!
  const markup = renderToStaticMarkup(createElement(ResponseReport, { view, timeZone: 'Europe/Vienna' }))
  assert.match(markup, /Antwort 123/)
  assert.match(markup, /Beispielabschnitt/)
  assert.match(markup, /Frage text/)
  assert.match(markup, /&lt;script&gt;/)
  assert.match(markup, /Zweite Zeile/)
  assert.doesNotMatch(markup, /<script>|HIDDEN-SUBMISSION|HIDDEN-RECEIPT|HIDDEN-CONTACT|Drucken/)
  assert.match(responseDate('2026-11-13T10:30:00.000Z', 'Europe/Vienna'), /11:30/)
  assert.equal(responseDate('invalid'), 'Nicht gespeichert')
  assert.equal(responseDuration(208), '3 Min. 28 Sek.')
  assert.equal(responseDuration(0), '0 Min. 0 Sek.')
})
