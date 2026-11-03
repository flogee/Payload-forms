import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createHarness } from './payload-memory-fixture.mjs'
import { notificationFixture } from './notification-fixture'
import { saveSubmission } from '../src/survey/response-store'
import { testPrivacy } from './privacy-fixture'
import { privacyNotice } from '../src/survey/privacy'
import { participationMode } from '../src/survey/participation'
import { privacyHash } from '../src/survey/privacy-crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const insert = (native: any, id: number, testOnly: number, key = crypto.randomUUID()) => native.prepare(
  'INSERT INTO responses(submission_key,survey_id,version,test_only,answers,instrument) VALUES(?,?,?,?,?,?)'
).run(key, id, 'fixture-v1', testOnly, '{}', '{}')

test('pretest answers permit edits; the first real answer permanently freezes content, identity and mode', async () => {
  const h = await createHarness(root)
  try {
    const args = { collection: 'surveys', user: h.user, overrideAccess: false, depth: 0 }
    let doc = await h.payload.create({ ...args, data: { title: 'Synthetic editable survey', slug: 'editable-fixture', phase: 'pretest', ...h.toStored(h.fixture) } })
    insert(h.native, doc.id, 1)
    const sections = structuredClone(doc.sections)
    sections[0].questions[0].label = 'Revised during the pretest'
    doc = await h.payload.update({ ...args, id: doc.id, data: { title: 'Revised title', sections } })
    assert.equal(doc.sections[0].questions[0].label, 'Revised during the pretest')
    assert.equal(h.native.prepare('SELECT first_real_response_at FROM surveys WHERE id=?').get(doc.id).first_real_response_at, null)
    insert(h.native, doc.id, 0)
    for (const data of [{ title: 'Forbidden' }, { slug: 'forbidden' }, { version: 'forbidden' }, { sections: h.toStored(h.fixture).sections }, { privacy: { purpose: 'Forbidden' } }, { phase: 'draft' }]) {
      await assert.rejects(h.payload.update({ ...args, id: doc.id, data }), /eingefroren|nur geschlossen/)
    }
    await h.payload.update({ ...args, id: doc.id, data: { branding: { mode: 'text', text: 'Operational branding' } } })
    await h.payload.update({ ...args, id: doc.id, data: { phase: 'closed' } })
    h.native.prepare('DELETE FROM responses WHERE survey_id=?').run(doc.id)
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { title: 'Still forbidden after erasure' } }), /eingefroren/)
    assert.throws(() => h.native.prepare('UPDATE surveys SET first_real_response_at=NULL WHERE id=?').run(doc.id), /permanent/)
    assert.equal((await h.payload.findByID({ ...args, id: doc.id })).title, 'Revised title')
    assert.equal(h.native.prepare('SELECT instrument_edit_token FROM surveys WHERE id=?').get(doc.id).instrument_edit_token, null)
  } finally { await h.close() }
})

test('a real answer arriving after the collection check wins before any nested questionnaire writes', async () => {
  let native: any
  const h = await createHarness(root, { surveyTransform: (survey: any) => ({ ...survey, hooks: { ...survey.hooks, beforeChange: [...survey.hooks.beforeChange, ({ data, originalDoc, req }: any) => {
    if (req.context.firstAnswerRace) insert(native, originalDoc.id, 0)
    return data
  }] } }) })
  native = h.native
  try {
    const args = { collection: 'surveys', user: h.user, overrideAccess: false, depth: 0 }
    const doc = await h.payload.create({ ...args, data: { title: 'Synthetic race fixture', slug: 'race-fixture', phase: 'pretest', ...h.toStored(h.fixture) } })
    const sections = structuredClone(doc.sections)
    sections[0].questions[0].label = 'Must not overwrite the first real answer'
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { sections }, context: { firstAnswerRace: true } }), /echte Antworten|neu/)
    assert.deepEqual(h.fromStored(await h.payload.findByID({ ...args, id: doc.id })), h.fromStored(doc))
    assert.equal(native.prepare('SELECT count(*) AS n FROM responses WHERE test_only=0').get().n, 1)
  } finally { await h.close() }
})

