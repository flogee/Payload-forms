import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Payload, TypedUser } from 'payload'
import { sample } from '../src/survey/sample'
import { fromStored, toStored } from '../src/survey/storage'
import { validSurveySlug } from '../src/survey/sharing'
import { testText } from './content-fixture'
import { testPrivacy } from './privacy-fixture'
import { duplicateDraftData, duplicateIdentity, duplicateSavedSurvey, questionnaireExport, questionnaireMarkdown,
  readDuplicateRequest, SurveyToolError, surveyToolIDSchema, surveyToolsStaff, surveyToolsURLs, surveyToolsOriginStatus } from '../src/survey/survey-tools'

test('Next-interne URL darf vom tatsächlichen Host abweichen; fremde und weitergeleitete Hosts bleiben gesperrt', () => {
  const env = { SURVEY_ORIGINS: 'http://127.0.0.1:3334,http://localhost:3334' }
  const req = (origin: string, host?: string, forwardedHost?: string) => new Request('http://localhost:3334/api/survey/duplicate/1', {
    headers: { origin, ...(host ? { host } : {}), ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}) },
  })
  assert.equal(surveyToolsOriginStatus(req('http://127.0.0.1:3334', '127.0.0.1:3334'), env), null)
  assert.equal(surveyToolsOriginStatus(req('http://localhost:3334', '127.0.0.1:3334'), env), 403)
  assert.equal(surveyToolsOriginStatus(req('http://127.0.0.1:3334', 'localhost:3334', '127.0.0.1:3334'), env), 403)
  assert.equal(surveyToolsOriginStatus(req('http://localhost:3334'), env), null)
  assert.equal(surveyToolsOriginStatus(req('https://foreign.example.invalid', 'foreign.example.invalid'), env), 403)
  assert.equal(surveyToolsOriginStatus(req('http://localhost:3334'), {}), 503)
})

const requestID = 'ec2a24af-d5ca-4d6e-84c3-378e172a6671'
const staff = { id: 1, collection: 'users' } as TypedUser
const source = () => ({ id: 42, title: 'Gespeicherter Fragebogen', slug: 'saved-form', phase: 'pretest',
  ...toStored({ ...sample, introContent: [{ blockType: 'text', content: testText('<script>Text</script> [Link](evil)') },
    { blockType: 'image', image: 17, alt: 'Fiktives Bild', caption: 'Bildtext' }],
    sections: sample.sections.map((section, index) => index === 0 ? { ...section, content: [{ blockType: 'text', content: testText('Text nach Frage'), afterQuestion: section.questions[0].id }] } : section) }),
  privacy: testPrivacy({ reviewed: true, retentionYears: 3 }),
  notifications: { enabled: true, recipients: 'operational-secret@example.invalid' }, retentionReminders: { enabled: true },
  responses: [{ answers: 'PRIVATE ANSWER', contact: 'PRIVATE CONTACT' }], jobs: ['PRIVATE JOB'], secret: 'PRIVATE SECRET',
})

test('Fragebogenexport verwendet gespeicherte Inhalte und eine begrenzte Datenschutz-Allowlist', () => {
  const saved = source(), snapshot = structuredClone(saved)
  saved.title = 'Titel nach gespeichertem Edit'
  const exported = questionnaireExport(saved)
  assert.equal(exported.formatVersion, 1)
  assert.equal(exported.survey.title, saved.title)
  assert.deepEqual(exported.definition, fromStored(saved))
  assert.equal(exported.definition.introContent?.[1].blockType, 'image')
  assert.equal((exported.definition.introContent?.[1] as any).image, 17)
  assert.equal(exported.privacy.contactEmail, saved.privacy.contactEmail, 'participant privacy contact is intentional')
  assert.equal(exported.privacy.retentionYears, 3)
  const serialized = JSON.stringify(exported)
  for (const privateValue of ['operational-secret', 'PRIVATE ANSWER', 'PRIVATE CONTACT', 'PRIVATE JOB', 'PRIVATE SECRET', 'reviewed', 'notifications', 'retentionReminders']) assert.ok(!serialized.includes(privateValue), privateValue)
  exported.definition.sections[0].title = 'Export changed locally'
  exported.privacy.controllerName = 'Export changed locally'
  assert.deepEqual(saved, { ...snapshot, title: saved.title }, 'export objects are isolated from the source')
})

