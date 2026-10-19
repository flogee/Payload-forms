import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { z } from 'zod'
import { fromStored } from '@/survey/storage'
import { validateAnswers } from '@/survey/validation'
import { surveyOriginStatus } from '@/survey/origins'
import { participantContact, participantContactSchema, privacyNotice, readPrivacySettings, type PrivacyReceipt } from '@/survey/privacy'
import { digest, erasureKey, privacyHash } from '@/survey/privacy-crypto'
import { saveSubmission, responseDatabase } from '@/survey/response-store'
import { mailPolicy, readNotificationSettings } from '@/survey/notifications'
import { boundedBody, BodyTooLarge } from '@/survey/bounded-body'
import { authorizedEvaluationRun, EvaluationRunError, runCredentialSchema } from '@/survey/evaluation-runs'
const requestSchema = z.object({
  surveyID: z.number().int().positive(), version: z.string().max(100), submissionID: z.string().uuid(),
  confirmTest: z.literal(true), durationSeconds: z.number().int().min(0).max(86400), answers: z.record(z.unknown()), website: z.literal('').optional(),
  privacy: z.object({ noticeHash: z.string().regex(/^[a-f0-9]{64}$/), consent: z.boolean(), contactConsent: z.boolean() }).strict().optional(),
  contact: participantContactSchema.optional(),
  evaluationRun: runCredentialSchema.optional(),
}).strict()
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(req: Request) {
  const originStatus = surveyOriginStatus(req.headers.get('origin'), process.env)
  if (originStatus) return json({ error: originStatus === 503 ? 'Die Formularadresse ist noch nicht konfiguriert.' : 'Ungültiger Ursprung.' }, originStatus)
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON erforderlich.' }, 415)
  let text: string
  try { text = await boundedBody(req) }
  catch (error) { return json({ error: error instanceof BodyTooLarge ? 'Antwort zu groß.' : 'Ungültige Anfrage.' }, error instanceof BodyTooLarge ? 413 : 400) }
  let body: unknown
  try { body = JSON.parse(text) } catch { return json({ error: 'Ungültige Anfrage.' }, 400) }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'Bitte nur Testdaten verwenden und die Testbestätigung aktivieren.' }, 400)
  const input = parsed.data, payload = await getPayload({ config })
  const survey = await payload.findByID({ collection: 'surveys', id: input.surveyID, depth: 0 }).catch((): null => null)
  if (!survey || survey.phase !== 'pretest') return json({ error: 'Diese Testbefragung ist geschlossen.' }, 403)
  if (survey.version !== input.version) return json({ error: 'Die Fragebogenfassung wurde geändert. Bitte lade die Seite neu.' }, 409)
  let run: Awaited<ReturnType<typeof authorizedEvaluationRun>> | undefined
  if (input.evaluationRun) {
    try {
      run = await authorizedEvaluationRun(responseDatabase(payload), input.evaluationRun, 'participate', payload.secret, new Date(), { allowExpiredReceipt: true })
      if (run.survey_id !== survey.id || run.version !== survey.version) throw new EvaluationRunError(404, 'Durchlauf nicht verfügbar.')
    } catch (error) { return json({ error: error instanceof EvaluationRunError ? error.message : 'Durchlauf derzeit nicht verfügbar.' }, error instanceof EvaluationRunError ? error.status : 503) }
  }
  const definition = fromStored(survey), validated = validateAnswers(definition, input.answers)
  if (Object.keys(validated.errors).length) return json({ error: 'Bitte die markierten Angaben prüfen.', fields: validated.errors }, 400)
  const settings = readPrivacySettings(survey.privacy), notice = privacyNotice(settings)
  if (settings.enabled && !notice) return json({ error: 'Die Datenschutzinformation ist noch nicht vollständig vorbereitet.' }, 503)
  if (!settings.enabled && (input.privacy || input.contact)) return json({ error: 'Für diesen Pretest sind keine Datenschutz- oder Kontaktangaben vorgesehen.' }, 400)
  let receipt: PrivacyReceipt | undefined, contact
  if (notice) {
    const hash = privacyHash(notice)
    if (!input.privacy || input.privacy.noticeHash !== hash) return json({ error: 'Die Datenschutzinformation wurde geändert. Bitte lade die Seite neu.' }, 409)
    if (notice.legalBasis === 'consent' && !input.privacy.consent) return json({ error: 'Bitte die Zustimmung zur Verarbeitung der Testantworten bestätigen.' }, 400)
    if (notice.legalBasis !== 'consent' && input.privacy.consent) return json({ error: 'Für diese Rechtsgrundlage ist keine Einwilligung zur Antwortverarbeitung vorgesehen.' }, 400)
    try { contact = participantContact(settings, input.privacy.contactConsent, input.contact, true) }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Kontaktangaben konnten nicht geprüft werden.' }, 400) }
    receipt = { notice, noticeHash: hash, recordedAt: new Date().toISOString(), consent: input.privacy.consent, contactConsent: input.privacy.contactConsent }
  }
  const submissionKey = `${survey.id}:${survey.version}:${run ? `${run.key}:` : ''}${input.submissionID}`
  const notifications = readNotificationSettings(survey.notifications)
  const mail = mailPolicy({ ...cloudflareEnvironment, ...process.env })
  try {
    const saved = await saveSubmission(responseDatabase(payload), {
      key: submissionKey, erasureKey: erasureKey(submissionKey, payload.secret), surveyID: survey.id, version: survey.version,
      digest: digest({ version: survey.version, evaluationRun: run?.key, answers: validated.answers,
        noticeHash: receipt?.noticeHash, consent: receipt?.consent, contactConsent: receipt?.contactConsent, contact }),
      durationSeconds: input.durationSeconds, answers: validated.answers, instrument: definition, receipt, contact,
      now: new Date().toISOString(),
      retentionYears: settings.enabled ? settings.retentionYears : 0,
      ...(run ? { evaluationRun: { id: run.id, key: run.key } } : {}),
      notificationRecipients: notifications.enabled && mail.configured ? notifications.recipients : [],
    })
    if (saved.state === 'erased') return json({ error: 'Diese Antwort wurde gelöscht. Ein erneuter Netzwerkversuch kann sie nicht wiederherstellen.' }, 410)
    if (saved.state === 'closed') return json({ error: 'Diese Testbefragung ist geschlossen.' }, 403)
    if (saved.state === 'conflict') return json({ error: 'Diese Einsendekennung wurde bereits für andere Angaben verwendet.' }, 409)
    return json({ saved: true, id: saved.id, ...(saved.duplicate ? { duplicate: true } : {}) }, saved.duplicate ? 200 : 201)
  } catch {
    return json({ error: 'Speichern fehlgeschlagen. Deine Angaben bleiben auf dieser Seite erhalten; bitte erneut versuchen.' }, 500)
  }
}
