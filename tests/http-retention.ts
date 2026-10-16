import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sample } from '../src/survey/sample'
import { toStored } from '../src/survey/storage'
import { privacyNotice } from '../src/survey/privacy'
import { privacyHash } from '../src/survey/privacy-crypto'
import { retentionReviewDueAt } from '../src/survey/retention-policy'
import { testPrivacy } from './privacy-fixture'

export async function checkRetentionHTTP(base: string, token: string, apiKey: string) {
  const auth = { Authorization: `JWT ${token}` }, mcp = { Authorization: `Bearer ${apiKey}` }
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, method = 'POST', headers: Record<string, string> = auth) => request(path, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(data),
  })
  const status = async (pending: Promise<Response>, expected: number, label: string) => {
    const result = await pending; assert.equal(result.status, expected, label); await result.body?.cancel()
  }
  const path = '/api/survey/retention/status'
  await status(request(path + '?surveyID=1'), 401, 'anonymous users cannot read retention status')
  await status(request(path + '?surveyID=1', { headers: mcp }), 401, 'MCP identities cannot read retention status')
  await status(request(path + '?surveyID=0', { headers: auth }), 400, 'retention status validates IDs')
  for (const collection of ['retention-reminders', 'retention-reminder-monitor']) {
    await status(request(`/api/${collection}`, { headers: auth }), 403, 'retention internals remain protected')
    await status(json(`/api/${collection}/1`, { status: 'pending', checkedAt: new Date().toISOString() }, 'PATCH'), 403, 'retention state cannot be reset')
  }
  const slug = `retention-test-${randomUUID()}`, privacy = testPrivacy({ retentionYears: 3 })
  await status(json('/api/surveys', { title: 'RETENTION DUMMY', slug: `${slug}-bad`, phase: 'draft', ...toStored({ ...sample, version: `${slug}-bad` }), retentionReminders: { enabled: true } }), 400, 'reminders require an explicit privacy policy and years')
  await status(json('/api/surveys', { title: 'RETENTION DUMMY', slug: `${slug}-decimal`, phase: 'draft', privacy: { ...privacy, retentionYears: 1.5 }, ...toStored({ ...sample, version: `${slug}-decimal` }) }), 400, 'fractional retention years are rejected')
  const created = await json('/api/surveys', { title: 'RETENTION DUMMY', slug, phase: 'draft', privacy,
    retentionReminders: { enabled: true }, ...toStored({ ...sample, version: slug }) })
  assert.equal(created.status, 201)
  const survey = (await created.json() as any).doc
  const multipart = new FormData()
  const nativeData = JSON.stringify({ ...survey, retentionReminders: { enabled: false } })
  assert.ok(new TextEncoder().encode(nativeData).length > 10000, 'the full Sample edit exceeds the former upload metadata limit')
  multipart.set('_payload', nativeData)
  await status(request(`/api/surveys/${survey.id}`, { method: 'PATCH', headers: { ...auth, Origin: base }, body: multipart }), 200, 'native multipart admin edits save the full Sample questionnaire')
  const oversized = new FormData()
  oversized.set('_payload', ' '.repeat(1024 * 1024 + 1))
  await status(request(`/api/surveys/${survey.id}`, { method: 'PATCH', headers: { ...auth, Origin: base }, body: oversized }), 413, 'admin form metadata remains bounded')
  await status(json(`/api/surveys/${survey.id}`, { phase: 'pretest' }, 'PATCH'), 200, 'configured dummy pretest opens')
  await status(json(`/api/surveys/${survey.id}`, { privacy: { ...privacy, retentionYears: 4 } }, 'PATCH'), 400, 'retention policy stays frozen after opening')
  await status(json(`/api/surveys/${survey.id}`, { retentionReminders: { enabled: false } }, 'PATCH'), 200, 'staff can disable operational reminders after opening')
  await status(json(`/api/surveys/${survey.id}`, { retentionReminders: { enabled: true } }, 'PATCH'), 200, 'staff can enable operational reminders after opening')
  const notice = privacyNotice(privacy)!
  const body = { surveyID: survey.id, version: slug, submissionID: randomUUID(), confirmTest: true, durationSeconds: 2,
    answers: { F01_name: 'RETENTION HTTP DUMMY' }, privacy: { noticeHash: privacyHash(notice), consent: true, contactConsent: false } }
  const saved = await json('/api/survey/submit', body, 'POST', {})
  assert.equal(saved.status, 201)
  const id = (await saved.json() as any).id
  const doc = await (await request(`/api/responses/${id}?depth=0`, { headers: auth })).json() as any
  assert.equal(doc.retentionReviewDueAt, retentionReviewDueAt(doc.createdAt, 3), 'submission gets an immutable calendar deadline')
  const statusResponse = await request(path + `?surveyID=${survey.id}`, { headers: auth })
  assert.equal(statusResponse.status, 200)
  assert.equal(statusResponse.headers.get('cache-control'), 'no-store')
  const info = await statusResponse.json() as any
  assert.equal(info.retentionYears, 3)
  assert.equal(info.enabled, true)
  assert.deepEqual(info.counts, { within90: 0, within30: 0, overdue: 0, unconfigured: 0 })
  assert.equal(info.latest, null, 'future deadlines generate no reminders')
  if (process.env.TEST_SCHEDULED === '1') {
    await status(request('/__scheduled?cron=' + encodeURIComponent('*/5 * * * *')), 200, 'real scheduled Worker runs retention checker')
    const checked = await (await request(path + `?surveyID=${survey.id}`, { headers: auth })).json() as any
    assert.equal(checked.stale, false)
    assert.ok(checked.checkedAt)
    assert.equal(checked.latest, null, 'cron does not mail for future deadlines')
  }
  console.log('PASS: retention policy, immutable deadline, staff/MCP boundaries and reminder status' + (process.env.TEST_SCHEDULED === '1' ? ', real scheduled Worker.' : '.'))
}