test('Markdown enthält Fragen, Optionen, Zeilen, Sprungregeln und sichere Text-/Bildinhalte', () => {
  const markdown = questionnaireMarkdown(source())
  assert.ok(markdown.includes('&lt;script&gt;Text&lt;/script&gt;'))
  assert.ok(!markdown.includes('<script>'))
  assert.ok(markdown.includes('\\[Link\\]\\(evil\\)'))
  assert.ok(markdown.includes('Bildreferenz: Medium 17'))
  assert.ok(markdown.includes('Fiktives Bild'))
  assert.ok(markdown.includes('Inhalt nach Frage F01\\_unit:'))
  assert.ok(markdown.includes('Text nach Frage'))
  assert.ok(markdown.includes('Antwortoptionen:'))
  assert.ok(markdown.includes('Zeilen:'))
  assert.ok(markdown.includes('Anzeigen, wenn'))
  assert.ok(markdown.includes('Einwilligung zur Kontaktaufnahme:'))
  assert.ok(!markdown.includes('operational-secret'))
})

test('Kopie ist ein isolierter Entwurf ohne Antworten, Betriebsdaten oder wiederverwendete Array-IDs', () => {
  const saved = source() as any, original = structuredClone(saved)
  saved.introduction[0].id = 'old-paragraph-id'
  saved.introContent[0].id = 'old-block-id'
  saved.sections[0].id = 'old-section-id'
  saved.sections[0].questions[0].id = 'old-question-id'
  const copy = duplicateDraftData(saved, requestID)
  assert.equal(copy.title, `${saved.title} · Kopie`)
  assert.equal(copy.phase, 'draft')
  assert.equal(copy.slug, copy.version)
  assert.equal(validSurveySlug(copy.slug), true)
  assert.deepEqual(copy.notifications, { enabled: false, recipients: '' })
  assert.deepEqual(copy.retentionReminders, { enabled: false })
  assert.equal(copy.privacy.reviewed, false)
  assert.equal(copy.privacy.retentionYears, 3)
  assert.deepEqual(fromStored(copy), { ...fromStored(saved), version: copy.version })
  assert.equal((copy.introContent[1] as any).image, 17, 'media references are reused without binary copies')
  for (const value of ['old-paragraph-id', 'old-block-id', 'old-section-id', 'old-question-id', 'PRIVATE', 'operational-secret']) assert.ok(!JSON.stringify(copy).includes(value))
  copy.sections[0].title = 'A different title'
  copy.privacy.purpose = 'A different purpose'
  assert.deepEqual(saved.sections[0].questions, original.sections[0].questions.map((question: any, index: number) => index === 0 ? { ...question, id: 'old-question-id' } : question))
  assert.equal(saved.privacy.purpose, original.privacy.purpose)
})

function repository(options: { uncertain?: boolean; failure?: boolean; previous?: any[] } = {}) {
  const saved = source(), documents: any[] = [...(options.previous ?? [])], calls: any[] = []
  const api = {
    find: async (args: any) => { calls.push(['find', args]); return { docs: documents.filter(doc => args.where.or.some((condition: any) => doc.version === condition.version?.equals || doc.slug === condition.slug?.equals)) } },
    findByID: async (args: any) => { calls.push(['findByID', args]); return saved },
    create: async (args: any) => { calls.push(['create', args]); if (options.failure) throw new Error('Database unavailable')
      const doc = { id: 99, ...structuredClone(args.data) }; documents.push(doc)
      if (options.uncertain) throw new Error('Unique race or committed response lost')
      return doc },
  } as unknown as Pick<Payload, 'find' | 'findByID' | 'create'>
  return { api, saved, calls, documents }
}

