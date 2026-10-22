import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realFixtureSlug } from './http-real-surveys'

const base = process.env.TEST_BASE_URL!
const login = await fetch(`${base}/api/users/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ email: process.env.PROTOTYPE_ADMIN_EMAIL, password: process.env.PROTOTYPE_ADMIN_PASSWORD }) })
assert.equal(login.status, 200)
const auth = { Authorization: `JWT ${(await login.json() as any).token}` }
const found = await fetch(`${base}/api/surveys?where[slug][equals]=${realFixtureSlug}&depth=0`, { headers: auth })
const survey = (await found.json() as any).docs[0]
assert.equal(survey.phase, 'live', 'runtime shutdown never relabels a saved instrument')
for (const path of [`/f/${realFixtureSlug}`, `/datenschutz/${realFixtureSlug}`, `/f/${realFixtureSlug}/images/${survey.introContent[0].image}`]) {
  const response = await fetch(base + path)
  assert.equal(response.status, 404, path)
  await response.body?.cancel()
}
const sharing = await fetch(`${base}/api/survey/share/${survey.id}`, { headers: auth })
assert.equal(sharing.status, 409)
await sharing.body?.cancel()
const submission = await fetch(`${base}/api/survey/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ surveyID: survey.id, version: survey.version, submissionID: randomUUID(), confirmParticipation: true, durationSeconds: 2, answers: {} }) })
assert.equal(submission.status, 403)
await submission.body?.cancel()
const responses = await fetch(`${base}/api/responses?where[survey][equals]=${survey.id}`, { headers: auth })
const records = (await responses.json() as any).docs
assert.equal(records.length, 2)
assert.ok(records.every((response: any) => response.testOnly === false))
const pretest = await fetch(`${base}/f/sample`)
assert.equal(pretest.status, 200, 'runtime shutdown leaves fictional participation available')
await pretest.body?.cancel()
console.log('PASS: disabling the runtime flag on an enabled build closes real participation, notice, images, sharing and submissions without changing stored responses or fictional pretests.')
