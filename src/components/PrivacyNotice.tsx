import type { PrivacyNotice as Notice } from '@/survey/privacy'
import './PrivacyNotice.css'

export function PrivacyNotice({ notice, draft = true }: { notice: Notice; draft?: boolean }) {
  return <section className="privacy-notice" aria-label="Datenschutzinformation">
    <h2>Datenschutzinformation</h2>
    <p className="help">Fassung: {notice.version}</p>
    {draft && <div className="notice"><strong>Test- und Prüffassung</strong><p>Diese Information dient der internen Prüfung mit erfundenen Angaben. Sie gibt keine echte Erhebung frei.</p></div>}
    {notice.sections.map((section, index) => <section key={index}>
      <h3>{section.title}</h3><p className="privacy-notice__text">{section.text}</p>
    </section>)}
    {notice.consentText && <section><h3>Einwilligung zu den Antworten</h3><p className="privacy-notice__text">{notice.consentText}</p></section>}
    {notice.contactConsentText && <section><h3>Einwilligung zur Kontaktaufnahme</h3><p className="privacy-notice__text">{notice.contactConsentText}</p></section>}
  </section>
}
