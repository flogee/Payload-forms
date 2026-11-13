import type { Payload, TypedUser } from 'payload'
import { isTeamUser } from '../auth/team'
import { analyze, ANALYSIS_LIMIT } from './analysis'
import { AnalysisError } from './analysis-load'
import { digest } from './privacy-crypto'
import { fromStored } from './storage'
import { definitionSchema } from './validation'
import { buildSurveyReport } from './report-build'
import type { Definition, Answers } from './types'
import type { ReportRecord } from './report-types'

export function reportDataset(value: unknown): 'real' | 'test' | undefined {
  if (value === undefined) return undefined
  if (value === 'real' || value === 'test') return value
  throw new AnalysisError('Bitte echte Einsendungen oder Pretest auswählen.', 400)
}

/** This human-only loader deliberately does not feed the aggregate API or MCP. */
export async function loadSurveyReport(payload: Payload, surveyID: number, user: TypedUser, requestedDataset?: 'real' | 'test') {
  if (!isTeamUser(user) || user._strategy === 'mcp-api-key') throw new AnalysisError('Der Gesamtbericht ist ausschließlich im persönlichen Teamzugang verfügbar.', 403)
  const scope = { user, overrideAccess: false as const, depth: 0 }
  const found = await payload.find({ collection: 'surveys', ...scope, where: { id: { equals: surveyID } }, limit: 1,
    select: { title: true, slug: true, version: true, phase: true, firstRealResponseAt: true, introduction: true, introContent: true, sections: true },
  })
  const survey = found.docs[0]
  if (!survey) throw new AnalysisError('Fragebogen nicht gefunden.', 404)
  const dataset = requestedDataset ?? (survey.phase === 'live' || survey.firstRealResponseAt ? 'real' : 'test')
  const rows = await payload.find({ collection: 'responses', ...scope, limit: ANALYSIS_LIMIT, sort: 'createdAt',
    where: { and: [{ survey: { equals: surveyID } }, { testOnly: { equals: dataset === 'test' } }] },
    select: { answers: true, createdAt: true, durationSeconds: true, testOnly: true, instrument: true, version: true },
  })
  if (rows.totalDocs > ANALYSIS_LIMIT) throw new AnalysisError('Mehr als 1.000 Einsendungen: Für einen vollständigen Bericht ist eine paginierte Auswertung erforderlich. Es wird kein Teilbericht angezeigt.', 422)
  if (rows.docs.length !== rows.totalDocs) throw new AnalysisError('Der Datenstand hat sich während des Ladens geändert. Bitte den Bericht neu laden.', 409)
  const definitions: Definition[] = rows.docs.map(row => {
    const parsed = definitionSchema.safeParse(row.instrument)
    if (!parsed.success || parsed.data.version !== row.version) throw new AnalysisError('Eine gespeicherte Fragebogenfassung fehlt oder passt nicht zur Antwort. Bitte die betroffenen Einzelantworten prüfen.', 422)
    return parsed.data as Definition
  })
  if (new Set(definitions.map(def => digest({ version: def.version, sections: def.sections }))).size > 1) {
    throw new AnalysisError('Die Einsendungen stammen aus unterschiedlichen Fragebogenständen. Diese Fassungen müssen getrennt ausgewertet werden.', 422)
  }
  const definition = definitions[0] ?? fromStored(survey)
  const records: ReportRecord[] = rows.docs.map(row => ({ id: row.id, answers: row.answers as Answers,
    createdAt: row.createdAt, durationSeconds: row.durationSeconds, testOnly: row.testOnly }))
  const total = await payload.count({ collection: 'responses', user, overrideAccess: false, where: { survey: { equals: surveyID } } })
  const aggregate = analyze(definition, records, { id: survey.id, title: survey.title, slug: survey.slug, version: definition.version, phase: String(survey.phase) })
  aggregate.dataset = dataset
  return buildSurveyReport({ definition, records, aggregate, dataset, excludedResponses: Math.max(0, total.totalDocs - rows.totalDocs) })
}
