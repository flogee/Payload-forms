import type { Payload, PayloadRequest, TypedUser } from 'payload'
import { isTeamUser } from '../auth/team'
import { analyze, ANALYSIS_LIMIT } from './analysis'
import { fromStored } from './storage'
import type { Answers } from './types'

type Scope = { user?: TypedUser; req?: PayloadRequest }
export class AnalysisError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export function parseSurveyID(value: unknown): number | null {
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647 ? Number(value) : null
}
function authorized(scope: Scope) {
  if (!isTeamUser(scope.req?.user ?? scope.user)) throw new AnalysisError('Teamzugang erforderlich.', 401)
}
export async function analysisSurveys(payload: Payload, scope: Scope) {
  authorized(scope)
  const found = await payload.find({ collection: 'surveys', ...scope, overrideAccess: false, depth: 0, limit: 100, sort: 'title',
    select: { title: true, slug: true, version: true, phase: true },
  })
  return found.docs.map(s => ({ id: s.id, title: s.title, slug: s.slug, version: s.version, phase: String(s.phase) }))
}
export async function loadAnalysis(payload: Payload, surveyID: number, scope: Scope) {
  authorized(scope)
  const found = await payload.find({ collection: 'surveys', where: { id: { equals: surveyID } }, ...scope, overrideAccess: false, depth: 0, limit: 1,
    select: { title: true, slug: true, version: true, phase: true, introduction: true, sections: true },
  })
  const survey = found.docs[0]
  if (!survey) throw new AnalysisError('Fragebogen nicht gefunden.', 404)
  const rows = await payload.find({ collection: 'responses', ...scope, overrideAccess: false, depth: 0, limit: ANALYSIS_LIMIT,
    where: { and: [{ survey: { equals: survey.id } }, { version: { equals: survey.version } }, { testOnly: { equals: true } }] },
    // Do not load instrument snapshots, privacy receipts or contact references.
    select: { answers: true, createdAt: true },
  })
  if (rows.totalDocs > ANALYSIS_LIMIT) throw new AnalysisError('Mehr als 1.000 Testantworten: paginierte Auswertung erforderlich. Es werden keine Teilergebnisse angezeigt.', 422)
  return analyze(fromStored(survey), rows.docs.map(r => ({ answers: r.answers as Answers, createdAt: r.createdAt })),
    { id: survey.id, title: survey.title, slug: survey.slug, version: survey.version, phase: survey.phase })
}
