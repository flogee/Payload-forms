import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import { isTeamUser } from '@/auth/team'
import { analysisSurveys, AnalysisError, parseSurveyID } from '@/survey/analysis-load'
import { loadSurveyReport, reportDataset } from '@/survey/report-load'
import { buildSurveyReport } from '@/survey/report-build'
import { analyze } from '@/survey/analysis'
import { demoDefinition, demoRecords } from '@/survey/analysis-demo'
import { SurveyReport } from '@/components/report/SurveyReport'
export const dynamic = 'force-dynamic'

export default async function Report({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: await headers() })
  if (!isTeamUser(user) || user._strategy === 'mcp-api-key') return <main className="unavailable"><h1>Gesamtbericht</h1><p>Bitte melde dich mit deinem persönlichen Teamzugang an.</p><a className="primary" href="/admin/login?redirect=%2Fauswertung%2Fbericht">Zum Teamzugang</a></main>
  try {
    const params = await searchParams, surveys = await analysisSurveys(payload, { user })
    if (params.demo === '1') {
      const records = demoRecords().map((record, index) => ({ ...record, id: `demo-${index + 1}`, testOnly: true }))
      const aggregate = analyze(demoDefinition, records, { id: 0, title: 'Governance-Praxis · erfundenes Beispiel', slug: 'demo', version: demoDefinition.version, phase: 'demo' })
      return <SurveyReport data={buildSurveyReport({ definition: demoDefinition, records, aggregate, dataset: 'test', excludedResponses: 0 })} surveys={[]} demo />
    }
    const selected = params.surveyID === undefined ? (surveys.find(survey => survey.phase === 'live') ?? surveys[0])?.id : parseSurveyID(params.surveyID)
    if (selected == null) throw new AnalysisError(params.surveyID === undefined ? 'Noch kein Fragebogen vorhanden.' : 'Ungültige Fragebogenkennung.', 400)
    return <SurveyReport data={await loadSurveyReport(payload, selected, user, reportDataset(params.dataset))} surveys={surveys} />
  } catch (error) {
    if (!(error instanceof AnalysisError)) throw error
    return <main className="unavailable"><h1>Gesamtbericht</h1><p>{error.message}</p><a href="/auswertung">Zur Auswertung</a></main>
  }
}
