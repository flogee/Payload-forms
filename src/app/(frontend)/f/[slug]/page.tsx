import { cache } from 'react'
import { participantText, readParticipantLanguage } from '@/survey/participant-language'
import { notFound } from 'next/navigation'
import { participantDefinition, participationMode } from '@/survey/participation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { fromStored } from '@/survey/storage'
import { validSurveySlug } from '@/survey/sharing'
import { Survey } from '../../Survey'
import { privacyNotice, readPrivacySettings } from '@/survey/privacy'
import { digest, privacyHash } from '@/survey/privacy-crypto'
import { readBranding } from '@/survey/branding'
import { authorizedEvaluationRun, evaluationRunOpen } from '@/survey/evaluation-runs'
import { responseDatabase } from '@/survey/response-store'
import type { Definition } from '@/survey/types'

export const dynamic = 'force-dynamic'
const findParticipatingSurvey = cache(async (slug: string) => {
  if (!validSurveySlug(slug)) return undefined
  const payload = await getPayload({ config })
  // Only explicitly opened, operator-enabled forms are exposed.
  const result = await payload.find({ collection: 'surveys', where: { slug: { equals: slug }, phase: { in: ['pretest', 'live'] } }, limit: 1, depth: 0 })
  const survey = result.docs[0]
  const mode = survey && participationMode(survey)
  return mode && survey ? { survey, mode, payload } : undefined
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const source = await findParticipatingSurvey((await params).slug)
  const t = participantText(readParticipantLanguage(source?.survey.participantLanguage))
  const label = source?.survey.privacy?.contactMode === 'email-only' ? t('E-Mail-Anmeldung') : t('Fragebogen')
  return { title: `${label} · Payload Forms`, description: t('Fragebogen und Teilnahme'), referrer: 'no-referrer' as const }
}

export default async function ParticipationPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const source = await findParticipatingSurvey((await params).slug)
  if (!source) notFound()
  const { survey, mode, payload } = source
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
  if ((privacy?.contactMode === 'email-only') !== (definition.sections.length === 0)) notFound()
  const hideQuestionCodes = survey.hideQuestionCodes === true
  return <Survey language={readParticipantLanguage(survey.participantLanguage)} testOnly={mode === 'pretest'} definition={hideQuestionCodes ? participantDefinition(definition) : definition} hideQuestionCodes={hideQuestionCodes} instrumentRevision={digest(definition)} evaluationRun={evaluationRun} branding={readBranding(survey.branding)} surveyID={survey.id} title={survey.title} homeURL={`/f/${survey.slug}`} privacy={privacy} privacyHash={privacy && privacyHash(privacy)} />
}
