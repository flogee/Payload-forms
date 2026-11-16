import test from 'node:test'
import assert from 'node:assert/strict'
import type { Payload, TypedUser } from 'payload'
import { resolveAnalysisDefinition } from '../src/survey/analysis-definition'
import { digest } from '../src/survey/privacy-crypto'
import type { Definition } from '../src/survey/types'

const user = { id: 1, collection: 'users', enabled: true, role: 'admin', _strategy: 'local-jwt' } as unknown as TypedUser
const make = (label: string): Definition => ({ version: 'fixture-v1', introduction: [], sections: [{ id: 's', title: 'Fixture', questions: [{ id: 'Q', block: '1', kind: 'text', label }] }] })
const [a, b, c] = ['A', 'B', 'C'].map(make)
const hash = (d: Definition) => digest({ version: d.version, sections: d.sections })
const edge = (before: Definition, after: Definition) => ({ survey: 8, status: 'committed', beforeHash: hash(before), afterHash: hash(after) })
function fixture(docs: any[] = [], extra: Record<string, unknown> = {}) {
  const calls: any[] = []
  const payload = { find: async (args: any) => { calls.push(args); return { docs, totalDocs: docs.length, ...extra } } } as unknown as Payload
  return { payload, calls }
}

test('same definition and empty datasets avoid audit reads', async () => {
  const { payload, calls } = fixture()
  assert.deepEqual(await resolveAnalysisDefinition(payload, 8, a, [a, a], { user }), { definition: a, corrected: false })
  assert.deepEqual(await resolveAnalysisDefinition(payload, 8, a, [], { user }), { definition: a, corrected: false })
  assert.equal(calls.length, 0)
})

test('committed chained corrections relabel all saved snapshots through minimal authorized reads', async () => {
  const { payload, calls } = fixture([edge(a, b), edge(b, c)])
  assert.deepEqual(await resolveAnalysisDefinition(payload, 8, c, [a, b, c], { user }), { definition: c, corrected: true })
  assert.deepEqual(await resolveAnalysisDefinition(payload, 8, c, [a], { user }), { definition: c, corrected: true })
  assert.equal(calls[0].overrideAccess, false); assert.equal(calls[0].user, user); assert.equal(calls[0].depth, 0)
  assert.equal(calls[0].limit, 1000)
  assert.deepEqual(calls[0].where, { and: [{ survey: { equals: 8 } }, { status: { equals: 'committed' } }] })
  assert.deepEqual(calls[0].select, { survey: true, status: true, beforeHash: true, afterHash: true })
})

test('no, pending, foreign, incomplete and oversized history never combine wording changes', async () => {
  for (const { payload } of [fixture(), fixture([{ ...edge(a, c), status: 'pending' }]), fixture([{ ...edge(a, c), survey: 9 }]), fixture([edge(a, c)], { totalDocs: 2 }), fixture([edge(a, c)], { totalDocs: 1001 }), fixture([edge(a, c)], { hasNextPage: true }), fixture([edge(c, a)])]) {
    assert.deepEqual(await resolveAnalysisDefinition(payload, 8, c, [a], { user }), { definition: a, corrected: false })
    await assert.rejects(resolveAnalysisDefinition(payload, 8, c, [a, c], { user }), /unterschiedlichen Fragebogenständen/)
  }
})

test('cycles terminate and require every historical snapshot to reach current', async () => {
  const { payload } = fixture([edge(a, b), edge(b, a)])
  await assert.rejects(resolveAnalysisDefinition(payload, 8, c, [a, c], { user }), /unterschiedlichen Fragebogenständen/)
  const valid = fixture([edge(a, b), edge(b, a), edge(b, c)])
  assert.equal((await resolveAnalysisDefinition(valid.payload, 8, c, [a, b], { user })).corrected, true)
})

test('machine scopes never read history or merge differently worded pretests', async () => {
  const { payload, calls } = fixture([edge(a, c)])
  const machine = { ...user, _strategy: 'mcp-api-key' } as unknown as TypedUser
  assert.deepEqual(await resolveAnalysisDefinition(payload, 8, c, [a], { req: { user: machine } as any, user }), { definition: a, corrected: false })
  await assert.rejects(resolveAnalysisDefinition(payload, 8, c, [a, c], { user: machine }), /unterschiedlichen Fragebogenständen/)
  assert.equal(calls.length, 0)
})

test('even claimed committed links cannot authorize structural or version changes', async () => {
  for (const changed of [{ ...c, version: 'fixture-v2' }, { ...c, sections: [{ ...c.sections[0], questions: [{ ...c.sections[0].questions[0], optional: true }] }] }]) {
    const { payload, calls } = fixture([edge(a, changed)])
    await assert.rejects(resolveAnalysisDefinition(payload, 8, changed, [a, changed], { user }), /unterschiedlichen Fragebogenständen/)
    assert.equal(calls.length, 0)
  }
})
