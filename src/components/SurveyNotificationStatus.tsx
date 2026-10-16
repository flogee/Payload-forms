'use client'

import { Button, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useId, useState } from 'react'
import './SurveyNotificationStatus.css'

const countLabels = {
  pending: 'Ausstehend',
  sending: 'In Bearbeitung',
  sent: 'Vom Versanddienst angenommen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  uncertain: 'Versandstatus unklar',
}
const countKeys = Object.keys(countLabels) as (keyof typeof countLabels)[]
type NotificationStatus = {
  surveyID: number
  enabled: boolean
  recipients: string[]
  configured: boolean
  sender: string | null
  allowedRecipients: string[]
  counts: Record<keyof typeof countLabels, number>
  budget: { limit: number; routineLimit: number; used: number }
  deliveryLogURL: string
}
type StatusState = {
  data: ReturnType<typeof useDocumentInfo>['data']
  id: number | string
  lastUpdateTime: number
  refresh: number
  result?: NotificationStatus
  error?: string
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const isNotificationStatus = (body: unknown): body is NotificationStatus => {
  if (!body || typeof body !== 'object') return false
  const value = body as Partial<NotificationStatus>
  return isCount(value.surveyID) && typeof value.enabled === 'boolean' && typeof value.configured === 'boolean'
    && isStringList(value.recipients) && isStringList(value.allowedRecipients)
    && (value.sender === null || typeof value.sender === 'string')
    && !!value.counts && countKeys.every(key => isCount(value.counts[key]))
    && !!value.budget && isCount(value.budget.limit) && isCount(value.budget.routineLimit) && isCount(value.budget.used)
    && typeof value.deliveryLogURL === 'string'
}

// Only allow the relative collection link, never a different origin or admin page.
const deliveryLogLink = (value: string): string | undefined => {
  const path = '/admin/collections/response-notifications'
  if (!value.startsWith(path) || /[\\\s#]/.test(value)) return undefined
  try {
    const base = 'https://notification-status.invalid'
    const url = new URL(value, base)
    return url.origin === base && url.pathname === path ? `${url.pathname}${url.search}` : undefined
  } catch { return undefined }
}

export function SurveyNotificationStatus() {
  const { data, id, lastUpdateTime } = useDocumentInfo()
  const headingID = useId()
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<StatusState>()
  const saved = id != null

  useEffect(() => {
    if (!saved) return
    const controller = new AbortController()
    let active = true
    const snapshot = { data, id, lastUpdateTime, refresh }
    setState(snapshot)

    async function load() {
      try {
        const response = await fetch(`/api/survey/notifications/status?surveyID=${encodeURIComponent(String(id))}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        })
        const body: unknown = await response.json()
        if (!active) return
        if (!response.ok || !isNotificationStatus(body) || String(body.surveyID) !== String(id)) {
          throw new Error('Status unavailable')
        }
        setState({ ...snapshot, result: body })
      } catch {
        if (!active) return
        setState({ ...snapshot, error: 'Benachrichtigungsstatus konnte nicht geladen werden. Bitte erneut versuchen.' })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [data, id, lastUpdateTime, refresh, saved])

  // Discard stale data during render, before the replacement request starts.
  const current = state && state.data === data && state.id === id
    && state.lastUpdateTime === lastUpdateTime && state.refresh === refresh ? state : undefined
  const status = saved ? current?.result : undefined
  const loading = saved && !status && !current?.error
  const unsupported = status?.recipients.filter(address => !status.allowedRecipients.some(allowed => allowed.toLowerCase() === address.toLowerCase())) ?? []
  const logURL = status ? deliveryLogLink(status.deliveryLogURL) : undefined
  const counts = status ? countKeys.filter(key => status.counts[key] > 0) : []

  return <section className="survey-notification-status" aria-labelledby={headingID} aria-busy={loading}>
    <h3 id={headingID}>E-Mail-Benachrichtigungen</h3>
    <p className="survey-notification-status__hint">Es gelten die gespeicherten Einstellungen. Änderungen werden erst nach dem Speichern wirksam.</p>
    <p>Die E-Mail enthält nur einen Hinweis auf eine neue Antwort und einen geschützten Link zur Antwort. Antwortinhalte und Kontaktangaben werden nicht per E-Mail versendet.</p>
    <p>Jede Empfängeradresse muss bei Cloudflare bestätigt und für den Versand registriert sein. Zum Öffnen der Antwort braucht die Person zusätzlich einen freigegebenen Teamzugang und eine Cloudflare-Access-Berechtigung. Die Empfängerliste vergibt keine Zugriffsrechte.</p>
    {!saved && <p role="status">Zuerst den Fragebogen speichern, um den Benachrichtigungsstatus zu prüfen.</p>}
    {loading && <p role="status">Benachrichtigungsstatus wird geladen …</p>}
    {saved && current?.error && <p role="alert">{current.error}</p>}
    {status && <>
      <p role="status"><strong>{!status.configured
        ? 'Der E-Mail-Versand ist noch nicht aktiviert. Bis zur Aktivierung werden keine Benachrichtigungen erzeugt.'
        : !status.enabled ? 'Benachrichtigungen sind für diesen Fragebogen ausgeschaltet.'
          : !status.recipients.length ? 'Benachrichtigungen sind eingeschaltet, aber es sind noch keine Empfänger gespeichert.'
            : 'Benachrichtigungen sind für diesen Fragebogen eingeschaltet.'}</strong></p>
      {status.sender && <p>Absender: <span className="survey-notification-status__address">{status.sender}</span></p>}
      {!!status.recipients.length && <details>
        <summary>Gespeicherte Empfänger ({status.recipients.length})</summary>
        <ul>{status.recipients.map((address, index) => <li className="survey-notification-status__address" key={`${index}-${address}`}>{address}</li>)}</ul>
      </details>}
      {!!unsupported.length && <div className="survey-notification-status__notice">
        <p><strong>Diese Adressen sind noch nicht für den Versand freigegeben.</strong> Sie müssen bei Cloudflare bestätigt und registriert werden:</p>
        <ul>{unsupported.map((address, index) => <li className="survey-notification-status__address" key={`${index}-${address}`}>{address}</li>)}</ul>
      </div>}
      {!!counts.length && <dl className="survey-notification-status__counts">{counts.map(key => <div key={key}><dt>{countLabels[key]}</dt><dd>{status.counts[key]}</dd></div>)}</dl>}
      {!counts.length && <p>Bisher sind keine Benachrichtigungen protokolliert.</p>}
      <p>„Vom Versanddienst angenommen“ bestätigt die Annahme zum Versand, nicht die Zustellung im Posteingang.</p>
      <p>App-Versandversuche in diesem Kalendermonat (UTC): {status.budget.used} von {status.budget.limit} verbraucht. Reguläre Eingangsmails pausieren ab {status.budget.routineLimit} Versuchen; die übrigen {status.budget.limit - status.budget.routineLimit} bleiben für Betriebswarnungen reserviert.</p>
      {status.budget.used >= status.budget.routineLimit && <p role="alert">Das reguläre Mailkontingent ist ausgeschöpft. Einsendungen werden weiterhin gespeichert. Ausstehende Eingangsmails können nach 24 Stunden verfallen; bitte Antworten im Backend prüfen.</p>}
      {logURL && <p><a href={logURL}>Versandprotokoll öffnen</a></p>}
    </>}
    {saved && <Button type="button" buttonStyle="secondary" size="small" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
      Status aktualisieren
    </Button>}
  </section>
}
