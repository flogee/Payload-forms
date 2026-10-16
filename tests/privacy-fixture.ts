import { readPrivacySettings, type PrivacySettings } from '../src/survey/privacy'

export function testPrivacy(overrides: Partial<PrivacySettings> = {}): PrivacySettings {
  return readPrivacySettings({
    enabled: true, noticeVersion: 'fixture-notice-v1', controllerName: 'Fiktiver Testverein',
    controllerAddress: 'Fiktive Testanschrift', contactEmail: 'privacy@example.invalid',
    purpose: 'Ausschließlich technischer Test mit erfundenen Daten.', legalBasis: 'consent',
    legalBasisDetails: 'Fiktive Einwilligungsanzeige für einen technischen Pretest.',
    dataCategories: 'Fiktive Organisationsangaben und optional erfundene Kontaktangaben.',
    recipients: 'Nur das fiktive Testteam.', internationalTransfers: 'Fiktive Testkonfiguration, keine echte Erhebung.',
    retention: 'Nur während des technischen Tests.', rights: 'Fiktives Testverfahren für Auskunft und Löschung.',
    complaintAuthority: 'Fiktive Testaufsicht.', contactMode: 'optional',
    contactPurpose: 'Fiktive individuelle Rückmeldung.', contactRetention: 'Nur während des technischen Tests.',
    consentText: 'Ich bestätige die fiktive Zustimmung zur Verarbeitung der Testantworten.',
    contactConsentText: 'Ich bestätige die fiktive Zustimmung zur Rückmeldung mit Testkontaktdaten.',
    reviewed: false, ...overrides,
  })
}
