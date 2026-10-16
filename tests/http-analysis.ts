import assert from 'node:assert/strict'
import type { SharedAnalysisReport } from '../src/survey/analysis-types'

export async function checkAnalysisHTTP(base: string, token: string, surveyID: number) {
  const auth = { Authorization: `JWT ${token}` }
  for (const suffix of [`surveyID=${surveyID}`, 'demo=1&format=json', 'demo=1&format=svg&seriesID=Q1']) {
    const denied = await fetch(`${base}/api/survey/analysis?${suffix}`)
    assert.equal(denied.status, 401); assert.match(denied.headers.get('cache-control')!, /no-store/)
    await denied.body?.cancel()
  }
  for (const path of ['/auswertung', '/auswertung/demo']) {
    const anonymous = await fetch(base + path), text = await anonymous.text()
    assert.equal(anonymous.status, 200); assert.ok(text.includes('Zum Teamzugang'))
    assert.ok(!text.includes('analysis-overview'), 'anonymous pages contain no statistics')
    const teamPage = await fetch(base + path, { headers: auth }), html = await teamPage.text()
    assert.equal(teamPage.status, 200); assert.ok(html.includes('analysis-overview'))
    assert.ok(!html.includes('HTTP TEST ONLY'), 'team charts do not serialize raw text')
  }
  const demo = await fetch(`${base}/api/survey/analysis?demo=1`, { headers: auth })
  assert.equal(demo.status, 200); assert.match(demo.headers.get('cache-control')!, /no-store/)
  const report = await demo.json() as SharedAnalysisReport
  assert.equal(report.responses, 60); assert.equal(report.survey.version, 'demo-1')
  assert.equal(report.audience, 'aggregate-sharing'); assert.equal(report.minimumGroup, 5)
  assert.equal(report.sections[2].series[1].suppressed, true)
  assert.deepEqual(report.sections[2].series[1].options, [])
  assert.doesNotMatch(JSON.stringify(report), /Demo-Freitext|"answers"/)
  const svg = await fetch(`${base}/api/survey/analysis?demo=1&format=svg&seriesID=Q1`, { headers: auth })
  assert.equal(svg.status, 200); assert.match(svg.headers.get('content-type')!, /image\/svg\+xml/)
  assert.match(svg.headers.get('content-security-policy')!, /sandbox/)
  assert.match(await svg.text(), /Beantwortet: 60/)
  const saved = await fetch(`${base}/api/survey/analysis?surveyID=${surveyID}`, { headers: auth })
  assert.equal(saved.status, 200)
  const result = await saved.json() as SharedAnalysisReport
  assert.equal(result.survey.id, surveyID); assert.equal(result.dataset, 'test')
  assert.doesNotMatch(JSON.stringify(result), /HTTP TEST ONLY|"answers"|"instrument"|"privacyReceipt"/)
  for (const [query, status] of [['surveyID=0', 400], ['surveyID=2147483648', 400], ['surveyID=2147483647', 404], ['demo=1&format=csv', 400], ['demo=1&format=svg&seriesID=invalid', 404]] as const) {
    const bad = await fetch(`${base}/api/survey/analysis?${query}`, { headers: auth })
    assert.equal(bad.status, status); await bad.body?.cancel()
  }
}
