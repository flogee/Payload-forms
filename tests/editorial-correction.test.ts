import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createHarness } from './payload-memory-fixture.mjs'
import { prepareEditorialCorrection } from '../src/survey/editorial-correction'

const root = fileURLToPath(new URL('..', import.meta.url))
const approval = { editorialCorrection: true, correctionReason: 'Synthetic wording and logo correction' }
async function frozen(options = {}) {
  const h = await createHarness(root, options)
  h.native.exec("INSERT INTO users(id,email) VALUES(777,'admin@localhost.invalid'); INSERT INTO media(id,title,filename) VALUES(1,'Old synthetic logo','before.png'),(2,'New synthetic logo','after.png')")
  const args = { collection: 'surveys', user: h.user, overrideAccess: false, depth: 0 }
  const textBlock: any = { blockType: 'text', content: { root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', children: [{ type: 'text', version: 1, text: 'Original introduction', format: 0 }] }] } } }
  const definition = { version: 'editorial-fixture-v1', introduction: ['Synthetic fixture'], introContent: [{ blockType: 'image', image: 1, alt: 'Old logo' }, textBlock],
    sections: [{ id: 'S1', title: 'First section', questions: [{ id: 'Q1', block: '1', label: 'Original wording', kind: 'single', options: [{ value: 'a', label: 'Original option' }, { value: 'b', label: 'Second option' }] }] }] }
  const doc = await h.payload.create({ ...args, data: { title: 'Synthetic frozen fixture', slug: 'editorial-fixture', phase: 'pretest', ...h.toStored(definition) } })
  h.native.prepare('INSERT INTO responses(submission_key,survey_id,version,test_only,answers,instrument) VALUES(?,?,?,?,?,?)')
    .run('original-response', doc.id, definition.version, 0, '{"Q1":"a"}', JSON.stringify(definition))
  return { ...h, args, doc: await h.payload.findByID({ ...args, id: doc.id }) }
}

test('human correction retains survey identity, frozen timestamp and original response, with committed before/after audit', async () => {
  const h = await frozen()
  try {
    const { doc, args } = h, sections = structuredClone(doc.sections)
    sections[0].questions[0].label = 'Clearer wording'
    sections[0].questions[0].options[0].label = 'Clearer option'
    const originalResponse = h.native.prepare('SELECT * FROM responses').get()
    const content = structuredClone(doc.introContent)
    content[0].image = 2; content[0].alt = 'New logo'
    content[1].content.root.children[0].textFormat = 0; content[1].content.root.children[0].textStyle = ''
    content[1].content.root.children[0].children[0].text = 'Clarified introduction'
    const updated = await h.payload.update({ ...args, id: doc.id, data: { ...approval, sections, introContent: content } })
    assert.equal(updated.id, doc.id); assert.equal(updated.version, doc.version); assert.equal(updated.slug, doc.slug)
    assert.equal(updated.firstRealResponseAt, doc.firstRealResponseAt)
    assert.equal(updated.sections[0].questions[0].label, 'Clearer wording')
    assert.equal(updated.introContent[0].image, 2)
    assert.deepEqual(h.native.prepare('SELECT * FROM responses').get(), originalResponse)
    const audit = h.native.prepare('SELECT * FROM survey_corrections').get()
    assert.equal(audit.status, 'committed'); assert.equal(audit.corrected_by_id, 777)
    assert.equal(JSON.parse(String(audit.before)).definition.sections[0].questions[0].label, 'Original wording')
    assert.equal(JSON.parse(String(audit.after)).definition.sections[0].questions[0].label, 'Clearer wording')
    assert.equal(h.native.prepare('SELECT instrument_edit_token FROM surveys').get().instrument_edit_token, null)
    assert.equal(updated.editorialCorrection, false); assert.equal(updated.correctionReason, '')
    const serialized = structuredClone(updated)
    serialized.introContent[1].content.root.children[0].textFormat = 0
    serialized.introContent[1].content.root.children[0].textStyle = ''
    await h.payload.update({ ...args, id: doc.id, data: serialized })
    await h.payload.update({ ...args, id: doc.id, data: { branding: { mode: 'text', text: 'Independent operational change' } } })
    assert.equal(h.native.prepare('SELECT count(*) n FROM survey_corrections').get().n, 1)
    await assert.rejects(h.payload.create({ collection: 'survey-corrections', user: h.user, overrideAccess: false, data: audit }))
    await assert.rejects(h.payload.update({ collection: 'survey-corrections', id: audit.id, user: h.user, overrideAccess: false, data: { reason: 'Tampered' } }))
  } finally { await h.close() }
})

test('corrections require a fresh human-admin confirmation, reason and unchanged answer structure', async () => {
  const h = await frozen()
  try {
    const { doc, args } = h
    for (const missing of [{}, { editorialCorrection: true }, { ...approval, correctionReason: ' ' }, { ...approval, editorialCorrection: false }]) {
      await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { title: 'Correction', ...missing } }), /eingefroren|Grund/)
    }
    for (const user of [{ ...h.user, role: 'editor' }, { ...h.user, _strategy: 'mcp-api-key' }]) {
      await assert.rejects(h.payload.update({ ...args, user, id: doc.id, data: { title: 'Forbidden', ...approval } }), /Administrator|zugriff|permission/i)
    }
    for (const mutate of [
      (d: any) => { d.sections[0].questions[0].options[0].value = 'changed' },
      (d: any) => { d.sections[0].questions[0].options.reverse() },
      (d: any) => { d.sections[0].questions[0].optional = true },
      (d: any) => { d.sections[0].questions[0].required = true },
      (d: any) => { d.sections[0].questions[0].kind = 'multiple' },
      (d: any) => { d.introContent = [] },
      (d: any) => { d.version = 'different' },
      (d: any) => { d.slug = 'different' },
      (d: any) => { d.privacy = { ...d.privacy, purpose: 'Different purpose' } },
      (d: any) => { d.sections[0].questions[0].showIf = { field: 'Q0', values: ['1'] } },
    ]) {
      const data = structuredClone(doc); mutate(data)
      assert.throws(() => prepareEditorialCorrection(doc, data, h.user, true, 'Synthetic correction'))
      await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { ...data, ...approval } }))
    }
    const unknown = structuredClone(doc); unknown.sections[0].questions[0].futureLogic = true
    assert.throws(() => prepareEditorialCorrection(doc, unknown, h.user, true, 'Synthetic correction'), /Unbekanntes/)
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { ...unknown, ...approval } }), /Unbekanntes/)
    assert.equal(h.native.prepare('SELECT count(*) n FROM survey_corrections').get().n, 0)
  } finally { await h.close() }
})

