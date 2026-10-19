import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { toStored } from '../src/survey/storage'
import type { Definition } from '../src/survey/types'

export async function checkEvaluationRunsHTTP(base: string, teamToken: string) {
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, token?: string, method = 'POST', origin = base) => request(path, { method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `JWT ${token}` } : {}) }, body: JSON.stringify(data) })
  const fixtureID = randomUUID(), version = `run-fixture-${fixtureID}`
  const definition: Definition = { version, introduction: ['Fictional run pretest only.'], sections: [{ id: 'feedback', title: 'Fixture', questions: [
    { id: 'RATING', block: 'Feedback', kind: 'stars', label: 'Fictional rating', optional: true },
    { id: 'COMMENT', block: 'Feedback', kind: 'textarea', label: 'Fictional comment', optional: true },
  ] }] }
  const created = await json('/api/surveys', { title: 'Fictional run fixture', slug: version, phase: 'pretest', ...toStored(definition) }, teamToken)
  assert.equal(created.status, 201)
  const survey = (await created.json() as any).doc
  const a = { key: randomUUID(), contextRef: randomUUID(), surveyID: survey.id, version, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() }
  const b = { ...a, key: randomUUID(), contextRef: randomUUID() }
  assert.equal((await json('/api/survey/runs', a)).status, 401, 'creation needs an existing team account')
  assert.equal((await json('/api/survey/runs', a, teamToken, 'POST', 'https://foreign.example.invalid')).status, 403)
  const [one, raced] = await Promise.all([json('/api/survey/runs', a, teamToken), json('/api/survey/runs', a, teamToken)])
  assert.deepEqual([one.status, raced.status].sort(), [200, 201], 'racing ensures create exactly one run')
  const runA = await one.json() as any
  await raced.body?.cancel()
  const two = await json('/api/survey/runs', b, teamToken)
  assert.equal(two.status, 201); const runB = await two.json() as any
  assert.equal((await json('/api/survey/runs', { ...a, contextRef: b.contextRef }, teamToken)).status, 409)
  assert.equal((await json('/api/survey/runs', { ...a, unexpected: true }, teamToken)).status, 400)
  const page = await request(runA.participationPath)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /name="referrer" content="no-referrer"/)
  assert.ok(!html.includes(runA.reportCredential.token), 'report access never enters the participation page')
  const urlA = new URL(runA.participationPath, base), urlB = new URL(runB.participationPath, base)
  const credentialA = { key: a.key, token: urlA.searchParams.get('access')! }, credentialB = { key: b.key, token: urlB.searchParams.get('access')! }
  const headerURL = (markup: string) => {
    const href = /<a\b[^>]*href="([^"]+)"[^>]*aria-label="[^"]*Fragebogen Startseite"/.exec(markup)?.[1]
    assert.ok(href, 'the visible questionnaire-home link is rendered')
    return new URL(href.replaceAll('&amp;', '&'), base)
  }
  const header = headerURL(html)
  assert.equal(header.href, urlA.href, 'header navigation preserves exactly this Run and participation grant')
  const reopened = await request(header.pathname + header.search)
  assert.equal(reopened.status, 200)
  assert.equal(headerURL(await reopened.text()).href, urlA.href, 'a reload cannot drop the Run on the next header click')
  assert.equal((await json(`/api/surveys/${survey.id}`, { branding: { mode: 'text', text: 'Fictional scoped header' } }, teamToken, 'PATCH')).status, 200)
  const branded = await request(runA.participationPath)
  assert.equal(branded.status, 200)
  assert.equal(headerURL(await branded.text()).href, urlA.href, 'custom branding retains the same scoped navigation')
  const credentialAfterHeader = { key: header.searchParams.get('run')!, token: header.searchParams.get('access')! }
  const wrongPage = `${urlA.pathname}?run=${b.key}&access=${credentialA.token}`
  assert.equal((await request(wrongPage)).status, 404, 'a wrong run grant never falls back to unscoped participation')
  const submission = (evaluationRun: { key: string; token: string }, rating: number, submissionID = randomUUID()) => ({
    surveyID: survey.id, version, submissionID, confirmTest: true, durationSeconds: 1,
    answers: { RATING: rating, COMMENT: `private-comment-${evaluationRun.key}` }, evaluationRun,
  })
  const first = submission(credentialAfterHeader, 5)
  // Discard the first result, as after a lost acknowledgement; retry the same ID.
  const saved = await json('/api/survey/submit', first)
  assert.equal(saved.status, 201); await saved.body?.cancel()
  const retry = await json('/api/survey/submit', first)
  assert.equal(retry.status, 200); assert.equal((await retry.json() as any).duplicate, true)
  for (let i = 1; i < 6; i++) assert.equal((await json('/api/survey/submit', submission(credentialA, 5))).status, 201)
  for (let i = 0; i < 2; i++) assert.equal((await json('/api/survey/submit', submission(credentialB, 1))).status, 201)
  const small = await json('/api/survey/runs/report', runB.reportCredential)
  assert.equal(small.status, 200); assert.equal((await small.json() as any).report.responses, null)
  for (let i = 2; i < 5; i++) assert.equal((await json('/api/survey/submit', submission(credentialB, 1))).status, 201)
  for (const [run, count, rating] of [[runA, 6, '5'], [runB, 5, '1']] as const) {
    const read = await json('/api/survey/runs/report', run.reportCredential)
    assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store')
    const report = await read.json() as any
    assert.equal(report.report.responses, count)
    assert.equal(report.contextRef, run.contextRef)
    assert.equal(report.report.sections[0].series[0].options.find((o: any) => o.value === rating).count, count)
    assert.ok(!JSON.stringify(report).includes('private-comment'))
  }
  const exportPath = `/api/survey/runs/export?key=${a.key}`
  assert.equal((await request(exportPath)).status, 401, 'raw export needs a human team account, not possession of a group/report grant')
  const exported = await request(exportPath, { headers: { Authorization: `JWT ${teamToken}` } })
  assert.equal(exported.status, 200); assert.match(exported.headers.get('cache-control')!, /no-store/)
  assert.equal(exported.headers.get('referrer-policy'), 'no-referrer')
  assert.match(exported.headers.get('content-disposition')!, /attachment; filename="evaluation-run-[a-f0-9-]+\.json"/)
  const extract = await exported.json() as any
  assert.equal(extract.run.contextRef, a.contextRef); assert.equal(extract.responses.length, 6)
  assert.ok(JSON.stringify(extract).includes(`private-comment-${a.key}`), 'the explicitly protected extract includes raw text, unlike the trainer report')
  assert.ok(!JSON.stringify(extract).includes(`private-comment-${b.key}`))
  assert.ok(!JSON.stringify(extract).includes(runA.reportCredential.token))
  assert.equal((await request(exportPath + '&token=' + runA.reportCredential.token, { headers: { Authorization: `JWT ${teamToken}` } })).status, 400)
  assert.equal((await request(exportPath + '&key=' + b.key, { headers: { Authorization: `JWT ${teamToken}` } })).status, 400)
  assert.equal((await request(exportPath + '&format=csv', { headers: { Authorization: `JWT ${teamToken}` } })).status, 400)
  assert.equal((await json('/api/survey/runs/report', { ...runA.reportCredential, key: b.key })).status, 404)
  assert.equal((await json('/api/survey/runs/report', credentialA)).status, 404, 'participation cannot read a report')
  assert.equal((await json('/api/survey/runs/report', { ...runA.reportCredential, filters: { contextRef: b.contextRef } })).status, 404)
  assert.equal((await json('/api/survey/submit', submission({ ...credentialA, key: b.key }, 5))).status, 404)
  assert.equal((await json('/api/survey/submit', submission(runA.reportCredential, 5))).status, 404)
  assert.equal((await json(`/api/evaluation-runs`, { ...a }, teamToken)).status, 403, 'generic collection writes are denied')
  assert.equal((await json(`/api/surveys/${survey.id}`, { sections: [] }, teamToken, 'PATCH')).status, 400, 'started version stays frozen')
  assert.equal((await json('/api/survey/runs', { key: a.key }, undefined, 'PATCH')).status, 401)
  assert.equal((await json('/api/survey/runs', { key: a.key }, teamToken, 'PATCH')).status, 200)
  assert.equal((await json('/api/survey/runs', { key: a.key }, teamToken, 'PATCH')).status, 200, 'closure is repeatable')
  assert.equal((await request(runA.participationPath)).status, 404)
  assert.equal((await json('/api/survey/submit', submission(credentialA, 5))).status, 403, 'closed run rejects new answers')
  assert.equal((await json('/api/survey/submit', first)).status, 200, 'closed run still confirms an unchanged committed retry')
  const afterClose = await json('/api/survey/runs', a, teamToken)
  assert.equal(afterClose.status, 200); assert.equal((await afterClose.json() as any).state, 'closed', 'ensure never reopens')
  const freshGrant = await request(`/api/survey/runs?key=${a.key}`, { headers: { Authorization: `JWT ${teamToken}` } })
  assert.equal(freshGrant.status, 200)
  const details = await freshGrant.json() as any
  assert.equal(details.participationPath, null)
  assert.equal((await json('/api/survey/runs/report', details.reportCredential)).status, 200, 'closed runs remain reportable')
  assert.equal((await request(runB.participationPath)).status, 200, 'closing A does not close B or the common instrument')
  const legacyPage = await request('/f/sample')
  assert.equal(legacyPage.status, 200, 'legacy participation remains available')
  assert.equal(headerURL(await legacyPage.text()).href, new URL('/f/sample', base).href, 'legacy header navigation stays unscoped')
  console.log('PASS: two evaluation runs, Run-preserving header navigation/submission, native concurrent ensure, scoped grants/reports, lost-ack retry, frozen version, closure and legacy isolation')
}
