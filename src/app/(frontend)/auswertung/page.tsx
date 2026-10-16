import { isTeamUser } from '@/auth/team'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import { AnalysisDashboard } from '@/components/AnalysisDashboard'
import { analysisSurveys, AnalysisError, loadAnalysis, parseSurveyID } from '@/survey/analysis-load'
export const dynamic = 'force-dynamic'
export default async function Results({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: await headers() })
  if (!isTeamUser(user)) return <main className="unavailable"><p className="eyebrow">Payload Forms · Teambereich</p><h1>Auswertung der Testantworten</h1><p>Bitte melde dich im Teamzugang an.</p><a className="primary" href="/admin/login?redirect=%2Fauswertung">Zum Teamzugang</a></main>
  const params = await searchParams, surveys = await analysisSurveys(payload, { user })
  const selected = params.surveyID === undefined ? (surveys.find(s => s.slug === 'sample') ?? surveys[0])?.id : parseSurveyID(params.surveyID)
  if (selected == null) return <main className="unavailable"><h1>Auswertung</h1><p>{params.surveyID === undefined ? 'Noch kein Fragebogen vorhanden.' : 'Ungültige Fragebogenkennung.'}</p><a href="/admin">Zur Verwaltung</a></main>
  try {
    const report = await loadAnalysis(payload, selected, { user })
    if (!surveys.some(s => s.id === selected)) surveys.push(report.survey)
    return <AnalysisDashboard report={report} surveys={surveys} />
  } catch (error) {
    if (!(error instanceof AnalysisError)) throw error
    return <main className="unavailable"><h1>Auswertung</h1><p>{error.message}</p><a href="/auswertung">Anderen Fragebogen wählen</a> · <a href="/admin">Zur Verwaltung</a></main>
  }
}