test('closing cannot race a correction, and failed audit creation rolls back the edit lock', async () => {
  let h: any, probe = false
  h = await frozen({ beforeWrite: async (args: any) => {
    if (probe && args.collection === 'surveys') {
      probe = false
      await assert.rejects(h.payload.update({ ...h.args, id: h.doc.id, data: { phase: 'closed' } }), /gerade gespeichert/)
    }
  } })
  try {
    await assert.rejects(h.payload.update({ ...h.args, user: { ...h.user, id: 888 }, id: h.doc.id, data: { ...approval, title: 'No persisted actor' } }))
    assert.equal(h.native.prepare('SELECT instrument_edit_token FROM surveys').get().instrument_edit_token, null)
    assert.equal(h.native.prepare('SELECT count(*) n FROM survey_corrections').get().n, 0)
    probe = true
    await h.payload.update({ ...h.args, id: h.doc.id, data: { ...approval, title: 'Correction before closing' } })
    assert.equal(probe, false)
    const closed = await h.payload.update({ ...h.args, id: h.doc.id, data: { phase: 'closed' } })
    assert.equal(closed.phase, 'closed')
    assert.equal(closed.firstRealResponseAt, h.doc.firstRealResponseAt)
  } finally { await h.close() }
})

test('stale corrections lose before nested writes; failed corrections retain the lock and pending audit', async () => {
  let native: any
  const h = await frozen({ surveyTransform: (survey: any) => ({ ...survey, hooks: { ...survey.hooks, beforeChange: [...survey.hooks.beforeChange, ({ data, originalDoc, req }: any) => {
    if (req.context.staleCorrection) native.prepare("UPDATE surveys SET updated_at='2026-11-16T00:00:00.000Z' WHERE id=?").run(originalDoc.id)
    if (req.context.changedAfterApproval) data.sections[0].questions[0].options[0].value = 'tampered'
    return data
  }] } }) })
  native = h.native
  try {
    const sections = structuredClone(h.doc.sections); sections[0].questions[0].label = 'Changed wording'
    const edit = { ...h.args, id: h.doc.id, data: { ...approval, sections } }
    await assert.rejects(h.payload.update({ ...edit, context: { changedAfterApproval: true } }), /nach der Prüfung/)
    await assert.rejects(h.payload.update({ ...edit, context: { staleCorrection: true } }), /neu/)
    assert.equal(h.native.prepare('SELECT count(*) n FROM survey_corrections').get().n, 0)
    assert.equal((await h.payload.findByID({ ...h.args, id: h.doc.id })).sections[0].questions[0].label, 'Original wording')
    h.native.exec("CREATE TRIGGER synthetic_child_failure BEFORE INSERT ON surveys_sections_questions BEGIN SELECT RAISE(ABORT,'synthetic child failure'); END")
    await assert.rejects(h.payload.update(edit))
    assert.ok(h.native.prepare('SELECT instrument_edit_token FROM surveys').get().instrument_edit_token)
    assert.equal(h.native.prepare('SELECT status FROM survey_corrections').get().status, 'pending')
    assert.throws(() => h.native.prepare('INSERT INTO responses(submission_key,survey_id,version,test_only,answers,instrument) VALUES(?,?,?,?,?,?)').run('blocked', h.doc.id, h.doc.version, 0, '{}', '{}'), /being edited/)
  } finally { await h.close() }
})
