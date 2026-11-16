import type { Payload, PayloadRequest, TypedUser } from 'payload'
import { isTeamUser } from '../auth/team'
import { AnalysisError } from './analysis-load'
import { digest } from './privacy-crypto'
import { definitionStructureHash } from './questionnaire-structure'
import type { Definition } from './types'

type Scope = { user?: TypedUser; req?: PayloadRequest }
const HISTORY_LIMIT = 1000
const signature = (definition: Definition) => digest({ version: definition.version, sections: definition.sections })
const incompatible = () => new AnalysisError('Die Antworten stammen aus unterschiedlichen Fragebogenständen. Bitte getrennt anhand des CSV-Exports auswerten.', 422)

/** Audit edges are trusted only after commit, through ordinary human collection access. */
export async function resolveAnalysisDefinition(payload: Payload, surveyID: number, currentDefinition: Definition, savedDefinitions: Definition[], scope: Scope): Promise<{ definition: Definition; corrected: boolean }> {
  const currentHash = signature(currentDefinition)
  const hashes = new Set(savedDefinitions.map(signature))
  if (!hashes.size || (hashes.size === 1 && hashes.has(currentHash))) return { definition: savedDefinitions[0] ?? currentDefinition, corrected: false }
  const fallback = () => {
    if (hashes.size > 1) throw incompatible()
    return { definition: savedDefinitions[0], corrected: false }
  }
  const user = scope.req?.user ?? scope.user
  if (!isTeamUser(user) || user._strategy === 'mcp-api-key') return fallback()
  // Audit authorization cannot make a structural or version change compatible.
  try {
    const structure = definitionStructureHash(currentDefinition)
    if (savedDefinitions.some(definition => definitionStructureHash(definition) !== structure)) return fallback()
  } catch { return fallback() }
  const history = await payload.find({ collection: 'survey-corrections', ...scope, overrideAccess: false, depth: 0,
    limit: HISTORY_LIMIT,
    where: { and: [{ survey: { equals: surveyID } }, { status: { equals: 'committed' } }] },
    select: { survey: true, status: true, beforeHash: true, afterHash: true },
  })
  // Never interpret a truncated graph as complete correction history.
  if (history.totalDocs > HISTORY_LIMIT || history.docs.length !== history.totalDocs || history.hasNextPage) return fallback()
  const predecessors = new Map<string, string[]>()
  for (const edge of history.docs) {
    if (edge.survey !== surveyID || edge.status !== 'committed' || !/^[a-f0-9]{64}$/.test(edge.beforeHash) || !/^[a-f0-9]{64}$/.test(edge.afterHash)) continue
    const incoming = predecessors.get(edge.afterHash) ?? []
    incoming.push(edge.beforeHash); predecessors.set(edge.afterHash, incoming)
  }
  const reachable = new Set([currentHash]), pending = [currentHash]
  while (pending.length) {
    for (const hash of predecessors.get(pending.pop()!) ?? []) {
      if (!reachable.has(hash)) { reachable.add(hash); pending.push(hash) }
    }
  }
  if ([...hashes].every(hash => reachable.has(hash))) return { definition: currentDefinition, corrected: true }
  return fallback()
}
