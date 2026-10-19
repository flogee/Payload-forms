import { EvaluationRunError, runKeySchema } from './evaluation-runs'
import { runBatch, type ResponseDatabase } from './response-store'
import { definitionSchema, validateAnswers } from './validation'
import { digest } from './privacy-crypto'
import type { Answers, Definition } from './types'

export const RUN_EXPORT_LIMITS = Object.freeze({ responses: 1000, answerBytes: 2 * 1024 * 1024, documentBytes: 4 * 1024 * 1024 })
// The bounded selection is shared by the statistics and data queries. Both
// execute with Run metadata in one D1 transaction, never a mixed-time export.
const selected = `SELECT r.id, r.survey_id, r.version, r.test_only, r.created_at, r.duration_seconds, r.answers
  FROM responses r WHERE r.evaluation_run_id = (SELECT id FROM evaluation_runs WHERE key = ?)
  ORDER BY r.id LIMIT ${RUN_EXPORT_LIMITS.responses + 1}`
const stats = 'SELECT count(*) AS total, coalesce(sum(length(CAST(answers AS BLOB))), 0) AS answer_bytes FROM selected'
const invalid = () => new EvaluationRunError(503, 'Durchlauf-Export derzeit nicht vollständig verfügbar. Kein Ersatzexport erzeugt.')
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647
const stamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)

/** Human-team raw-answer extract, NOT a backup/import or a machine report.
 * No contacts, submission/grant credentials, secrets, notification jobs or
 * educational records are selected. Join SZ context by Run key + contextRef.
 */
export async function evaluationRunExport(db: ResponseDatabase, key: string, now = new Date()) {
  const parsed = runKeySchema.safeParse(key)
  if (!parsed.success) throw new EvaluationRunError(400, 'Ungültige Durchlaufkennung.')
  try {
    const [metadata, counts, data] = await runBatch(db, [
      { sql: `SELECT id, key, context_ref, survey_id, version, status, expires_at, integration_client, created_at,
        CASE WHEN length(CAST(instrument AS BLOB)) <= 256000 THEN instrument ELSE NULL END AS instrument
        FROM evaluation_runs WHERE key = ?`, values: [parsed.data] },
      { sql: `WITH selected AS (${selected}) ${stats}`, values: [parsed.data] },
      // SQL checks limits BEFORE returning any large answer bodies to Worker
      // memory. A too-large run is rejected, not truncated or paged silently.
      { sql: `WITH selected AS (${selected}), stats AS (${stats}) SELECT * FROM selected
        WHERE (SELECT total <= ? AND answer_bytes <= ? FROM stats) ORDER BY id`,
        values: [parsed.data, RUN_EXPORT_LIMITS.responses, RUN_EXPORT_LIMITS.answerBytes] },
    ])
    const run = metadata.results[0]
    if (!run) throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
    if (!id(run.id) || !id(run.survey_id) || run.key !== parsed.data || !runKeySchema.safeParse(run.context_ref).success
      || !['open', 'closed'].includes(String(run.status)) || !stamp(run.created_at) || !stamp(run.expires_at)
      || (run.integration_client != null && !runKeySchema.safeParse(run.integration_client).success)
      || typeof run.instrument !== 'string') throw invalid()
    const count = counts.results[0]
    if (!count || !Number.isSafeInteger(count.total) || !Number.isSafeInteger(count.answer_bytes)
      || Number(count.total) < 0 || Number(count.answer_bytes) < 0) throw invalid()
    if (Number(count.total) > RUN_EXPORT_LIMITS.responses || Number(count.answer_bytes) > RUN_EXPORT_LIMITS.answerBytes) {
      throw new EvaluationRunError(422, 'Durchlauf zu groß für den begrenzten Export. Kein Teilexport erzeugt.')
    }
    if (data.results.length !== count.total) throw invalid()
    const definition = JSON.parse(run.instrument) as Definition
    if (!definitionSchema.safeParse(definition).success || definition.version !== run.version) throw invalid()
    const responses = data.results.map(row => {
      if (!id(row.id) || row.survey_id !== run.survey_id || row.version !== run.version || row.test_only !== 1
        || !stamp(row.created_at) || (row.duration_seconds !== null && (!Number.isSafeInteger(row.duration_seconds) || Number(row.duration_seconds) < 0))
        || typeof row.answers !== 'string') throw invalid()
      const answers = JSON.parse(row.answers) as Answers
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw invalid()
      const checked = validateAnswers(definition, answers)
      // Reuse the frozen instrument's rules but export the original values.
      // Never drop unknown/hidden keys or turn overflow numbers into JSON null.
      if (Object.keys(checked.errors).length || digest(checked.answers) !== digest(answers)) throw invalid()
      return { sourceResponseID: row.id, version: row.version, submittedAt: row.created_at,
        durationSeconds: row.duration_seconds, answers }
    })
    const document = { format: 'evaluation-run-export' as const, formatVersion: 1 as const,
      exportedAt: now.toISOString(), dataset: 'fictional-pretest' as const, containsRawAnswers: true,
      purpose: 'portable-answer-extract-not-a-backup' as const,
      run: { key: run.key as string, contextRef: run.context_ref as string, version: run.version as string,
        state: run.status as 'open' | 'closed', createdAt: run.created_at, expiresAt: run.expires_at,
        integrationClient: (run.integration_client ?? null) as string | null,
        sourceRunID: run.id, sourceSurveyID: run.survey_id },
      questionnaire: { version: definition.version, definition }, responses,
      excludes: ['contacts', 'privacyReceipts', 'credentials', 'mediaFiles', 'operationalState', 'educationalRecords'],
    }
    const exported = { ...document, integrity: { algorithm: 'SHA-256/canonical-JSON' as const, digest: digest(document) } }
    if (new TextEncoder().encode(JSON.stringify(exported)).byteLength > RUN_EXPORT_LIMITS.documentBytes) throw new EvaluationRunError(422, 'Durchlauf-Export zu groß. Kein Teilexport erzeugt.')
    return exported
  } catch (error) {
    if (error instanceof EvaluationRunError) throw error
    throw invalid()
  }
}
