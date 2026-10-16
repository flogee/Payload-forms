import { isTeamUser } from '../auth/team'
import type { Payload, TypedUser } from 'payload'
import { z } from 'zod'
import { fromStored, toStored } from './storage'
import { readPrivacySettings, type PrivacySettings } from './privacy'
import type { ContentBlock, RichTextNode } from './content'
import { surveyOriginStatus } from './origins'
import { readBranding } from './branding'

export const surveyToolIDSchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number)
  .refine(id => Number.isSafeInteger(id) && id <= 2147483647)
export const duplicateRequestSchema = z.object({ requestID: z.string().uuid().transform(value => value.toLowerCase()) }).strict()

export function surveyToolsOriginStatus(req: Request, env: { SURVEY_ORIGINS?: string; SURVEY_ORIGIN?: string }): 503 | 403 | null {
  const origin = req.headers.get('origin'), status = surveyOriginStatus(origin, env)
  if (status) return status
  // Next's Node adapter can use localhost in req.url while retaining the actual
  // request Host header. Do not trust forwarded-host headers from the client.
  const host = req.headers.get('host') ?? new URL(req.url).host
  return new URL(origin!).host === host ? null : 403
}

export function surveyToolsStaff(user: unknown): boolean {
  return isTeamUser(user) && user._strategy !== 'mcp-api-key'
}

// An explicit allowlist through the definition/privacy normalizers keeps answers,
// operational recipients, job state and arbitrary stored fields out of exports.
export function questionnaireExport(source: Record<string, any>) {
  const { reviewed: _reviewed, ...privacy } = readPrivacySettings(source.privacy)
  return {
    format: 'payload-forms-forms-questionnaire' as const, formatVersion: 1 as const,
    survey: { id: source.id as number, title: source.title as string, slug: source.slug as string, version: source.version as string },
    definition: fromStored(source), branding: readBranding(source.branding), privacy,
  }
}

const plain = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
function richText(node: RichTextNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'linebreak') return '\n'
  const text = (node.children ?? []).map(richText).join('')
  const linked = node.fields?.url ? `${text} (${node.fields.url})` : text
  return ['paragraph', 'heading', 'listitem'].includes(node.type) ? `${linked}\n` : linked
}
function contentLines(blocks: ContentBlock[] = []) {
  return blocks.flatMap(block => [
    ...(block.afterQuestion ? [`Inhalt nach Frage ${plain(block.afterQuestion)}:`, ''] : []),
    ...(block.blockType === 'text' ? [plain(richText(block.content.root).trim()), '']
      : [`Bildreferenz: Medium ${block.image}. Alternativtext: ${plain(block.alt)}`,
        ...(block.caption ? [`Bildunterschrift: ${plain(block.caption)}`] : []), '']),
  ])
}

const privacyLabels: Record<Exclude<keyof PrivacySettings, 'reviewed'>, string> = {
  enabled: 'Datenschutzinformation aktiviert', noticeVersion: 'Informationsfassung',
  controllerName: 'Verantwortlicher', controllerAddress: 'Anschrift', contactEmail: 'Datenschutzkontakt',
  purpose: 'Zweck', legalBasis: 'Rechtsgrundlage', legalBasisDetails: 'Erläuterung der Rechtsgrundlage',
  dataCategories: 'Erhobene Daten', recipients: 'Empfänger und Zugriff', internationalTransfers: 'Dienstleister und Datenübermittlungen',
  retention: 'Aufbewahrung der Antworten', retentionYears: 'Prüffrist in Kalenderjahren (0: ausgeschaltet)',
  rights: 'Betroffenenrechte', complaintAuthority: 'Beschwerdestelle', contactMode: 'Kontaktangaben',
  contactPurpose: 'Zweck der Kontaktaufnahme', contactRetention: 'Aufbewahrung der Kontaktangaben',
  consentText: 'Einwilligung zu den Antworten', contactConsentText: 'Einwilligung zur Kontaktaufnahme',
}
const formatLabels = { single: 'Einfachauswahl', multiple: 'Mehrfachauswahl', text: 'Kurzer Text', textarea: 'Längerer Text',
  count: 'Zahl mit Status', counts: 'Mehrere Zahlen mit Status', matrix: 'Bewertungszeilen', committees: 'Gremienliste',
  slider: 'Slider / Zahlen-Skala', stars: 'Sterne-Bewertung', smiley: 'Smiley-Bewertung', ranking: 'Rangfolge / Prioritäten' }

