import test from 'node:test'
import assert from 'node:assert/strict'
import type { Payload, TypedUser } from 'payload'
import { loadSurveyReport, reportDataset } from '../src/survey/report-load'
import { toStored } from '../src/survey/storage'
import { demoDefinition } from '../src/survey/analysis-demo'

const user = { id: 1, collection: 'users', enabled: true, role: 'admin', _strategy: 'local-jwt' } as unknown as TypedUser
const survey = { id: 8, title: 'Fictional survey', slug: 'fixture', phase: 'live', ...toStored(demoDefinition) }
function fixture(overrides: { rows?: any[]; total?: number; survey?: any } = {}) {
  const calls: any[] = []
  const rows = overrides.rows ?? [{ id: 1, answers: { Q5: 'FICTIONAL PRIVATE REPORT TEXT' }, instrument: demoDefinition, version: demoDefinition.version, testOnly: false }]
  const payload = { find: async (args: any) => { calls.push(args); return args.collection === 'surveys'
    ? { docs: [overrides.survey ?? survey] } : { docs: rows, totalDocs: overrides.total ?? rows.length } },
    count: async (args: any) => { calls.push(args); return { totalDocs: rows.length + 3 } },
  } as unknown as Payload
  return { payload, calls }
}

test('human report loads a complete real cohort with minimal authorized reads and excludes test rows', async () => {
  const { payload, calls } = fixture()
  const report = await loadSurveyReport(payload, 8, user)
  assert.equal(report.dataset, 'real'); assert.equal(report.aggregate.responses, 1); assert.equal(report.excludedResponses, 3)
  assert.deepEqual(calls[1].where, { and: [{ survey: { equals: 8 } }, { testOnly: { equals: false } }] })
  assert.deepEqual(calls[1].select, { answers: true, createdAt: true, durationSeconds: true, testOnly: true, instrument: true, version: true })
  for (const call of calls) { assert.equal(call.user, user); assert.equal(call.overrideAccess, false); assert.notEqual(call.collection, 'response-contacts') }
  assert.match(JSON.stringify(report.sections), /FICTIONAL PRIVATE REPORT TEXT/)
  assert.doesNotMatch(JSON.stringify(report.aggregate), /FICTIONAL PRIVATE REPORT TEXT|privacyReceipt/)
})

test('machine and absent users cannot load raw report details or cause any data reads', async () => {
  const { payload, calls } = fixture()
  await assert.rejects(loadSurveyReport(payload, 8, null as any), /persönlichen Teamzugang/)
  await assert.rejects(loadSurveyReport(payload, 8, { ...user, _strategy: 'mcp-api-key' } as any), /persönlichen Teamzugang/)
  assert.equal(calls.length, 0)
})

test('report refuses truncation, missing snapshots, mixed revisions and concurrent incomplete reads', async () => {
  await assert.rejects(loadSurveyReport(fixture({ total: 1001 }).payload, 8, user), /kein Teilbericht/)
  await assert.rejects(loadSurveyReport(fixture({ rows: [{ id: 1, answers: {}, testOnly: false }] }).payload, 8, user), /Fragebogenfassung fehlt/)
  const changed = structuredClone(demoDefinition); changed.sections[0].questions[0].label = 'Changed historical question'
  const rows = [demoDefinition, changed].map((instrument, id) => ({ id, answers: {}, instrument, version: instrument.version, testOnly: false }))
  await assert.rejects(loadSurveyReport(fixture({ rows }).payload, 8, user), /unterschiedlichen Fragebogenständen/)
  await assert.rejects(loadSurveyReport(fixture({ total: 2 }).payload, 8, user), /Datenstand hat sich/)
})

test('empty and explicit test cohorts remain correctly labelled and dataset parameters are strict', async () => {
  const empty = await loadSurveyReport(fixture({ rows: [] }).payload, 8, user)
  assert.equal(empty.aggregate.responses, 0); assert.equal(empty.aggregate.dataset, 'real')
  const { payload, calls } = fixture({ rows: [] })
  await loadSurveyReport(payload, 8, user, 'test')
  assert.deepEqual(calls[1].where.and[1], { testOnly: { equals: true } })
  assert.equal(reportDataset('real'), 'real'); assert.equal(reportDataset('test'), 'test'); assert.equal(reportDataset(undefined), undefined)
  for (const value of ['mixed', '', ['real'], 1]) assert.throws(() => reportDataset(value), /auswählen/)
})
