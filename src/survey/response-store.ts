import type { ParticipantContact, PrivacyReceipt, ErasureReason } from './privacy'
import type { Answers, Definition } from './types'
import { digest } from './privacy-crypto'
import { retentionReviewDueAt } from './retention-policy'

export type SQLValue = string | number | null
export type Statement = { sql: string; values: SQLValue[] }
type StoredResponse = { id: number; submission_digest: string | null; version: string; answers: string; privacy_receipt: string | null }
type StoredErasure = {
  response_key: string; survey_id: number; version: string; reason: ErasureReason
  erased_by_id: number; erased_at: string; retention_until: string
}
type BatchResult = { results: Record<string, unknown>[]; meta: { changes: number } }
type Prepared = { bind(...values: SQLValue[]): Prepared }
export type ResponseDatabase = { prepare(sql: string): Prepared; batch(statements: Prepared[]): Promise<BatchResult[]> }

export function responseDatabase(payload: { db: unknown }): ResponseDatabase {
  const client = (payload.db as { client?: ResponseDatabase }).client
  if (!client || typeof client.prepare !== 'function' || typeof client.batch !== 'function') {
    throw new Error('Atomare D1-Speicherung ist nicht verfügbar.')
  }
  return client
}

export async function runBatch(db: ResponseDatabase, statements: Statement[]) {
  return db.batch(statements.map(statement => db.prepare(statement.sql).bind(...statement.values)))
}

type ExportRow = {
  id: number; survey_id: number; version: string; test_only: number; created_at: string
  duration_seconds: number | null; answers: string; instrument: string; privacy_receipt: string | null
  contact_name: string | null; contact_email: string | null; contact_receipt: string | null; retention_review_due_at: string | null
}

export async function readResponseExport(db: ResponseDatabase, id: number, expectedKey: string) {
  // One joined read binds answers and contacts to the same immutable submission.
  // A separate contact lookup could disclose another person's data after ID reuse.
  const [result] = await runBatch(db, [{
    sql: `SELECT r.id, r.survey_id, r.version, r.test_only, r.created_at, r.duration_seconds,
      r.answers, r.instrument, r.privacy_receipt, r.retention_review_due_at, c.name AS contact_name,
      c.email AS contact_email, c.privacy_receipt AS contact_receipt
      FROM responses r LEFT JOIN response_contacts c ON c.response_id = r.id
      WHERE r.id = ? AND r.submission_key = ?`, values: [id, expectedKey],
  }])
  const row = result.results[0] as ExportRow | undefined
  if (!row) return undefined
  return {
    response: { id: row.id, survey: row.survey_id, version: row.version, testOnly: !!row.test_only,
      createdAt: row.created_at, durationSeconds: row.duration_seconds, answers: JSON.parse(row.answers),
      instrument: JSON.parse(row.instrument), privacyReceipt: row.privacy_receipt ? JSON.parse(row.privacy_receipt) : null,
      retentionReviewDueAt: row.retention_review_due_at },
    contact: row.contact_name ? { name: row.contact_name, email: row.contact_email,
      privacyReceipt: row.contact_receipt ? JSON.parse(row.contact_receipt) : null } : null,
  }
}

export type Submission = {
  key: string; erasureKey: string; surveyID: number; version: string; digest: string
  durationSeconds: number; answers: Answers; instrument: Definition
  receipt?: PrivacyReceipt; contact?: ParticipantContact; now: string
  notificationReference?: string; notificationRecipients?: string[]
  retentionYears?: number
}

export function submissionStatements(input: Submission): Statement[] {
  const statements: Statement[] = [{
    sql: `INSERT INTO responses
      (submission_key, survey_id, version, test_only, duration_seconds, answers, instrument,
       privacy_receipt, submission_digest, notification_reference, retention_review_due_at, created_at, updated_at)
      SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM surveys WHERE id = ? AND version = ? AND phase = 'pretest')
      AND NOT EXISTS (SELECT 1 FROM response_erasure_logs WHERE response_key = ?)
      ON CONFLICT (submission_key) DO NOTHING`,
    values: [input.key, input.surveyID, input.version, input.durationSeconds,
      JSON.stringify(input.answers), JSON.stringify(input.instrument),
      input.receipt ? JSON.stringify(input.receipt) : null, input.digest, input.notificationReference ?? null,
      retentionReviewDueAt(input.now, input.retentionYears ?? 0), input.now, input.now,
      input.surveyID, input.version, input.erasureKey],
  }]
  if (input.contact) statements.push({
    sql: `INSERT INTO response_contacts
      (response_id, name, email, test_only, privacy_receipt, created_at, updated_at)
      SELECT id, ?, ?, 1, ?, ?, ? FROM responses
      WHERE submission_key = ? AND submission_digest = ?
      AND NOT EXISTS (SELECT 1 FROM response_erasure_logs WHERE response_key = ?)
      ON CONFLICT (response_id) DO NOTHING`,
    values: [input.contact.name, input.contact.email, JSON.stringify(input.receipt), input.now, input.now,
      input.key, input.digest, input.erasureKey],
  })
  // Enqueue in the same transaction, only for this new immutable response.
  // A duplicate submission cannot notify newly added recipients retroactively.
  for (const recipient of input.notificationRecipients || []) statements.push({
    sql: `INSERT INTO response_notifications
      (response_id, survey_id, response_reference, recipient, status, attempts, next_attempt_at, created_at, updated_at)
      SELECT r.id, r.survey_id, r.notification_reference, ?, 'pending', 0, ?, ?, ?
      FROM responses r JOIN surveys s ON s.id = r.survey_id
      WHERE r.submission_key = ? AND r.submission_digest = ? AND r.notification_reference = ?
      AND s.notifications_enabled = 1
      AND instr(char(10) || coalesce(s.notifications_recipients, '') || char(10), char(10) || ? || char(10)) > 0
      ON CONFLICT (response_reference, recipient) DO NOTHING`,
    values: [recipient, input.now, input.now, input.now, input.key, input.digest, input.notificationReference ?? null, recipient],
  })
  statements.push({
    sql: 'SELECT id, submission_digest, version, answers, privacy_receipt FROM responses WHERE submission_key = ?', values: [input.key],
  }, {
    sql: 'SELECT response_key FROM response_erasure_logs WHERE response_key = ?', values: [input.erasureKey],
  })
  return statements
}

