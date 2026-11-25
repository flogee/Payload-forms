import { participantText, readParticipantLanguage } from '@/survey/participant-language'
import { participationMode } from '@/survey/participation'
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
  const humanTeam = isTeamUser(user) && user._strategy !== 'mcp-api-key'
  const where = humanTeam ? { slug: { equals: slug } } : { slug: { equals: slug }, phase: { in: ['pretest', 'live'] } }
  const found = await payload.find({ collection: 'surveys', where, limit: 1, depth: 0 })
  const survey = found.docs[0]
  if (!survey || (!humanTeam && !participationMode(survey))) notFound()
  const notice = privacyNotice(readPrivacySettings(survey.privacy))
  if (!notice) notFound()
  const language = readParticipantLanguage(survey.participantLanguage)
  const t = participantText(language)
  return <div className="shell" lang={language}><header className="topbar"><a className="wordmark" href="/admin">Payload Forms<span>{t('Datenschutz und Teilnahme')}</span></a><span className="test-tag">{survey.phase === 'live' ? t('Erhebung') : survey.phase === 'closed' ? t('Geschlossene Fassung') : t('Vorschau · Pretest')}</span></header>
    <main className="unavailable"><h1>{survey.title}</h1><PrivacyNotice language={language} notice={notice} draft={survey.phase === 'draft' || survey.phase === 'pretest'} />
      <p><a href={participationMode(survey) ? `/f/${survey.slug}` : `/admin/collections/surveys/${survey.id}`}>{t('Zurück zum Fragebogen')}</a></p>
    </main></div>
}
