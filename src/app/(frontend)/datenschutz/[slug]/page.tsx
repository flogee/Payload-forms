import { isTeamUser } from '@/auth/team'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { validSurveySlug } from '@/survey/sharing'
import { privacyNotice, readPrivacySettings } from '@/survey/privacy'
import { PrivacyNotice } from '@/components/PrivacyNotice'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Datenschutz und Teilnahme · Payload Forms', robots: { index: false, follow: false } }

export default async function PrivacyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!validSurveySlug(slug)) notFound()
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await headers() })
  const where = isTeamUser(user) ? { slug: { equals: slug } } : { slug: { equals: slug }, phase: { equals: 'pretest' } }
  const found = await payload.find({ collection: 'surveys', where, limit: 1, depth: 0 })
  const survey = found.docs[0]
  if (!survey) notFound()
  const notice = privacyNotice(readPrivacySettings(survey.privacy))
  if (!notice) notFound()
  return <div className="shell"><header className="topbar"><a className="wordmark" href="/admin">Payload Forms<span>Datenschutz und Teilnahme</span></a><span className="test-tag">Vorschau · Pretest</span></header>
    <main className="unavailable"><h1>{survey.title}</h1><PrivacyNotice notice={notice} draft />
      <p><a href={survey.phase === 'pretest' ? `/f/${survey.slug}` : `/admin/collections/surveys/${survey.id}`}>Zurück zum Fragebogen</a></p>
    </main></div>
}
