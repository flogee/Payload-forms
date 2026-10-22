import { notFound } from 'next/navigation'
import { participationMode } from '@/survey/participation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { fromStored } from '@/survey/storage'
import { validSurveySlug } from '@/survey/sharing'
import { Survey } from '../../Survey'
import { privacyNotice, readPrivacySettings } from '@/survey/privacy'
import { privacyHash } from '@/survey/privacy-crypto'
import { readBranding } from '@/survey/branding'
import { authorizedEvaluationRun, evaluationRunOpen } from '@/survey/evaluation-runs'
import { responseDatabase } from '@/survey/response-store'
import type { Definition } from '@/survey/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fragebogen · Payload Forms', description: 'Fragebogen und Teilnahme', referrer: 'no-referrer' }

export default async function ParticipationPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  if (!validSurveySlug(slug)) notFound()
  const payload = await getPayload({ config })
  // Only explicitly opened, operator-enabled forms are exposed.
  const found = await payload.find({ collection: 'surveys', where: { slug: { equals: slug }, phase: { in: ['pretest', 'live'] } }, limit: 1, depth: 0 })
  const survey = found.docs[0]
  const mode = survey && participationMode(survey)
  if (!survey || !mode) notFound()
  const query = await searchParams
  let evaluationRun: { key: string; token: string } | undefined, definition = fromStored(survey)
  if (query.run !== undefined || query.access !== undefined) {
    if (mode !== 'pretest') notFound()
    if (typeof query.run !== 'string' || typeof query.access !== 'string') notFound()
    evaluationRun = { key: query.run, token: query.access }
    // Invalid credentials never fall back to unscoped participation.
    let run
    try { run = await authorizedEvaluationRun(responseDatabase(payload), evaluationRun, 'participate', payload.secret) }
    catch { notFound() }
    if (!evaluationRunOpen(run) || run.survey_id !== survey.id || run.version !== survey.version) notFound()
    definition = JSON.parse(run.instrument) as Definition
  }
  const privacy = privacyNotice(readPrivacySettings(survey.privacy))
  return <Survey testOnly={mode === 'pretest'} definition={definition} evaluationRun={evaluationRun} branding={readBranding(survey.branding)} surveyID={survey.id} title={survey.title} homeURL={`/f/${survey.slug}`} privacy={privacy} privacyHash={privacy && privacyHash(privacy)} />
}
