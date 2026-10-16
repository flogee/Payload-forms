import { getPayload } from 'payload'
import config from '@payload-config'
import { isTeamUser } from '@/auth/team'
import { AnalysisError, loadAnalysis, parseSurveyID } from '@/survey/analysis-load'
import { forSharing } from '@/survey/analysis'
import { demoReport } from '@/survey/analysis-demo'
import { analysisSVG } from '@/survey/analysis-svg'
export const dynamic = 'force-dynamic'
const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff' }
const problem = (error: string, status: number) => Response.json({ error }, { status, headers: privateHeaders })

export async function GET(req: Request) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: req.headers })
  if (!isTeamUser(user)) return problem('Teamzugang erforderlich.', 401)
  const params = new URL(req.url).searchParams, format = params.get('format') ?? 'json'
  if (!['json', 'svg'].includes(format)) return problem('Format muss json oder svg sein.', 400)
  const demo = params.get('demo') === '1', surveyID = parseSurveyID(params.get('surveyID'))
  if (!demo && surveyID == null) return problem('Ungültige Fragebogenkennung.', 400)
  try {
    const report = demo ? demoReport() : await loadAnalysis(payload, surveyID!, { user })
    if (format === 'svg') {
      const series = report.sections.flatMap(s => s.series).find(s => s.id === params.get('seriesID'))
      if (!series) return problem('Diagramm nicht gefunden.', 404)
      return new Response(analysisSVG(report, series), { headers: { ...privateHeaders, 'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="auswertung-${report.survey.id}-${series.id.replace(/[^A-Za-z0-9_-]/g, '-')}.svg"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
      } })
    }
    return Response.json(forSharing(report), { headers: { ...privateHeaders, 'Content-Disposition': `attachment; filename="auswertung-${report.survey.id}-berichtsdaten.json"` } })
  } catch (error) {
    if (error instanceof AnalysisError) return problem(error.message, error.status)
    console.error('Analysis could not be loaded')
    return problem('Auswertung konnte nicht geladen werden. Bitte erneut versuchen.', 500)
  }
}
