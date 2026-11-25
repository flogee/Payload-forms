'use client'
import { participantText, type ParticipantLanguage } from '@/survey/participant-language'

import { useId, useRef } from 'react'
import type { PrivacyNotice as Notice } from '@/survey/privacy'
import { PrivacyNotice } from './PrivacyNotice'
import './SurveyPrivacyDialog.css'

export function SurveyPrivacyDialog({ notice, testOnly = true, language = 'de' }: { notice?: Notice; testOnly?: boolean; language?: ParticipantLanguage }) {
  const t = participantText(language)
  const id = useId(), headingID = `${id}-heading`
  const dialog = useRef<HTMLDialogElement>(null)

  return <>
    <button type="button" className="survey-privacy-trigger" aria-haspopup="dialog" aria-controls={id}
      onClick={() => dialog.current?.showModal()}>{t("Hinweise zum Datenschutz")}</button>
    <dialog id={id} ref={dialog} className="survey-privacy-dialog" aria-labelledby={headingID}>
      <div className="survey-privacy-dialog__header">
        <h2 id={headingID}>{t("Hinweise zum Datenschutz")}</h2>
        <form method="dialog"><button type="submit" className="secondary" autoFocus>{t("Schließen")}</button></form>
      </div>
      <div className="survey-privacy-dialog__content">
        {notice ? <PrivacyNotice language={language} notice={notice} draft={testOnly} /> : <section aria-label={t("Datenschutzhinweise zum Pretest")}>
          <div className="notice"><strong>{t("Pretest mit erfundenen Angaben")}</strong>
            <p>{t("Die vollständige Datenschutzinformation für eine echte Erhebung ist für diese Testfassung noch nicht freigegeben.")}</p>
          </div>
          <p>{t("Bitte verwende ausschließlich erfundene Angaben und keine echten Namen, E-Mail-Adressen oder vertraulichen Inhalte.")}</p>
          <p>{t("Deine Eingaben bleiben während der Bearbeitung auf dieser geöffneten Seite. Beim Neuladen geht der Zwischenstand verloren.")}</p>
          <p>{t("Wenn du die Testantwort absendest, werden deine Angaben mit Fragebogenfassung, Einsendezeitpunkt und Bearbeitungsdauer gespeichert. Das Team kann die Testantwort im geschützten Verwaltungsbereich ansehen und auswerten.")}</p>
        </section>}
      </div>
    </dialog>
  </>
}
