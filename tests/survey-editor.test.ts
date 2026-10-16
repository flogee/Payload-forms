import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerFormat, answerFormats, contentRowLabel, itemRowLabel, questionRowLabel, sectionRowLabel } from '../src/components/SurveyEditor.helpers'

test('Die Formathilfe erhält bestehende Werte und ergänzt vier Abstimmungsformate', () => {
  assert.deepEqual(Object.keys(answerFormats), ['single', 'multiple', 'text', 'textarea', 'count', 'counts', 'matrix', 'committees', 'slider', 'stars', 'smiley', 'ranking'])
  assert.equal(answerFormat('matrix')?.label, 'Skala / Bewertungszeilen')
  assert.match(answerFormat('matrix')!.description, /gemeinsame Skala/)
  for (const unknown of [null, undefined, '', 'rating', 'toString', '__proto__', {}]) assert.equal(answerFormat(unknown), undefined)
})

test('Inhalt und Fragezahl bleiben bei leeren, geänderten und unvollständigen Zeilen verständlich', () => {
  assert.deepEqual(sectionRowLabel({ title: ' Zusammenarbeit\n im Team ', key: 'team', questions: [{}, {}] }), {
    title: 'Zusammenarbeit im Team', detail: 'team · 2 Fragen',
  })
  assert.equal(sectionRowLabel({ title: 'Neu', questions: [{}] }).detail, '1 Frage')
  assert.deepEqual(sectionRowLabel({ questions: null }, 0), { title: 'Neuer Abschnitt 1', detail: '0 Fragen' })
  assert.deepEqual(questionRowLabel({ code: 'F01', label: 'Wie entscheidet ihr?', kind: 'matrix' }), {
    title: 'F01 · Wie entscheidet ihr?', detail: 'Skala / Bewertungszeilen',
  })
  assert.deepEqual(questionRowLabel({}, 1), { title: 'Neue Frage 2', detail: 'Antwortformat wählen' })
  assert.equal(questionRowLabel({ label: 'Aktueller Text', kind: 'text' }).title, 'Aktueller Text')
  assert.equal(questionRowLabel({ code: 'F02', kind: 'text' }).title, 'F02')
})

test('Absätze, Antwortoptionen und Bewertungszeilen zeigen Texte mit ihren stabilen Kennungen', () => {
  assert.deepEqual(itemRowLabel({ label: 'Stimme zu', value: 'yes' }, 'label', 'Neue Antwortoption'), { title: 'Stimme zu', detail: 'yes' })
  assert.deepEqual(itemRowLabel({ label: 'Zusammenarbeit', key: 'team' }, 'label', 'Neue Zeile'), { title: 'Zusammenarbeit', detail: 'team' })
  assert.equal(itemRowLabel({ text: 'Willkommen\nzum Feedback' }, 'text', 'Neuer Absatz').title, 'Willkommen zum Feedback')
  assert.equal(itemRowLabel({ label: {} }, 'label', 'Neue Antwortoption', 0).title, 'Neue Antwortoption 1')
  const long = 'Eine lange Frage '.repeat(50)
  assert.equal(questionRowLabel({ label: long }).title, long.trim())
})

test('Inhaltsblöcke erhalten begrenzte Vorschauen und klare Leerzustände', () => {
  const content = { root: { type: 'root', children: [{ type: 'paragraph', children: [{ text: 'Zusammen' }, { text: 'arbeit' }] }, { type: 'paragraph', children: [{ text: 'im ' }, { text: 'Team' }] }] } }
  assert.deepEqual(contentRowLabel({ blockType: 'text', content }), { title: 'Zusammenarbeit im Team', detail: 'Formatierter Text' })
  assert.deepEqual(contentRowLabel({ blockType: 'image', alt: 'Ein Team im Kreis', caption: 'Teamrunde' }), { title: 'Teamrunde', detail: 'Bild' })
  assert.equal(contentRowLabel({ blockType: 'image', alt: 'Ein Team im Kreis' }).title, 'Ein Team im Kreis')
  assert.equal(contentRowLabel({ blockType: 'image' }, 0).title, 'Neues Bild 1')
  assert.equal(contentRowLabel({ content: null }, 1).title, 'Neuer Textblock 2')
  const preview = contentRowLabel({ content: { text: 'a'.repeat(1000) } }).title
  assert.equal(preview.length, 161)
  assert.ok(preview.endsWith('…'))
})
