import { getPayload } from 'payload'
import config from '@payload-config'
import { responseDatabase } from '@/survey/response-store'
import { EvaluationRunError, evaluationRunReport } from '@/survey/evaluation-runs'
import { boundedBody, BodyTooLarge } from '@/survey/bounded-body'
import { surveyToolsOriginStatus } from '@/survey/survey-tools'

const json = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } })
export async function POST(req: Request) {
  const origin = surveyToolsOriginStatus(req, process.env)
  if (origin) return json({ error: 'Ungültiger oder nicht konfigurierter Ursprung.' }, origin)
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) return json({ error: 'JSON erforderlich.' }, 415)
  try {
    let input: unknown
    try { input = JSON.parse(await boundedBody(req, 512)) }
    catch (error) { return json({ error: 'Ungültige Anfrage.' }, error instanceof BodyTooLarge ? 413 : 400) }
    const payload = await getPayload({ config })
    return json(await evaluationRunReport(responseDatabase(payload), input, payload.secret))
  } catch (error) {
    return json({ error: error instanceof EvaluationRunError ? error.message : 'Auswertung derzeit nicht verfügbar. Es wird kein Ersatzbericht angezeigt.' },
      error instanceof EvaluationRunError ? error.status : 503)
  }
}
