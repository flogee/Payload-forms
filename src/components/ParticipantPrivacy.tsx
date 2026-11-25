'use client'
import { participantText, type ParticipantLanguage } from '@/survey/participant-language'

import { useId } from 'react'
import type { ParticipantContact, PrivacyNotice } from '@/survey/privacy'
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
  language?: ParticipantLanguage
}

export function ParticipantPrivacy({ notice, consent, onConsentChange, contactConsent, onContactConsentChange, contact, onContactChange, disabled = false, testOnly = true, language = 'de' }: Props) {
  const t = participantText(language)
  const id = useId()
  return <fieldset className="participant-privacy" disabled={disabled}>
    <legend>{t("Datenschutz und Kontakt")}</legend>
    {testOnly && <p className="help">{t("Wir testen hier die Einwilligungsanzeige mit erfundenen Angaben. Diese Bestätigung ist keine Teilnahme an einer echten Forschungserhebung.")}</p>}
    {notice.legalBasis === 'consent' && <label className="test-confirm" htmlFor={`${id}-consent`}>
      <input id={`${id}-consent`} type="checkbox" checked={consent} onChange={event => onConsentChange(event.target.checked)} />
      <span className="participant-privacy__text">{notice.consentText}</span>
    </label>}
    {notice.contactMode !== 'none' && <>
      <p>{notice.contactMode === 'required' ? testOnly ? t("Für dieses Formular sind eine gesonderte Zustimmung zur Kontaktaufnahme sowie Name und E-Mail-Adresse erforderlich.") : t("Für dieses Formular sind eine gesonderte Zustimmung zur Kontaktaufnahme und eine E-Mail-Adresse erforderlich. Dein Name ist freiwillig.") : t("Kontaktangaben sind freiwillig. Du kannst deine Antwort auch ohne Kontaktaufnahme abgeben.")}</p>
      <p className="participant-privacy__text">{notice.contactPurpose}</p>
      <label className="test-confirm" htmlFor={`${id}-contact-consent`}>
        <input id={`${id}-contact-consent`} type="checkbox" checked={contactConsent} onChange={event => {
          const checked = event.target.checked
          onContactConsentChange(checked)
          if (!checked) onContactChange({})
        }} />
        <span className="participant-privacy__text">{notice.contactConsentText}</span>
      </label>
      {contactConsent && <div className="participant-privacy__contact">
        <label htmlFor={`${id}-name`}>{t("Name")} {testOnly ? t("(erfunden)") : t("(optional)")}</label>
        <input id={`${id}-name`} type="text" maxLength={200} required={testOnly} value={contact.name ?? ''} autoComplete={testOnly ? 'off' : 'name'} onChange={event => onContactChange({ ...contact, name: event.target.value })} />
        <label htmlFor={`${id}-email`}>{t("E-Mail-Adresse")} {testOnly && t("(erfunden)")}</label>
        <input id={`${id}-email`} type="email" maxLength={254} required value={contact.email ?? ''} autoComplete={testOnly ? 'off' : 'email'} aria-describedby={testOnly ? `${id}-contact-help` : undefined} onChange={event => onContactChange({ ...contact, email: event.target.value })} />
        {testOnly && <p id={`${id}-contact-help`} className="help">{t("Bitte nur erfundene Angaben verwenden, zum Beispiel test@example.invalid. Die E-Mail-Adresse muss auf .invalid enden.")}</p>}
      </div>}
    </>}
  </fieldset>
}
