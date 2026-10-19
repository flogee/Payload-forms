import type { JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { authenticateQAMachine, QAMachineError, type QAMachineEnvironment } from '../auth/qa-machine'
import { boundedBody, BodyTooLarge } from './bounded-body'
import { createRunSchema, ensureEvaluationRun, findEvaluationRun, evaluationRunGrant, evaluationRunOpen,
  evaluationRunReport, EvaluationRunError, runKeySchema } from './evaluation-runs'
import type { ResponseDatabase } from './response-store'
import type { Definition } from './types'
import { validSurveySlug } from './sharing'
import { reserveQAMachineRequest, recordQAMachineRateBlock } from './qa-machine-budget'

const requestSchema = z.discriminatedUnion('action', [
  createRunSchema.extend({ action: z.literal('ensure') }),
  z.object({ action: z.literal('participation'), key: runKeySchema }).strict(),
  z.object({ action: z.literal('report'), key: runKeySchema }).strict(),
])
export type QAMachineContext = {
  db: ResponseDatabase; secret: string
  loadInstrument(id: number): Promise<{ id: number; slug: string; phase: string; definition: Definition } | null>
}
const json = (body: unknown, status = 200, retryAfter?: number) => Response.json(body, { status,
  headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } })

export async function handleQAMachineRequest(request: Request, env: QAMachineEnvironment,
  context: () => Promise<QAMachineContext>, testKey?: JWTVerifyGetKey): Promise<Response> {
  try {
    // Authenticate before creating a Payload context or reading application data.
    const client = await authenticateQAMachine(request, env, testKey)
    if (!env.D1 || !env.PUBLIC_IP_RATE?.limit || !env.PUBLIC_TOTAL_RATE?.limit) throw new QAMachineError(503, 'QA-Kontingentprüfung ist nicht eingerichtet.')
    // Reuse the installation's checked rate bindings with independent keys.
    // These approximate per-location limits do not replace atomic D1 budgets.
    if (!(await env.PUBLIC_IP_RATE.limit({ key: `payload-forms:qa:client:${client.key}` })).success ||
      !(await env.PUBLIC_TOTAL_RATE.limit({ key: 'payload-forms:qa:all' })).success) {
      await recordQAMachineRateBlock(env.D1, client.key)
      throw new QAMachineError(429, 'Zu viele QA-Anfragen. Bitte eine Minute warten.', 60)
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'JSON erforderlich.' }, 415)
    let raw: unknown
    try { raw = JSON.parse(await boundedBody(request, 4096)) }
    catch (error) { return json({ error: 'Ungültige Anfrage.' }, error instanceof BodyTooLarge ? 413 : 400) }
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) return json({ error: 'Ungültiger QA-Befehl.' }, 400)
    const input = parsed.data
    if (input.action === 'ensure' && !client.surveyVersions.includes(input.version)) return json({ error: 'Fassung nicht freigegeben.' }, 403)
    if (!await reserveQAMachineRequest(env.D1, client.key, input.action === 'report')) {
      throw new QAMachineError(429, 'QA-Monatskontingent erreicht. Formularverwaltung kontaktieren; keine automatische Erhöhung.')
    }
    const { db, secret, loadInstrument } = await context()
    if (input.action === 'ensure') {
      const instrument = await loadInstrument(input.surveyID)
      if (!instrument || instrument.id !== input.surveyID || instrument.phase !== 'pretest' || instrument.definition.version !== input.version) return json({ error: 'Fassung nicht verfügbar.' }, 404)
      const { action: _action, ...binding } = input
      const { run, reused } = await ensureEvaluationRun(db, binding, instrument.definition, new Date(), { integrationClient: client.key })
      return json({ format: 'qa-run', formatVersion: 1, key: run.key, contextRef: run.context_ref,
        surveyID: run.survey_id, version: run.version, state: run.status, expiresAt: run.expires_at, reused }, reused ? 200 : 201)
    }
    const run = await findEvaluationRun(db, input.key)
    if (run.integration_client !== client.key || !client.surveyVersions.includes(run.version)) return json({ error: 'Durchlauf nicht verfügbar.' }, 404)
    if (input.action === 'report') {
      // No report credential or raw response reaches the calling browser.
      return json(await evaluationRunReport(db, { key: run.key, token: evaluationRunGrant(run, 'report', secret) }, secret))
    }
    const instrument = await loadInstrument(run.survey_id)
    if (!instrument || instrument.id !== run.survey_id || instrument.phase !== 'pretest' || instrument.definition.version !== run.version || !validSurveySlug(instrument.slug)
      || !evaluationRunOpen(run)) return json({ error: 'Teilnahme derzeit nicht verfügbar.' }, 409)
    return json({ format: 'qa-participation', formatVersion: 1, key: run.key, contextRef: run.context_ref,
      version: run.version, state: run.status, expiresAt: run.expires_at,
      participationPath: `/f/${encodeURIComponent(instrument.slug)}?run=${run.key}&access=${evaluationRunGrant(run, 'participate', secret)}` })
  } catch (error) {
    const known = error instanceof QAMachineError || error instanceof EvaluationRunError
    return json({ error: known ? error.message : 'QA derzeit nicht verfügbar. Kein Ersatzdatensatz wurde erzeugt.' }, known ? error.status : 503,
      error instanceof QAMachineError ? error.retryAfter : undefined)
  }
}
