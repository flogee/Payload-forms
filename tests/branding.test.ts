import test from 'node:test'
import assert from 'node:assert/strict'
import { readBranding, surveyImageIDs } from '../src/survey/branding'
import { sample } from '../src/survey/sample'
import { fromStored, toStored } from '../src/survey/storage'
import { duplicateDraftData, questionnaireExport, questionnaireMarkdown } from '../src/survey/survey-tools'

test('branding normalizes native relationships and ignores inactive fields without changing legacy instruments', () => {
  for (const value of [undefined, null, {}, { mode: null, text: null, logo: null }]) assert.deepEqual(readBranding(value), { mode: 'default' })
  assert.deepEqual(readBranding({ mode: 'text', text: '  Seminarteam  ', logo: { id: 7 } }), { mode: 'text', text: 'Seminarteam' })
  assert.deepEqual(readBranding({ mode: 'logo', text: 'Seminarteam', logo: { id: 7, filename: 'private.png' } }), { mode: 'logo', text: 'Seminarteam', logo: 7 })
  assert.deepEqual(readBranding({ mode: 'default', text: 'Unused', logo: 7 }), { mode: 'default' })
  assert.deepEqual(fromStored({ ...toStored(sample), branding: { mode: 'text', text: 'Seminarteam' } }), JSON.parse(JSON.stringify(sample)))
  const invalid: unknown[] = [[], 'text', { mode: 'unknown' }, { mode: 'text', text: ' ' }, { mode: 'logo', text: 'Logo' },
    { mode: 'text', text: 'x'.repeat(101) }, ...[0, -1, 1.5, 2147483648, 'https://example.invalid/image.png'].map(logo => ({ mode: 'logo', text: 'Logo', logo }))]
  for (const value of invalid) {
    assert.throws(() => readBranding(value))
  }
})

test('only the selected header logo joins the questionnaire image allowlist', () => {
  assert.deepEqual(surveyImageIDs(sample, readBranding({ mode: 'logo', text: 'Team', logo: 7 })), [7])
  assert.deepEqual(surveyImageIDs(sample, readBranding({ mode: 'text', text: 'Team', logo: 7 })), [])
  const definition = { ...sample, introContent: [{ blockType: 'image' as const, image: 7, alt: 'Image' }] }
  assert.deepEqual(surveyImageIDs(definition, readBranding({ mode: 'logo', text: 'Team', logo: 7 })), [7])
})

test('downloads and duplication preserve branding outside the instrument without copying image binaries', () => {
  const source = { id: 42, title: 'Test', slug: 'test', phase: 'pretest', ...toStored(sample),
    branding: { mode: 'logo', text: '<Team> [Test]', logo: { id: 7, url: 'PRIVATE URL' } } }
  const branding = { mode: 'logo', text: '<Team> [Test]', logo: 7 }
  const exported = questionnaireExport(source)
  assert.deepEqual(exported.branding, branding)
  assert.ok(!JSON.stringify(exported).includes('PRIVATE URL'))
  assert.deepEqual(exported.definition, JSON.parse(JSON.stringify(sample)))
  assert.match(questionnaireMarkdown(source), /Kopfzeile: &lt;Team&gt; \\\[Test\\\] · Logo: Medium 7/)
  const copy = duplicateDraftData(source, 'ec2a24af-d5ca-4d6e-84c3-378e172a6671')
  assert.deepEqual(copy.branding, branding)
  assert.equal(copy.phase, 'draft')
})
