import { isTeamUser } from '../src/auth/team'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { participationLinks } from '../src/survey/sharing'
import { participationQR } from '../src/survey/qr'
import { mailPolicy, readNotificationSettings } from '../src/survey/notifications'
import { participationMode } from '../src/survey/participation'
import { readPrivacySettings } from '../src/survey/privacy'

const require = createRequire(import.meta.url)
// Exercise the query compiler shipped with the installed D1 adapter, not a copy of its selection logic.
const { buildFindManyArgs } = await import(pathToFileURL(`${dirname(require.resolve('@payloadcms/drizzle'))}/find/buildFindManyArgs.js`).href)
const text = (name: string) => ({ name, type: 'text' })
const fields = [text('title'), text('slug'), { name: 'phase', type: 'select' },
  { name: 'notifications', type: 'group', flattenedFields: [{ name: 'enabled', type: 'checkbox' }, text('recipients')] },
  { name: 'privacy', type: 'group', flattenedFields: [text('purpose'), { name: 'retentionYears', type: 'number' }] },
  { name: 'retentionReminders', type: 'group', flattenedFields: [{ name: 'enabled', type: 'checkbox' }] },
  { name: 'introContent', type: 'blocks', blocks: [{ slug: 'text', flattenedFields: [text('body')] }] },
  { name: 'sections', type: 'array', flattenedFields: [text('title'),
    { name: 'questions', type: 'array', flattenedFields: [text('label'),
      { name: 'options', type: 'array', flattenedFields: [text('label')] },
      { name: 'rows', type: 'array', flattenedFields: [text('label')] }] }] },
]
const tableNames = ['surveys', 'surveys_sections', 'surveys_sections_questions',
  'surveys_sections_questions_options', 'surveys_sections_questions_rows', 'surveys_blocks_text']
const adapter = {
  tableNameMap: new Map(tableNames.map(name => [name, name])),
  tables: { surveys: Object.fromEntries(['title', 'slug', 'phase', 'notifications_enabled', 'notifications_recipients',
    'privacy_purpose', 'privacy_retentionYears', 'retentionReminders_enabled'].map(name => [name, {}])) },
  relationshipsSuffix: '_rels', localesSuffix: '_locales', blocksAsJSON: false,
}
const plan = (select?: Record<string, boolean>) => buildFindManyArgs({ adapter, fields, tableName: 'surveys', depth: 0, select })
const survey = { id: 42, title: 'Fixture questionnaire', slug: 'fixture', phase: 'pretest',
  notifications: { enabled: true, recipients: 'notify@localhost.invalid' },
  privacy: { purpose: 'Fixture notice', retentionYears: 3 }, retentionReminders: { enabled: true },
  sections: [{ title: 'Fixture section', questions: Array.from({ length: 45 }, (_, index) => ({
    label: `Question ${index}`, options: [{ label: 'Yes' }, { label: 'No' }], rows: [{ label: 'Fixture row' }],
  })) }], introContent: [{ blockType: 'text', body: 'Fixture introduction' }],
}
const selectors = {
  share: { title: true, slug: true, phase: true, privacy: true },
  notifications: { notifications: true },
  retention: { retentionReminders: true, privacy: true },
}
const summary = { counts: { pending: 2 }, used: 7, checkedAt: '2026-10-09T00:00:00Z', stale: false, latest: null as null }

function route(kind: keyof typeof selectors, options: { user?: unknown; doc?: unknown; error?: unknown } = {}) {
  const queries: any[] = [], summaries: unknown[][] = []
  const user = 'user' in options ? options.user : { id: 1, collection: 'users' }
  const payload = {
    auth: async () => ({ user }),
    findByID: async (query: any) => {
      queries.push(query)
      if (options.error) throw options.error
      const doc = 'doc' in options ? options.doc : survey
      if (!doc) return null
      // A projected fake record ensures endpoint code cannot rely on omitted instrument fields.
      return Object.fromEntries(Object.entries(doc).filter(([key]) => key === 'id' || query.select?.[key]))
    },
  }
  const path = kind === 'share' ? 'share/[id]' : `${kind}/status`
  const source = readFileSync(new URL(`../src/app/(frontend)/api/survey/${path}/route.ts`, import.meta.url), 'utf8')
  const modules: Record<string, unknown> = {
    '@/auth/team': { isTeamUser }, payload: { getPayload: async () => payload }, '@payload-config': { default: {}, cloudflareEnvironment: {} },
    '@/survey/sharing': { participationLinks: (id: number, slug: string) => participationLinks(id, slug, { SURVEY_ORIGIN: 'http://127.0.0.1:3212' }) },
    '@/survey/qr': { participationQR }, '@/survey/notifications': { mailPolicy, readNotificationSettings },
    '@/survey/participation': { participationMode: (survey: Parameters<typeof participationMode>[0]) => participationMode(survey, {}) }, '@/survey/privacy': { readPrivacySettings }, '@/survey/response-store': { responseDatabase: () => 'fixture-db' },
    '@/survey/notification-store': { notificationSummary: async (...args: unknown[]) => { summaries.push(args); return summary } },
    '@/survey/retention-reminders': { retentionSummary: async (...args: unknown[]) => { summaries.push(args); return summary } },
  }
  const exports: { GET?: (request: Request, context: unknown) => Promise<Response> } = {}
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name] }, Response, Request, URL, Uint8Array, process: { env: {} } })
  const get = (query = '', id = '42') => exports.GET!(new Request(`http://localhost/api?surveyID=${id}&${query}`), { params: Promise.resolve({ id }) })
  return { get, queries, summaries, user }
}

