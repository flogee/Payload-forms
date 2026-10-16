import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHarness } from './payload-memory-fixture.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const persistenceModule = import(pathToFileURL(`${root}/src/survey/persist-update.ts`).href)
const normalize = (v: any): any => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => !(Array.isArray(x) && x.length === 0)).map(([k, x]) => [k, normalize(x)])) : v
const formData = (doc: any) => Object.fromEntries(['title', 'slug', 'version', 'phase', 'introduction', 'introContent', 'sections', 'privacy', 'notifications', 'retentionReminders']
  .filter(k => doc[k] !== undefined).map(k => [k, structuredClone(doc[k])]))
const childWrites = (h: any) => h.events.filter((e: any) => /^(insert into|delete from|update) "surveys_/.test(e.sql))

test('actual Payload pipeline preserves unchanged arrays and persists intended array mutations', async () => {
  const h = await createHarness(root)
  try {
    const args = { collection: 'surveys', user: h.user, overrideAccess: false, depth: 0 }
    let doc = await h.payload.create({ ...args, data: { title: 'Disposable fixture', slug: 'fixture-integrity', phase: 'draft', ...h.toStored(h.fixture) } })
    const originalIDs = doc.sections.flatMap((s: any) => [s.id, ...s.questions.flatMap((q: any) => [q.id, ...q.options.map((o: any) => o.id), ...q.rows.map((r: any) => r.id)])])
    let expected = normalize(h.fromStored(doc))
    const update = async (data: any, unchanged = false) => {
      h.reset()
      doc = await h.payload.update({ ...args, id: doc.id, data })
      if (unchanged) {
        assert.equal(h.events.length, 5)
        assert.equal(childWrites(h).length, 0)
        assert.equal(h.events.filter((e: any) => e.sql.startsWith('update "surveys"')).length, 1)
        assert.deepEqual(doc.sections.flatMap((s: any) => [s.id, ...s.questions.flatMap((q: any) => [q.id, ...q.options.map((o: any) => o.id), ...q.rows.map((r: any) => r.id)])]), originalIDs)
      } else assert.ok(childWrites(h).length > 0, 'changed arrays must use normal writer')
      assert.deepEqual(normalize(h.fromStored(doc)), expected, 'returned full instrument')
      const readback = await h.payload.findByID({ ...args, id: doc.id })
      assert.deepEqual(normalize(h.fromStored(readback)), expected, 'independent persisted readback')
      assert.equal(h.native.prepare('PRAGMA foreign_key_check').all().length, 0)
    }
    await update({ title: 'Only title changed' }, true)
    await update(formData(doc), true)
    const questionChange = formData(doc)
    questionChange.sections[0].questions[0].label = 'Intended replacement question label'
    expected.sections[0].questions[0].label = questionChange.sections[0].questions[0].label
    await update(questionChange)
    const introductionChange = structuredClone(doc.introduction)
    introductionChange[0].text = 'Intended replacement introduction'
    expected.introduction[0] = introductionChange[0].text
    await update({ introduction: introductionChange })
    const { parseRichTextContent } = await import(pathToFileURL(`${root}/src/survey/content.ts`).href)
    const addBlock = [{ blockType: 'text', content: parseRichTextContent({ root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Disposable introductory text block' }] }] } }) }]
    expected.introContent = addBlock
    await update({ introContent: addBlock })
    delete expected.introContent
    await update({ introContent: [] })
    assert.equal(h.native.prepare('SELECT count(*) n FROM surveys_blocks_text').get().n, 0)
    const reorder = structuredClone(doc.sections)
    ;[reorder[0].questions[0], reorder[0].questions[1]] = [reorder[0].questions[1], reorder[0].questions[0]]
    ;[expected.sections[0].questions[0], expected.sections[0].questions[1]] = [expected.sections[0].questions[1], expected.sections[0].questions[0]]
    await update({ sections: reorder })
    const addQuestion = structuredClone(doc.sections)
    const newQuestion = { code: 'fixture_added', block: 'fixture', label: 'Added question', kind: 'text', optional: true }
    addQuestion[0].questions.push(newQuestion)
    expected.sections[0].questions.push({ id: 'fixture_added', block: 'fixture', label: 'Added question', kind: 'text', optional: true })
    await update({ sections: addQuestion })
    assert.equal(h.native.prepare('SELECT count(*) n FROM surveys_sections_questions').get().n, 46)
    const removeQuestion = structuredClone(doc.sections)
    removeQuestion[0].questions.pop()
    expected.sections[0].questions.pop()
    await update({ sections: removeQuestion })
    assert.equal(h.native.prepare('SELECT count(*) n FROM surveys_sections_questions').get().n, 45)
    assert.equal(h.native.prepare('SELECT count(*) n FROM surveys_sections_questions_options').get().n, 163)
    assert.equal(h.native.prepare('SELECT count(*) n FROM surveys_sections_questions_rows').get().n, 33)
    const beforeInvalid = structuredClone(doc)
    const invalid = structuredClone(doc.sections)
    invalid[0].questions[0].kind = 'invalid-format'
    h.reset()
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { sections: invalid } }))
    assert.equal(childWrites(h).length, 0)
    assert.deepEqual(normalize(h.fromStored(await h.payload.findByID({ ...args, id: doc.id }))), expected)
    h.reset()
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { title: '' } }))
    assert.equal(childWrites(h).length, 0)
    doc = await h.payload.update({ ...args, id: doc.id, data: { phase: 'closed' } })
    h.reset()
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { title: 'Frozen mutation' } }), /eingefroren/)
    assert.equal(childWrites(h).length, 0)
    const frozenArrays = formData(doc)
    frozenArrays.sections[0].questions[0].label = 'Frozen question mutation'
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: frozenArrays }), /eingefroren/)
    assert.deepEqual(normalize(h.fromStored(await h.payload.findByID({ ...args, id: doc.id }))), expected)
    assert.equal((await h.payload.findByID({ ...args, id: doc.id })).title, beforeInvalid.title)
  } finally { await h.close() }
})

