'use client'

import { Button, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useId, useState } from 'react'
import './SurveyRetentionStatus.css'

const statusLabels = {
  pending: 'Ausstehend',
  sending: 'In Bearbeitung',
  sent: 'Vom Versanddienst angenommen',
  failed: 'Fehlgeschlagen',
  uncertain: 'Versandstatus unklar',
  cancelled: 'Abgebrochen',
}
const countLabels = {
  within90: 'In 31 bis 90 Tagen fällig',
  within30: 'Innerhalb von 30 Tagen fällig',
  overdue: 'Frist erreicht oder überschritten',
  unconfigured: 'Ohne gespeicherte Frist',
}
const countKeys = Object.keys(countLabels) as (keyof typeof countLabels)[]
type RetentionStatus = {
  surveyID: number
  enabled: boolean
  retentionYears: number | null
  recipient: string | null
  configured: boolean
  checkedAt: string | null
  stale: boolean
  counts: Record<keyof typeof countLabels, number>
  latest: {
    period: string
    status: keyof typeof statusLabels
    attempts: number
    lastError: string | null
    updatedAt: string
  } | null
  budget: { used: number; limit: number; routineLimit: number }
}
type StatusState = {
  data: ReturnType<typeof useDocumentInfo>['data']
  id: number | string
  lastUpdateTime: number
  refresh: number
  result?: RetentionStatus
  error?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isCalendarDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const isDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
const isRetentionStatus = (value: unknown): value is RetentionStatus => {
  if (!isRecord(value)) return false
  const { counts, latest, budget } = value
  return isCount(value.surveyID) && value.surveyID > 0
    && typeof value.enabled === 'boolean' && typeof value.configured === 'boolean' && typeof value.stale === 'boolean'
    && (value.retentionYears === null || (isCount(value.retentionYears) && value.retentionYears >= 1 && value.retentionYears <= 20))
    && isNullableString(value.recipient) && (value.checkedAt === null || isDate(value.checkedAt))
    && isRecord(counts) && countKeys.every(key => isCount(counts[key]))
    && (latest === null || (isRecord(latest) && typeof latest.period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(latest.period)
      && isCalendarDate(latest.period)
      && typeof latest.status === 'string' && Object.hasOwn(statusLabels, latest.status)
      && isCount(latest.attempts) && isNullableString(latest.lastError) && isDate(latest.updatedAt)))
    && isRecord(budget) && isCount(budget.used) && isCount(budget.limit) && isCount(budget.routineLimit)
    && budget.routineLimit <= budget.limit
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const weekLabel = (value: string) => new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
const savedSurveyID = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return undefined
  const numeric = Number(value)
  return isCount(numeric) && numeric > 0 ? numeric : undefined
}

export function SurveyRetentionStatus() {
  const { data, id, lastUpdateTime } = useDocumentInfo()
  const headingID = useId()
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<StatusState>()
  const surveyID = savedSurveyID(id)
  const saved = surveyID !== undefined

  useEffect(() => {
    if (surveyID === undefined || id == null) return
    const controller = new AbortController()
    let active = true
    const snapshot = { data, id, lastUpdateTime, refresh }
    setState(snapshot)
    async function load() {
      try {
        const response = await fetch(`/api/survey/retention/status?surveyID=${surveyID}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        })
        const body: unknown = await response.json()
        if (!active) return
        if (!response.ok || !isRetentionStatus(body) || body.surveyID !== surveyID) throw new Error('Status unavailable')
        setState({ ...snapshot, result: body })
      } catch {
        if (!active) return
        setState({ ...snapshot, error: 'Der Aufbewahrungsstatus konnte nicht geladen werden. Bitte erneut versuchen.' })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [data, id, lastUpdateTime, refresh, surveyID])

  // Hide the previous document's result before its replacement request starts.
  const current = state && state.data === data && state.id === id
    && state.lastUpdateTime === lastUpdateTime && state.refresh === refresh ? state : undefined
  const status = saved ? current?.result : undefined
  const loading = saved && !status && !current?.error

  return <section className="survey-retention-status" aria-labelledby={headingID} aria-busy={loading}>
    <h3 id={headingID}>Aufbewahrungsfristen und Erinnerungen</h3>
    <p className="survey-retention-status__hint">Es gelten die gespeicherten Einstellungen. Änderungen werden erst nach dem Speichern wirksam.</p>
    <p>Wenn gespeicherte Fristen innerhalb von 90 Tagen fällig oder bereits erreicht sind, wird höchstens eine Zusammenfassung pro Woche und Fragebogen an die konfigurierte Betriebsadresse gesendet. Sie enthält nur Anzahlen und einen geschützten Link, keine Antwortinhalte oder Kontaktangaben.</p>
    <p><strong>Erinnerungen löschen oder anonymisieren keine Daten.</strong> Das Entfernen von Kontaktangaben allein macht Freitextantworten nicht automatisch anonym.</p>
    <p>Die Betriebsadresse vergibt keine Zugriffsrechte. Zum Öffnen der Antworten sind weiterhin ein Teamzugang und die Cloudflare-Access-Berechtigung nötig.</p>
    {!saved && <p role="status">Zuerst den Fragebogen speichern, um Fristen und Erinnerungsstatus zu prüfen.</p>}
    {loading && <p role="status">Aufbewahrungsstatus wird geladen …</p>}
    {saved && current?.error && <p role="alert">{current.error}</p>}
    {status && <>
      <p role="status"><strong>{!status.enabled
        ? 'Erinnerungen sind für diesen Fragebogen ausgeschaltet.'
        : !status.configured ? 'Erinnerungen sind eingeschaltet, aber der Erinnerungsversand ist noch nicht vollständig eingerichtet.'
          : 'Erinnerungen sind für diesen Fragebogen eingeschaltet.'}</strong></p>
      <p>Gespeicherte Aufbewahrungsfrist: {status.retentionYears === null ? 'Keine Frist eingestellt.' : `${status.retentionYears} ${status.retentionYears === 1 ? 'Jahr' : 'Jahre'}.`}</p>
      <p>Betriebsadresse: {status.recipient
        ? <span className="survey-retention-status__address">{status.recipient}</span> : 'Keine Adresse konfiguriert.'}</p>
      <p>Ältere Antworten ohne gespeichertes Fristdatum haben keine berechenbare Frist. Eine neue Einstellung ergänzt deren Frist nicht rückwirkend.</p>
      <dl className="survey-retention-status__counts">{countKeys.map(key => <div key={key}><dt>{countLabels[key]}</dt><dd>{status.counts[key]}</dd></div>)}</dl>
      <p>Letzte Fristprüfung: {status.checkedAt ? <time dateTime={status.checkedAt}>{dateLabel(status.checkedAt)}</time> : 'Noch keine Prüfung protokolliert.'}</p>
      {status.stale && <p className="survey-retention-status__notice" role="alert">Die Fristprüfung ist überfällig oder noch nicht erfolgt. Die angezeigten Anzahlen können veraltet sein; bitte Antworten im Backend prüfen.</p>}
      {status.latest ? <>
        <p>Letzte Wochenzusammenfassung, Woche ab <time dateTime={status.latest.period}>{weekLabel(status.latest.period)}</time> (UTC): <strong>{statusLabels[status.latest.status]}</strong>. Versandversuche: {status.latest.attempts}. Aktualisiert: <time dateTime={status.latest.updatedAt}>{dateLabel(status.latest.updatedAt)}</time>.</p>
        {status.latest.status === 'cancelled' && <p>Eine ausstehende Erinnerung wurde wegen Wochenwechsel, geänderter Einstellungen oder nicht mehr fälliger Antworten abgebrochen.</p>}
        {(status.latest.status !== 'cancelled' && (status.latest.lastError !== null || status.latest.status === 'failed' || status.latest.status === 'uncertain')) && <p className="survey-retention-status__notice" role="alert">Der letzte Erinnerungsversand ist fehlgeschlagen oder konnte nicht sicher bestätigt werden. Bitte den Betriebsstatus und die Antworten im Backend prüfen.</p>}
      </> : <p>Bisher ist keine Wochenzusammenfassung protokolliert.</p>}
      <p>„Vom Versanddienst angenommen“ bestätigt die Annahme zum Versand, nicht die Zustellung im Posteingang.</p>
      <p>App-Versandversuche in diesem Kalendermonat (UTC): {status.budget.used} von {status.budget.limit} verbraucht. Reguläre E-Mails und Erinnerungen pausieren ab {status.budget.routineLimit} Versuchen; die übrigen {status.budget.limit - status.budget.routineLimit} bleiben für Betriebswarnungen reserviert.</p>
      {status.budget.used >= status.budget.routineLimit && <p role="alert">Das reguläre Mailkontingent ist ausgeschöpft. Antworten werden weiterhin gespeichert. Bitte Fristen im Backend prüfen.</p>}
      <p><a href={`/admin/collections/responses?where[survey][equals]=${status.surveyID}`}>Antworten dieses Fragebogens prüfen</a></p>
    </>}
    {saved && <Button type="button" buttonStyle="secondary" size="small" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
      Status aktualisieren
    </Button>}
  </section>
}
