import { participationMode } from '@/survey/participation'
import { isTeamUser } from '@/auth/team'
import { getPayload } from 'payload'
import config from '@payload-config'
import { participationLinks } from '@/survey/sharing'
import { participationQR } from '@/survey/qr'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!isTeamUser(user)) return json({ error: 'Teamzugang erforderlich.' }, 401)
  const { id } = await params
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return json({ error: 'Ungültige Formularnummer.' }, 400)
  const survey = await payload.findByID({ collection: 'surveys', id: Number(id), user, overrideAccess: false, depth: 0,
    select: { title: true, slug: true, phase: true, privacy: true } }).catch((error: unknown): null => {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null
    throw error
  })
  if (!survey) return json({ error: 'Formular nicht gefunden.' }, 404)
  if (!participationMode(survey)) return json({ error: 'Teilnahmelinks sind für freigegebene Pretests oder echte Erhebungen verfügbar. Geschlossene Formulare nehmen keine Antworten mehr an.' }, 409)
  const links = participationLinks(survey.id, survey.slug, process.env)
  if (!links) return json({ error: 'Die Formularadressen oder die Linkkennung sind noch nicht gültig konfiguriert.' }, 503)
  const query = new URL(req.url).searchParams, format = query.get('format'), requestedOrigin = query.get('origin')
  if (!format) return json({ surveyID: survey.id, title: survey.title, links })
  if (format !== 'svg' && format !== 'png') return json({ error: 'Bitte PNG oder SVG wählen.' }, 400)
  const link = requestedOrigin == null ? links[0] : links.find(link => link.origin === requestedOrigin)
  if (!link) return json({ error: 'Diese Formularadresse ist nicht freigegeben.' }, 400)
  const image = await participationQR(link.url, format)
  return new Response(typeof image === 'string' ? image : new Uint8Array(image), {
    headers: {
      'Content-Type': format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png',
      'Content-Disposition': `${query.get('download') === '1' ? 'attachment' : 'inline'}; filename="${survey.slug}-qr-code.${format}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
