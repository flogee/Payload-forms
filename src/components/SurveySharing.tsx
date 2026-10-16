'use client'

import { Button, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useId, useRef, useState } from 'react'
import './SurveySharing.css'

type ShareLink = { origin: string; url: string; qrSVG: string; qrPNG: string }
type ShareResponse = { surveyID: number; title: string; links: ShareLink[] }
const isShareResponse = (body: unknown): body is ShareResponse => {
  if (!body || typeof body !== 'object') return false
  const value = body as Partial<ShareResponse>
  return typeof value.surveyID === 'number' && typeof value.title === 'string'
    && Array.isArray(value.links) && value.links.length > 0
    && value.links.every(link => link && typeof link.origin === 'string' && typeof link.url === 'string'
      && typeof link.qrSVG === 'string' && typeof link.qrPNG === 'string')
}
type ShareState = {
  data: ReturnType<typeof useDocumentInfo>['data']
  id: number | string
  lastUpdateTime: number
  retry: number
  result?: ShareResponse
  error?: string
  unavailable?: boolean
}

const downloadURL = (url: string) => `${url}${url.includes('?') ? '&' : '?'}download=1`

export function SurveySharing() {
  const { data, id, lastUpdateTime } = useDocumentInfo()
  const fieldID = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<ShareState>()
  const [origin, setOrigin] = useState('')
  const [copyStatus, setCopyStatus] = useState<{ url: string; message: string }>()
  const [qrError, setQRError] = useState('')
  const savedPretest = id != null && data?.phase === 'pretest'

  useEffect(() => {
    if (!savedPretest) return
    const controller = new AbortController()
    let active = true
    const snapshot = { data, id, lastUpdateTime, retry }
    setState(snapshot)
    setCopyStatus(undefined)
    setQRError('')

    async function load() {
      try {
        const response = await fetch(`/api/survey/share/${encodeURIComponent(String(id))}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        })
        const body = await response.json()
        if (!active) return
        if (!response.ok) {
          const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error : 'Teilnahmelinks konnten nicht geladen werden.'
          setState({ ...snapshot, unavailable: response.status === 409,
            error: message })
          return
        }
        if (!isShareResponse(body)) {
          throw new Error('Es sind keine Teilnahmelinks verfügbar.')
        }
        setState({ ...snapshot, result: body })
      } catch (error) {
        if (!active) return
        setState({ ...snapshot, error: error instanceof Error && error.message === 'Es sind keine Teilnahmelinks verfügbar.'
          ? error.message : 'Teilnahmelinks konnten nicht geladen werden. Bitte erneut versuchen.' })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [data, id, lastUpdateTime, retry, savedPretest])

  // Hide the previous response immediately when the saved document changes,
  // including the render before the next effect starts its request.
  const current = state && state.data === data && state.id === id && state.lastUpdateTime === lastUpdateTime && state.retry === retry
    ? state : undefined
  const links = savedPretest ? current?.result?.links : undefined
  const selected = links?.find(link => link.origin === origin) ?? links?.[0]

  async function copyLink() {
    if (!selected) return
    const url = selected.url
    try {
      await navigator.clipboard.writeText(url)
      setCopyStatus({ url, message: 'Link kopiert.' })
    } catch {
      setCopyStatus({ url, message: 'Kopieren nicht möglich. Bitte den Link im Feld markieren und manuell kopieren.' })
      if (inputRef.current?.value === url) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }
  }

  const inactiveMessage = id == null
    ? 'Zuerst den Fragebogen speichern. Teilnahmelinks gibt es für einen gespeicherten Pretest.'
    : data?.phase === 'closed'
      ? 'Dieser Fragebogen ist geschlossen. Es gibt keine aktive Einladung.'
      : 'Für einen Teilnahmelink den Status „Pretest“ wählen und speichern.'

  return (
    <section className="survey-sharing" aria-labelledby={`${fieldID}-heading`} aria-busy={savedPretest && !current?.result && !current?.error}>
      <h3 id={`${fieldID}-heading`}>Teilnahmelink und QR-Code</h3>
      <p>Pretest mit erfundenen Angaben. Teilnehmende öffnen diesen Link ohne Anmeldung; das Backend und gespeicherte Antworten bleiben geschützt.</p>
      <p className="survey-sharing__hint">Es gilt der gespeicherte Status. Änderungen werden erst nach dem Speichern berücksichtigt.</p>
      {!savedPretest && <p role="status">{inactiveMessage}</p>}
      {savedPretest && !current?.result && !current?.error && <p role="status">Teilnahmelinks werden geladen …</p>}
      {savedPretest && current?.error && (
        <div>
          <p role={current.unavailable ? 'status' : 'alert'}>{current.error}</p>
          <Button type="button" buttonStyle="secondary" size="small" onClick={() => setRetry(value => value + 1)}>Erneut laden</Button>
        </div>
      )}
      {selected && (
        <div className="survey-sharing__content">
          <div className="survey-sharing__fields">
            <label htmlFor={`${fieldID}-origin`}>Domain</label>
            <select id={`${fieldID}-origin`} value={selected.origin} onChange={event => {
              setOrigin(event.target.value); setCopyStatus(undefined); setQRError('')
            }}>
              {links.map(link => <option key={link.origin} value={link.origin}>{link.origin}</option>)}
            </select>
            <label htmlFor={`${fieldID}-link`}>Teilnahmelink</label>
            <input ref={inputRef} id={`${fieldID}-link`} type="text" readOnly value={selected.url} onFocus={event => event.target.select()} />
            <Button el="anchor" url={selected.url} newTab buttonStyle="primary" size="small">Fragebogen-Vorschau öffnen</Button>
            <Button type="button" buttonStyle="secondary" size="small" onClick={() => void copyLink()}>Link kopieren</Button>
            <p role="status" aria-live="polite">{copyStatus?.url === selected.url ? copyStatus.message : ''}</p>
          </div>
          <div className="survey-sharing__qr">
            <img key={selected.qrSVG} src={selected.qrSVG} width={224} height={224} alt={`QR-Code zum Teilnahmelink für ${current.result.title} auf ${selected.origin}`} onError={() => setQRError(selected.qrSVG)} />
            {qrError === selected.qrSVG && <p role="alert">QR-Vorschau konnte nicht geladen werden.</p>}
            <div className="survey-sharing__downloads">
              <a href={downloadURL(selected.qrPNG)} download>QR als PNG</a>
              <a href={downloadURL(selected.qrSVG)} download>QR als SVG</a>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
