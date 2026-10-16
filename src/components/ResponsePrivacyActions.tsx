'use client'

import { Button, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { erasureConfirmation, type ErasureReason } from '@/survey/privacy'
import './ResponsePrivacyActions.css'

export function ResponsePrivacyActions() {
  const { id, data, lastUpdateTime } = useDocumentInfo()
  const updatedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : ''
  const submissionKey = typeof data?.submissionKey === 'string' ? data.submissionKey : ''
  if (id == null || !updatedAt || !submissionKey) return <section className="response-privacy-actions"><h3>Auskunft und Löschung</h3><p>Eine gespeicherte Antwort laden, bevor Auskunft oder Löschung möglich sind.</p></section>
  // Remount immediately on a saved-document change so confirmations, receipts and
  // in-flight results cannot carry over to another response or revision.
  return <SavedResponseActions key={JSON.stringify([id, updatedAt, submissionKey, lastUpdateTime])} id={id} updatedAt={updatedAt} submissionKey={submissionKey} />
}

function SavedResponseActions({ id, updatedAt, submissionKey }: { id: string | number; updatedAt: string; submissionKey: string }) {
  const fieldID = useId()
  const [reason, setReason] = useState<ErasureReason | ''>('')
  const [copiesReviewed, setCopiesReviewed] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [operation, setOperation] = useState<'export' | 'erase'>()
  const busy = !!operation
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Record<string, unknown>>()
  const [receiptURL, setReceiptURL] = useState('')
  const [exportURL, setExportURL] = useState('')
  const mounted = useRef(true)
  const submitting = useRef(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const downloadURL = useRef<string | undefined>(undefined)
  const endpoint = `/api/survey/responses/${encodeURIComponent(String(id))}/privacy`
  const exactConfirmation = erasureConfirmation(id)
  const ready = !!reason && copiesReviewed && confirmation === exactConfirmation

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort(); if (downloadURL.current) URL.revokeObjectURL(downloadURL.current) }
  }, [])

  useEffect(() => {
    if (!receipt) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }))
    setReceiptURL(url)
    return () => URL.revokeObjectURL(url)
  }, [receipt])

  async function download() {
    if (submitting.current || receipt) return
    submitting.current = true
    setOperation('export')
    setError('')
    controller.current = new AbortController()
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-Expected-Submission-Key': submissionKey }, signal: controller.current.signal })
      if (!response.ok) {
        const body: unknown = await response.json()
        if (mounted.current) setError(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error : 'Die Auskunft konnte nicht geladen werden. Bitte die gespeicherte Antwort erneut laden.')
        return
      }
      const blob = await response.blob()
      if (!mounted.current) return
      if (downloadURL.current) URL.revokeObjectURL(downloadURL.current)
      const url = URL.createObjectURL(blob)
      downloadURL.current = url
      setExportURL(url)
      const link = document.createElement('a')
      link.href = url
      link.download = `antwort-${id}-auskunft.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      if (mounted.current) setError('Die Auskunft konnte nicht geladen werden. Bitte die gespeicherte Antwort erneut laden.')
    } finally {
      if (mounted.current) { setOperation(undefined); submitting.current = false }
    }
  }

  async function erase() {
    if (!ready || submitting.current || receipt) return
    submitting.current = true
    setOperation('erase')
    setError('')
    controller.current = new AbortController()
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, signal: controller.current.signal,
        body: JSON.stringify({ confirmation, reason, expectedUpdatedAt: updatedAt, expectedSubmissionKey: submissionKey, copiesReviewed: true }),
      })
      const body: unknown = await response.json()
      if (!mounted.current) return
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error : 'Die Löschung konnte nicht bestätigt werden. Bitte den gespeicherten Stand erneut laden und prüfen.'
        setError(message)
        return
      }
      if (!body || typeof body !== 'object' || !('deleted' in body) || body.deleted !== true
        || !('receipt' in body) || !body.receipt || typeof body.receipt !== 'object' || Array.isArray(body.receipt)) {
        setError('Die Serverantwort bestätigt die Löschung nicht eindeutig. Bitte den gespeicherten Stand erneut laden und prüfen.')
        return
      }
      setReceipt(body.receipt as Record<string, unknown>)
      setConfirmation('')
    } catch {
      if (mounted.current) setError('Die Löschung konnte nicht bestätigt werden. Bitte den gespeicherten Stand erneut laden und prüfen, bevor du es erneut versuchst.')
    } finally {
      if (mounted.current) { setOperation(undefined); submitting.current = false }
    }
  }

  return <section className="response-privacy-actions" aria-labelledby={`${fieldID}-heading`} aria-busy={busy}>
    <h3 id={`${fieldID}-heading`}>Auskunft und Löschung</h3>
    <p>Diese Aktionen beziehen sich auf die gespeicherte Antwort {id}. Ungespeicherte Änderungen werden nicht berücksichtigt.</p>
    {receipt ? <div role="status" aria-live="polite">
      <p>Antwort und zugehörige Kontaktangaben wurden gelöscht.</p>
      {receiptURL && <p><a href={receiptURL} download={`loeschbeleg-antwort-${id}.json`}>Löschbeleg als JSON herunterladen</a></p>}
      <p>Den minimalen Löschbeleg getrennt von der Datenbank aufbewahren. Bei einer Wiederherstellung müssen gelöschte Datensätze anhand dieser Belege erneut entfernt werden. Exportierte Kopien und Sicherungen nach dem vereinbarten Verfahren behandeln.</p>
    </div> : <>
      <Button type="button" buttonStyle="secondary" size="small" disabled={busy} onClick={() => void download()}>{operation === 'export' ? 'Auskunft wird geladen …' : 'Gespeicherte Antwort und Kontaktangaben als JSON herunterladen'}</Button>
      {exportURL && <p role="status">Die Auskunft ist bereit. <a href={exportURL} download={`antwort-${id}-auskunft.json`}>Auskunft als JSON speichern</a></p>}
      <p>Die Löschung entfernt Antwort und Kontaktangaben gemeinsam aus der Datenbank. Sie kann nicht rückgängig gemacht werden.</p>
      <fieldset disabled={busy} className="response-privacy-actions__fields">
        <legend>Löschung bestätigen</legend>
        <label htmlFor={`${fieldID}-reason`}>Grund der Löschung</label>
        <select id={`${fieldID}-reason`} value={reason} onChange={event => setReason(event.target.value as ErasureReason | '')}>
          <option value="">Bitte auswählen</option>
          <option value="request">Anfrage der betroffenen Person</option>
          <option value="retention">Aufbewahrungsfrist abgelaufen</option>
          <option value="test-cleanup">Testdaten bereinigen</option>
        </select>
        <label className="response-privacy-actions__checkbox" htmlFor={`${fieldID}-copies`}>
          <input id={`${fieldID}-copies`} type="checkbox" checked={copiesReviewed} onChange={event => setCopiesReviewed(event.target.checked)} />
          <span>Ich habe exportierte Kopien und Sicherungen geprüft und ihre Löschung oder Sperrung sowie die erneute Löschung nach einer Wiederherstellung nach dem vereinbarten Verfahren berücksichtigt.</span>
        </label>
        <label htmlFor={`${fieldID}-confirmation`}>Zur Bestätigung exakt „{exactConfirmation}“ eingeben</label>
        <input id={`${fieldID}-confirmation`} type="text" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} spellCheck={false} />
        <Button type="button" buttonStyle="secondary" size="small" disabled={!ready || busy} onClick={() => void erase()}>{operation === 'erase' ? 'Löschung wird geprüft …' : 'Antwort und Kontaktangaben endgültig löschen'}</Button>
      </fieldset>
    </>}
    <p role={error ? 'alert' : 'status'} aria-live="polite">{error || (busy ? operation === 'export' ? 'Bitte warten. Die Auskunft wird geladen.' : 'Bitte warten. Die Löschung wird verarbeitet.' : '')}</p>
  </section>
}
