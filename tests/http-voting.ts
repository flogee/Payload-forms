import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { votingDefinition } from './voting-fixture'
import { fromStored, toStored } from '../src/survey/storage'
import { testPrivacy } from './privacy-fixture'
import { privacyNotice } from '../src/survey/privacy'
import { privacyHash } from '../src/survey/privacy-crypto'

export async function checkVotingHTTP(base: string, token: string) {
  const auth = { Authorization: `JWT ${token}` }
  const json = (path: string, data: unknown, team = true, method = 'POST') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, ...(team ? auth : {}) }, body: JSON.stringify(data),
  })
  const slug = `voting-${randomUUID()}`, definition = { ...votingDefinition, version: slug,
    sections: votingDefinition.sections.map(s => ({ ...s, questions: s.questions.map(q => ({ ...q, options: q.options ?? [], rows: q.rows ?? [] })) })) }
  const privacy = testPrivacy({ reviewed: true, contactMode: 'none' })
  const created = await json('/api/surveys', { title: 'Fiktive Abstimmungsfelder', slug, phase: 'draft', privacy, ...toStored(definition) })
  assert.equal(created.status, 201)
  let survey = (await created.json() as any).doc
  assert.deepEqual(fromStored(survey), definition, 'real Payload round-trip preserves all new settings')
  const opened = await json(`/api/surveys/${survey.id}`, { phase: 'pretest' }, true, 'PATCH')
  assert.equal(opened.status, 200); survey = (await opened.json() as any).doc
  const page = await fetch(`${base}/f/${slug}`)
  assert.equal(page.status, 200); await page.body?.cancel()
  const body = { surveyID: survey.id, version: definition.version, submissionID: randomUUID(), confirmTest: true,
    durationSeconds: 1, privacy: { noticeHash: privacyHash(privacyNotice(privacy)!), consent: true, contactConsent: false } }
  const answers = { Slider: 0, Wide: 100, Stars: 5, Mood: 1, Rank: { order: ['exchange', 'clarity', 'decisions'] } }
  for (const invalid of [{ ...answers, Wide: 15 }, { ...answers, Mood: 0 }, { ...answers, Rank: { order: ['clarity', 'exchange'] } }]) {
    const rejected = await json('/api/survey/submit', { ...body, answers: invalid }, false)
    assert.equal(rejected.status, 400); await rejected.body?.cancel()
  }
  const saved = await json('/api/survey/submit', { ...body, answers }, false)
  assert.equal(saved.status, 201)
  const id = (await saved.json() as any).id
  const read = await fetch(`${base}/api/responses/${id}?depth=0`, { headers: auth }), response = await read.json() as any
  assert.deepEqual(response.answers, answers); assert.deepEqual(response.instrument, definition)
  const empty = await json('/api/survey/submit', { ...body, submissionID: randomUUID(), answers: {} }, false)
  assert.equal(empty.status, 201); await empty.body?.cancel()
  const exportResponse = await fetch(`${base}/api/survey/export?surveyID=${survey.id}`, { headers: auth }), csv = await exportResponse.text()
  assert.equal(exportResponse.status, 200); assert.match(csv, /Rank_rank_1/); assert.match(csv, /"0","100","5","1","exchange","clarity","decisions"/)
  const protectedAnswer = await fetch(`${base}/antwort/${response.notificationReference}`, { headers: auth })
  assert.equal(protectedAnswer.status, 200); assert.match(await protectedAnswer.text(), /5 \/ 5/)
  const frozen = await json(`/api/surveys/${survey.id}`, { sections: toStored({ ...definition, sections: [{ ...definition.sections[0], questions: definition.sections[0].questions.map(q => q.id === 'Slider' ? { ...q, max: 100 } : q) }] }).sections }, true, 'PATCH')
  assert.equal(frozen.status, 400); await frozen.body?.cancel()
  const copy = await json(`/api/survey/duplicate/${survey.id}`, { requestID: randomUUID() })
  assert.equal(copy.status, 201)
  const copyID = (await copy.json() as any).id
  const copied = await fetch(`${base}/api/surveys/${copyID}?depth=0`, { headers: auth })
  assert.equal(copied.status, 200)
  const copiedDefinition = fromStored((await copied.json() as any))
  assert.deepEqual(copiedDefinition.sections, definition.sections)
}