test('snapshots isolate concurrent requests, IDs and collections and are consumed once', async () => {
  const { rememberSurveyArrays, preserveUnchangedSurveyArrays } = await persistenceModule
  const reqA: any = {}, reqB: any = {}
  const a = { introduction: [{ text: 'a' }], introContent: [] as unknown[], sections: [{ key: 'a' }] }
  const b = { introduction: [{ text: 'b' }], introContent: [] as unknown[], sections: [{ key: 'b' }] }
  const calls: any[] = []
  const receiver = { receiver: true }
  const wrapped = preserveUnchangedSurveyArrays(async function (this: any, args: any) { assert.equal(this, receiver); calls.push(args); return args.data })
  rememberSurveyArrays(reqA, 1, a); rememberSurveyArrays(reqA, 2, b); rememberSurveyArrays(reqB, 1, b)
  const run = (req: any, id: any, data: any, collection = 'surveys') => wrapped.call(receiver, { req, id, collection, data } as any)
  await Promise.all([run(reqA, 1, { ...a, title: 'a' }), run(reqA, 2, { ...b, title: 'b' }), run(reqB, 1, { ...b, title: 'b2' })])
  assert.deepEqual(calls.map(a => a.data), [{ title: 'a' }, { title: 'b' }, { title: 'b2' }])
  await run(reqA, 1, a)
  assert.ok('sections' in calls.at(-1).data, 'consumed snapshot cannot be reused')
  rememberSurveyArrays(reqA, 1, a)
  await run(reqA, 1, a, 'other')
  assert.ok('sections' in calls.at(-1).data, 'another collection cannot use snapshot')
  await run(reqA, 1, a)
  assert.deepEqual(calls.at(-1).data, {}, 'other collection does not consume survey snapshot')
  rememberSurveyArrays(reqA, 1, a)
  await run(reqA, 3, a)
  assert.ok('sections' in calls.at(-1).data, 'different ID cannot use snapshot')
  await run(reqA, 1, { ...a, introduction: [] })
  assert.ok('sections' in calls.at(-1).data, 'one changed array retains all arrays')
  rememberSurveyArrays(reqA, 1, a)
  await run(reqA, 1, { ...a, sections: null })
  assert.equal(calls.at(-1).data.sections, null, 'null does not suppress intended value')
})

test('post-validation field-hook changes are persisted even when submitted arrays equal original', async () => {
  const rewrite = (fields: any[], insideQuestions = false): any[] => fields.map(f => {
    const field = { ...f }
    if (field.fields) field.fields = rewrite(field.fields, insideQuestions || field.name === 'questions')
    if (field.tabs) field.tabs = field.tabs.map((tab: any) => ({ ...tab, fields: rewrite(tab.fields, insideQuestions) }))
    if (insideQuestions && field.name === 'label') field.hooks = { ...field.hooks, beforeChange: [...(field.hooks?.beforeChange || []), ({ value, req }: any) => req.context.mutateAfterSnapshot ? 'Changed by post-validation hook' : value] }
    return field
  })
  const h = await createHarness(root, { surveyTransform: (survey: any) => ({ ...survey, fields: rewrite(survey.fields) }) })
  try {
    const args = { collection: 'surveys', user: h.user, overrideAccess: false, depth: 0 }
    const doc = await h.payload.create({ ...args, data: { title: 'Hook fixture', slug: 'hook-fixture', phase: 'draft', ...h.toStored(h.fixture) } })
    h.reset()
    const result = await h.payload.update({ ...args, id: doc.id, data: formData(doc), context: { mutateAfterSnapshot: true } })
    assert.ok(childWrites(h).length > 0, 'final hook-modified arrays must use full writer')
    assert.ok(result.sections.flatMap((s: any) => s.questions).every((q: any) => q.label === 'Changed by post-validation hook'))
    const readback = await h.payload.findByID({ ...args, id: doc.id })
    assert.deepEqual(h.fromStored(readback), h.fromStored(result))
    assert.equal(h.native.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { await h.close() }
})
