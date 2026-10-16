import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { managesTeam } from '@/auth/team'
import { syncSettings, teamSnapshot } from '@/auth/team-sync'
import { responseDatabase, runBatch } from '@/survey/response-store'
import { surveyToolsOriginStatus } from '@/survey/survey-tools'
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
async function context(req: Request) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!managesTeam(user)) return null
  return { db: responseDatabase(payload), env: cloudflareEnvironment }
}
export async function GET(req: Request) {
  const ctx = await context(req)
  if (!ctx) return json({ error: 'Administration erforderlich.' }, 403)
  const settings = syncSettings(ctx.env), snapshot = await teamSnapshot(ctx.db), monitor = snapshot.monitor
  const synchronized = monitor?.status === 'synced' && monitor.desired_digest === snapshot.digest
  return json({ configured: !!settings?.token, enabled: !!settings, synchronized,
    status: synchronized ? 'synced' : monitor?.desired_digest === snapshot.digest ? monitor.status : 'pending',
    attempts: monitor?.desired_digest === snapshot.digest ? monitor.attempts : 0,
    checkedAt: monitor?.checked_at ?? null, syncedAt: monitor?.synced_at ?? null, error: monitor?.last_error ?? null,
    stale: !monitor?.checked_at || Date.now() - new Date(monitor.checked_at).getTime() > 4500000, count: snapshot.emails.length, limit: 40 })
}
export async function POST(req: Request) {
  const ctx = await context(req)
  if (!ctx) return json({ error: 'Administration erforderlich.' }, 403)
  const origin = surveyToolsOriginStatus(req, { ...ctx.env, ...process.env })
  if (origin) return json({ error: 'Ungültiger Ursprung.' }, origin)
  // This action only resets the bounded retry counter; the scheduled worker owns API writes.
  if (req.headers.get('content-length') !== '0') return json({ error: 'Diese Aktion erwartet keine Daten.' }, 400)
  await runBatch(ctx.db, [{ sql: "UPDATE team_access_monitor SET attempts = 0, checked_at = NULL, status = 'pending', last_error = NULL WHERE id = 1 AND lease_token IS NULL", values: [] }])
  return json({ queued: true })
}