export function questionnaireMarkdown(source: Record<string, any>): string {
  const exported = questionnaireExport(source), { survey, definition, branding, privacy } = exported
  const lines = [`# ${plain(survey.title)}`, '', `Gespeicherter Fragebogen ${survey.id} · Linkkennung: ${plain(survey.slug)} · Fassung: ${plain(survey.version)}`, '',
    'Bilder sind Referenzen auf vorhandene Medien; Bilddateien sind nicht enthalten.', '',
    ...(branding.mode === 'default' ? [] : [`Kopfzeile: ${plain(branding.text)}${branding.mode === 'logo' ? ` · Logo: Medium ${branding.logo}` : ''}`, '']),
    ...definition.introduction.flatMap(text => [plain(text), '']), ...contentLines(definition.introContent)]
  for (const section of definition.sections) {
    lines.push(`## ${plain(section.title)} (${plain(section.id)})`, '', ...(section.description ? [plain(section.description), ''] : []))
    lines.push(...contentLines(section.content?.filter(block => !block.afterQuestion)))
    for (const question of section.questions) {
      lines.push(`### ${plain(question.id)} · ${plain(question.label)}`, '', `Frageblock: ${plain(question.block)} · Antwortformat: ${formatLabels[question.kind]} · Optional: ${question.optional ? 'ja' : 'nein'}`, '')
      if (question.help) lines.push(plain(question.help), '')
      if (question.kind === 'slider') lines.push(`Slider: ${question.min ?? 0}–${question.max ?? 10}; Schrittweite ${question.step ?? 1}.`, '')
      if (question.kind === 'stars' || question.kind === 'smiley') lines.push('Bewertung: 1–5.', '')
      if (question.lowLabel || question.highLabel) lines.push(`Skalenenden: ${plain(question.lowLabel || '')} → ${plain(question.highLabel || '')}`, '')
      if (question.kind === 'ranking') lines.push('Alle Optionen einmal ordnen; Platz 1 hat die höchste Priorität.', '')
      if (question.showIf) lines.push(`Anzeigen, wenn ${plain(question.showIf.field)} einen dieser Werte hat: ${question.showIf.values.map(plain).join(', ')}`, '')
      if (question.options) lines.push('Antwortoptionen:', '', ...question.options.map(option => `- ${plain(option.value)}: ${plain(option.label)}${option.exclusive ? ' (exklusiv)' : ''}`), '')
      if (question.rows) lines.push('Zeilen:', '', ...question.rows.map(row => `- ${plain(row.key)}: ${plain(row.label)}`), '')
      if (question.min !== undefined || question.max !== undefined) lines.push(`Zahlengrenzen: ${question.min ?? 'offen'} bis ${question.max ?? 'offen'}`, '')
      if (question.allowNA !== undefined) lines.push(`„Nicht zutreffend“ zulässig: ${question.allowNA ? 'ja' : 'nein'}`, '')
      lines.push(...contentLines(section.content?.filter(block => block.afterQuestion === question.id)))
    }
  }
  lines.push('## Datenschutz und Teilnahme', '')
  for (const [key, value] of Object.entries(privacy)) lines.push(`- ${privacyLabels[key as keyof typeof privacyLabels]}: ${plain(typeof value === 'boolean' ? value ? 'ja' : 'nein' : String(value))}`)
  return lines.join('\n') + '\n'
}

export function duplicateIdentity(sourceID: number, requestID: string): string {
  surveyToolIDSchema.parse(String(sourceID))
  return `kopie-${sourceID}-${duplicateRequestSchema.parse({ requestID }).requestID}`
}

export function duplicateDraftData(source: Record<string, any>, requestID: string) {
  const identity = duplicateIdentity(source.id, requestID)
  return {
    title: `${source.title} · Kopie`, slug: identity, phase: 'draft' as const,
    ...toStored({ ...fromStored(source), version: identity }),
    branding: readBranding(source.branding),
    privacy: { ...readPrivacySettings(source.privacy), reviewed: false },
    notifications: { enabled: false, recipients: '' }, retentionReminders: { enabled: false },
  }
}

export class SurveyToolError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
type Repository = Pick<Payload, 'find' | 'findByID' | 'create'>

export async function duplicateSavedSurvey(payload: Repository, user: TypedUser, sourceID: number, requestID: string) {
  if (!surveyToolsStaff(user)) throw new SurveyToolError(401, 'Teamzugang erforderlich.')
  const identity = duplicateIdentity(sourceID, requestID)
  const existing = async () => {
    const matches = (await payload.find({ collection: 'surveys', where: { or: [{ version: { equals: identity } }, { slug: { equals: identity } }] },
      user, overrideAccess: false, depth: 0, limit: 2 })).docs
    if (matches.length > 1) throw new SurveyToolError(409, 'Die Kennung der Kopie ist nicht mehr eindeutig. Bitte die vorhandenen Entwürfe prüfen.')
    return matches[0]
  }
  const previous = await existing()
  if (previous) return { survey: previous, reused: true }
  const source = await payload.findByID({ collection: 'surveys', id: sourceID, user, overrideAccess: false, depth: 0 }).catch((error: unknown): null => {
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null
    throw error
  })
  if (!source) throw new SurveyToolError(404, 'Fragebogen nicht gefunden.')
  try {
    const survey = await payload.create({ collection: 'surveys', user, overrideAccess: false, depth: 0, data: duplicateDraftData(source, requestID) })
    return { survey, reused: false }
  } catch (error) {
    // A unique-index race (or an uncertain create response) may have committed.
    // An exact deterministic version or slug identifies this request's result,
    // even after the user changes one of the copy's editable identifiers.
    const winner = await existing()
    if (winner) return { survey: winner, reused: true }
    throw error
  }
}

export async function readDuplicateRequest(req: Request): Promise<string> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new SurveyToolError(415, 'JSON erforderlich.')
  const reader = req.body?.getReader()
  if (!reader) throw new SurveyToolError(400, 'Ungültige Anfrage.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 1024) { await reader.cancel(); throw new SurveyToolError(413, 'Anfrage zu groß.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return duplicateRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))).requestID }
  catch { throw new SurveyToolError(400, 'Eine gültige Anfragekennung ist erforderlich.') }
}

export function surveyToolsURLs(id: string | number) {
  const encoded = encodeURIComponent(String(id))
  return { json: `/api/survey/definition/${encoded}?format=json`, markdown: `/api/survey/definition/${encoded}?format=markdown`,
    csv: `/api/survey/export?surveyID=${encoded}`, duplicate: `/api/survey/duplicate/${encoded}` }
}
