import test from 'node:test'
import assert from 'node:assert/strict'
import { participantContact, privacyMissing, privacyNotice, readPrivacySettings } from '../src/survey/privacy'
import { digest, erasureKey, privacyHash } from '../src/survey/privacy-crypto'
import { testPrivacy } from './privacy-fixture'

test('legacy forms have no implied information or consent and incomplete notices fail closed', () => {
  assert.equal(readPrivacySettings(null).enabled, false)
  assert.equal(privacyNotice(readPrivacySettings(null)), undefined)
  const partial = testPrivacy({ contactEmail: '', retention: '   ', contactRetention: '' })
  assert.ok(privacyMissing(partial).includes('Datenschutz-Kontaktadresse'))
  assert.ok(privacyMissing(partial).includes('Aufbewahrung der Antworten'))
  assert.equal(privacyNotice(partial), undefined)
  assert.equal(testPrivacy().reviewed, false, 'completeness never marks legal review')
})

test('notice hash covers actual text and basis, independent of object key order', () => {
  const notice = privacyNotice(testPrivacy())!
  assert.equal(privacyHash(notice), privacyHash({ ...notice, sections: [...notice.sections] }))
  const changed = privacyNotice(testPrivacy({ rights: 'Changed rights' }))!
  assert.notEqual(privacyHash(notice), privacyHash(changed))
  assert.equal(digest({ b: 1, a: 2 }), digest({ a: 2, b: 1 }))
  const otherBasis = privacyNotice(testPrivacy({ legalBasis: 'legitimate-interests', consentText: '' }))!
  assert.equal(otherBasis.consentText, '')
  assert.notEqual(privacyHash(otherBasis), privacyHash(notice))
})

test('contacts require separate choice, optional participation can omit them, and pretest rejects real mail domains', () => {
  const settings = testPrivacy()
  assert.equal(participantContact(settings, false, undefined, true), undefined)
  assert.throws(() => participantContact(settings, false, { name: 'Test', email: 'test@example.invalid' }, true))
  assert.throws(() => participantContact(settings, true, { name: 'Test', email: 'test@gmail.com' }, true))
  assert.deepEqual(participantContact(settings, true, { name: ' Test ', email: 'test@example.invalid' }, true), { name: 'Test', email: 'test@example.invalid' })
  assert.throws(() => participantContact(testPrivacy({ contactMode: 'required' }), false, undefined, true))
  assert.throws(() => participantContact(testPrivacy({ contactMode: 'none' }), true, { name: 'Test', email: 'test@example.invalid' }, true))
})

test('standalone named registration requires a name and separate consent in both modes', () => {
  const settings = testPrivacy({ contactMode: 'name-and-email' })
  for (const testOnly of [true, false]) {
    const email = testOnly ? 'name@example.invalid' : 'name@example.org'
    assert.throws(() => participantContact(settings, true, { email }, testOnly), /Name/)
    assert.throws(() => participantContact(settings, true, { name: '  ', email }, testOnly), /Name/)
    assert.throws(() => participantContact(settings, false, { name: 'Fixture', email }, testOnly), /erforderlich/)
    assert.deepEqual(participantContact(settings, true, { name: ' Fixture ', email }, testOnly), { name: 'Fixture', email })
  }
  const notice = privacyNotice(settings)!
  const oldNotice = privacyNotice(testPrivacy({ contactMode: 'email-only' }))!
  assert.deepEqual(notice.sections, oldNotice.sections)
  assert.notEqual(privacyHash(notice), privacyHash(oldNotice))
})

test('restore suppression uses keyed digests rather than retaining plaintext submission identifiers', () => {
  const secret = 'fixture-secret-only'.repeat(4), key = '1:fixture-version:fixture-submission'
  assert.match(erasureKey(key, secret), /^[a-f0-9]{64}$/)
  assert.equal(erasureKey(key, secret), erasureKey(key, secret))
  assert.notEqual(erasureKey(key, secret), erasureKey(key, secret + 'other'))
  assert.ok(!erasureKey(key, secret).includes('fixture'))
  assert.throws(() => erasureKey(key, 'short'))
})