function assertQuery(f: ReturnType<typeof route>, kind: keyof typeof selectors) {
  assert.equal(f.queries.length, 1)
  const query = f.queries[0]
  assert.equal(query.user, f.user)
  assert.equal(query.overrideAccess, false)
  assert.equal(query.depth, 0)
  assert.equal(query.id, 42)
  assert.equal(query.collection, 'surveys')
  assert.deepEqual(JSON.parse(JSON.stringify(query.select)), selectors[kind])
  assert.equal(plan(query.select).with, undefined, 'no questionnaire array or block relations in the D1 query')
}

test('installed D1 query compiler omits all nested questionnaire reads for the endpoint projections', () => {
  const full = plan()
  assert.ok(full.with.sections.with.questions.with.options)
  assert.ok(full.with.sections.with.questions.with.rows)
  assert.ok(full.with._blocks_text)
  for (const [kind, select] of Object.entries(selectors)) {
    const projected = plan(select)
    assert.equal(projected.with, undefined, kind)
    assert.equal(projected.with?._blocks_text, undefined, kind)
    assert.equal(projected.columns.id, true, 'Payload retains the ID automatically')
    const projectedDoc = Object.fromEntries(Object.entries(survey).filter(([key]) => key === 'id' || select[key as keyof typeof select]))
    assert.ok(JSON.stringify(projectedDoc).length < JSON.stringify(survey).length / 2, kind)
  }
})

test('sharing preserves links, phase guards, origin checks and real QR output with only projected fields', async () => {
  const f = route('share'), response = await f.get()
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const body = await response.json() as { surveyID: number; title: string; links: { url: string }[] }
  assert.equal(body.surveyID, 42); assert.equal(body.title, survey.title)
  assert.equal(body.links[0].url, 'http://127.0.0.1:3212/f/fixture')
  assertQuery(f, 'share')
  for (const format of ['svg', 'png']) {
    const qr = await route('share').get(`format=${format}&download=1`)
    assert.equal(qr.status, 200)
    assert.match(qr.headers.get('Content-Disposition')!, new RegExp(`attachment; filename="fixture-qr-code.${format}"`))
    assert.equal(qr.headers.get('Cache-Control'), 'no-store')
    assert.equal(qr.headers.get('X-Content-Type-Options'), 'nosniff')
    if (format === 'svg') assert.match(await qr.text(), /^<svg /)
    else assert.deepEqual(Array.from(new Uint8Array(await qr.arrayBuffer()).slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
  }
  for (const phase of ['draft', 'closed']) assert.equal((await route('share', { doc: { ...survey, phase } }).get()).status, 409)
  assert.equal((await route('share').get('format=pdf')).status, 400)
  assert.equal((await route('share').get('format=svg&origin=https://other.invalid')).status, 400)
  assert.equal((await route('share', { doc: { ...survey, slug: '../bad' } }).get()).status, 503)
  await assert.rejects(route('share', { error: new Error('database failure') }).get(), /database failure/)
})

test('notification and retention status preserve settings, summaries and no-store response headers', async () => {
  for (const kind of ['notifications', 'retention'] as const) {
    const f = route(kind), response = await f.get(), body = await response.json() as { surveyID: number; enabled: boolean; budget: { used: number }; counts: unknown; recipients: string[]; deliveryLogURL: string; retentionYears: number; checkedAt: string }
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(body.surveyID, 42); assert.equal(body.enabled, true); assert.equal(body.budget.used, 7)
    assert.deepEqual(body.counts, summary.counts)
    assert.equal(f.summaries[0][0], 'fixture-db'); assert.equal(f.summaries[0][1], 42)
    assertQuery(f, kind)
    if (kind === 'notifications') {
      assert.deepEqual(body.recipients, ['notify@localhost.invalid'])
      assert.equal(body.deliveryLogURL, '/admin/collections/response-notifications?where[survey][equals]=42')
    } else { assert.equal(body.retentionYears, 3); assert.equal(body.checkedAt, summary.checkedAt) }
  }
  await assert.rejects(route('retention', { doc: { ...survey, privacy: { ...survey.privacy, purpose: 123 } } }).get(), /purpose/)
  assert.equal((await route('retention', { user: { collection: 'users', _strategy: 'mcp-api-key' } }).get()).status, 401)
})

test('unauthorized, invalid and missing requests keep existing errors without reading questionnaire contents', async () => {
  for (const kind of ['share', 'notifications', 'retention'] as const) {
    for (const user of [null, { collection: 'other' }]) {
      const f = route(kind, { user }), response = await f.get()
      assert.equal(response.status, 401); assert.equal(f.queries.length, 0)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
    }
    for (const id of ['0', '-1', 'abc', '9007199254740992']) {
      const f = route(kind)
      assert.equal((await f.get('', id)).status, 400); assert.equal(f.queries.length, 0)
    }
    assert.equal((await route(kind, { doc: null }).get()).status, 404)
    assert.equal((await route(kind, { error: { status: 404 } }).get()).status, 404)
    if (kind !== 'share') assert.equal((await route(kind, { error: new Error('database failure') }).get()).status, 404)
  }
})
