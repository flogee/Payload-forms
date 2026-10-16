import { normalizeTeamEmail } from './team'
import { digest } from '../survey/privacy-crypto'
import { runBatch, type ResponseDatabase } from '../survey/response-store'

export type TeamSyncEnvironment = {
  ACCESS_SYNC_ENABLED?: string; ACCESS_SYNC_TOKEN?: string; ACCESS_ACCOUNT_ID?: string
  ACCESS_APP_ID?: string; ACCESS_POLICY_ID?: string; ACCESS_INITIAL_EMAILS?: string
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
// Only errors created here may appear in the administrative status. Provider
// bodies, credentials and unknown exception messages are never forwarded.
class SafeSyncError extends Error {}
export function syncSettings(env: TeamSyncEnvironment) {
  if (env.ACCESS_SYNC_ENABLED !== '1') return null
  if (!/^[a-f0-9]{32}$/.test(env.ACCESS_ACCOUNT_ID ?? '') || !uuid.test(env.ACCESS_APP_ID ?? '')
    || !uuid.test(env.ACCESS_POLICY_ID ?? '')) throw new Error('Teamabgleich ist unvollständig konfiguriert.')
  const initial = canonicalEmails((env.ACCESS_INITIAL_EMAILS ?? '').split(','))
  return { account: env.ACCESS_ACCOUNT_ID!, app: env.ACCESS_APP_ID!, policy: env.ACCESS_POLICY_ID!, token: env.ACCESS_SYNC_TOKEN?.trim(), initial }
}
export function canonicalEmails(values: unknown[]): string[] {
  const emails = values.map(normalizeTeamEmail)
  if (emails.some(email => !email)) throw new Error('Ungültige Teamadresse im Abgleich.')
  const unique = [...new Set(emails as string[])].sort()
  if (!unique.length || unique.length > 40) throw new Error('Der Abgleich benötigt 1 bis 40 aktive Teamadressen.')
  return unique
}
type Monitor = { desired_digest: string; synced_emails: string | null; attempted_emails: string | null; status: string; attempts: number;
  checked_at: string | null; synced_at: string | null; last_error: string | null; lease_until: string | null; lease_token: string | null }
export async function teamSnapshot(db: ResponseDatabase) {
  const [users, monitor] = await runBatch(db, [
    { sql: 'SELECT email FROM users WHERE enabled = 1 ORDER BY email LIMIT 41', values: [] },
    { sql: 'SELECT * FROM team_access_monitor WHERE id = 1', values: [] },
  ])
  const emails = canonicalEmails(users.results.map(row => row.email))
  return { emails, digest: await digest(JSON.stringify(emails)), monitor: monitor.results[0] as Monitor | undefined }
}
function policyEmails(policy: any) {
  if (policy?.app_count !== 1) throw new SafeSyncError('Access-Richtliniennutzung ist nicht als genau eine Anwendung bestätigt.')
  if (!policy || policy.decision !== 'allow' || !Array.isArray(policy.include) || !policy.include.length
    || (policy.require?.length ?? 0) || (policy.exclude?.length ?? 0) || policy.approval_required) throw new SafeSyncError('Access-Richtlinie enthält unerwartete Zugangseinstellungen.')
  const emails = policy.include.map((rule: any) => {
    if (!rule || Object.keys(rule).length !== 1 || !rule.email || Object.keys(rule.email).length !== 1) throw new SafeSyncError('Access-Richtlinie enthält ein unerwartetes Regelformat.')
    return rule.email.email
  })
  try { return canonicalEmails(emails) }
  catch { throw new SafeSyncError('Access-Richtlinie enthält keine gültige begrenzte E-Mail-Liste.') }
}
function same(a: string[], b: string[]) { return JSON.stringify(a) === JSON.stringify(b) }
export async function reconcileTeamAccess(db: ResponseDatabase, env: TeamSyncEnvironment, request: typeof fetch = fetch, now = new Date()) {
  const settings = syncSettings(env)
  if (!settings) return
  const snapshot = await teamSnapshot(db), stamp = now.toISOString()
  if (snapshot.monitor?.status === 'synced' && snapshot.monitor.desired_digest === snapshot.digest
    && snapshot.monitor.checked_at && new Date(snapshot.monitor.checked_at).getTime() > now.getTime() - 3600000) return
  // Clear abandoned leases, including the third attempt, so the admin retry can recover.
  await runBatch(db, [{ sql: `UPDATE team_access_monitor SET lease_token = NULL, lease_until = NULL,
    status = 'failed', last_error = 'Der Teamabgleich wurde unterbrochen. Bitte erneut vormerken.'
    WHERE id = 1 AND lease_until <= ?`, values: [stamp] }])
  const lease = crypto.randomUUID(), until = new Date(now.getTime() + 120000).toISOString(), cooldown = new Date(now.getTime() - 300000).toISOString()
  const [claimed] = await runBatch(db, [{ sql: `INSERT INTO team_access_monitor
      (id, desired_digest, status, attempts, checked_at, lease_token, lease_until) VALUES (1, ?, 'syncing', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET desired_digest = excluded.desired_digest, status = 'syncing',
        attempts = CASE WHEN desired_digest = excluded.desired_digest THEN attempts + 1 ELSE 1 END,
        checked_at = excluded.checked_at, lease_token = excluded.lease_token, lease_until = excluded.lease_until
      WHERE (lease_until IS NULL OR lease_until < ?)
        AND (desired_digest <> excluded.desired_digest OR (attempts < 3 AND (checked_at IS NULL OR checked_at <= ?)))
      RETURNING id`, values: [snapshot.digest, stamp, lease, until, stamp, cooldown] }])
  if (!claimed.results.length) return
  const base = `https://api.cloudflare.com/client/v4/accounts/${settings.account}/access`
  async function api(path: string, method = 'GET', body?: unknown) {
    let response: Response
    try {
      response = await request(`${base}${path}`, { method, headers: { Authorization: `Bearer ${settings!.token}`, 'Content-Type': 'application/json' },
        // Workers reject redirect:'error' before sending a request. Manual mode
        // never forwards credentials; the non-2xx check below rejects redirects.
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'manual' })
    } catch (error) {
      throw new SafeSyncError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'Cloudflare-Abgleich hat das Zeitlimit erreicht.' : 'Cloudflare-Abgleich konnte keine Verbindung aufbauen.')
    }
    if (!response.ok) throw new SafeSyncError(`Cloudflare-Abgleich fehlgeschlagen (HTTP ${response.status}).`)
    let text: string
    try { text = await response.text() }
    catch { throw new SafeSyncError('Cloudflare-Antwort konnte nicht vollständig gelesen werden.') }
    if (text.length > 65536) throw new SafeSyncError('Cloudflare-Antwort überschreitet die Abgleichgrenze.')
    let result: any
    try { result = JSON.parse(text) }
    catch { throw new SafeSyncError('Cloudflare-Antwort enthält ungültige Abgleichdaten.') }
    if (!result?.success || result.result_info?.total_pages > 1) throw new SafeSyncError('Cloudflare-Abgleich konnte nicht vollständig bestätigt werden.')
    return result.result
  }
  try {
    if (!settings.token) throw new SafeSyncError('Der eingeschränkte Access-Abgleichschlüssel fehlt.')
    if (settings.token.length > 256 || !/^[A-Za-z0-9_.-]+$/.test(settings.token)) throw new SafeSyncError('Der eingeschränkte Access-Abgleichschlüssel hat ein ungültiges Format.')
    const assigned = await api(`/apps/${settings.app}/policies?per_page=100`)
    if (!Array.isArray(assigned) || assigned.length !== 1 || assigned[0].id !== settings.policy) throw new SafeSyncError('Die Anwendung verwendet eine unerwartete Richtlinienzuordnung.')
    const policy = await api(`/policies/${settings.policy}`), current = policyEmails(policy)
    const previous = snapshot.monitor?.synced_emails ? canonicalEmails(JSON.parse(snapshot.monitor.synced_emails)) : settings.initial
    const attempted = snapshot.monitor?.attempted_emails ? canonicalEmails(JSON.parse(snapshot.monitor.attempted_emails)) : []
    if (!same(current, snapshot.emails) && !same(current, previous) && !same(current, attempted)) throw new SafeSyncError('Access wurde außerhalb der Teamverwaltung geändert. Abgleich prüfen.')
    if (!same(current, snapshot.emails)) {
      const body = { name: 'Payload Forms – Teamzugänge', decision: 'allow', include: snapshot.emails.map(email => ({ email: { email } })),
        require: [] as unknown[], exclude: [] as unknown[], session_duration: policy.session_duration, approval_required: false }
      // Keep evidence before a side effect; a lost confirmation must be recoverable.
      await runBatch(db, [{ sql: 'UPDATE team_access_monitor SET attempted_emails = ? WHERE id = 1 AND lease_token = ?', values: [JSON.stringify(snapshot.emails), lease] }])
      await api(`/policies/${settings.policy}`, 'PUT', body)
      if (!same(policyEmails(await api(`/policies/${settings.policy}`)), snapshot.emails)) throw new SafeSyncError('Die neue Access-Freigabe ist nicht bestätigt.')
    }
    await runBatch(db, [{ sql: `UPDATE team_access_monitor SET status = 'synced', attempts = 0, attempted_emails = NULL, synced_emails = ?, synced_at = ?,
      last_error = NULL, lease_token = NULL, lease_until = NULL WHERE id = 1 AND lease_token = ?`, values: [JSON.stringify(snapshot.emails), stamp, lease] }])
  } catch (error) {
    const message = error instanceof SafeSyncError
      ? error.message : 'Der Teamabgleich ist fehlgeschlagen. Bitte den Zugangsschlüssel und die Access-Konfiguration prüfen.'
    await runBatch(db, [{ sql: `UPDATE team_access_monitor SET status = 'failed', last_error = ?, lease_token = NULL,
      lease_until = NULL WHERE id = 1 AND lease_token = ?`, values: [message, lease] }])
  }
}
