import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import { isTeamUser } from '@/auth/team'
import { AnalysisDashboard } from '@/components/AnalysisDashboard'
import { demoReport } from '@/survey/analysis-demo'
export const dynamic = 'force-dynamic'

export default async function Demo() {
  const payload = await getPayload({ config }), { user } = await payload.auth({ headers: await headers() })
  if (!isTeamUser(user)) return <main className="unavailable"><h1>Auswertungsdemo</h1><p>Bitte melde dich im Teamzugang an.</p><a className="primary" href="/admin/login?redirect=%2Fauswertung%2Fdemo">Zum Teamzugang</a></main>
  return <AnalysisDashboard report={demoReport()} surveys={[]} demo />
}
