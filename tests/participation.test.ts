import test from 'node:test'
import assert from 'node:assert/strict'
import { Surveys } from '../src/collections/Surveys'
import { participationMode, realSurveysEnabled } from '../src/survey/participation'
import { participantContact } from '../src/survey/privacy'
import { toStored } from '../src/survey/storage'
import { sample } from '../src/survey/sample'
import { testPrivacy } from './privacy-fixture'
import { exportCSV } from '../src/survey/csv'

const enabled = { FORMS_REAL_SURVEYS_ENABLED: '1' }
const admin = { collection: 'users', id: 1, enabled: true, role: 'admin' }

test('live reads require exact operator opt-in and complete reviewed privacy; pretests retain the default', () => {
  const live = { phase: 'live', privacy: testPrivacy({ reviewed: true }) }
  for (const value of [undefined, '0', 'true', true, 1, '', ' 1']) {
    assert.equal(realSurveysEnabled({ FORMS_REAL_SURVEYS_ENABLED: value }), false)
    assert.equal(participationMode(live, { FORMS_REAL_SURVEYS_ENABLED: value }), undefined)
  }
  assert.equal(participationMode(live, enabled), 'live')
  for (const privacy of [undefined, {}, testPrivacy(), testPrivacy({ reviewed: true, purpose: '' })]) assert.equal(participationMode({ ...live, privacy }, enabled), undefined)
  for (const phase of ['draft', 'closed']) assert.equal(participationMode({ ...live, phase }, enabled), undefined)
  assert.equal(participationMode({ phase: 'pretest' }, {}), 'pretest')
})

test('only a human administrator may activate live with reviewed privacy; frozen versions can only close', async () => {
  const previous = process.env.FORMS_REAL_SURVEYS_ENABLED
  const hook = Surveys.hooks!.beforeChange![0]
  const draft = { id: 1, title: 'Synthetic fixture', slug: 'fixture', ...toStored(sample), phase: 'draft', privacy: testPrivacy({ reviewed: true }) }
  const change = (data: any, originalDoc = draft, user: any = admin) => hook({ data, originalDoc, operation: 'update', req: { user, context: {} } } as any)
  try {
    delete process.env.FORMS_REAL_SURVEYS_ENABLED
    await assert.rejects(change({ phase: 'live' }), /Betreiber/)
    process.env.FORMS_REAL_SURVEYS_ENABLED = '1'
    await assert.rejects(change({ phase: 'live' }, draft, { ...admin, role: 'editor' }), /Administrator/)
    await assert.rejects(change({ phase: 'live' }, draft, { ...admin, _strategy: 'mcp-api-key' }), /Administrator/)
    for (const privacy of [testPrivacy(), testPrivacy({ reviewed: true, purpose: '' })]) await assert.rejects(change({ phase: 'live', privacy }), /Datenschutz/)
    assert.equal((await change({ phase: 'live' }) as any).phase, 'live')
    const normalized = await change({ phase: 'live', privacy: { ...draft.privacy, purpose: '  Synthetic purpose  ' } }) as any
    assert.equal(normalized.privacy.purpose, 'Synthetic purpose')
    const live = { ...draft, phase: 'live' }
    for (const data of [{ phase: 'pretest' }, { version: 'changed' }, { title: 'changed' }, { privacy: testPrivacy() }, { sections: [] as unknown[] }]) await assert.rejects(change(data, live), /eingefroren|geschlossen/)
    delete process.env.FORMS_REAL_SURVEYS_ENABLED
    assert.equal((await change({ phase: 'closed' }, live) as any).phase, 'closed', 'operator shutdown never prevents closure')
  } finally {
    if (previous === undefined) delete process.env.FORMS_REAL_SURVEYS_ENABLED
    else process.env.FORMS_REAL_SURVEYS_ENABLED = previous
  }
})

test('live contacts require separate opt-in and valid email but no personal name; pretests keep fictional rules', () => {
  const settings = testPrivacy()
  assert.equal(participantContact(settings, false, undefined, false), undefined)
  assert.deepEqual(participantContact(settings, true, { email: 'fixture@example.org' }, false), { name: '', email: 'fixture@example.org' })
  assert.throws(() => participantContact(settings, false, { email: 'fixture@example.org' }, false), /Zustimmung/)
  assert.throws(() => participantContact(settings, true, { email: 'invalid' }, false), /gültige/)
  assert.throws(() => participantContact(settings, true, { name: 'Fictional', email: 'fixture@example.org' }, true), /\.invalid/)
  assert.throws(() => participantContact(settings, true, { email: 'fixture@example.invalid' }, true), /Name/)
})

test('CSV preserves actual response test markers while legacy callers remain test-only', () => {
  const csv = exportCSV(sample, [{ id: 1, version: sample.version, createdAt: '', testOnly: false, answers: {} }, { id: 2, version: sample.version, createdAt: '', answers: {} }])
  assert.match(csv.split('\r\n')[1], /"false"/)
  assert.match(csv.split('\r\n')[2], /"true"/)
})
