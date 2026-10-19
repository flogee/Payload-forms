'use client'

import { Button } from '@payloadcms/ui'
import { useEffect, useId, useState } from 'react'
import './MediaBudgetStatus.css'

type MediaBudget = {
  month: string
  storage: { reservedBytes: number; limitBytes: number; reservedObjects: number; limitObjects: number }
  reads: { used: number; limit: number }
  writes: { used: number; limit: number }
  mail: { used: number; limit: number }
  participation: { used: number; limit: number }
  submissions: { used: number; limit: number }
  qa: { enabled: boolean; usage: { scope: string; requests: { used: number; limit: number }; reports: { used: number; limit: number } }[] }
  warnings: { configured: boolean; recipient: string | null; stale: boolean; checkedAt: string | null; mailTotalLimit: number;
    alerts: { metric: string; scope: string; level: string; status: string; updated_at: string }[] }
}
type BudgetState = { refresh: number; result?: MediaBudget; error?: boolean }

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isUsage = (value: unknown): boolean => isRecord(value) && isCount(value.used) && isCount(value.limit) && value.limit > 0
const isMediaBudget = (value: unknown): value is MediaBudget => {
  if (!isRecord(value) || typeof value.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)) return false
  const storage = value.storage
  return isRecord(storage) && isCount(storage.reservedBytes) && isCount(storage.limitBytes) && storage.limitBytes > 0
    && isCount(storage.reservedObjects) && isCount(storage.limitObjects) && storage.limitObjects > 0
    && isUsage(value.reads) && isUsage(value.writes) && isUsage(value.mail) && isUsage(value.participation) && isUsage(value.submissions)
    && isRecord(value.qa) && typeof value.qa.enabled === 'boolean' && Array.isArray(value.qa.usage) && value.qa.usage.length <= 64
    && value.qa.usage.every(row => isRecord(row) && typeof row.scope === 'string' && isUsage(row.requests) && isUsage(row.reports))
    && isRecord(value.warnings) && typeof value.warnings.configured === 'boolean' && typeof value.warnings.stale === 'boolean'
    && (value.warnings.recipient === null || typeof value.warnings.recipient === 'string')
    && (value.warnings.checkedAt === null || typeof value.warnings.checkedAt === 'string') && isCount(value.warnings.mailTotalLimit)
    && Array.isArray(value.warnings.alerts) && value.warnings.alerts.every(alert => isRecord(alert)
      && typeof alert.metric === 'string' && typeof alert.scope === 'string' && typeof alert.level === 'string' && typeof alert.status === 'string' && typeof alert.updated_at === 'string')
}

const labels: Record<string, string> = { storage: 'Bildspeicher', objects: 'Bildplätze', reads: 'Bildabrufe', writes: 'Bild-Uploads', mail: 'Eingangsmails', participation: 'Öffentliche Formularabrufe', submissions: 'Öffentliche Absendeversuche', rate: 'Kurzzeitige Ratenbegrenzung', qaRequests: 'QA-Maschinenaufrufe', qaReports: 'QA-Berichtsversuche', qaRate: 'QA-Kurzzeitbegrenzung' }
const states: Record<string, string> = { pending: 'Versand ausstehend', sending: 'Versand gestartet', sent: 'Vom Versanddienst angenommen', failed: 'Versand fehlgeschlagen', uncertain: 'Versandausgang unklar' }

const count = (value: number) => value.toLocaleString('de-AT')
const mib = (value: number) => (value / 1048576).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function BudgetMeter({ label, used, limit, text }: { label: string; used: number; limit: number; text: string }) {
  return <div><dt>{label}</dt><dd><span>{text}</span><meter min={0} max={limit} value={Math.min(used, limit)} aria-label={label} /></dd></div>
}

