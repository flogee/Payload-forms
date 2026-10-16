import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredSurveyOrigins, surveyOriginStatus } from '../src/survey/origins'

const first = 'https://forms.example.org'
const second = 'https://forms.example.net'
const env = { SURVEY_ORIGINS: `${first}, ${second}` }

test('explicit survey origin list allows both exact HTTPS origins', () => {
  assert.deepEqual(configuredSurveyOrigins(env), new Set([first, second]))
  assert.equal(surveyOriginStatus(first, env), null)
  assert.equal(surveyOriginStatus(second, env), null)
  for (const origin of [null, '', 'null', 'https://unknown.example.org', `${first}/`, `${second}.evil.example.org`, `${first} ${second}`]) {
    assert.equal(surveyOriginStatus(origin, env), 403)
  }
})

test('local single-origin fallback remains available but explicit list takes precedence', () => {
  const local = 'http://127.0.0.1:3212'
  assert.equal(surveyOriginStatus(local, { SURVEY_ORIGIN: local }), null)
  assert.equal(surveyOriginStatus(first, { SURVEY_ORIGIN: `${first},${second}` }), 503)
  assert.equal(surveyOriginStatus(local, { ...env, SURVEY_ORIGIN: local }), 403)
  assert.equal(surveyOriginStatus(first, { SURVEY_ORIGINS: '', SURVEY_ORIGIN: first }), 503)
  assert.equal(surveyOriginStatus('http://localhost:3212', { SURVEY_ORIGINS: `${local},http://localhost:3212` }), null)
})

test('missing or malformed origin configuration fails closed before origin authentication', () => {
  assert.equal(surveyOriginStatus(first, {}), 503)
  for (const invalid of ['', ' ', '*', 'https://*.example.org', `${first}/`, `${first}/api`, `${first}?query`, `${first}#hash`, 'https://user:pass@forms.example.net', 'ftp://forms.example.net', 'http://forms.example.net', `${first},`, 'https://forms.example.net:443', 'https://FORMS.example.net']) {
    assert.equal(surveyOriginStatus(first, { SURVEY_ORIGINS: invalid }), 503, invalid)
    assert.equal(surveyOriginStatus(null, { SURVEY_ORIGINS: invalid }), 503, invalid)
  }
})
