import { getPayload } from 'payload'
import config from '@payload-config'
import { duplicateSavedSurvey, readDuplicateRequest, SurveyToolError, surveyToolIDSchema, surveyToolsStaff, surveyToolsOriginStatus } from '@/survey/survey-tools'

const json = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const originStatus = surveyToolsOriginStatus(req, process.env)
  if (originStatus) return json({ error: originStatus === 503 ? 'Die Formularadresse ist noch nicht konfiguriert.' : 'Ungültiger Ursprung.' }, originStatus)
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!surveyToolsStaff(user)) return json({ error: 'Teamzugang erforderlich.' }, 401)
  const id = surveyToolIDSchema.safeParse((await params).id)
  if (!id.success) return json({ error: 'Ungültige Formularnummer.' }, 400)
  try {
    const requestID = await readDuplicateRequest(req)
    const { survey, reused } = await duplicateSavedSurvey(payload, user, id.data, requestID)
    return json({ id: survey.id, title: survey.title, version: survey.version, phase: survey.phase, reused,
      adminURL: `/admin/collections/surveys/${survey.id}` }, reused ? 200 : 201)
  } catch (error) {
    return json({ error: error instanceof SurveyToolError ? error.message : 'Die Kopie konnte nicht bestätigt werden. Bitte mit derselben Anfrage erneut versuchen.' },
      error instanceof SurveyToolError ? error.status : 500)
  }
}
