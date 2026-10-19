import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { analyze, ANALYSIS_LIMIT, forSharing } from './analysis'
import { canonicalJSON } from './privacy-crypto'
import { runBatch, type ResponseDatabase } from './response-store'
import type { Answers, Definition } from './types'

export class EvaluationRunError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const runKeySchema = z.string().uuid().transform(value => value.toLowerCase())
export const runCredentialSchema = z.object({ key: runKeySchema, token: z.string().max(100).regex(/^\d{10}\.[a-f0-9]{64}$/) }).strict()
export const createRunSchema = z.object({
  key: runKeySchema, contextRef: runKeySchema,
  surveyID: z.number().int().positive().max(2147483647), version: z.string().min(1).max(100),
  expiresAt: z.string().datetime().transform(value => new Date(value).toISOString()),
}).strict()
type CreateRun = z.infer<typeof createRunSchema>
export type EvaluationRun = {
  id: number; key: string; context_ref: string; survey_id: number; version: string
  instrument: string; status: 'open' | 'closed'; expires_at: string; integration_client?: string | null
}
const columns = 'id, key, context_ref, survey_id, version, instrument, status, expires_at, integration_client'

export async function findEvaluationRun(db: ResponseDatabase, key: string): Promise<EvaluationRun> {
  const parsed = runKeySchema.safeParse(key)
  if (!parsed.success) throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
  const [found] = await runBatch(db, [{ sql: `SELECT ${columns} FROM evaluation_runs WHERE key = ?`, values: [parsed.data] }])
  const row = found.results[0] as EvaluationRun | undefined
  if (!row) throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
  return row
}

// Same key + same binding recovers even when the first committed response was
// lost. Never reopen a closed run or silently rebind one to another context.
export async function ensureEvaluationRun(db: ResponseDatabase, raw: unknown, definition: Definition, now = new Date(), owner: { integrationClient?: string } = {}) {
  const parsed = createRunSchema.safeParse(raw)
  if (!parsed.success || definition.version !== parsed.data.version) throw new EvaluationRunError(400, 'Ungültige Durchlaufzuordnung.')
  const input: CreateRun = parsed.data
  const integrationClient = owner.integrationClient === undefined ? null : runKeySchema.parse(owner.integrationClient)
  const [inserted, found] = await runBatch(db, [{
    sql: `INSERT INTO evaluation_runs (key, context_ref, survey_id, version, instrument, status, expires_at, created_at, updated_at, integration_client)
      SELECT ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM surveys WHERE id = ? AND version = ? AND phase = 'pretest')
      AND julianday(?) > julianday(?) AND julianday(?) <= julianday(?, '+90 days')
      ON CONFLICT (key) DO NOTHING`,
    values: [input.key, input.contextRef, input.surveyID, input.version, canonicalJSON(definition), input.expiresAt,
      now.toISOString(), now.toISOString(), integrationClient, input.surveyID, input.version,
      input.expiresAt, now.toISOString(), input.expiresAt, now.toISOString()],
  }, { sql: `SELECT ${columns} FROM evaluation_runs WHERE key = ?`, values: [input.key] }])
  const run = found.results[0] as EvaluationRun | undefined
  if (!run) throw new EvaluationRunError(409, 'Nur gespeicherte Pretests mit einer Frist innerhalb der nächsten 90 Tage sind zulässig.')
  if (run.context_ref !== input.contextRef || run.survey_id !== input.surveyID || run.version !== input.version
    || run.expires_at !== input.expiresAt || run.instrument !== canonicalJSON(definition)
    || (run.integration_client ?? null) !== integrationClient) {
    throw new EvaluationRunError(409, 'Diese Durchlaufkennung ist bereits anders gebunden.')
  }
  return { run, reused: inserted.meta.changes === 0 }
}

