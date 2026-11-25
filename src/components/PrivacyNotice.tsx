import { participantText, type ParticipantLanguage } from '@/survey/participant-language'
import type { PrivacyNotice as Notice } from '@/survey/privacy'
import './PrivacyNotice.css'

export function PrivacyNotice({ notice, draft = true, language = 'de' }: { notice: Notice; draft?: boolean; language?: ParticipantLanguage }) {
  const t = participantText(language)
  return <section className="privacy-notice" aria-label={t("Datenschutzinformation")}>
    <h2>{t("Datenschutzinformation")}</h2>
    <p className="help">{t("Fassung")}: {notice.version}</p>
    {draft && <div className="notice"><strong>{t("Test- und Prüffassung")}</strong><p>{t("Diese Information dient der internen Prüfung mit erfundenen Angaben. Sie gibt keine echte Erhebung frei.")}</p></div>}
    {notice.sections.map((section, index) => <section key={index}>
      <h3>{t(section.title)}</h3><p className="privacy-notice__text">{section.text}</p>
    </section>)}
    {notice.consentText && <section><h3>{t("Einwilligung zu den Antworten")}</h3><p className="privacy-notice__text">{notice.consentText}</p></section>}
    {notice.contactConsentText && <section><h3>{t("Einwilligung zur Kontaktaufnahme")}</h3><p className="privacy-notice__text">{notice.contactConsentText}</p></section>}
  </section>
}
