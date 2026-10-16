import { getPayload } from 'payload'
import config from '@payload-config'
import { questionnaireExport, questionnaireMarkdown, surveyToolIDSchema, surveyToolsStaff } from '@/survey/survey-tools'

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const json = (body: unknown, status: number) => Response.json(body, { status, headers })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!surveyToolsStaff(user)) return json({ error: 'Teamzugang erforderlich.' }, 401)
  const id = surveyToolIDSchema.safeParse((await params).id)
  if (!id.success) return json({ error: 'Ungültige Formularnummer.' }, 400)
  const format = new URL(req.url).searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'markdown') return json({ error: 'Bitte JSON oder Markdown wählen.' }, 400)
  try {
    const source = await payload.findByID({ collection: 'surveys', id: id.data, user, overrideAccess: false, depth: 0 }).catch((error: unknown): null => {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null
      throw error
    })
    if (!source) return json({ error: 'Fragebogen nicht gefunden.' }, 404)
    const body = format === 'json' ? JSON.stringify(questionnaireExport(source), null, 2) : questionnaireMarkdown(source)
    return new Response(body, { headers: { ...headers,
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="fragebogen-${source.id}.${format === 'json' ? 'json' : 'md'}"`,
    } })
  } catch { return json({ error: 'Die gespeicherte Fragebogenfassung konnte nicht geladen werden.' }, 500) }
}
