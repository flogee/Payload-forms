import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { toStored } from '../src/survey/storage'
import { privacyNotice } from '../src/survey/privacy'
import { privacyHash } from '../src/survey/privacy-crypto'
import { testPrivacy } from './privacy-fixture'
import type { Definition } from '../src/survey/types'

// Synthetic contract fixtures only. The fixed open slug is reused by the
// disposable runtime-shutdown check after restarting with the operator flag off.
export const realFixtureSlug = 'synthetic-live-runtime-check'
export async function checkRealSurveysHTTP(base: string, token: string, apiKey: string) {
  const auth = { Authorization: `JWT ${token}` }, machine = { Authorization: `Bearer ${apiKey}` }
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, method = 'POST', headers: Record<string, string> = auth) => request(path, {
    method, headers: { ...headers, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  const status = async (pending: Promise<Response>, expected: number, label: string) => {
    const response = await pending
    assert.equal(response.status, expected, label)
    await response.body?.cancel()
  }
  const settings = testPrivacy({ reviewed: true })
  const images = await (await request('/api/media?depth=0&limit=1', { headers: auth })).json() as any
  const imageID = images.docs[0].id as number
  const definition: Definition = { version: realFixtureSlug, introduction: ['Synthetic live-mode contract test.'],
    introContent: [{ blockType: 'image', image: imageID, alt: 'Synthetic fixture image' }],
    sections: [{ id: 'fixture', title: 'Synthetic fixture', questions: [{ id: 'Q1', block: '1', label: 'Optional fictional text', kind: 'text' }] }] }
  const create = await json('/api/surveys', { title: 'SYNTHETIC LIVE MODE TEST', slug: realFixtureSlug, phase: 'draft', ...toStored(definition) })
  assert.equal(create.status, 201)
  const survey = (await create.json() as any).doc, path = `/api/surveys/${survey.id}`
  await status(json(path, { phase: 'live' }, 'PATCH'), 400, 'live activation requires a complete privacy profile')
  await status(json(path, { phase: 'live', privacy: { ...settings, reviewed: false } }, 'PATCH'), 400, 'complete unreviewed profile cannot activate live')
  await status(json(path, { phase: 'live', privacy: settings }, 'PATCH'), 200, 'operator opt-in and reviewed profile allow an administrator to activate live')
  const page = await request(`/f/${realFixtureSlug}`), html = await page.text()
  assert.equal(page.status, 200)
  assert.ok(html.includes('Teilnahme an einer Erhebung'))
  assert.ok(!html.includes('Dies ist eine Testversion.') && !html.includes('Test- und Prüffassung'))
  const noticePage = await request(`/datenschutz/${realFixtureSlug}`), noticeHTML = await noticePage.text()
  assert.equal(noticePage.status, 200)
  assert.ok(!noticeHTML.includes('Test- und Prüffassung'))
  await status(request(`/f/${realFixtureSlug}/images/${imageID}`), 200, 'live serves only its referenced images')
  await status(request(`/f/${realFixtureSlug}/images/2147483647`), 404, 'foreign live image is unavailable')
  await status(request(`/api/survey/share/${survey.id}`, { headers: auth }), 200, 'team may share an enabled live version')
  for (const data of [{ phase: 'pretest' }, { title: 'changed' }, { version: 'changed' }, { privacy: { ...settings, purpose: 'changed' } }]) {
    await status(json(path, data, 'PATCH'), 400, 'started live version and privacy remain frozen')
  }
  const privacy = { noticeHash: privacyHash(privacyNotice(settings)!), consent: true, contactConsent: false }
  const input = { surveyID: survey.id, version: definition.version, submissionID: randomUUID(), confirmParticipation: true,
    durationSeconds: 2, answers: {}, privacy }
  const { confirmParticipation: _confirmation, privacy: _privacy, ...withoutConsent } = input
  await status(json('/api/survey/submit', { ...input, confirmTest: true }, 'POST', {}), 400, 'live rejects mixed confirmation modes')
  await status(json('/api/survey/submit', { ...withoutConsent, privacy, confirmTest: true }, 'POST', {}), 400, 'live rejects fictional confirmation')
  await status(json('/api/survey/submit', { ...withoutConsent, privacy }, 'POST', {}), 400, 'live requires explicit participation confirmation')
  await status(json('/api/survey/submit', { ...input, privacy: undefined }, 'POST', {}), 409, 'live requires a current notice receipt')
  await status(json('/api/survey/submit', { ...input, privacy: { ...privacy, noticeHash: '0'.repeat(64) } }, 'POST', {}), 409, 'live rejects stale notice receipts')
  await status(json('/api/survey/submit', { ...input, privacy: { ...privacy, consent: false } }, 'POST', {}), 400, 'consent basis requires affirmative live consent')
  await status(json('/api/survey/submit', { ...input, contact: { email: 'synthetic@example.org' } }, 'POST', {}), 400, 'live contacts require their own opt-in')
  await status(json('/api/survey/submit', { ...input, evaluationRun: { key: randomUUID(), token: randomUUID() } }, 'POST', {}), 400, 'live cannot join fictional evaluation runs')
  const saved = await json('/api/survey/submit', input, 'POST', {})
  assert.equal(saved.status, 201, 'all content questions and optional contacts may be skipped')
  const savedID = (await saved.json() as any).id
  await status(json('/api/survey/submit', { ...input, durationSeconds: 8 }, 'POST', {}), 200, 'live exact retries are idempotent')
  await status(json('/api/survey/submit', { ...input, answers: { Q1: 'changed' } }, 'POST', {}), 409, 'live retries cannot replace answers')
  const response = await (await request(`/api/responses/${savedID}?depth=0`, { headers: auth })).json() as any
  assert.equal(response.testOnly, false)
  assert.deepEqual(response.answers, {})
  assert.equal(response.privacyReceipt.noticeHash, privacy.noticeHash)
  const contactSaved = await json('/api/survey/submit', { ...input, submissionID: randomUUID(),
    privacy: { ...privacy, contactConsent: true }, contact: { email: 'synthetic@example.org' } }, 'POST', {})
  assert.equal(contactSaved.status, 201, 'live accepts ordinary email domains and an omitted personal name')
  const contactID = (await contactSaved.json() as any).id
  const contacts = await (await request(`/api/response-contacts?where[response][equals]=${contactID}`, { headers: auth })).json() as any
  assert.equal(contacts.docs[0].testOnly, false)
  assert.equal(contacts.docs[0].email, 'synthetic@example.org')
  const csv = await (await request(`/api/survey/export?surveyID=${survey.id}`, { headers: auth })).text()
  assert.match(csv, /"false"/)
  assert.ok(!csv.includes('synthetic@example.org'))
  const report = await (await request(`/api/survey/analysis?surveyID=${survey.id}`, { headers: auth })).json() as any
  assert.equal(report.dataset, 'real')
  const chart = await request(`/auswertung?surveyID=${survey.id}`, { headers: auth })
  assert.ok((await chart.text()).includes('Erhebungsdaten · Teamzugang'))
  for (const endpoint of [`/api/surveys/${survey.id}`, `/api/responses/${savedID}`, '/api/response-contacts']) {
    const denied = await request(endpoint, { headers: machine })
    assert.ok([401, 403, 404].includes(denied.status), 'machine keys cannot read real instruments, answers or contacts')
    await denied.body?.cancel()
  }
  // Exercise MCP impersonation itself, not only REST endpoints that reject
  // Bearer keys before the owning team account is considered.
  const callMCP = async (name: string, arguments_: unknown) => {
    const result = await request('/api/mcp', { method: 'POST', headers: { ...machine,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } }) })
    assert.equal(result.status, 200, 'MCP request reaches the registered tool')
    const body = await result.text()
    return JSON.parse(/^data: (.+)$/m.exec(body)?.[1] ?? body)
  }
  const pretests = await (await request('/api/surveys?where[phase][equals]=pretest&limit=1', { headers: auth })).json() as any
  assert.ok(pretests.docs.length, 'fictional control version exists')
  const allowed = await callMCP('findSurveys', { id: String(pretests.docs[0].id) })
  assert.ok(JSON.stringify(allowed).includes(pretests.docs[0].title), 'MCP key can read its permitted pretest control')
  for (const query of [{ id: String(survey.id) },
    { where: JSON.stringify({ id: { equals: survey.id } }) },
    { id: String(survey.id), select: JSON.stringify({ title: true, privacy: true }) }]) {
    const denied = JSON.stringify(await callMCP('findSurveys', query))
    for (const marker of ['SYNTHETIC LIVE MODE TEST', settings.controllerName, settings.purpose, definition.introduction[0]]) {
      assert.ok(!denied.includes(marker), 'actual MCP findSurveys never exposes live instrument or notice')
    }
  }
  const stats = await callMCP('surveyStatistics', { surveyID: survey.id })
  const statsText = JSON.stringify(stats)
  assert.ok(stats.result?.isError || stats.error || /error|nicht|Fehler|not found/i.test(statsText), 'actual MCP live statistics return a denial')
  assert.ok(!statsText.includes('schemaVersion') && !statsText.includes('SYNTHETIC LIVE MODE TEST'), 'MCP does not return a live report')
  // A separate live version exercises closing without losing the open runtime fixture.
  const closeSlug = `synthetic-close-${randomUUID()}`
  const close = await json('/api/surveys', { title: 'SYNTHETIC LIVE CLOSE TEST', slug: closeSlug, phase: 'live', privacy: settings, ...toStored({ ...definition, version: closeSlug }) })
  assert.equal(close.status, 201)
  const closeID = (await close.json() as any).doc.id
  await status(json(`/api/surveys/${closeID}`, { phase: 'closed' }, 'PATCH'), 200, 'live version can close')
  await status(request(`/f/${closeSlug}`), 404, 'closed live form is unavailable')
  await status(json('/api/survey/submit', { ...input, surveyID: closeID, version: closeSlug, submissionID: randomUUID() }, 'POST', {}), 403, 'closed live rejects submissions')
  await status(json(`/api/surveys/${closeID}`, { phase: 'live' }, 'PATCH'), 400, 'closed live cannot reopen')
  console.log('PASS: synthetic live activation, real consent and contact contracts, protected analysis, immutable versions, closure, mode markers and fictional machine separation.')
}
