import { z } from 'zod'

const text = (max = 4000) => z.string().trim().max(max).default('')
export const privacySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  noticeVersion: text(100),
  controllerName: text(300),
  controllerAddress: text(1000),
  contactEmail: text(254),
  purpose: text(),
  legalBasis: z.enum(['consent', 'contract', 'legal-obligation', 'vital-interests', 'public-task', 'legitimate-interests']).default('consent'),
  legalBasisDetails: text(),
  dataCategories: text(),
  recipients: text(),
  internationalTransfers: text(),
  retention: text(),
  retentionYears: z.number().int().min(0).max(20).default(0),
  rights: text(),
  complaintAuthority: text(1000),
  contactMode: z.enum(['none', 'optional', 'required']).default('none'),
  contactConsentMode: z.enum(['separate', 'combined']).default('separate'),
  contactPurpose: text(),
  contactRetention: text(),
  consentText: text(2000),
  contactConsentText: text(2000),
  reviewed: z.boolean().default(false),
})
export type PrivacySettings = z.infer<typeof privacySettingsSchema>
export type PrivacySection = { title: string; text: string }
export type PrivacyNotice = {
  version: string
  legalBasis: PrivacySettings['legalBasis']
  sections: PrivacySection[]
  consentText: string
  contactMode: PrivacySettings['contactMode']
  contactConsentMode?: 'combined'
  contactPurpose: string
  contactConsentText: string
}
export type ParticipantContact = { name: string; email: string }
export type PrivacyReceipt = {
  notice: PrivacyNotice
  noticeHash: string
  recordedAt: string
  consent: boolean
  contactConsent: boolean
}

export function readPrivacySettings(value: unknown): PrivacySettings {
  const cleaned = value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined)) : {}
  return privacySettingsSchema.parse(cleaned)
}

const requiredFields = {
  noticeVersion: 'Fassung der Datenschutzinformation',
  controllerName: 'Name des Verantwortlichen',
  controllerAddress: 'Anschrift des Verantwortlichen',
  contactEmail: 'Datenschutz-Kontaktadresse',
  purpose: 'Zweck der Erhebung',
  legalBasisDetails: 'Erläuterung der Rechtsgrundlage',
  dataCategories: 'Erhobene Daten',
  recipients: 'Empfänger und Zugriffsberechtigte',
  internationalTransfers: 'Dienstleister und Drittlandübermittlungen',
  retention: 'Aufbewahrung der Antworten',
  rights: 'Betroffenenrechte und Verfahren',
  complaintAuthority: 'Zuständige Aufsichtsbehörde',
} as const

export function privacyMissing(settings: PrivacySettings): string[] {
  if (!settings.enabled) return ['Datenschutzinformation aktivieren']
  const missing: string[] = Object.entries(requiredFields)
    .filter(([key]) => !settings[key as keyof typeof requiredFields])
    .map(([, label]) => label)
  if (settings.contactEmail && !z.string().email().safeParse(settings.contactEmail).success) missing.push('Gültige Datenschutz-Kontaktadresse')
  if (settings.legalBasis === 'consent' && !settings.consentText) missing.push('Einwilligung zur Verarbeitung der Antworten')
  if (settings.contactMode !== 'none') {
    if (!settings.contactPurpose) missing.push('Zweck der Kontaktaufnahme')
    if (!settings.contactRetention) missing.push('Aufbewahrung der Kontaktangaben')
    if (settings.contactConsentMode === 'separate' && !settings.contactConsentText) missing.push('Einwilligung zur Kontaktaufnahme')
  }
  if (settings.contactConsentMode === 'combined' && (settings.legalBasis !== 'consent' || settings.contactMode !== 'optional')) {
    missing.push('Gemeinsame Einwilligung benötigt die Rechtsgrundlage Einwilligung und freiwillige Kontaktangaben')
  }
  return missing
}