export async function saveSubmission(db: ResponseDatabase, input: Submission) {
  const result = await runBatch(db, submissionStatements({ ...input, notificationReference: input.notificationReference ?? crypto.randomUUID() }))
  const row = result[result.length - 2].results[0] as StoredResponse | undefined
  if (result[result.length - 1].results.length) return { state: 'erased' as const }
  if (!row) return { state: 'closed' as const }
  if (row.submission_digest !== input.digest) {
    // Pre-migration test answers have no digest. Accept only an unchanged retry
    // with the original answer payload and no newly attached privacy/contact data.
    let identicalLegacy = false
    if (row.submission_digest === null && row.privacy_receipt === null && !input.contact && !input.receipt) {
      try { identicalLegacy = digest({ version: row.version, answers: JSON.parse(row.answers) }) === input.digest }
      catch { /* Malformed legacy records fail closed. */ }
    }
    if (!identicalLegacy) return { state: 'conflict' as const }
  }
  return { state: 'saved' as const, id: row.id, duplicate: result[0].meta.changes === 0 }
}

export type Erasure = {
  id: number; key: string; erasureKey: string; expectedUpdatedAt: string; actorID: number
  reason: ErasureReason; now: string; retainUntil: string
}

export function erasureStatements(input: Erasure): Statement[] {
  return [{
    sql: `INSERT INTO response_erasure_logs
      (response_key, survey_id, version, reason, erased_by_id, erased_at, retention_until, created_at, updated_at)
      SELECT ?, survey_id, version, ?, ?, ?, ?, ?, ? FROM responses
      WHERE id = ? AND submission_key = ? AND updated_at = ?
      ON CONFLICT (response_key) DO NOTHING`,
    values: [input.erasureKey, input.reason, input.actorID, input.now, input.retainUntil,
      input.now, input.now, input.id, input.key, input.expectedUpdatedAt],
  }, {
    sql: `DELETE FROM response_notifications WHERE response_id = ?
      AND EXISTS (SELECT 1 FROM responses WHERE id = ? AND submission_key = ? AND updated_at = ?)
      AND EXISTS (SELECT 1 FROM response_erasure_logs WHERE response_key = ? AND erased_at = ?)`,
    values: [input.id, input.id, input.key, input.expectedUpdatedAt, input.erasureKey, input.now],
  }, {
    sql: `DELETE FROM response_contacts WHERE response_id = ?
      AND EXISTS (SELECT 1 FROM responses WHERE id = ? AND updated_at = ?)
      AND EXISTS (SELECT 1 FROM response_erasure_logs WHERE response_key = ? AND erased_at = ?)`,
    values: [input.id, input.id, input.expectedUpdatedAt, input.erasureKey, input.now],
  }, {
    sql: `DELETE FROM responses WHERE id = ? AND submission_key = ? AND updated_at = ?
      AND EXISTS (SELECT 1 FROM response_erasure_logs WHERE response_key = ? AND erased_at = ?)`,
    values: [input.id, input.key, input.expectedUpdatedAt, input.erasureKey, input.now],
  }, {
    sql: `SELECT response_key, survey_id, version, reason, erased_by_id, erased_at, retention_until
      FROM response_erasure_logs WHERE response_key = ? AND erased_at = ?`,
    values: [input.erasureKey, input.now],
  }]
}

export async function eraseResponse(db: ResponseDatabase, input: Erasure) {
  const result = await runBatch(db, erasureStatements(input))
  const receipt = result.at(-1)!.results[0] as StoredErasure | undefined
  if (!receipt || result.at(-2)!.meta.changes !== 1) return undefined
  return receipt
}
