import test from 'node:test'
import assert from 'node:assert/strict'
import { sample } from '../src/survey/sample'
import { parseRichTextContent, imageIDs, safeRichTextURL, type RichTextNode } from '../src/survey/content'
import { fromStored, toStored } from '../src/survey/storage'
import { definitionSchema, validateAnswers } from '../src/survey/validation'
import { aggregate } from '../src/survey/stats'
import { testText } from './content-fixture'
import type { Definition } from '../src/survey/types'

test('rich text normalizes supported formatting and rejects executable or oversized content', () => {
  const text = testText('<script>escaped text</script>')
  text.root.children[0].children![0].style = 'position:fixed'
  text.root.children[0].children![0].format = 255
  const parsed = parseRichTextContent(text)
  assert.equal(parsed.root.children[0].children![0].style, '')
  assert.equal(parsed.root.children[0].children![0].format, 3)
  for (const node of [{ type: 'upload' }, { type: 'html', text: '<img onerror=alert(1)>' }, { type: 'heading', tag: 'h1', children: [] as RichTextNode[] }]) {
    assert.throws(() => parseRichTextContent({ root: { type: 'root', children: [node] } }))
  }
  assert.throws(() => parseRichTextContent(testText('x'.repeat(20001))))
  assert.throws(() => parseRichTextContent({ root: { type: 'root', children: Array.from({ length: 401 }, () => ({ type: 'paragraph', children: [] as RichTextNode[] })) } }))
  assert.throws(() => parseRichTextContent({ root: { type: 'root', children: [{ type: 'text', text: 'wrong parent' }] } }))
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//example.invalid', 'https://user:secret@example.invalid', 'https://example.invalid/\nattack']) {
    assert.equal(safeRichTextURL(url), false)
    assert.throws(() => parseRichTextContent({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', fields: { url }, children: [{ type: 'text', text: 'link' }] }] }] } }))
  }
  for (const url of ['https://example.invalid/path?q=test', 'http://localhost:3212', 'mailto:test@example.invalid']) assert.equal(safeRichTextURL(url), true)
})

test('content survives populated native storage without affecting questions, answers or statistics', () => {
  const definition = definitionSchema.parse({ ...sample,
    introContent: [{ blockType: 'text', content: testText() }, { blockType: 'image', image: 7, alt: 'Testbild' }],
    sections: sample.sections.map((section, i) => i ? section : { ...section, content: [{ blockType: 'image', image: 7, alt: 'Testbild', afterQuestion: section.questions[0].id }] }),
  }) as Definition
  const stored = structuredClone(toStored(definition)) as any
  stored.introContent[1].image = { id: 7, filename: 'test.png' }
  stored.sections[0].content[0].image = { id: 7, filename: 'test.png' }
  stored.sections[0].content[0].id = 'native-row-id'
  assert.deepEqual(fromStored(stored), JSON.parse(JSON.stringify(definition)))
  assert.deepEqual(imageIDs(definition), [7])
  assert.deepEqual(validateAnswers(definition, { F01_name: 'Test' }), validateAnswers(sample, { F01_name: 'Test' }))
  assert.deepEqual(aggregate(definition, [{ F01_name: 'Test' }]), aggregate(sample, [{ F01_name: 'Test' }]))
  assert.deepEqual(fromStored(toStored(sample)), JSON.parse(JSON.stringify(sample)), 'legacy instrument is unchanged')
  assert.equal(definitionSchema.safeParse({ ...definition, introContent: [{ ...definition.introContent![1], afterQuestion: 'F01_name' }] }).success, false)
  assert.equal(definitionSchema.safeParse({ ...definition, sections: [{ ...definition.sections[0], content: [{ ...definition.sections[0].content![0], afterQuestion: 'F21_rating' }] }, ...definition.sections.slice(1)] }).success, false)
  assert.equal(definitionSchema.safeParse({ ...definition, introContent: [{ blockType: 'image', image: 7, alt: ' ' }] }).success, false)
})