export async function closeEvaluationRun(db: ResponseDatabase, key: string, now = new Date()) {
  runKeySchema.parse(key)
  const [, found] = await runBatch(db, [{
    sql: "UPDATE evaluation_runs SET status = 'closed', updated_at = ? WHERE key = ? AND status = 'open'",
    values: [now.toISOString(), key],
  }, { sql: `SELECT ${columns} FROM evaluation_runs WHERE key = ?`, values: [key] }])
  if (!found.results.length) throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
  return found.results[0] as EvaluationRun
}

type RunScope = 'participate' | 'report'
function signature(run: EvaluationRun, scope: RunScope, expires: number, secret: string) {
  if (secret.length < 32) throw new Error('Dauerhaftes Anwendungsgeheimnis erforderlich.')
  return createHmac('sha256', secret).update(canonicalJSON({ format: 'evaluation-run-v1',
    key: run.key, context: run.context_ref, survey: run.survey_id, version: run.version,
    scope, expires, closes: run.expires_at, client: run.integration_client ?? undefined })).digest('hex')
}
export function evaluationRunGrant(run: EvaluationRun, scope: RunScope, secret: string, now = new Date()) {
  // Report grants are short-lived and sent in a POST body, never a public URL.
  // Participation is a forwardable group link, NOT a learner identity proof.
  const expiry = scope === 'report' ? Math.floor((now.getTime() + 15 * 60_000) / 1000)
    : Math.ceil(Date.parse(run.expires_at) / 1000)
  return `${expiry}.${signature(run, scope, expiry, secret)}`
}
export async function authorizedEvaluationRun(db: ResponseDatabase, raw: unknown, scope: RunScope, secret: string, now = new Date(), options: { allowExpiredReceipt?: true } = {}) {
  const credential = runCredentialSchema.safeParse(raw)
  if (!credential.success) throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
  const run = await findEvaluationRun(db, credential.data.key)
  const [expiryText, mac] = credential.data.token.split('.')
  const expiry = Number(expiryText)
  // Only submission receipt recovery may accept an authentic expired group
  // grant, and only after the run itself expired. The transactional insert
  // guard still forbids every new response. Page/report access stays expired.
  const receiptOnly = options.allowExpiredReceipt && scope === 'participate' && Date.parse(run.expires_at) <= now.getTime()
  if ((expiry <= Math.floor(now.getTime() / 1000) && !receiptOnly)
    || !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(run, scope, expiry, secret), 'hex'))) {
    throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
  }
  return run
}

export function evaluationRunOpen(run: EvaluationRun, now = new Date()) {
  return run.status === 'open' && Date.parse(run.expires_at) > now.getTime()
}

export async function evaluationRunReport(db: ResponseDatabase, credential: unknown, secret: string, now = new Date()) {
  const run = await authorizedEvaluationRun(db, credential, 'report', secret, now)
  // No dates, arbitrary filters, raw response IDs, contacts or free text.
  const [rows] = await runBatch(db, [{
    sql: `SELECT answers, created_at FROM responses WHERE evaluation_run_id = ? AND survey_id = ?
      AND version = ? AND test_only = 1 ORDER BY id LIMIT ?`,
    values: [run.id, run.survey_id, run.version, ANALYSIS_LIMIT + 1],
  }])
  if (rows.results.length > ANALYSIS_LIMIT) throw new EvaluationRunError(422, 'Mehr als 1.000 Testantworten: keine Teilauswertung.')
  const definition = JSON.parse(run.instrument) as Definition
  const report = analyze(definition, rows.results.map(row => ({ answers: JSON.parse(String(row.answers)) as Answers, createdAt: String(row.created_at) })),
    { id: run.survey_id, title: 'Durchlauf-Auswertung', slug: 'evaluation-run', version: run.version, phase: 'pretest' }, now)
  return { format: 'evaluation-run-report', formatVersion: 1, runKey: run.key, contextRef: run.context_ref,
    state: run.status, expiresAt: run.expires_at, report: forSharing(report) }
}