test('failed writes stay blocked until verified recovery; partial nested writes cannot accept responses', async () => {
  const h = await createHarness(root)
  try {
    const args = { collection: 'surveys', user: h.user, overrideAccess: false, depth: 0 }
    const doc = await h.payload.create({ ...args, data: { title: 'Failure fixture', slug: 'failure-fixture', phase: 'pretest', ...h.toStored(h.fixture) } })
    h.native.exec("CREATE TRIGGER fixture_write_failure BEFORE UPDATE OF title ON surveys WHEN NEW.title='Fail' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END")
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { title: 'Fail' } }), (error: any) => /synthetic write failure/.test(String(error.cause)))
    assert.ok(h.native.prepare('SELECT instrument_edit_token FROM surveys WHERE id=?').get(doc.id).instrument_edit_token)
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { title: 'Blocked' } }), /gerade geändert/)
    // Operator recovery is safe here only because this injected failure preceded all writes.
    h.native.prepare('UPDATE surveys SET instrument_edit_token=NULL WHERE id=?').run(doc.id)
    const saved = await h.payload.update({ ...args, id: doc.id, data: { title: 'Recovered' } })
    assert.equal(saved.title, 'Recovered')
    h.native.exec("CREATE TRIGGER fixture_child_failure BEFORE INSERT ON surveys_sections_questions BEGIN SELECT RAISE(ABORT,'synthetic child failure'); END")
    const sections=structuredClone(saved.sections);sections[0].questions[0].label='Partial update'
    await assert.rejects(h.payload.update({ ...args, id: doc.id, data: { sections } }))
    assert.equal(h.native.prepare('SELECT count(*) AS n FROM surveys_sections_questions').get().n, 0)
    const token=h.native.prepare('SELECT instrument_edit_token FROM surveys WHERE id=?').get(doc.id).instrument_edit_token
    assert.ok(token)
    assert.equal(participationMode({ phase:'pretest',instrumentEditToken:token }),undefined)
    assert.throws(() => insert(h.native,doc.id,0),/being edited/)
  } finally { await h.close() }
})

test('edit tokens and stale reads prevent real submission without creating a freeze; retry succeeds after editing', async () => {
  const h = await notificationFixture(), previous = process.env.FORMS_REAL_SURVEYS_ENABLED
  try {
    process.env.FORMS_REAL_SURVEYS_ENABLED = '1'
    const settings = testPrivacy({ reviewed: true }), notice = privacyNotice(settings)!
    const entries = Object.entries(settings)
    h.sqlite.prepare(`UPDATE surveys SET phase='live', ${entries.map(([key]) => `privacy_${key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}=?`).join(',')} WHERE id=1`)
      .run(...entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value))
    const input = { ...h.input(), mode: 'live' as const, livePrivacy: settings,
      receipt: { notice, noticeHash: privacyHash(notice), recordedAt: new Date().toISOString(), consent: true, contactConsent: false } }
    h.sqlite.exec("UPDATE surveys SET instrument_edit_token='synthetic-edit'")
    assert.equal((await saveSubmission(h.db, input)).state, 'closed')
    assert.throws(() => insert(h.sqlite, 1, 0), /being edited/)
    h.sqlite.exec('UPDATE surveys SET instrument_edit_token=NULL')
    assert.equal((await saveSubmission(h.db, { ...input, expectedSurveyUpdatedAt: 'stale' })).state, 'closed')
    assert.equal(h.sqlite.prepare('SELECT first_real_response_at FROM surveys').get()?.first_real_response_at, null)
    const expectedSurveyUpdatedAt = String(h.sqlite.prepare('SELECT updated_at FROM surveys').get()?.updated_at)
    assert.equal((await saveSubmission(h.db, { ...input, expectedSurveyUpdatedAt })).state, 'saved')
    assert.ok(h.sqlite.prepare('SELECT first_real_response_at FROM surveys').get()?.first_real_response_at)
  } finally {
    if (previous === undefined) delete process.env.FORMS_REAL_SURVEYS_ENABLED
    else process.env.FORMS_REAL_SURVEYS_ENABLED = previous
    h.sqlite.close()
  }
})


test('a stale operational save cannot restore an earlier instrument or pretest mode after the first real answer', async () => {
  let native: any
  const h = await createHarness(root, { surveyTransform: (survey: any) => ({ ...survey, hooks: { ...survey.hooks, beforeChange: [...survey.hooks.beforeChange, ({ data, originalDoc, req }: any) => {
    if (req.context.operationalRace) {
      native.prepare("UPDATE surveys SET title='Instrument B',phase='live',updated_at='2026-11-03T12:00:00.000Z' WHERE id=?").run(originalDoc.id)
      insert(native, originalDoc.id, 0)
    }
    return data
  }] } }) })
  native=h.native
  try {
    const args={collection:'surveys',user:h.user,overrideAccess:false,depth:0}
    const doc=await h.payload.create({...args,data:{title:'Instrument A',slug:'operational-race',phase:'pretest',...h.toStored(h.fixture)}})
    await h.payload.update({...args,id:doc.id,data:{branding:{mode:'text',text:'Operational change'}},context:{operationalRace:true}})
    const saved=await h.payload.findByID({...args,id:doc.id})
    assert.equal(saved.title,'Instrument B');assert.equal(saved.phase,'live');assert.ok(saved.firstRealResponseAt)
    assert.equal(saved.branding.text,'Operational change')
  } finally { await h.close() }
})