export function privacyNotice(settings: PrivacySettings): PrivacyNotice | undefined {
  if (privacyMissing(settings).length) return undefined
  const sections: PrivacySection[] = [
    { title: 'Verantwortlicher und Kontakt', text: `${settings.controllerName}\n${settings.controllerAddress}\n${settings.contactEmail}` },
    { title: 'Zweck und Rechtsgrundlage', text: `${settings.purpose}\n\n${settings.legalBasisDetails}` },
    { title: 'Welche Daten wir erheben', text: settings.dataCategories },
    { title: 'Wer Zugriff erhält', text: settings.recipients },
    { title: 'Dienstleister und Datenübermittlungen', text: settings.internationalTransfers },
    { title: 'Aufbewahrung der Antworten', text: settings.retention },
  ]
  if (settings.contactMode !== 'none') sections.push({
    title: 'Individuelle Rückmeldung',
    text: `${settings.contactPurpose}\n\n${settings.contactRetention}\n\nKontaktangaben werden getrennt von den Antworten gespeichert. Eine Zuordnung bleibt für die individuelle Rückmeldung möglich.`,
  })
  sections.push(
    { title: 'Deine Rechte', text: settings.rights },
    { title: 'Beschwerdemöglichkeit', text: settings.complaintAuthority },
  )
  return {
    version: settings.noticeVersion,
    legalBasis: settings.legalBasis,
    sections,
    consentText: settings.legalBasis === 'consent' ? settings.consentText : '',
    contactMode: settings.contactMode,
    // Omit the additive field for legacy notices so their hashes remain identical.
    ...(settings.contactConsentMode === 'combined' ? { contactConsentMode: 'combined' as const } : {}),
    contactPurpose: settings.contactPurpose,
    contactConsentText: settings.contactMode === 'none' || settings.contactConsentMode === 'combined' ? '' : settings.contactConsentText,
  }
}

export function usesCombinedConsent(notice?: Pick<PrivacyNotice, 'legalBasis' | 'contactMode' | 'contactConsentMode'>): boolean {
  return notice?.contactConsentMode === 'combined' && notice.legalBasis === 'consent' && notice.contactMode === 'optional'
}

// The optional field is a contact choice only alongside the affirmative common
// consent and an explicit submission. Presence of an email alone grants nothing.
export function contactRequested(notice: PrivacyNotice | undefined, consent: boolean, separateConsent: boolean, contact: Partial<ParticipantContact>): boolean {
  if (!notice || notice.contactMode === 'none') return false
  return usesCombinedConsent(notice)
    ? consent && Boolean(contact.email?.trim() || contact.name?.trim())
    : separateConsent
}

export const participantContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
}).strict()

export const liveParticipantContactSchema = participantContactSchema.extend({ name: z.string().trim().max(200).default('') })

export function participantContact(
  settings: PrivacySettings, requested: boolean, value: unknown, testOnly: boolean,
): ParticipantContact | undefined {
  if (settings.contactMode === 'none') {
    if (requested || value !== undefined) throw new Error('Dieser Fragebogen erhebt keine Kontaktangaben.')
    return undefined
  }
  if (!requested) {
    if (settings.contactMode === 'required') throw new Error('Für diesen Fragebogen sind Kontaktangaben erforderlich.')
    if (value !== undefined) throw new Error('Kontaktangaben benötigen eine eigene Zustimmung.')
    return undefined
  }
  const parsed = (testOnly ? participantContactSchema : liveParticipantContactSchema).safeParse(value)
  if (!parsed.success) throw new Error(testOnly ? 'Bitte Name und gültige E-Mail-Adresse ergänzen.' : 'Bitte eine gültige E-Mail-Adresse ergänzen.')
  if (testOnly && !parsed.data.email.toLowerCase().endsWith('.invalid')) {
    throw new Error('Im Pretest bitte eine erfundene E-Mail mit der Endung .invalid verwenden, zum Beispiel test@example.invalid.')
  }
  return { name: parsed.data.name, email: parsed.data.email }
}

export function erasureConfirmation(id: number | string): string {
  return `ANTWORT ${id} LÖSCHEN`
}
export const erasureReasonSchema = z.enum(['request', 'retention', 'test-cleanup'])
export type ErasureReason = z.infer<typeof erasureReasonSchema>