export function MediaBudgetStatus() {
  const headingID = useId()
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<BudgetState>()

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ refresh })
    async function load() {
      try {
        const response = await fetch('/api/survey/media/status', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Status request failed')
        const body: unknown = await response.json()
        if (!isMediaBudget(body)) throw new Error('Invalid status response')
        if (active) setState({ refresh, result: body })
      } catch {
        if (active) setState({ refresh, error: true })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [refresh])

  const current = state?.refresh === refresh ? state : undefined
  const budget = current?.result, loading = !budget && !current?.error
  return <section className="media-budget-status" aria-labelledby={headingID} aria-busy={loading}>
    <h3 id={headingID}>Betriebskontingente</h3>
    <p>Reservierter Speicher und reservierte Bildplätze gelten dauerhaft. Auch fehlgeschlagene oder unklare Uploads können Reservierungen belegen; dies ist keine Messung des tatsächlich belegten Speichers.</p>
    {loading && <p role="status">Bildbudget wird geladen …</p>}
    {current?.error && <p role="alert">Kontingentprüfung und Warnstatus sind nicht verfügbar. Auch der automatische Warnversand kann gestört sein. Bitte erneut versuchen und den Betrieb prüfen.</p>}
    {budget && <>
      <dl className="media-budget-status__counts">
        <BudgetMeter label="Reservierter Speicher" used={budget.storage.reservedBytes} limit={budget.storage.limitBytes} text={`${mib(budget.storage.reservedBytes)} von ${mib(budget.storage.limitBytes)} MiB`} />
        <BudgetMeter label="Reservierte Bildplätze" used={budget.storage.reservedObjects} limit={budget.storage.limitObjects} text={`${count(budget.storage.reservedObjects)} von ${count(budget.storage.limitObjects)}`} />
        <BudgetMeter label={`Leseversuche · ${budget.month}`} used={budget.reads.used} limit={budget.reads.limit} text={`${count(budget.reads.used)} von ${count(budget.reads.limit)}`} />
        <BudgetMeter label={`Schreibversuche · ${budget.month}`} used={budget.writes.used} limit={budget.writes.limit} text={`${count(budget.writes.used)} von ${count(budget.writes.limit)}`} />
        <BudgetMeter label={`Eingangsmails · ${budget.month}`} used={budget.mail.used} limit={budget.mail.limit} text={`${count(budget.mail.used)} von ${count(budget.mail.limit)} regulären Versandversuchen`} />
        <BudgetMeter label={`Öffentliche Formularabrufe · ${budget.month}`} used={budget.participation.used} limit={budget.participation.limit} text={`${count(budget.participation.used)} von ${count(budget.participation.limit)} Abrufversuchen`} />
        <BudgetMeter label={`Öffentliche Absendeversuche · ${budget.month}`} used={budget.submissions.used} limit={budget.submissions.limit} text={`${count(budget.submissions.used)} von ${count(budget.submissions.limit)} Absendeversuchen`} />
      </dl>
      <p>QA-Maschinenanschluss: {budget.qa.enabled ? 'aktiviert' : 'abgeschaltet'}. Die folgenden festen Pilotgrenzen gelten gemeinsam für alle Domains; Berichtsversuche zählen auch als Aufruf. Fehlgeschlagene Versuche werden nicht erstattet.</p>
      <dl className="media-budget-status__counts">
        {budget.qa.usage.flatMap(row => [
          <BudgetMeter key={`${row.scope}:requests`} label={row.scope === 'installation' ? 'QA-Aufrufe · gesamte Installation' : `QA-Aufrufe · Client ${row.scope}`} used={row.requests.used} limit={row.requests.limit} text={`${count(row.requests.used)} von ${count(row.requests.limit)} · ${budget.month}`} />,
          <BudgetMeter key={`${row.scope}:reports`} label={row.scope === 'installation' ? 'QA-Berichte · gesamte Installation' : `QA-Berichte · Client ${row.scope}`} used={row.reports.used} limit={row.reports.limit} text={`${count(row.reports.used)} von ${count(row.reports.limit)} · ${budget.month}`} />,
        ])}
      </dl>
      <p>Warnungen ab 80 % und bei Begrenzungen gehen an {budget.warnings.recipient || 'keinen konfigurierten Empfänger'}. Prüfung alle fünf Minuten. {budget.warnings.mailTotalLimit - budget.mail.limit} der {budget.warnings.mailTotalLimit} monatlichen Versandversuche bleiben für Betriebswarnungen reserviert.</p>
      {(!budget.warnings.configured || budget.warnings.stale) && <p role="alert">{!budget.warnings.configured ? 'Der automatische Warnversand ist nicht konfiguriert.' : 'Die automatische Kontingentprüfung wurde noch nicht ausgeführt oder ist seit über 15 Minuten überfällig.'} Bitte den Betrieb prüfen.</p>}
      {budget.warnings.checkedAt && <p>Letzte erfolgreiche Prüfung: {new Date(budget.warnings.checkedAt).toLocaleString('de-AT')}</p>}
      {budget.warnings.alerts.length > 0 && <ul>{budget.warnings.alerts.map((alert, index) => <li key={index}>
        {labels[alert.metric] || alert.metric}{alert.scope && ` · ${alert.scope === 'installation' ? 'gesamte Installation' : `Client ${alert.scope}`}`}: {alert.level === 'blocked' ? 'Vorgänge begrenzt' : 'Warnschwelle erreicht'} · {states[alert.status] || alert.status}
        {(alert.status === 'failed' || alert.status === 'uncertain' || (alert.status === 'pending' && budget.mail.used >= budget.warnings.mailTotalLimit)) && ' – bitte manuell prüfen.'}
      </li>)}</ul>}
      <p>Bei einer Bildgrenze bleiben Formulare und Einsendungen verfügbar. Ausgeschöpfte Monatsquoten erneuern sich im nächsten UTC-Monat; dauerhafte Reservierungen erfordern eine technische Prüfung. Grenzen werden nicht automatisch erhöht. Angenommene E-Mails bestätigen keine Zustellung im Posteingang.</p>
      <p>Bei einer Teilnahmegrenze pausieren nur die betroffenen öffentlichen Abrufe oder Absendeversuche. Das Backend und vorhandene Antworten bleiben erreichbar. Bei kurzen Ratenbegrenzungen können Teilnehmende nach einer Minute erneut versuchen.</p>
      <p>QA-Grenzen pausieren nur die betroffenen Maschinenaufrufe bzw. Berichte, nicht Feedbackteilnahme oder Ausbildungsnachweise. Diese App-Limits sind keine kontoweite Kostenobergrenze.</p>
      <p className="media-budget-status__hint">Lese- und Schreibversuche werden monatlich gezählt. Die Anzeige ist eine Momentaufnahme.</p>
    </>}
    <Button type="button" buttonStyle="secondary" size="small" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Aktualisieren</Button>
  </section>
}
