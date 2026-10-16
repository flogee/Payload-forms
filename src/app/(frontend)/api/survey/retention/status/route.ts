import { isTeamUser } from '@/auth/team'
import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { mailPolicy } from '@/survey/notifications'
import { readPrivacySettings } from '@/survey/privacy'
import { retentionSummary } from '@/survey/retention-reminders'
import { responseDatabase } from '@/survey/response-store'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
export async function GET(req: Request) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!isTeamUser(user) || ('_strategy' in user && user._strategy === 'mcp-api-key')) return json({ error: 'Teamzugang erforderlich.' }, 401)
  const id = new URL(req.url).searchParams.get('surveyID')
  if (!id || !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return json({ error: 'Ungültige Fragebogenkennung.' }, 400)
  const survey = await payload.findByID({ collection: 'surveys', id: Number(id), user, overrideAccess: false, depth: 0,
    select: { retentionReminders: true, privacy: true } }).catch((): null => null)
  if (!survey) return json({ error: 'Fragebogen nicht gefunden.' }, 404)
  const policy = mailPolicy({ ...cloudflareEnvironment, ...process.env })
  const summary = await retentionSummary(responseDatabase(payload), survey.id)
  return json({ surveyID: survey.id, enabled: survey.retentionReminders?.enabled === true,
    retentionYears: readPrivacySettings(survey.privacy).retentionYears || null, recipient: policy.alertRecipient ?? null,
    configured: policy.configured && !!policy.alertRecipient, counts: summary.counts, checkedAt: summary.checkedAt,
    stale: summary.stale, latest: summary.latest,
    budget: { used: summary.used, limit: policy.limit, routineLimit: policy.routineLimit } })
}
