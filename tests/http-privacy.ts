import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sample } from '../src/survey/sample'
import { toStored } from '../src/survey/storage'
import { privacyNotice, erasureConfirmation } from '../src/survey/privacy'
import { privacyHash } from '../src/survey/privacy-crypto'
import { testPrivacy } from './privacy-fixture'

export async function checkPrivacyHTTP(base: string, token: string, apiKey: string) {
  const auth = { Authorization: `JWT ${token}` }
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, method = 'POST', headers: Record<string, string> = {}) => request(path, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(data),
  })
  const status = async (response: Promise<Response>, expected: number, label: string) => {
    const result = await response
    assert.equal(result.status, expected, label)
    await result.body?.cancel()
  }
  const slug = `privacy-test-${randomUUID()}`
  const settings = testPrivacy()
  const created = await json('/api/surveys', { title: 'PRIVACY TEST ONLY', slug, phase: 'draft', privacy: { ...settings, contactEmail: null }, ...toStored({ ...sample, version: slug }) }, 'POST', auth)
  assert.equal(created.status, 201, 'incomplete privacy information may be saved as a draft')
  const survey = (await created.json() as any).doc
  await status(json(`/api/surveys/${survey.id}`, { phase: 'pretest' }, 'PATCH', auth), 400, 'incomplete privacy information blocks opening pretest')
  await status(json(`/api/surveys/${survey.id}`, { privacy: { ...settings, contactEmail: null, reviewed: true } }, 'PATCH', auth), 400, 'review confirmation cannot skip missing information')
  await status(json(`/api/surveys/${survey.id}`, { privacy: settings }, 'PATCH', auth), 200, 'staff may complete the draft information')
  await status(request(`/datenschutz/${slug}`), 404, 'anonymous users cannot preview unpublished privacy information')
  const preview = await request(`/datenschutz/${slug}`, { headers: auth })
  assert.equal(preview.status, 200)
  assert.ok((await preview.text()).includes(settings.controllerName))
  await status(json(`/api/surveys/${survey.id}`, { phase: 'live' }, 'PATCH', auth), 400, 'complete information alone never releases real collection')
  await status(json(`/api/surveys/${survey.id}`, { phase: 'pretest' }, 'PATCH', auth), 200, 'complete dummy information opens the pretest')
  const publicNotice = await request(`/datenschutz/${slug}`)
  assert.equal(publicNotice.status, 200)
  assert.ok((await publicNotice.text()).includes(settings.noticeVersion))
  const participantPage = await request(`/f/${slug}`)
  assert.equal(participantPage.status, 200)
  const participantHTML = await participantPage.text()
  assert.ok(participantHTML.includes(settings.consentText), 'participant page contains the stored notice and consent wording')
  assert.match(participantHTML, /<button[^>]*>Hinweise zum Datenschutz<\/button>/, 'forms with a complete profile have a visible privacy button')
  assert.ok(!participantHTML.includes('Pretest mit erfundenen Angaben'), 'complete form information replaces the legacy fallback')
  await status(json(`/api/surveys/${survey.id}`, { privacy: { ...settings, retention: 'changed' } }, 'PATCH', auth), 400, 'started notice text stays frozen')

  const notice = privacyNotice(settings)!, noticeHash = privacyHash(notice)
  const body = { surveyID: survey.id, version: slug, submissionID: randomUUID(), confirmTest: true,
    durationSeconds: 2, answers: { F01_name: 'PRIVACY HTTP DUMMY' },
    privacy: { noticeHash, consent: true, contactConsent: true },
    contact: { name: 'Fiktive Rückmeldeperson', email: 'feedback@example.invalid' } }
  const { privacy: _privacy, contact: _contact, ...noPrivacy } = body
  await status(json('/api/survey/submit', noPrivacy), 409, 'privacy-enabled forms require a matching notice')
  await status(json('/api/survey/submit', { ...body, privacy: { ...body.privacy, noticeHash: '0'.repeat(64) } }), 409, 'stale or tampered information hash is rejected')
  await status(json('/api/survey/submit', { ...body, privacy: { ...body.privacy, consent: false } }), 400, 'consent basis requires affirmative consent')
  await status(json('/api/survey/submit', { ...body, privacy: { ...body.privacy, contactConsent: false } }), 400, 'contacts cannot be silently attached')
  await status(json('/api/survey/submit', { ...body, contact: { ...body.contact, email: 'fixture@example.org' } }), 400, 'pretest rejects real mail domains')
  await status(json('/api/survey/submit', { ...noPrivacy, submissionID: randomUUID(), privacy: { noticeHash, consent: true, contactConsent: false } }), 201, 'optional feedback does not prevent participation without contacts')
  const saved = await json('/api/survey/submit', body)
  assert.equal(saved.status, 201)
  const { id } = await saved.json() as { id: number }
  const retry = await json('/api/survey/submit', { ...body, durationSeconds: 8 })
  assert.equal(retry.status, 200, 'network retry with new duration remains idempotent')
  assert.equal((await retry.json() as any).id, id)
  await status(json('/api/survey/submit', { ...body, contact: { ...body.contact, name: 'Andere Testperson' } }), 409, 'same submission cannot replace saved contact data')
  const response = await request(`/api/responses/${id}?depth=0`, { headers: auth })
  assert.equal(response.status, 200)
  const doc = await response.json() as any
  assert.deepEqual(doc.privacyReceipt.notice, notice)
  assert.equal(doc.privacyReceipt.noticeHash, noticeHash)
  assert.equal(doc.privacyReceipt.consent, true)
  assert.equal(doc.privacyReceipt.contactConsent, true)
  assert.equal(doc.durationSeconds, 2)
  assert.ok(!JSON.stringify(doc).includes(body.contact.email), 'answer records do not contain contact values')
  const contactQuery = `/api/response-contacts?depth=0&where[response][equals]=${id}`
  await status(request(contactQuery), 403, 'contacts require a team account')
  const contactResponse = await request(contactQuery, { headers: auth })
  assert.equal(contactResponse.status, 200)
  const contacts = (await contactResponse.json() as any).docs
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].email, body.contact.email)
  await status(json('/api/response-contacts', { response: id, ...body.contact, testOnly: true, privacyReceipt: doc.privacyReceipt }, 'POST', auth), 403, 'ordinary staff CRUD cannot create unproven contacts')
  await status(json(`/api/responses/${id}`, {}, 'DELETE', auth), 403, 'ordinary response delete cannot bypass the erasure workflow')
  const csv = await request(`/api/survey/export?surveyID=${survey.id}`, { headers: auth })
  assert.equal(csv.status, 200)
  const csvText = await csv.text()
  assert.ok(csvText.includes('PRIVACY HTTP DUMMY'))
  assert.ok(!csvText.includes(body.contact.name) && !csvText.includes(body.contact.email), 'normal export excludes separate contacts')
  await status(request('/api/survey/export?surveyID=invalid', { headers: auth }), 400, 'export rejects malformed form identifiers')
  await status(request('/api/survey/export?surveyID=2147483647', { headers: auth }), 404, 'export does not fall back to another form when selected form is missing')

  const endpoint = `/api/survey/responses/${id}/privacy`
  await status(request(endpoint), 401, 'individual export requires team login')
  await status(request(endpoint, { headers: { Authorization: `payload-mcp-api-keys API-Key ${apiKey}`, 'X-Expected-Submission-Key': doc.submissionKey } }), 401, 'MCP identities cannot receive individual exports')
  await status(request(endpoint, { headers: auth }), 412, 'export requires the saved immutable submission key')
  await status(request(endpoint, { headers: { ...auth, 'X-Expected-Submission-Key': 'different' } }), 412, 'stale document IDs cannot export another response')
  const exported = await request(endpoint, { headers: { ...auth, 'X-Expected-Submission-Key': doc.submissionKey } })
  assert.equal(exported.status, 200)
  assert.equal(exported.headers.get('cache-control'), 'no-store')
  assert.match(exported.headers.get('content-disposition') || '', /^attachment;/)
  const exportedBody = await exported.json() as any
  assert.equal(exportedBody.response.id, id)
  assert.equal(exportedBody.contact.name, body.contact.name)
  assert.equal(exportedBody.contact.email, body.contact.email)
  for (const field of ['submissionKey', 'submissionDigest', 'hash', 'salt', 'password']) assert.ok(!(field in exportedBody.response))
  const erase = { confirmation: erasureConfirmation(id), reason: 'request', expectedUpdatedAt: doc.updatedAt,
    expectedSubmissionKey: doc.submissionKey, copiesReviewed: true }
  await status(json(endpoint, erase), 401, 'erasure requires team login')
  await status(request(endpoint, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(erase) }), 403, 'erasure requires allowed origin')
  await status(json(endpoint, { ...erase, confirmation: 'delete' }, 'POST', auth), 400, 'exact erasure confirmation is required')
  await status(json(endpoint, { ...erase, copiesReviewed: false }, 'POST', auth), 400, 'copies and backups must be considered before erasing')
  await status(json(endpoint, { ...erase, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }, 'POST', auth), 409, 'stale document revision cannot erase')
  await status(json(endpoint, { ...erase, expectedSubmissionKey: 'different' }, 'POST', auth), 409, 'stale immutable key cannot erase a reused numeric ID')
  const erased = await json(endpoint, erase, 'POST', auth)
  assert.equal(erased.status, 200)
  const receipt = await erased.json() as any
  assert.equal(receipt.deleted, true)
  for (const privateValue of [body.contact.name, body.contact.email, doc.submissionKey, 'PRIVACY HTTP DUMMY']) assert.ok(!JSON.stringify(receipt.receipt).includes(privateValue))
  await status(request(`/api/responses/${id}`, { headers: auth }), 404, 'erased answer is gone')
  const remainingContacts = await request(contactQuery, { headers: auth })
  assert.equal((await remainingContacts.json() as any).totalDocs, 0, 'linked contact is erased with the response')
  await status(json('/api/survey/submit', body), 410, 'network retry cannot resurrect an erased answer')
  await status(request('/api/response-erasure-logs'), 403, 'minimal erasure records require team login')
  const logs = await request(`/api/response-erasure-logs?depth=0&where[survey][equals]=${survey.id}`, { headers: auth })
  const logBody = await logs.json() as any
  assert.equal(logBody.totalDocs, 1)
  assert.equal(logBody.docs[0].responseKey, receipt.receipt.response_key)
  assert.ok(!JSON.stringify(logBody).includes(body.contact.email))
  await status(json(`/api/surveys/${survey.id}`, { phase: 'closed' }, 'PATCH', auth), 200, 'privacy-enabled form can close without mutating its frozen information')
  await status(request(`/datenschutz/${slug}`), 404, 'closed privacy information is not offered as an active participant page')
  console.log('PASS: versioned privacy notices, separate contacts, consent validation, restricted individual export, confirmed atomic erasure and suppressed retries.')
}
