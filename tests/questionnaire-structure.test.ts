import test from 'node:test'
import assert from 'node:assert/strict'
import { definitionStructureHash } from '../src/survey/questionnaire-structure'
import type { Definition } from '../src/survey/types'

const definition: Definition = { version: 'fixture-v1', introduction: ['Original'], introContent: [{ blockType: 'image', image: 1, alt: 'Original' }], sections: [{ id: 's', title: 'Section', description: 'Description', content: [{ blockType: 'image', image: 2, alt: 'Image', afterQuestion: 'Q' }], questions: [
  { id: 'Q', block: '1', kind: 'single', label: 'Question', help: 'Help', lowLabel: 'Low', highLabel: 'High', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', exclusive: true }] },
  { id: 'M', block: '2', kind: 'matrix', label: 'Matrix', options: [{ value: 'a', label: 'A' }], rows: [{ key: 'r', label: 'Row' }], showIf: { field: 'Q', values: ['a'] } },
] }] }

test('only enumerated editorial fields are ignored without mutating the definition', () => {
  const original = structuredClone(definition), edited = structuredClone(definition)
  edited.introduction = ['New', 'Intro']; edited.introContent![0] = { blockType: 'image', image: 9, alt: 'New', caption: 'Caption' }
  const section = edited.sections[0]; section.title = 'New section'; section.description = 'New description'
  section.content![0] = { blockType: 'image', image: 10, alt: 'New', caption: 'New', afterQuestion: 'Q' }
  for (const q of section.questions) { q.label = 'New'; q.help = 'New'; q.lowLabel = 'New'; q.highLabel = 'New'; q.options?.forEach(o => { o.label = 'New' }); q.rows?.forEach(r => { r.label = 'New' }) }
  assert.equal(definitionStructureHash(edited), definitionStructureHash(definition))
  assert.deepEqual(definition, original)
})

test('answer semantics, placement, identities and ordering remain structural', () => {
  const edits: ((d: Definition) => void)[] = [
    d => { d.version = 'fixture-v2' }, d => { d.sections[0].id = 'new' },
    d => { d.sections[0].questions.reverse() }, d => { d.sections.push(structuredClone(d.sections[0])) },
    d => { d.sections[0].questions[0].id = 'new' }, d => { d.sections[0].questions[0].block = '3' },
    d => { d.sections[0].questions[0].kind = 'multiple' }, d => { d.sections[0].questions[0].optional = true },
    d => { d.sections[0].questions[0].required = true },
    d => { d.sections[0].questions[0].allowNA = true }, d => { d.sections[0].questions[0].min = 1 },
    d => { d.sections[0].questions[0].max = 20 }, d => { d.sections[0].questions[0].step = 2 },
    d => { d.sections[0].questions[0].options!.reverse() }, d => { d.sections[0].questions[0].options![0].value = 'c' },
    d => { d.sections[0].questions[0].options![1].exclusive = false }, d => { d.sections[0].questions[1].rows![0].key = 'new' },
    d => { d.sections[0].questions[1].showIf!.values = ['b'] }, d => { d.sections[0].questions[1].showIf!.field = 'new' },
    d => { d.sections[0].content![0].afterQuestion = 'M' }, d => { d.sections[0].content!.push(structuredClone(d.sections[0].content![0])) },
    d => { d.introContent = [] },
  ]
  for (const edit of edits) { const changed = structuredClone(definition); edit(changed); assert.notEqual(definitionStructureHash(changed), definitionStructureHash(definition), edit.toString()) }
})

test('native empty/default values normalize, while unknown fields fail closed', () => {
  const normalized = structuredClone(definition)
  normalized.sections[0].questions[0].required = false
  normalized.sections[0].questions[0].optional = false; normalized.sections[0].questions[0].allowNA = false
  normalized.sections[0].questions[0].rows = []; normalized.sections[0].questions[0].options![0].exclusive = false
  assert.equal(definitionStructureHash(normalized), definitionStructureHash(definition))
  for (const target of [(d: Definition) => d, (d: Definition) => d.sections[0], (d: Definition) => d.sections[0].questions[0], (d: Definition) => d.sections[0].questions[0].options![0], (d: Definition) => d.sections[0].questions[1].rows![0], (d: Definition) => d.sections[0].questions[1].showIf!, (d: Definition) => d.introContent![0]]) {
    const unknown = structuredClone(definition); Object.assign(target(unknown), { futureSetting: true })
    assert.throws(() => definitionStructureHash(unknown), /Unbekanntes Strukturfeld/)
  }
})
