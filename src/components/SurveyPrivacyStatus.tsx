'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { useId } from 'react'
import { privacyMissing, privacyNotice, readPrivacySettings } from '@/survey/privacy'
import './SurveyPrivacyStatus.css'

const legalBasisLabels = {
  consent: 'Einwilligung',
  contract: 'Vertrag',
  'legal-obligation': 'Rechtliche Verpflichtung',
  'vital-interests': 'Lebenswichtige Interessen',
  'public-task': 'Öffentliche Aufgabe',
  'legitimate-interests': 'Berechtigte Interessen',
}

export function SurveyPrivacyStatus() {
  const { data, id } = useDocumentInfo()
  const headingID = useId()
  let settings: ReturnType<typeof readPrivacySettings> | undefined = undefined
  try { settings = readPrivacySettings(data?.privacy) } catch { /* Saved invalid profiles remain unavailable. */ }
  const missing = settings ? privacyMissing(settings) : ['Gespeicherte Datenschutzangaben prüfen und korrigieren']
  const notice = settings ? privacyNotice(settings) : undefined
  const slug = typeof data?.slug === 'string' ? data.slug : ''

  return <section className="survey-privacy-status" aria-labelledby={headingID}>
    <h3 id={headingID}>Datenschutzstatus</h3>
    <p>Es gelten ausschließlich die gespeicherten Angaben. Änderungen werden erst nach dem Speichern berücksichtigt.</p>
    <p><strong>Echte Erhebungen benötigen die Betreiberfreigabe.</strong> Zusätzlich müssen Administratoren ein vollständiges, fachlich geprüftes Datenschutzprofil bestätigen und den Status „Echte Erhebung“ speichern.</p>
    {id == null ? <p role="status">Zuerst den Fragebogen speichern.</p> : <>
      <p role="status">{missing.length ? 'Das Datenschutzprofil ist noch unvollständig.' : 'Das gespeicherte Datenschutzprofil ist vollständig.'}</p>
      {!!missing.length && <ul>{missing.map(label => <li key={label}>{label}</li>)}</ul>}
      <p>Interne Prüfung: {settings?.reviewed ? 'als geprüft markiert' : 'noch nicht als geprüft markiert'}.</p>
      {notice && <>
        <p>Fassung: {notice.version}. Rechtsgrundlage: {legalBasisLabels[notice.legalBasis]}. Kontaktangaben: {notice.contactMode === 'none' ? 'nicht vorgesehen' : notice.contactMode === 'optional' ? 'freiwillig' : 'erforderlich'}.</p>
        <details><summary>Gespeicherte Datenschutzangaben anzeigen</summary>{notice.sections.map((section, index) => <div key={index}><h4>{section.title}</h4><p className="survey-privacy-status__text">{section.text}</p></div>)}
          {notice.consentText && <div><h4>Einwilligung zu den Antworten</h4><p className="survey-privacy-status__text">{notice.consentText}</p></div>}
          {notice.contactConsentText && <div><h4>Einwilligung zur Kontaktaufnahme</h4><p className="survey-privacy-status__text">{notice.contactConsentText}</p></div>}
        </details>
        {slug && <p><a href={`/datenschutz/${encodeURIComponent(slug)}`}>Datenschutzinformation im Teamzugang prüfen</a></p>}
      </>}
    </>}
  </section>
}
