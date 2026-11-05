import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { toStored } from '../src/survey/storage'
import { privacyNotice } from '../src/survey/privacy'
import { privacyHash } from '../src/survey/privacy-crypto'
import { testPrivacy } from './privacy-fixture'

// These requests run only against disposable synthetic dev/Worker fixtures.
export async function checkCombinedConsentHTTP(base: string, token: string) {
  const auth = { Authorization: `JWT ${token}` }
  const json = (path: string, data: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
    method: path.startsWith('/api/surveys/') ? 'PATCH' : 'POST',
    headers: { ...headers, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  const status = async (request: Promise<Response>, expected: number, label: string) => {
    const response = await request
    assert.equal(response.status, expected, label)
    await response.body?.cancel()
  }
  for (const mode of ['pretest', 'live'] as const) {
    const slug = `synthetic-combined-${mode}-${randomUUID()}`
    const settings = testPrivacy({ reviewed: true, contactConsentMode: 'combined', contactConsentText: '',
      consentText: 'Synthetic common consent to responses and optional contact when a fictional email is entered.' })
    const notice = privacyNotice(settings)!
    const created = await json('/api/surveys', { title: 'SYNTHETIC COMBINED CONSENT', slug, phase: 'draft', privacy: settings,
      ...toStored({ version: slug, introduction: ['Synthetic consent contract fixture.'], sections: [
        { id: 'fixture', title: 'Synthetic fixture', questions: [{ id: 'Q1', block: '1', label: 'Fictional optional text', kind: 'text' as const }] },
      ] }) }, auth)
    assert.equal(created.status, 201)
    const survey = (await created.json() as any).doc
    await status(json(`/api/surveys/${survey.id}`, { phase: mode }, auth), 200, 'explicit combined mode can open after review')
    const confirmation = mode === 'pretest' ? { confirmTest: true } : { confirmParticipation: true }
    const body = { surveyID: survey.id, version: slug, submissionID: randomUUID(), ...confirmation, durationSeconds: 1,
      answers: {}, privacy: { noticeHash: privacyHash(notice), consent: true, contactConsent: false } }
    const contact = { ...(mode === 'pretest' ? { name: 'Synthetic Contact' } : {}), email: mode === 'pretest' ? 'contact@example.invalid' : 'contact@example.org' }
    await status(json('/api/survey/submit', { ...body, contact, privacy: { ...body.privacy, consent: false, contactConsent: true } }), 400,
      'email alone never authorizes common response or contact processing')
    await status(json('/api/survey/submit', { ...body, contact }), 400, 'contact payload still requires an explicit recorded contact choice')
    await status(json('/api/survey/submit', { ...body, contact: { name: 'Partial contact' }, privacy: { ...body.privacy, contactConsent: true } }), 400,
      'partial contact is rejected rather than silently omitted')
    await status(json('/api/survey/submit', { ...body, contact: { ...contact, email: 'invalid' }, privacy: { ...body.privacy, contactConsent: true } }), 400,
      'invalid email is rejected')
    if (mode === 'pretest') await status(json('/api/survey/submit', { ...body, contact: { ...contact, email: 'contact@example.org' }, privacy: { ...body.privacy, contactConsent: true } }), 400,
      'combined pretest retains fictional-only email rules')
    const saved = await json('/api/survey/submit', body)
    assert.equal(saved.status, 201, 'common consent does not require optional contacts')
    const id = (await saved.json() as any).id
    const response = await (await fetch(`${base}/api/responses/${id}?depth=0`, { headers: auth })).json() as any
    assert.equal(response.privacyReceipt.consent, true)
    assert.equal(response.privacyReceipt.contactConsent, false)
    assert.equal(response.privacyReceipt.notice.contactConsentMode, 'combined')
    assert.equal(response.testOnly, mode === 'pretest')
    const noContacts = await (await fetch(`${base}/api/response-contacts?where[response][equals]=${id}`, { headers: auth })).json() as any
    assert.equal(noContacts.totalDocs, 0)
    const withContact = await json('/api/survey/submit', { ...body, submissionID: randomUUID(), contact,
      privacy: { ...body.privacy, contactConsent: true } })
    assert.equal(withContact.status, 201)
    const contactResponseID = (await withContact.json() as any).id
    const contacts = await (await fetch(`${base}/api/response-contacts?where[response][equals]=${contactResponseID}`, { headers: auth })).json() as any
    assert.equal(contacts.totalDocs, 1)
    assert.equal(contacts.docs[0].email, contact.email)
    const savedContactResponse = await (await fetch(`${base}/api/responses/${contactResponseID}?depth=0`, { headers: auth })).json() as any
    assert.equal(savedContactResponse.privacyReceipt.contactConsent, true)
    assert.equal(savedContactResponse.privacyReceipt.notice.contactConsentMode, 'combined')
    assert.equal(savedContactResponse.privacyReceipt.noticeHash, body.privacy.noticeHash)
    assert.ok(!JSON.stringify(savedContactResponse.answers).includes(contact.email), 'contacts stay outside research answers')
    if (mode === 'live') await status(json(`/api/surveys/${survey.id}`, { privacy: { ...settings, contactConsentMode: 'separate' } }, auth), 400,
      'recorded real consent mode remains frozen')
    await status(json(`/api/surveys/${survey.id}`, { phase: 'closed' }, auth), 200, 'synthetic fixture can close')
  }
  console.log('PASS: combined consent receipts, optional separated contacts, no implicit email opt-in, invalid-input rejection and fictional pretest boundaries.')
}
