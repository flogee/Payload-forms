'use client'

import { useId, useRef } from 'react'
import type { PrivacyNotice as Notice } from '@/survey/privacy'
import { PrivacyNotice } from './PrivacyNotice'
import './SurveyPrivacyDialog.css'

export function SurveyPrivacyDialog({ notice }: { notice?: Notice }) {
  const id = useId(), headingID = `${id}-heading`
  const dialog = useRef<HTMLDialogElement>(null)

  return <>
    <button type="button" className="survey-privacy-trigger" aria-haspopup="dialog" aria-controls={id}
      onClick={() => dialog.current?.showModal()}>Hinweise zum Datenschutz</button>
    <dialog id={id} ref={dialog} className="survey-privacy-dialog" aria-labelledby={headingID}>
      <div className="survey-privacy-dialog__header">
        <h2 id={headingID}>Hinweise zum Datenschutz</h2>
        <form method="dialog"><button type="submit" className="secondary" autoFocus>Schließen</button></form>
      </div>
      <div className="survey-privacy-dialog__content">
        {notice ? <PrivacyNotice notice={notice} draft /> : <section aria-label="Datenschutzhinweise zum Pretest">
          <div className="notice"><strong>Pretest mit erfundenen Angaben</strong>
            <p>Die vollständige Datenschutzinformation für eine echte Erhebung ist für diese Testfassung noch nicht freigegeben.</p>
          </div>
          <p>Bitte verwende ausschließlich erfundene Angaben und keine echten Namen, E-Mail-Adressen oder vertraulichen Inhalte.</p>
          <p>Deine Eingaben bleiben während der Bearbeitung auf dieser geöffneten Seite. Beim Neuladen geht der Zwischenstand verloren.</p>
          <p>Wenn du die Testantwort absendest, werden deine Angaben mit Fragebogenfassung, Einsendezeitpunkt und Bearbeitungsdauer gespeichert. Das Team kann die Testantwort im geschützten Verwaltungsbereich ansehen und auswerten.</p>
        </section>}
      </div>
    </dialog>
  </>
}
