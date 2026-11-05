'use client'

import { useId } from 'react'
import { usesCombinedConsent, type ParticipantContact, type PrivacyNotice } from '@/survey/privacy'
import './ParticipantPrivacy.css'

type Props = {
  notice: PrivacyNotice
  consent: boolean
  onConsentChange: (value: boolean) => void
  contactConsent: boolean
  onContactConsentChange: (value: boolean) => void
  contact: Partial<ParticipantContact>
  onContactChange: (value: Partial<ParticipantContact>) => void
  disabled?: boolean
  testOnly?: boolean
}

export function ParticipantPrivacy({ notice, consent, onConsentChange, contactConsent, onContactConsentChange, contact, onContactChange, disabled = false, testOnly = true }: Props) {
  const id = useId()
  const combinedConsent = usesCombinedConsent(notice)
  const hasContact = Boolean(contact.name?.trim() || contact.email?.trim())
  const consentCheckbox = notice.legalBasis === 'consent' && <label className="test-confirm" htmlFor={`${id}-consent`}>
    <input id={`${id}-consent`} type="checkbox" checked={consent} onChange={event => onConsentChange(event.target.checked)} />
    <span className="participant-privacy__text">{notice.consentText}</span>
  </label>
  return <fieldset className="participant-privacy" disabled={disabled}>
    <legend>Datenschutz und Kontakt</legend>
    {testOnly && <p className="help">Wir testen hier die Einwilligungsanzeige mit erfundenen Angaben. Diese Bestätigung ist keine Teilnahme an einer echten Forschungserhebung.</p>}
    {!combinedConsent && consentCheckbox}
    {notice.contactMode !== 'none' && <>
      <p>{notice.contactMode === 'required' ? testOnly ? 'Für dieses Formular sind eine gesonderte Zustimmung zur Kontaktaufnahme sowie Name und E-Mail-Adresse erforderlich.' : 'Für dieses Formular sind eine gesonderte Zustimmung zur Kontaktaufnahme und eine E-Mail-Adresse erforderlich. Dein Name ist freiwillig.' : 'Kontaktangaben sind freiwillig. Du kannst deine Antwort auch ohne Kontaktaufnahme abgeben.'}</p>
      {!combinedConsent && <p className="participant-privacy__text">{notice.contactPurpose}</p>}
      {!combinedConsent && <label className="test-confirm" htmlFor={`${id}-contact-consent`}>
        <input id={`${id}-contact-consent`} type="checkbox" checked={contactConsent} onChange={event => {
          const checked = event.target.checked
          onContactConsentChange(checked)
          if (!checked) onContactChange({})
        }} />
        <span className="participant-privacy__text">{notice.contactConsentText}</span>
      </label>}
      {(combinedConsent || contactConsent) && <div className="participant-privacy__contact">
        <label htmlFor={`${id}-name`}>Name {testOnly ? combinedConsent ? '(optional, erfunden)' : '(erfunden)' : '(optional)'}</label>
        <input id={`${id}-name`} type="text" maxLength={200} required={testOnly && (!combinedConsent || hasContact)} value={contact.name ?? ''} autoComplete={testOnly ? 'off' : 'name'} onChange={event => onContactChange({ ...contact, name: event.target.value })} />
        <label htmlFor={`${id}-email`}>E-Mail-Adresse {combinedConsent ? testOnly ? '(optional, erfunden)' : '(optional)' : testOnly && '(erfunden)'}</label>
        <input id={`${id}-email`} type="email" maxLength={254} required={!combinedConsent || hasContact} value={contact.email ?? ''} autoComplete={testOnly ? 'off' : 'email'} aria-describedby={[combinedConsent ? `${id}-contact-purpose` : '', testOnly ? `${id}-contact-help` : ''].filter(Boolean).join(' ') || undefined} onChange={event => onContactChange({ ...contact, email: event.target.value })} />
        {combinedConsent && <p id={`${id}-contact-purpose`} className="participant-privacy__text">{notice.contactPurpose}</p>}
        {testOnly && <p id={`${id}-contact-help`} className="help">Bitte nur erfundene Angaben verwenden, zum Beispiel test@example.invalid. Die E-Mail-Adresse muss auf .invalid enden.{combinedConsent && ' Wenn du Kontaktangaben machst, ergänze auch einen erfundenen Namen.'}</p>}
      </div>}
    </>}
    {combinedConsent && consentCheckbox}
  </fieldset>
}
