import { getPayload } from 'payload'
import config from '@payload-config'
import { responseDatabase } from '@/survey/response-store'
import { surveyToolsStaff } from '@/survey/survey-tools'
import { EvaluationRunError, runKeySchema } from '@/survey/evaluation-runs'
import { evaluationRunExport } from '@/survey/evaluation-run-export'

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
export async function GET(req: Request) {
  try {
    const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
    // This contains raw text, unlike the reduced machine/trainer report.
    // Report grants and service identities never authorize this route.
    if (!surveyToolsStaff(user)) return Response.json({ error: 'Menschlicher Teamzugang erforderlich.' }, { status: 401, headers })
    const query = new URL(req.url).searchParams
    const key = runKeySchema.safeParse(query.get('key'))
    if (!key.success || query.size !== 1) return Response.json({ error: 'Genau eine Durchlaufkennung erforderlich.' }, { status: 400, headers })
    const data = await evaluationRunExport(responseDatabase(payload), key.data)
    return Response.json(data, { headers: { ...headers, 'Content-Disposition': `attachment; filename="evaluation-run-${key.data}.json"` } })
  } catch (error) {
    return Response.json({ error: error instanceof EvaluationRunError ? error.message : 'Durchlauf-Export derzeit nicht verfügbar.' },
      { status: error instanceof EvaluationRunError ? error.status : 503, headers })
  }
}
