'use client'
import { z } from 'zod'
import { Button, useAuth, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import './SurveyNotificationStatus.css'
import { managesTeam } from '../auth/team'
type Status = { configured: boolean; enabled: boolean; synchronized: boolean; status: string; stale: boolean; attempts: number;
  checkedAt: string | null; syncedAt: string | null; error: string | null; count: number; limit: number }
const statusSchema = z.object({ configured: z.boolean(), enabled: z.boolean(), synchronized: z.boolean(), status: z.enum(['pending','syncing','synced','failed']),
  stale: z.boolean(), attempts: z.number().int().min(0).max(3), checkedAt: z.string().nullable(), syncedAt: z.string().nullable(), error: z.string().nullable(), count: z.number().int().min(1).max(40), limit: z.literal(40) })
export function TeamAccessStatus() {
  const { user } = useAuth(), { lastUpdateTime } = useDocumentInfo()
  const [refresh, setRefresh] = useState(0), [status, setStatus] = useState<Status>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const manager = managesTeam(user)
  useEffect(() => {
    if (!manager) return
    const controller = new AbortController()
    setStatus(undefined); setError('')
    fetch('/api/team-access/status', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error('Status nicht verfügbar.'); return statusSchema.parse(body) as Status })
      .then(body => { if (!controller.signal.aborted) setStatus(body) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [manager, lastUpdateTime, refresh])
  if (!manager) return null
  async function retry() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/team-access/status', { method: 'POST', credentials: 'same-origin', body: '' })
      if (!response.ok) throw new Error('Der erneute Abgleich konnte nicht vorgemerkt werden.')
      setRefresh(value => value + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Abgleich nicht verfügbar.') }
    finally { setBusy(false) }
  }
  return <section className="survey-notification-status" aria-label="Teamzugang und Anmeldung">
    <h3>Teamzugang und Anmeldung</h3>
    <p>Teammitglieder melden sich mit ihrer freigegebenen E-Mail-Adresse an. Ein Cloudflare-Verwaltungsaccount ist dafür nicht erforderlich.</p>
    <p>Die Freigabe verwendet den gespeicherten Stand. Neue Zugänge können nach dem Speichern bis zu fünf Minuten brauchen. Eine Sperre gilt im Backend sofort.</p>
    {error && <p role="alert">{error}</p>}
    {status && <>
      <p role="status"><strong>{!status.enabled || !status.configured ? 'Automatische Access-Freigabe ist noch nicht vollständig eingerichtet.'
        : status.synchronized ? 'Die gespeicherten Teamzugänge sind mit Access abgeglichen.'
          : status.status === 'failed' ? 'Der Access-Abgleich ist fehlgeschlagen.' : 'Der Access-Abgleich steht aus.'}</strong></p>
      <p>{status.count} aktive Teamadressen · Grenze: {status.limit}</p>
      {status.stale && <p role="alert">Die Prüfung der Access-Freigabe ist überfällig. Bitte den Betrieb prüfen und den Status aktualisieren.</p>}
      {status.error && <p role="alert">{status.error}</p>}
      {status.attempts >= 3 && !status.synchronized && <p role="alert">Nach drei Versuchen pausiert der automatische Abgleich. Ursache beheben und dann erneut vormerken.</p>}
      {status.syncedAt && <p>Zuletzt bestätigt: {new Date(status.syncedAt).toLocaleString('de-AT')}</p>}
      <Button buttonStyle="secondary" size="small" type="button" onClick={() => setRefresh(value => value + 1)}>Status aktualisieren</Button>
      {status.status === 'failed' && <Button buttonStyle="secondary" size="small" type="button" disabled={busy} onClick={retry}>Abgleich erneut vormerken</Button>}
    </>}
  </section>
}
