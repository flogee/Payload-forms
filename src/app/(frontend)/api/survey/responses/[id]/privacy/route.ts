import { isTeamUser } from '@/auth/team'
import { getPayload } from 'payload'
import { z } from 'zod'
import config from '@payload-config'
import { erasureConfirmation, erasureReasonSchema } from '@/survey/privacy'
import { erasureKey } from '@/survey/privacy-crypto'
import { eraseResponse, readResponseExport, responseDatabase } from '@/survey/response-store'
import { surveyOriginStatus } from '@/survey/origins'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
const idSchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).refine(id => Number.isSafeInteger(id) && id <= 2147483647)
type Context = { params: Promise<{ id: string }> }

async function authorized(req: Request, context: Context) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!isTeamUser(user)) return { error: json({ error: 'Teamzugang erforderlich.' }, 401) }
  const parsed = idSchema.safeParse((await context.params).id)
  if (!parsed.success) return { error: json({ error: 'Ungültige Antwortkennung.' }, 400) }
  const response = await payload.findByID({ collection: 'responses', id: parsed.data, user, overrideAccess: false, depth: 0 }).catch((): null => null)
  if (!response) return { error: json({ error: 'Antwort nicht gefunden.' }, 404) }
  return { payload, user, response }
}

export async function GET(req: Request, context: Context) {
  const result = await authorized(req, context)
  if (result.error) return result.error
  const { payload, response } = result
  if (req.headers.get('x-expected-submission-key') !== response.submissionKey) return json({ error: 'Die gespeicherte Antwort erneut laden und ihre Kennung prüfen.' }, 412)
  const body = await readResponseExport(responseDatabase(payload), response.id, response.submissionKey)
  if (!body) return json({ error: 'Der Datensatz wurde inzwischen gelöscht. Bitte erneut prüfen.' }, 409)
  return new Response(JSON.stringify(body, null, 2), { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="antwort-${response.id}-auskunft.json"`, 'X-Content-Type-Options': 'nosniff',
  } })
}

const eraseSchema = z.object({
  confirmation: z.string().max(80), reason: erasureReasonSchema,
  expectedUpdatedAt: z.string().datetime(), expectedSubmissionKey: z.string().min(1).max(300), copiesReviewed: z.literal(true),
}).strict()

export async function POST(req: Request, context: Context) {
  const originStatus = surveyOriginStatus(req.headers.get('origin'), process.env)
  if (originStatus) return json({ error: originStatus === 503 ? 'Die Formularadresse ist noch nicht konfiguriert.' : 'Ungültiger Ursprung.' }, originStatus)
  const result = await authorized(req, context)
  if (result.error) return result.error
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON erforderlich.' }, 415)
  const body = await req.text()
  if (new TextEncoder().encode(body).length > 4096) return json({ error: 'Anfrage zu groß.' }, 413)
  let input: unknown
  try { input = JSON.parse(body) } catch { return json({ error: 'Ungültige Anfrage.' }, 400) }
  const parsed = eraseSchema.safeParse(input)
  if (!parsed.success) return json({ error: 'Löschgrund, Bestätigung und Prüfung der Kopien sind erforderlich.' }, 400)
  const { payload, user, response } = result
  if (parsed.data.confirmation !== erasureConfirmation(response.id)) return json({ error: 'Bitte die vollständige Bestätigung für genau diese Antwort eingeben.' }, 400)
  if (parsed.data.expectedUpdatedAt !== response.updatedAt || parsed.data.expectedSubmissionKey !== response.submissionKey) return json({ error: 'Der Datensatz wurde geändert. Bitte erneut prüfen.' }, 409)
  const now = new Date(), retainUntil = new Date(now.getTime() + 30 * 86400000)
  try {
    const receipt = await eraseResponse(responseDatabase(payload), {
      id: response.id, key: response.submissionKey, erasureKey: erasureKey(response.submissionKey, payload.secret),
      expectedUpdatedAt: parsed.data.expectedUpdatedAt, actorID: user.id, reason: parsed.data.reason,
      now: now.toISOString(), retainUntil: retainUntil.toISOString(),
    })
    if (!receipt) return json({ error: 'Der Datensatz wurde inzwischen geändert oder gelöscht. Bitte erneut prüfen.' }, 409)
    return json({ deleted: true, receipt, note: 'Antwort und Kontaktangaben sind aus der aktiven Datenbank entfernt. Exportierte Kopien und Sicherungen separat behandeln; Löschprotokoll für Wiederherstellungen getrennt sichern.' })
  } catch { return json({ error: 'Löschen fehlgeschlagen. Es wurden keine teilweise gelöschten Datensätze bestätigt.' }, 500) }
}
