import { isTeamUser } from '@/auth/team'
import { getPayload } from 'payload'
import config from '@payload-config'
import { fromStored } from '@/survey/storage'
import { exportCSV } from '@/survey/csv'
import type { Answers } from '@/survey/types'
export async function GET(req: Request) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!isTeamUser(user)) return Response.json({ error: 'Teamzugang erforderlich.' }, { status: 401 })
  const surveyID = new URL(req.url).searchParams.get('surveyID')
  if (surveyID !== null && (!/^[1-9]\d{0,9}$/.test(surveyID) || Number(surveyID) > 2147483647)) return Response.json({ error: 'Ungültige Fragebogenkennung.' }, { status: 400 })
  const surveys = await payload.find({ collection: 'surveys', where: surveyID === null ? { slug: { equals: 'sample' } } : { id: { equals: Number(surveyID) } }, user, overrideAccess: false, depth: 0, limit: 1 })
  const survey = surveys.docs[0]
  if (!survey) return Response.json({ error: 'Fragebogen nicht gefunden.' }, { status: 404 })
  const result = await payload.find({ collection: 'responses', where: { survey: { equals: survey.id }, version: { equals: survey.version } }, user, overrideAccess: false, depth: 0, limit: 1000, sort: 'createdAt' })
  if (result.totalDocs > 1000) return Response.json({ error: 'Export über 1000 Antworten erfordert paginierte Verarbeitung.' }, { status: 422 })
  const csv = exportCSV(fromStored(survey), result.docs.map(d => ({ id: d.id, version: d.version, createdAt: d.createdAt, durationSeconds: d.durationSeconds, answers: d.answers as Answers })))
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${survey.slug}-pretest-antworten.csv"`, 'Cache-Control': 'no-store' } })
}
