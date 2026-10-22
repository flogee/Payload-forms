'use client'

import { Button, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { surveyToolsURLs } from '@/survey/survey-tools'
import './SurveyTools.css'

type Operation = 'json' | 'markdown' | 'csv' | 'duplicate'
type Result = { key: string; operation?: Operation; error?: string; copyID?: number; download?: { url: string; filename: string } }
const message = (body: unknown, fallback: string) => body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : fallback

export function SurveyTools() {
  const { id, data, lastUpdateTime } = useDocumentInfo()
  if (id == null) return <section className="survey-tools"><h3>Downloads und Kopie</h3><p>Zuerst den Fragebogen speichern. Danach sind Downloads und eine Kopie als neuer Entwurf verfügbar.</p>
    <Button type="button" buttonStyle="secondary" size="small" disabled>Fragebogen herunterladen</Button>
    <Button type="button" buttonStyle="secondary" size="small" disabled>Als neuen Entwurf duplizieren</Button></section>
  return <SavedSurveyTools key={String(id)} id={id} savedKey={JSON.stringify([id, data?.updatedAt, lastUpdateTime])} />
}

function SavedSurveyTools({ id, savedKey }: { id: string | number; savedKey: string }) {
  const fieldID = useId(), endpoints = surveyToolsURLs(id)
  const [result, setResult] = useState<Result>()
  const [pendingRetry, setPendingRetry] = useState(false)
  const current = result?.key === savedKey ? result : undefined
  const busy = !!current?.operation
  const mounted = useRef(false), currentKey = useRef(savedKey)
  currentKey.current = savedKey
  const controller = useRef<AbortController | undefined>(undefined)
  const objectURL = useRef<string | undefined>(undefined)
  const requestID = useRef<string | undefined>(undefined)
  const storageKey = `payload-forms-forms-duplicate-${id}`

  useEffect(() => {
    mounted.current = true
    try {
      const pending = sessionStorage.getItem(storageKey)
      if (pending && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(pending)) requestID.current = pending
    } catch { /* The in-memory request ID still protects retries in this view. */ }
    setPendingRetry(!!requestID.current)
    return () => { mounted.current = false }
  }, [storageKey])

  useEffect(() => {
    return () => {
      controller.current?.abort(); controller.current = undefined
      if (objectURL.current) URL.revokeObjectURL(objectURL.current)
      objectURL.current = undefined
    }
  }, [savedKey])

  async function run(operation: Operation) {
    if (controller.current || (operation === 'duplicate' && current?.copyID)) return
    const snapshot = savedKey, activeController = new AbortController()
    controller.current = activeController
    const active = () => mounted.current && currentKey.current === snapshot && !activeController.signal.aborted
    setResult({ key: snapshot, operation })
    try {
      if (operation === 'duplicate' && !requestID.current) {
        requestID.current = crypto.randomUUID()
        try { sessionStorage.setItem(storageKey, requestID.current) } catch { /* Retain in memory if session storage is unavailable. */ }
      }
      const response = await fetch(endpoints[operation], { credentials: 'same-origin', cache: 'no-store', signal: activeController.signal,
        ...(operation === 'duplicate' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestID: requestID.current }) } : {}),
      })
      if (!response.ok) {
        let body: unknown
        try { body = await response.json() } catch { /* A proxy may return a non-JSON error. */ }
        throw new Error(message(body, operation === 'duplicate' ? 'Die Kopie konnte nicht bestätigt werden. Bitte erneut versuchen.' : 'Der Download konnte nicht geladen werden. Bitte erneut versuchen.'))
      }
      if (operation === 'duplicate') {
        const body: unknown = await response.json()
        if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id <= 0) throw new Error('Die Serverantwort bestätigt die Kopie nicht eindeutig. Bitte erneut versuchen.')
        if (!active()) return
        requestID.current = undefined
        try { sessionStorage.removeItem(storageKey) } catch { /* Best-effort persistence cleanup. */ }
        setPendingRetry(false)
        setResult({ key: snapshot, copyID: body.id })
      } else {
        const blob = await response.blob()
        if (!active()) return
        if (objectURL.current) URL.revokeObjectURL(objectURL.current)
        const url = URL.createObjectURL(blob)
        objectURL.current = url
        const filename = operation === 'csv' ? `fragebogen-${id}-antworten.csv` : `fragebogen-${id}.${operation === 'json' ? 'json' : 'md'}`
        setResult({ key: snapshot, download: { url, filename } })
        const link = document.createElement('a')
        link.href = url; link.download = filename
        document.body.appendChild(link); link.click(); link.remove()
      }
    } catch (error) {
      if (active()) {
        setResult({ key: snapshot, error: error instanceof Error ? error.message : 'Die Aktion konnte nicht bestätigt werden. Bitte erneut versuchen.' })
        setPendingRetry(!!requestID.current)
      }
    } finally { if (controller.current === activeController) controller.current = undefined }
  }

  return <section className="survey-tools" aria-labelledby={`${fieldID}-heading`} aria-busy={busy}>
    <h3 id={`${fieldID}-heading`}>Downloads und Kopie</h3>
    <p>Es gilt die gespeicherte Fassung. Ungespeicherte Änderungen werden erst nach dem Speichern berücksichtigt.</p>
    <div className="survey-tools__buttons">
      <a href={`/auswertung?surveyID=${encodeURIComponent(String(id))}`}>Antworten auswerten und Diagramme herunterladen</a>
      <Button type="button" buttonStyle="secondary" size="small" disabled={busy} onClick={() => void run('json')}>Fragebogen als JSON</Button>
      <Button type="button" buttonStyle="secondary" size="small" disabled={busy} onClick={() => void run('markdown')}>Fragebogen als Markdown</Button>
      <Button type="button" buttonStyle="secondary" size="small" disabled={busy} onClick={() => void run('csv')}>Antwortdaten als CSV</Button>
    </div>
    <p className="survey-tools__hint">Fragebogen-Downloads enthalten Inhalte und Datenschutzangaben; Bilder bleiben Medienreferenzen. CSV enthält höchstens 1.000 Antworten und keine getrennten Kontaktangaben.</p>
    <Button type="button" buttonStyle="secondary" size="small" disabled={busy || !!current?.copyID} onClick={() => void run('duplicate')}>
      {pendingRetry ? 'Duplizierung erneut prüfen' : 'Als neuen Entwurf duplizieren'}
    </Button>
    <p className="survey-tools__hint">Die Kopie enthält keine Antworten. Datenschutz erneut prüfen; E-Mail-Versand und Fristerinnerungen sind ausgeschaltet.</p>
    {pendingRetry && !current?.copyID && <p role="status">Ein Duplizierungsversuch ist noch unbestätigt. „Erneut prüfen“ verwendet dieselbe Anfragekennung.</p>}
    {current?.copyID && <p role="status">Kopie gespeichert. <a href={`/admin/collections/surveys/${current.copyID}`}>Neuen Entwurf öffnen</a></p>}
    {current?.download && <p role="status">Download bereit. <a href={current.download.url} download={current.download.filename}>Datei speichern</a></p>}
    <p role={current?.error ? 'alert' : 'status'} aria-live="polite">{current?.error || (busy ? 'Bitte warten …' : '')}</p>
  </section>
}
