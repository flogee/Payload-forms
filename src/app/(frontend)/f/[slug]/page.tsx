import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { fromStored } from '@/survey/storage'
import { validSurveySlug } from '@/survey/sharing'
import { Survey } from '../../Survey'
import { privacyNotice, readPrivacySettings } from '@/survey/privacy'
import { privacyHash } from '@/survey/privacy-crypto'
import { readBranding } from '@/survey/branding'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fragebogen · Payload Forms', description: 'Pretest mit Testdaten' }

export default async function ParticipationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!validSurveySlug(slug)) notFound()
  const payload = await getPayload({ config })
  // Only explicitly opened test forms are exposed; drafts and closed forms stay private.
  const found = await payload.find({ collection: 'surveys', where: { slug: { equals: slug }, phase: { equals: 'pretest' } }, limit: 1, depth: 0 })
  const survey = found.docs[0]
  if (!survey) notFound()
  const privacy = privacyNotice(readPrivacySettings(survey.privacy))
  return <Survey definition={fromStored(survey)} branding={readBranding(survey.branding)} surveyID={survey.id} title={survey.title} homeURL={`/f/${survey.slug}`} privacy={privacy} privacyHash={privacy && privacyHash(privacy)} />
}
