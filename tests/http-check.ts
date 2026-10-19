import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fromStored, toStored } from '../src/survey/storage'
import { sample } from '../src/survey/sample'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { checkPrivacyHTTP } from './http-privacy'
import { checkNotificationHTTP } from './http-notifications'
import { checkContentHTTP } from './http-content'
import { checkRetentionHTTP } from './http-retention'
import { checkTeamHTTP } from './http-team'
import { checkSurveyToolsHTTP } from './http-survey-tools'
import { checkAnalysisHTTP } from './http-analysis'
import { checkVotingHTTP } from './http-voting'
import { checkEvaluationRunsHTTP } from './http-evaluation-runs'
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3212'
const request = async (path: string, init?: RequestInit) => fetch(base + path, init)
const json = async (path: string, data: unknown, token?: string, method = 'POST') => request(path, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...(token ? { Authorization: `JWT ${token}` } : {}) }, body: JSON.stringify(data) })
const entry = await request('/', { redirect: 'manual' })
assert.equal(entry.status, 307, 'the base address opens the team entry rather than a particular form')
assert.equal(entry.headers.get('location'), '/admin')
await entry.body?.cancel()
if (process.env.TEST_FIRST_USER === '1') {
  const setup = await request('/admin/create-first-user')
  assert.equal(setup.status, 200, 'fresh database exposes first-account setup')
  assert.ok((await setup.text()).includes('To begin, create your first user.'))
  const first = await json('/api/users/first-register', { email: process.env.PROTOTYPE_ADMIN_EMAIL, password: process.env.PROTOTYPE_ADMIN_PASSWORD })
  assert.equal(first.status, 200, 'first account is created and logged in with Unicode and special characters')
  const createdUser = (await first.json() as any).user
  assert.equal(createdUser.email, process.env.PROTOTYPE_ADMIN_EMAIL)
  for (const field of ['hash', 'salt', 'password']) assert.ok(!(field in createdUser), 'password material stays private')
  const repeated = await json('/api/users/first-register', { email: 'second@localhost.invalid', password: process.env.PROTOTYPE_ADMIN_PASSWORD })
  assert.equal(repeated.status, 403, 'first-account registration closes after the first account')
  await repeated.body?.cancel()
  const anonymous = await json('/api/users', { email: 'third@localhost.invalid', password: process.env.PROTOTYPE_ADMIN_PASSWORD })
  assert.equal(anonymous.status, 403, 'ordinary anonymous account creation remains forbidden')
  await anonymous.body?.cancel()
  const invalidLogin = await json('/api/users/login', { email: process.env.PROTOTYPE_ADMIN_EMAIL, password: process.env.PROTOTYPE_ADMIN_PASSWORD + '-wrong' })
  assert.equal(invalidLogin.status, 401, 'wrong passwords cannot log in')
  await invalidLogin.body?.cancel()
}
const login = await json('/api/users/login', { email: process.env.PROTOTYPE_ADMIN_EMAIL, password: process.env.PROTOTYPE_ADMIN_PASSWORD })
assert.equal(login.status, 200, 'local staff login')
let { token, user } = await login.json() as { token: string; user: { id: number } }
if (process.env.TEST_FIRST_USER === '1') {
  const changedPassword = process.env.PROTOTYPE_ADMIN_PASSWORD + '-changed·💡'
  const changed = await json(`/api/users/${user.id}`, { password: changedPassword }, token, 'PATCH')
  assert.equal(changed.status, 200, 'staff can change their password with special characters')
  await changed.body?.cancel()
  const oldPassword = await json('/api/users/login', { email: process.env.PROTOTYPE_ADMIN_EMAIL, password: process.env.PROTOTYPE_ADMIN_PASSWORD })
  assert.equal(oldPassword.status, 401, 'password changes invalidate the old password')
  await oldPassword.body?.cancel()
  const newPassword = await json('/api/users/login', { email: process.env.PROTOTYPE_ADMIN_EMAIL, password: changedPassword })
  assert.equal(newPassword.status, 200, 'the changed password can log in')
  const changedToken = (await newPassword.json() as { token: string }).token
  const restored = await json(`/api/users/${user.id}`, { password: process.env.PROTOTYPE_ADMIN_PASSWORD }, changedToken, 'PATCH')
  assert.equal(restored.status, 200)
  await restored.body?.cancel()
  const freshLogin = await json('/api/users/login', { email: process.env.PROTOTYPE_ADMIN_EMAIL, password: process.env.PROTOTYPE_ADMIN_PASSWORD })
  assert.equal(freshLogin.status, 200)
  token = (await freshLogin.json() as { token: string }).token
}
const auth = { Authorization: `JWT ${token}` }
// Exercise the real compiled route in Next and native Worker CI. A new machine
// endpoint must remain closed by default, including for an ordinary team user.
for (const headers of [{}, auth]) {
  const disabled = await request('/api/integrations/qa', {method: 'POST',
    headers: {'Content-Type':'application/json',Origin:base,...headers},
    body: JSON.stringify({action:'report',key:randomUUID()})})
  assert.equal(disabled.status, 404, 'machine QA route stays disabled without explicit configuration')
  assert.match(disabled.headers.get('cache-control')!, /no-store/)
  assert.equal((await disabled.json() as {error:string}).error, 'Schnittstelle nicht verfügbar.')
}
const surveyResult = await request('/api/surveys?limit=1&where[slug][equals]=sample', { headers: auth })
let survey = ((await surveyResult.json()) as any).docs[0]
if (!survey && process.env.TEST_FIRST_USER === '1') {
  const seeded = await json('/api/surveys', { title: 'Fictional sample questionnaire', slug: 'sample', phase: 'pretest', ...toStored(sample) }, token)
  assert.equal(seeded.status, 201, 'staff can create the disposable test instrument')
  survey = (await seeded.json() as { doc: any }).doc
}
const formPage = await request('/f/sample')
assert.equal(formPage.status, 200, 'published form has its own participation page')
const formHTML = await formPage.text()
assert.match(formHTML, /<button[^>]*>Hinweise zum Datenschutz<\/button>/, 'legacy pretests have a visible privacy button')
assert.ok(formHTML.includes('Pretest mit erfundenen Angaben'), 'legacy pretests explain their limited test use')
assert.equal((await request('/f/no-such-form')).status, 404, 'unknown form stays unavailable')
const sharePath = `/api/survey/share/${survey.id}`
assert.equal((await request(sharePath)).status, 401, 'sharing controls require staff login')
assert.equal((await request(sharePath + '?format=png')).status, 401, 'QR download requires staff login')
const sharing = await request(sharePath, { headers: auth })
assert.equal(sharing.status, 200)
const shared = await sharing.json() as { links: { origin: string; url: string; qrSVG: string; qrPNG: string }[] }
assert.deepEqual(shared.links.map(link => link.origin), [base, ...(process.env.TEST_SECOND_ORIGIN ? [process.env.TEST_SECOND_ORIGIN] : [])])
for (const link of shared.links) {
  assert.equal(link.url, `${link.origin}/f/sample`)
  const qr = await request(link.qrPNG + '&download=1', { headers: auth })
  assert.equal(qr.status, 200)
  assert.equal(qr.headers.get('content-type'), 'image/png')
  assert.equal(qr.headers.get('cache-control'), 'no-store')
  assert.match(qr.headers.get('content-disposition') || '', /^attachment; filename="sample-qr-code.png"$/)
  const png = PNG.sync.read(Buffer.from(await qr.arrayBuffer()))
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, link.url, 'downloaded QR opens the exact selected form and domain')
  const svg = await request(link.qrSVG + '&download=1', { headers: auth })
  assert.equal(svg.status, 200)
  assert.match(svg.headers.get('content-type') || '', /^image\/svg\+xml/)
  assert.match(await svg.text(), /^<svg /)
}
assert.equal((await request(sharePath + '?format=png&origin=https://unapproved.example.invalid', { headers: auth })).status, 400, 'QR cannot point to an arbitrary origin')
assert.equal((await request(sharePath + '?format=pdf', { headers: auth })).status, 400, 'unsupported QR format is rejected')
assert.equal((await request('/api/survey/share/invalid', { headers: auth })).status, 400)
assert.equal((await request('/api/survey/share/2147483647', { headers: auth })).status, 404)
assert.equal(survey.sections.length, 6)
assert.equal(survey.sections.reduce((n: number, s: any) => n + s.questions.length, 0), 45)
// Exercise Payload's real server-rendered list, not just an equivalent REST query.
// Only active columns belong in its rows; the edit/API record above stays complete.
const listColumns = encodeURIComponent(JSON.stringify(['title', 'version', 'phase']))
const listPage = await request(`/admin/collections/surveys?columns=${listColumns}`, { headers: auth })
assert.equal(listPage.status, 200, 'authenticated questionnaire list renders')
const listHTML = await listPage.text()
assert.ok(listHTML.includes(survey.title), 'the list retains its document title')
assert.ok(listHTML.includes(survey.version), 'the list retains its version')
assert.ok(listHTML.includes(`/admin/collections/surveys/${survey.id}`), 'the list retains the edit link')
assert.ok(!listHTML.includes('F01_name'), 'the list does not serialize unselected questionnaire contents')
const body = { surveyID: survey.id, version: survey.version, submissionID: randomUUID(), confirmTest: true, durationSeconds: 2, answers: { F01_name: 'HTTP TEST ONLY', F06_people: { r1: { status: 'value', value: 0 }, r2: { status: 'unknown' }, r3: { status: 'na' } }, F19_dates: { choice: '3' }, F19_reminders: { choice: ['1'] }, F19_adhoc: { choice: '1' } } }
const saved = await json('/api/survey/submit', body)
assert.equal(saved.status, 201)
const savedBody = await saved.json() as { id: number }
const submitFromOrigin = (origin: string | null, submissionID = randomUUID()) => request('/api/survey/submit', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify({ ...body, submissionID }),
})
if (process.env.TEST_SECOND_ORIGIN) {
  assert.notEqual(process.env.TEST_SECOND_ORIGIN, base, 'second allowed origin differs from the first')
  const secondSaved = await submitFromOrigin(process.env.TEST_SECOND_ORIGIN)
  assert.equal(secondSaved.status, 201, 'second configured origin can store test data')
  await secondSaved.body?.cancel()
}
for (const origin of [null, 'https://unapproved.example.invalid']) {
  const rejected = await submitFromOrigin(origin)
  assert.equal(rejected.status, 403, 'missing and foreign origins are rejected')
  await rejected.body?.cancel()
}
const duplicate = await json('/api/survey/submit', body)
assert.equal(duplicate.status, 200)
assert.equal((await duplicate.json() as any).id, savedBody.id)
const response = await request(`/api/responses/${savedBody.id}?depth=0`, { headers: auth })
const doc = await response.json() as any
assert.equal(doc.answers.F06_people.r1.value, 0)
assert.equal(doc.answers.F06_people.r2.status, 'unknown')
assert.equal(doc.answers.F06_people.r3.status, 'na')
assert.ok(!doc.answers.F06_people.r4)
assert.ok(!doc.answers.F19_reminders)
assert.equal(doc.instrument.version, survey.version)
assert.equal((await request('/api/responses')).status, 403)
assert.equal((await request('/api/survey/export')).status, 401)
assert.equal((await json('/api/responses', { answers: {} })).status, 403)
assert.equal((await json('/api/survey/submit', { ...body, answers: { F03_legal: { choice: 'INVALID' } } })).status, 400)
assert.equal((await json('/api/survey/submit', { ...body, confirmTest: false })).status, 400)
assert.equal((await json('/api/survey/submit', { ...body, version: 'wrong' })).status, 409)
assert.equal((await json(`/api/surveys/${survey.id}`, { title: 'Changed frozen version' }, token, 'PATCH')).status, 400)
const csv = await request('/api/survey/export', { headers: auth })
assert.equal(csv.status, 200)
assert.ok((await csv.text()).includes('F06_people_r1_status'))
const apiKey = randomUUID() + randomUUID()
const keyResponse = await json('/api/payload-mcp-api-keys', { label: 'Local integration test', enableAPIKey: true, apiKey, surveys: { find: true }, 'payload-mcp-tool': { createSurveyDraft: true, updateSurveyDraft: true, surveyStatistics: true } }, token)
assert.equal(keyResponse.status, 201)
const mcp = async (method: string, params: unknown, key = apiKey, allowEmptyToolList = false) => {
  const response = await request('/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const text = await response.text()
  const data = text.includes('data: ') ? JSON.parse(text.split('\n').find(line => line.startsWith('data: '))!.slice(6)) : JSON.parse(text)
  assert.equal(response.status, 200)
  assert.ok(!data.error || (allowEmptyToolList && method === 'tools/list' && data.error.code === -32601), `MCP error: ${JSON.stringify(data.error)}`)
  return data
}
const tools = (await mcp('tools/list', {})).result.tools.map((t: any) => t.name)
console.log('MCP tools:', tools.join(', '))
assert.ok(tools.includes('surveyStatistics'))
assert.ok(tools.includes('createSurveyDraft'))
assert.ok(!tools.some((x: string) => /delete|responses|contacts|erasure/i.test(x)))
assert.ok(!tools.includes('createSurveys') && !tools.includes('updateSurveys'))
const noPrivilegesKey = randomUUID() + randomUUID()
const noPrivileges = await json('/api/payload-mcp-api-keys', { label: 'Local default-deny test', enableAPIKey: true, apiKey: noPrivilegesKey }, token)
assert.equal(noPrivileges.status, 201)
const noTools = await mcp('tools/list', {}, noPrivilegesKey, true)
assert.ok(noTools.error?.code === -32601 || noTools.result?.tools?.length === 0, 'new keys have no tools by default')
const statistics = await mcp('tools/call', { name: 'surveyStatistics', arguments: { surveyID: survey.id } })
assert.ok(!JSON.stringify(statistics).includes('HTTP TEST ONLY'))
assert.ok(JSON.stringify(statistics).includes('responses'))
const demoStatistics = await mcp('tools/call', { name: 'surveyStatistics', arguments: { demo: true } })
const demoAnalysis = JSON.parse(demoStatistics.result.content[0].text)
assert.equal(demoAnalysis.responses, 60, 'MCP can run the fully fictional report without real submissions')
assert.equal(demoAnalysis.minimumGroup, 5)
assert.equal(demoAnalysis.sections[2].series[1].suppressed, true)
assert.doesNotMatch(JSON.stringify(demoAnalysis), /Demo-Freitext|"answers"/)
await checkAnalysisHTTP(base, token, survey.id)
await checkEvaluationRunsHTTP(base, token)
await checkVotingHTTP(base, token)
const draftSlug = `mcp-test-${randomUUID()}`
const draftInstrument = { ...fromStored(survey), version: draftSlug }
const created = await mcp('tools/call', { name: 'createSurveyDraft', arguments: { title: 'MCP TEST ONLY', slug: draftSlug, definition: draftInstrument } })
assert.ok(!created.result.isError && JSON.stringify(created).includes('draft'), `MCP creates a full questionnaire draft: ${JSON.stringify(created).slice(0, 1400)}`)
const draftResult = await request(`/api/surveys?where[slug][equals]=${draftSlug}`, { headers: auth })
const draftSurvey = (await draftResult.json() as any).docs[0]
const draftPage = await request(`/f/${draftSlug}`)
assert.equal(draftPage.status, 404, 'draft is not a participant form')
assert.ok(!(await draftPage.text()).includes('MCP TEST ONLY'), 'draft title is not disclosed to participants')
assert.equal((await request(`/api/survey/share/${draftSurvey.id}`, { headers: auth })).status, 409, 'draft cannot be shared as published')
assert.equal((await request(`/api/survey/share/${draftSurvey.id}?format=svg`, { headers: auth })).status, 409, 'draft has no publishable QR')
assert.equal(draftSurvey.sections.reduce((n: number, s: any) => n + s.questions.length, 0), 45)
const updated = await mcp('tools/call', { name: 'updateSurveyDraft', arguments: { surveyID: draftSurvey.id, title: 'MCP TEST UPDATED', slug: draftSlug, definition: draftInstrument } })
assert.ok(!updated.result.isError, 'MCP updates drafts')
const updatedSurvey = await request(`/api/surveys/${draftSurvey.id}`, { headers: auth })
assert.equal((await updatedSurvey.json() as any).title, 'MCP TEST UPDATED')
const frozen = await mcp('tools/call', { name: 'updateSurveyDraft', arguments: { surveyID: survey.id, title: 'MCP attempted frozen edit', slug: survey.slug, definition: fromStored(survey) } })
assert.ok(JSON.stringify(frozen).includes('eingefroren'), 'MCP also respects frozen instrument versions')
assert.equal((await json(`/api/surveys/${draftSurvey.id}`, { phase: 'live' }, token, 'PATCH')).status, 400, 'real collection remains blocked')
assert.equal((await json(`/api/surveys/${draftSurvey.id}`, { phase: 'pretest' }, token, 'PATCH')).status, 200, 'saving pretest opens participation')
const opened = await request(`/f/${draftSlug}`)
assert.equal(opened.status, 200)
assert.ok((await opened.text()).includes('MCP TEST UPDATED'), 'participant page uses this form title')
const draftSharing = await request(`/api/survey/share/${draftSurvey.id}`, { headers: auth })
assert.equal(draftSharing.status, 200)
assert.equal((await draftSharing.json() as any).links[0].url, `${base}/f/${draftSlug}`)
const draftAnswers = { ...body, surveyID: draftSurvey.id, version: draftInstrument.version, submissionID: randomUUID() }
const draftSaved = await json('/api/survey/submit', draftAnswers)
assert.equal(draftSaved.status, 201, 'new form stores its own response')
const draftResponse = await request(`/api/responses/${(await draftSaved.json() as any).id}?depth=0`, { headers: auth })
assert.equal((await draftResponse.json() as any).survey, draftSurvey.id, 'response belongs to the shared form')
assert.equal((await json(`/api/surveys/${draftSurvey.id}`, { slug: 'changed-participation-link' }, token, 'PATCH')).status, 400, 'published link stays stable')
assert.equal((await json(`/api/surveys/${draftSurvey.id}`, { phase: 'closed' }, token, 'PATCH')).status, 200)
assert.equal((await request(`/f/${draftSlug}`)).status, 404, 'closed form cannot be filled in')
assert.equal((await request(`/api/survey/share/${draftSurvey.id}?format=png`, { headers: auth })).status, 409, 'closed form cannot generate active invitation QR')
assert.equal((await json('/api/survey/submit', { ...draftAnswers, submissionID: randomUUID() })).status, 403, 'closed form cannot accept late answers')
assert.equal((await request('/f/sample')).status, 200, 'closing one form leaves the Sample pretest available')
await checkPrivacyHTTP(base, token, apiKey)
await checkNotificationHTTP(base, token, apiKey)
await checkContentHTTP(base, token, apiKey)
await checkRetentionHTTP(base, token, apiKey)
await checkSurveyToolsHTTP(base, token, apiKey)
await checkTeamHTTP(base, token, user.id)
console.log('PASS: form participation links, decoded QR downloads, draft/publication/closure boundaries, full Sample schema, stored statuses, hidden branch stripping, duplicate protection, validation, access restrictions, frozen version, CSV export, MCP aggregate tool and MCP draft creation/update.')