test('Ein erneuter Duplizierungsversuch findet dieselbe Kopie vor dem Lesen einer geänderten Quelle', async () => {
  const repo = repository(), snapshot = structuredClone(repo.saved)
  const first = await duplicateSavedSurvey(repo.api, staff, 42, requestID)
  assert.equal(first.reused, false)
  assert.deepEqual(repo.saved, snapshot)
  repo.saved.sections[0].title = 'Source edited after uncertain response'
  repo.documents[0].version = 'user-edited-version'
  const repeated = await duplicateSavedSurvey(repo.api, staff, 42, requestID)
  assert.equal(repeated.survey.id, first.survey.id)
  assert.equal(repeated.reused, true)
  assert.equal(repo.calls.filter(call => call[0] === 'create').length, 1)
  assert.equal(repo.calls.filter(call => call[0] === 'findByID').length, 1)
  for (const [, args] of repo.calls) { assert.equal(args.overrideAccess, false); assert.equal(args.user, staff); assert.equal(args.collection, 'surveys'); assert.equal(args.depth, 0) }
})

test('Unique-Race oder verlorene Create-Antwort wird nur über dieselbe Kennung wiederhergestellt', async () => {
  const repo = repository({ uncertain: true })
  const result = await duplicateSavedSurvey(repo.api, staff, 42, requestID)
  assert.equal(result.reused, true)
  assert.equal(result.survey.version, duplicateIdentity(42, requestID))
  assert.equal(repo.documents.length, 1)
  const failing = repository({ failure: true })
  await assert.rejects(duplicateSavedSurvey(failing.api, staff, 42, requestID), /Database unavailable/)
  const ambiguous = repository({ previous: [{ id: 8, version: duplicateIdentity(42, requestID) }, { id: 9, slug: duplicateIdentity(42, requestID) }] })
  await assert.rejects(duplicateSavedSurvey(ambiguous.api, staff, 42, requestID), error => error instanceof SurveyToolError && error.status === 409)
})

test('Nur Teamkonten ohne MCP-Strategie dürfen kopieren, und Identitäten bleiben begrenzt', async () => {
  for (const user of [undefined, { collection: 'responses' }, { collection: 'users', _strategy: 'mcp-api-key' }, { collection: 'payload-mcp-api-keys' }]) {
    assert.equal(surveyToolsStaff(user), false)
    const repo = repository()
    await assert.rejects(duplicateSavedSurvey(repo.api, user as TypedUser, 42, requestID), error => error instanceof SurveyToolError && error.status === 401)
    assert.equal(repo.calls.length, 0)
  }
  assert.equal(surveyToolsStaff(staff), true)
  for (const id of ['0', '-1', '1.5', '01', '1e2', '2147483648', 'invalid']) assert.equal(surveyToolIDSchema.safeParse(id).success, false)
  const identity = duplicateIdentity(2147483647, requestID.toUpperCase())
  assert.ok(identity.length <= 80)
  assert.ok(validSurveySlug(identity))
  assert.ok(identity.endsWith(requestID))
})

test('Duplizierungsanfrage akzeptiert nur kleine JSON-Objekte mit einer UUID', async () => {
  const request = (body: string, type = 'application/json') => new Request('https://forms.example.invalid', { method: 'POST', headers: { 'Content-Type': type }, body })
  assert.equal(await readDuplicateRequest(request(JSON.stringify({ requestID }))), requestID)
  for (const body of ['invalid', '{}', JSON.stringify({ requestID, notifications: { enabled: true } }), JSON.stringify({ requestID: 'bad' })]) {
    await assert.rejects(readDuplicateRequest(request(body)), error => error instanceof SurveyToolError && error.status === 400)
  }
  await assert.rejects(readDuplicateRequest(request(' '.repeat(1025))), error => error instanceof SurveyToolError && error.status === 413)
  await assert.rejects(readDuplicateRequest(request('{}', 'text/plain')), error => error instanceof SurveyToolError && error.status === 415)
})

test('Download- und Kopiepfade verwenden genau die ausgewählte gespeicherte Formularnummer', () => {
  assert.deepEqual(surveyToolsURLs(42), { json: '/api/survey/definition/42?format=json', markdown: '/api/survey/definition/42?format=markdown',
    csv: '/api/survey/export?surveyID=42', duplicate: '/api/survey/duplicate/42' })
})
