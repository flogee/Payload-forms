import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sample } from '../src/survey/sample'
import { toStored } from '../src/survey/storage'
import { erasureConfirmation } from '../src/survey/privacy'

export async function checkNotificationHTTP(base: string, token: string, apiKey: string) {
  const auth = { Authorization: `JWT ${token}` }, mcp = { Authorization: `Bearer ${apiKey}` }
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, method = 'POST') => request(path, { method,
    headers: { ...auth, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(data) })
  const status = async (result: Promise<Response>, expected: number, label: string) => {
    const response = await result; assert.equal(response.status, expected, label); await response.body?.cancel()
  }
  await status(request('/api/survey/notifications/status?surveyID=1'), 401, 'notification settings require a team session')
  await status(request('/api/survey/notifications/status?surveyID=1', { headers: mcp }), 401, 'MCP keys do not gain notification access')
  await status(request('/api/survey/notifications/status?surveyID=not-an-id', { headers: auth }), 400, 'notification status validates the form ID')
  const slug = `mail-test-${randomUUID()}`
  const fields = { title: 'MAIL TEST ONLY', slug, phase: 'draft', ...toStored({ ...sample, version: slug }) }
  await status(json('/api/surveys', { ...fields, notifications: { enabled: true, recipients: '' } }), 400, 'enabled mail requires recipients')
  const created = await json('/api/surveys', { ...fields, notifications: { enabled: false, recipients: 'notify@localhost.invalid' } })
  assert.equal(created.status, 201)
  const survey = (await created.json() as any).doc
  await status(json(`/api/surveys/${survey.id}`, { phase: 'pretest' }, 'PATCH'), 200, 'open the dummy pretest')
  await status(json(`/api/surveys/${survey.id}`, { notifications: { enabled: true, recipients: ' NOTIFY@LOCALHOST.INVALID,notify@localhost.invalid ' } }, 'PATCH'), 200, 'mail settings remain mutable on a frozen instrument')
  const teamSurvey = await (await request(`/api/surveys/${survey.id}?depth=0`, { headers: auth })).json() as any
  assert.equal(teamSurvey.notifications.recipients, 'notify@localhost.invalid', 'team reads retain operational addresses')
  const reordered = (value: any): any => Array.isArray(value) ? value.map(reordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reordered(child)])) : value
  const instrumentFields = Object.fromEntries(['title', 'slug', 'version', 'introduction', 'sections', 'privacy'].map(key => [key, reordered(teamSurvey[key])]))
  await status(json(`/api/surveys/${survey.id}`, { ...instrumentFields, notifications: { enabled: true, recipients: 'notify@localhost.invalid' } }, 'PATCH'),
    200, 'admin serialization may reorder object keys while changing operational settings')
  const changedSections = structuredClone(teamSurvey.sections)
  changedSections[0].questions[0].label = 'Forbidden instrument edit'
  await status(json(`/api/surveys/${survey.id}`, { sections: changedSections }, 'PATCH'), 400, 'actual frozen instrument changes still fail')
  for (const args of [{ id: String(survey.id) }, { where: JSON.stringify({ id: { equals: survey.id } }) },
    { id: String(survey.id), select: JSON.stringify({ notifications: true, title: true }) }]) {
    const found = await request('/api/mcp', { method: 'POST', headers: { ...mcp, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'findSurveys', arguments: args } }) })
    assert.equal(found.status, 200)
    const text = await found.text()
    assert.ok(text.includes('MAIL TEST ONLY'), 'MCP can still read the allowed questionnaire')
    assert.ok(!text.includes('notify@localhost.invalid') && !text.includes('notifications'), 'MCP form reads never disclose notification settings, including explicit select')
  }
  const body = { surveyID: survey.id, version: slug, submissionID: randomUUID(), confirmTest: true, durationSeconds: 2, answers: { F01_name: 'MAIL HTTP DUMMY' } }
  const saved = await json('/api/survey/submit', body)
  assert.equal(saved.status, 201)
  const responseID = (await saved.json() as any).id
  const response = await request(`/api/responses/${responseID}?depth=0`, { headers: auth })
  const record = await response.json() as any
  assert.match(record.notificationReference, /^[a-f0-9-]{36}$/)
  await status(json('/api/survey/submit', body), 200, 'exact submission retry does not duplicate a notification')
  const info = async () => (await (await request(`/api/survey/notifications/status?surveyID=${survey.id}`, { headers: auth })).json() as any)
  let summary = await info()
  assert.equal(summary.configured, true, 'the isolated local sender is configured')
  assert.deepEqual(summary.recipients, ['notify@localhost.invalid'])
  assert.equal(summary.counts.pending, 1)
  const privateLink = `/antwort/${record.notificationReference}`
  const anonymous = await request(privateLink)
  assert.ok(!(await anonymous.text()).includes('MAIL HTTP DUMMY'), 'the notification reference never grants anonymous answer access')
  const apiKeyPage = await request(privateLink, { headers: mcp })
  assert.ok(!(await apiKeyPage.text()).includes('MAIL HTTP DUMMY'), 'MCP credentials cannot open notification answers')
  const teamPage = await request(privateLink, { headers: auth })
  assert.equal(teamPage.status, 200)
  assert.ok((await teamPage.text()).includes('MAIL HTTP DUMMY'), 'team members view the answer identified by the permanent reference')
  await status(request('/api/response-notifications', { headers: mcp }), 403, 'delivery log is unavailable to MCP keys')
  await status(json('/api/response-notifications', { response: responseID, survey: survey.id, recipient: 'notify@localhost.invalid', status: 'pending', attempts: 0, responseReference: randomUUID() }), 403, 'staff cannot bypass the atomic queue')
  if (process.env.TEST_SCHEDULED === '1') {
    await status(request('/__scheduled?cron=' + encodeURIComponent('*/5 * * * *')), 200, 'the real local Worker runs its scheduled sender')
    const monitoring = await (await request('/api/survey/media/status', { headers: auth })).json() as any
    assert.equal(monitoring.warnings.configured, true, 'operational warning recipient is configured in the real Worker')
    assert.equal(monitoring.warnings.stale, false, 'the scheduled Worker performed its quota check')
    assert.ok(monitoring.warnings.checkedAt, 'successful check persists a heartbeat')
    summary = await info()
    assert.equal(summary.counts.sent, 1, 'Cloudflare local email simulator accepts the notification')
    assert.equal(summary.budget.used, 1)
  }
  await status(json(`/api/surveys/${survey.id}`, { notifications: { enabled: false } }, 'PATCH'), 200, 'staff can stop future notifications without changing the instrument')
  await status(json('/api/survey/submit', { ...body, submissionID: randomUUID() }), 201, 'mail disabled does not block answer storage')
  summary = await info()
  assert.equal(summary.counts.pending + summary.counts.sent, 1, 'no new mail is queued while disabled')
  await status(json(`/api/survey/responses/${responseID}/privacy`, { confirmation: erasureConfirmation(responseID), reason: 'test-cleanup',
    expectedUpdatedAt: record.updatedAt, expectedSubmissionKey: record.submissionKey, copiesReviewed: true }), 200, 'erasure removes the response and its mail queue')
  await status(request(privateLink, { headers: auth }), 404, 'old notification links no longer resolve after erasure')
  assert.equal(Object.values((await info()).counts).reduce((n: number, count: any) => n + count, 0), 0)
  await status(json('/api/survey/submit', body), 410, 'erased submission retries cannot regenerate emails')
  console.log('PASS: editable per-form notification settings, team/MCP boundaries, atomic queue, duplicates, protected permanent links, erasure' + (process.env.TEST_SCHEDULED === '1' ? ', and scheduled Cloudflare local sending.' : '.'))
}
