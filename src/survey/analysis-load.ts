import type { Payload, PayloadRequest, TypedUser } from 'payload'
import { isTeamUser } from '../auth/team'
import { analyze, ANALYSIS_LIMIT } from './analysis'
import { digest } from './privacy-crypto'
import { definitionSchema } from './validation'
import { fromStored } from './storage'
import type { Answers, Definition } from './types'

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
    select: { title: true, slug: true, version: true, phase: true, introduction: true, introContent: true, sections: true },
  })
  const survey = found.docs[0]
  const user = scope.req?.user ?? scope.user
  if (survey && user && '_strategy' in user && user._strategy === 'mcp-api-key' && survey.phase !== 'pretest') throw new AnalysisError('Maschinenauswertung ist auf Pretests beschränkt.', 403)
  if (!survey) throw new AnalysisError('Fragebogen nicht gefunden.', 404)
  const rows = await payload.find({ collection: 'responses', ...scope, overrideAccess: false, depth: 0, limit: ANALYSIS_LIMIT,
    where: { survey: { equals: survey.id } },
    // Snapshots prevent reinterpreting test answers after an edit; no receipts or contacts.
    select: { answers: true, createdAt: true, testOnly: true, instrument: true },
  })
  if (rows.totalDocs > ANALYSIS_LIMIT) throw new AnalysisError('Mehr als 1.000 Antworten: paginierte Auswertung erforderlich. Es werden keine Teilergebnisse angezeigt.', 422)
  const current=fromStored(survey)
  const definitions=rows.docs.map(r=>r.instrument==null?current:definitionSchema.parse(r.instrument) as Definition)
  if (new Set(definitions.map(d=>digest({version:d.version,sections:d.sections}))).size>1) throw new AnalysisError('Die Antworten stammen aus unterschiedlichen Fragebogenständen. Bitte getrennt anhand des CSV-Exports auswerten.',422)
  const definition=definitions[0]??current
  return analyze(definition, rows.docs.map(r => ({ answers: r.answers as Answers, createdAt: r.createdAt, testOnly: r.testOnly })),
    { id: survey.id, title: survey.title, slug: survey.slug, version: definition.version, phase: survey.phase })
}
