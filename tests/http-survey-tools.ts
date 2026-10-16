import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sample } from '../src/survey/sample'
import { fromStored, toStored } from '../src/survey/storage'
import { questionnaireExport, duplicateIdentity } from '../src/survey/survey-tools'
import { privacyHash } from '../src/survey/privacy-crypto'
import { privacyNotice } from '../src/survey/privacy'
import { testPrivacy } from './privacy-fixture'
import { testText } from './content-fixture'

// Called by the existing disposable dev/Worker HTTP suite after staff and MCP setup.
export async function checkSurveyToolsHTTP(base: string, token: string, apiKey: string) {
  const auth = { Authorization: `JWT ${token}` }, mcp = { Authorization: `Bearer ${apiKey}` }
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, headers: Record<string, string> = auth, method = 'POST') => request(path, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(data),
  })
  const status = async (pending: Promise<Response>, expected: number, label: string) => {
    const response = await pending; assert.equal(response.status, expected, label)
    assert.match(response.headers.get('cache-control') || '', /(?:^|,\s*)no-store(?:,|$)/); await response.body?.cancel()
  }
  for (const headers of [{}, mcp]) {
    await status(request('/api/survey/definition/1', { headers }), 401, 'questionnaire downloads require human staff authentication')
    await status(json('/api/survey/duplicate/1', { requestID: randomUUID() }, headers), 401, 'MCP and anonymous clients cannot duplicate')
  }
  for (const invalid of ['0', '01', 'invalid', '2147483648']) {
    await status(request(`/api/survey/definition/${invalid}`, { headers: auth }), 400, 'download validates ID')
    await status(json(`/api/survey/duplicate/${invalid}`, { requestID: randomUUID() }), 400, 'duplicate validates ID')
  }
  await status(request('/api/survey/definition/2147483647', { headers: auth }), 404, 'missing questionnaire remains unavailable')
  await status(json('/api/survey/duplicate/2147483647', { requestID: randomUUID() }), 404, 'missing source cannot be copied')
  for (const origin of [undefined, 'https://foreign.example.invalid', process.env.TEST_SECOND_ORIGIN].filter((value, index) => index < 2 || !!value)) {
    await status(request('/api/survey/duplicate/1', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ requestID: randomUUID() }) }), 403, 'duplicate requires the same configured origin')
  }
  const slug = `tools-test-${randomUUID()}`, privacy = testPrivacy({ reviewed: true, retentionYears: 3 })
  const definition = { ...sample, version: slug, introContent: [{ blockType: 'text' as const, content: testText('Gespeicherter Exporttext') }] }
  const created = await json('/api/surveys', { title: 'DOWNLOAD DUPLICATE DUMMY', slug, phase: 'pretest', privacy,
    notifications: { enabled: false, recipients: 'operational-secret@example.invalid' }, retentionReminders: { enabled: true }, ...toStored(definition) })
  assert.equal(created.status, 201)
  const source = (await created.json() as any).doc, definitionPath = `/api/survey/definition/${source.id}`, duplicatePath = `/api/survey/duplicate/${source.id}`
  const notice = privacyNotice(privacy)!, contactEmail = `tools-${randomUUID()}@example.invalid`
  const saved = await json('/api/survey/submit', { surveyID: source.id, version: source.version, submissionID: randomUUID(), confirmTest: true, durationSeconds: 1,
    answers: { F01_name: 'TOOLS RESPONSE DUMMY' }, privacy: { noticeHash: privacyHash(notice), consent: true, contactConsent: true },
    contact: { name: 'TOOLS CONTACT DUMMY', email: contactEmail } }, {})
  assert.equal(saved.status, 201); await saved.body?.cancel()
  for (const format of ['json', 'markdown']) {
    const exported = await request(`${definitionPath}?format=${format}`, { headers: auth })
    assert.equal(exported.status, 200)
    assert.equal(exported.headers.get('cache-control'), 'no-store')
    assert.equal(exported.headers.get('x-content-type-options'), 'nosniff')
    assert.match(exported.headers.get('content-disposition') || '', /^attachment; filename="fragebogen-\d+\.(json|md)"$/)
    const text = await exported.text()
    for (const forbidden of ['operational-secret', 'TOOLS RESPONSE DUMMY', 'TOOLS CONTACT DUMMY', contactEmail, 'retentionReminders', 'notifications', 'reviewed']) assert.ok(!text.includes(forbidden), forbidden)
    if (format === 'json') assert.deepEqual(JSON.parse(text), questionnaireExport(source))
    else { assert.ok(text.includes('Gespeicherter Exporttext')); assert.ok(text.includes('Antwortoptionen:')); assert.ok(text.includes('Anzeigen, wenn')) }
  }
  await status(request(`${definitionPath}?format=html`, { headers: auth }), 400, 'unsupported export format fails safely')
  await status(json(duplicatePath, { requestID: randomUUID(), phase: 'pretest' }), 400, 'client cannot inject copy settings')
  await status(request(duplicatePath, { method: 'POST', headers: { ...auth, Origin: base, 'Content-Type': 'text/plain' }, body: '{}' }), 415, 'duplicate requires JSON')
  await status(request(duplicatePath, { method: 'POST', headers: { ...auth, Origin: base, 'Content-Type': 'application/json' }, body: ' '.repeat(1025) }), 413, 'duplicate request body is bounded')
  const requestID = randomUUID()
  const first = await json(duplicatePath, { requestID })
  assert.equal(first.status, 201)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  const receipt = await first.json() as any
  assert.equal(receipt.adminURL, `/admin/collections/surveys/${receipt.id}`)
  const copied = await (await request(`/api/surveys/${receipt.id}?depth=0`, { headers: auth })).json() as any
  assert.equal(copied.phase, 'draft')
  assert.equal(copied.title, `${source.title} · Kopie`)
  assert.equal(copied.slug, duplicateIdentity(source.id, requestID))
  assert.deepEqual(fromStored(copied), { ...fromStored(source), version: copied.version })
  assert.deepEqual(copied.privacy, { ...source.privacy, reviewed: false })
  assert.deepEqual(copied.notifications, { enabled: false, recipients: '' })
  assert.deepEqual(copied.retentionReminders, { enabled: false })
  const updated = await json(`/api/surveys/${copied.id}`, { title: 'EDITABLE COPY DUMMY', version: `edited-${randomUUID()}` }, auth, 'PATCH')
  assert.equal(updated.status, 200); await updated.body?.cancel()
  const retried = await json(duplicatePath, { requestID })
  assert.equal(retried.status, 200)
  assert.equal((await retried.json() as any).id, copied.id, 'retry reuses the copy despite an edited version')
  const originalAfter = await (await request(`/api/surveys/${source.id}?depth=0`, { headers: auth })).json()
  assert.deepEqual(originalAfter, source, 'source remains unchanged')
  const copyResponses = await (await request(`/api/responses?where[survey][equals]=${copied.id}`, { headers: auth })).json() as any
  assert.equal(copyResponses.totalDocs, 0, 'no source responses are copied')
  const contacts = await (await request(`/api/response-contacts?where[email][equals]=${encodeURIComponent(contactEmail)}`, { headers: auth })).json() as any
  assert.equal(contacts.totalDocs, 1, 'the original contact is preserved without copies')
  const concurrentID = randomUUID()
  const concurrent = await Promise.all([json(duplicatePath, { requestID: concurrentID }), json(duplicatePath, { requestID: concurrentID })])
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 201], 'concurrent identical requests create one draft')
  const receipts = await Promise.all(concurrent.map(response => response.json())) as any[]
  assert.equal(receipts[0].id, receipts[1].id)
  const csv = await request(`/api/survey/export?surveyID=${source.id}`, { headers: auth })
  assert.equal(csv.status, 200)
  const csvText = await csv.text()
  assert.ok(csvText.includes('TOOLS RESPONSE DUMMY'))
  assert.ok(!csvText.includes(contactEmail))
  const emptyCSV = await request(`/api/survey/export?surveyID=${copied.id}`, { headers: auth })
  assert.equal(emptyCSV.status, 200)
  assert.ok(!(await emptyCSV.text()).includes('TOOLS RESPONSE DUMMY'), 'selected copied form has its own empty export')
  console.log('PASS: current questionnaire downloads, staff/MCP and CSRF boundaries, safe isolated copies, idempotent retries and selected CSV.')
}
