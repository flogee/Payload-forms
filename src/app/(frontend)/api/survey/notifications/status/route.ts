import { isTeamUser } from '@/auth/team'
import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { mailPolicy, readNotificationSettings } from '@/survey/notifications'
import { notificationSummary } from '@/survey/notification-store'
import { responseDatabase } from '@/survey/response-store'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
export async function GET(req: Request) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!isTeamUser(user)) return json({ error: 'Teamzugang erforderlich.' }, 401)
  const id = new URL(req.url).searchParams.get('surveyID')
  if (!id || !/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return json({ error: 'Ungültige Fragebogenkennung.' }, 400)
  const survey = await payload.findByID({ collection: 'surveys', id: Number(id), user, overrideAccess: false, depth: 0,
    select: { notifications: true } }).catch((): null => null)
  if (!survey) return json({ error: 'Fragebogen nicht gefunden.' }, 404)
  const settings = readNotificationSettings(survey.notifications)
  const policy = mailPolicy({ ...cloudflareEnvironment, ...process.env })
  const summary = await notificationSummary(responseDatabase(payload), survey.id, new Date().toISOString())
  return json({ surveyID: survey.id, ...settings, configured: policy.configured, sender: policy.sender,
    allowedRecipients: policy.allowedRecipients, counts: summary.counts, budget: { limit: policy.limit, routineLimit: policy.routineLimit, used: summary.used },
    deliveryLogURL: `/admin/collections/response-notifications?where[survey][equals]=${survey.id}` })
}
