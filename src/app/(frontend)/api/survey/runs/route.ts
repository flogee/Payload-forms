import { getPayload } from 'payload'
import config from '@payload-config'
import { fromStored } from '@/survey/storage'
import { responseDatabase } from '@/survey/response-store'
import { surveyToolsOriginStatus, surveyToolsStaff } from '@/survey/survey-tools'
import { boundedBody, BodyTooLarge } from '@/survey/bounded-body'
import { EvaluationRunError, closeEvaluationRun, ensureEvaluationRun, evaluationRunGrant,
  evaluationRunOpen, findEvaluationRun, runKeySchema, type EvaluationRun } from '@/survey/evaluation-runs'
import { z } from 'zod'

const json = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } })
const closeSchema = z.object({ key: runKeySchema }).strict()
function details(run: EvaluationRun, secret: string, slug?: string) {
  return { key: run.key, contextRef: run.context_ref, surveyID: run.survey_id, version: run.version,
    state: run.status, expiresAt: run.expires_at,
    participationPath: slug && evaluationRunOpen(run)
      ? `/f/${encodeURIComponent(slug)}?run=${run.key}&access=${evaluationRunGrant(run, 'participate', secret)}` : null,
    reportCredential: { key: run.key, token: evaluationRunGrant(run, 'report', secret) },
    reportURL: '/api/survey/runs/report' }
}
function failure(error: unknown) {
  return json({ error: error instanceof EvaluationRunError ? error.message : 'Durchlauf konnte nicht bestätigt werden. Mit derselben Anfrage erneut versuchen.' },
    error instanceof EvaluationRunError ? error.status : 500)
}
async function body(req: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new EvaluationRunError(415, 'JSON erforderlich.')
  try { return JSON.parse(await boundedBody(req, 2048)) }
  catch (error) { throw new EvaluationRunError(error instanceof BodyTooLarge ? 413 : 400, 'Ungültige Anfrage.') }
}
async function authorized(req: Request, write: boolean) {
  if (write) {
    const status = surveyToolsOriginStatus(req, process.env)
    if (status) throw new EvaluationRunError(status, 'Ungültiger oder nicht konfigurierter Ursprung.')
  }
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!surveyToolsStaff(user)) throw new EvaluationRunError(401, 'Teamzugang erforderlich.')
  return { payload, user, db: responseDatabase(payload) }
}
export async function POST(req: Request) {
  try {
    const { payload, user, db } = await authorized(req, true)
    const input = await body(req)
    const id = z.number().int().positive().max(2147483647).safeParse(input?.surveyID)
    if (!id.success) throw new EvaluationRunError(400, 'Ungültige Formularnummer.')
    const survey = await payload.findByID({ collection: 'surveys', id: id.data, user, overrideAccess: false, depth: 0 })
    const { run, reused } = await ensureEvaluationRun(db, input, fromStored(survey))
    return json({ ...details(run, payload.secret, survey.slug), reused }, reused ? 200 : 201)
  } catch (error) { return failure(error) }
}
export async function PATCH(req: Request) {
  try {
    const { payload, db } = await authorized(req, true)
    const parsed = closeSchema.safeParse(await body(req))
    if (!parsed.success) throw new EvaluationRunError(400, 'Ungültige Durchlaufkennung.')
    return json(details(await closeEvaluationRun(db, parsed.data.key), payload.secret))
  } catch (error) { return failure(error) }
}
export async function GET(req: Request) {
  try {
    const { payload, user, db } = await authorized(req, false)
    const run = await findEvaluationRun(db, new URL(req.url).searchParams.get('key') ?? '')
    const survey = await payload.findByID({ collection: 'surveys', id: run.survey_id, user, overrideAccess: false, depth: 0 })
    return json(details(run, payload.secret, survey.phase === 'pretest' ? survey.slug : undefined))
  } catch (error) { return failure(error) }
}
