'use client'
import { participantText, type ParticipantLanguage } from '@/survey/participant-language'

import { useEffect, useId, useRef, useState } from 'react'
import { participantInvitation, participantShareURL } from '@/survey/participant-sharing'
import './ParticipantShare.css'

export function ParticipantShare({ title, homeURL, language = 'de' }: { title: string; homeURL: string; language?: ParticipantLanguage }) {
  const t = participantText(language)
  const id = useId()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [url, setURL] = useState<string>()
  const [status, setStatus] = useState('')
  const [copying, setCopying] = useState(false)
  useEffect(() => { setURL(participantShareURL(window.location.origin, homeURL)) }, [homeURL])
  if (!url) return null
  const invitation = participantInvitation(title, url, language)

  async function copy(linkOnly: boolean) {
    if (!url || copying) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(linkOnly ? url : invitation)
      setStatus(linkOnly ? t("Link kopiert.") : t("Text und Link kopiert."))
    } catch {
      textRef.current?.focus()
      textRef.current?.setSelectionRange(linkOnly ? invitation.lastIndexOf(url) : 0, invitation.length)
      setStatus(t("Bitte den markierten Text manuell kopieren."))
    } finally { setCopying(false) }
  }

  return <section className="participant-share" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{t("Auch für andere interessant?")}</h2>
    <p>{t("Empfiehl die Befragung Kolleginnen und Kollegen oder anderen Organisationen weiter.")}</p>
    <label htmlFor={`${id}-invitation`}>{t("Vorschlag zum Weiterleiten")}</label>
    <textarea id={`${id}-invitation`} ref={textRef} readOnly rows={5} value={invitation} spellCheck={false} />
    <div className="participant-share__actions">
      <button className="primary" type="button" disabled={copying} onClick={() => void copy(false)}>{t("Text und Link kopieren")}</button>
      <button className="secondary" type="button" disabled={copying} onClick={() => void copy(true)}>{t("Nur Link kopieren")}</button>
    </div>
    <p className="participant-share__status help" role="status" aria-live="polite">{status}</p>
  </section>
}
