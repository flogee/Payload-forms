import assert from 'node:assert/strict'
import { test } from 'node:test'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { participationLinks, validSurveySlug } from '../src/survey/sharing'
import { participationQR } from '../src/survey/qr'

const origins = ['https://forms.example.org', 'https://forms.example.net']

test('Teilnahmelinks gehören zum Formular und verwenden nur konfigurierte Ursprünge', () => {
  const links = participationLinks(42, 'seminarfeedback-2026', { SURVEY_ORIGINS: origins.join(',') })!
  assert.deepEqual(links.map(link => link.url), origins.map(origin => `${origin}/f/seminarfeedback-2026`))
  for (const link of links) {
    const svg = new URL(link.qrSVG, origins[0]), png = new URL(link.qrPNG, origins[0])
    assert.equal(svg.pathname, '/api/survey/share/42')
    assert.equal(svg.searchParams.get('origin'), link.origin)
    assert.equal(svg.searchParams.get('format'), 'svg')
    assert.equal(png.searchParams.get('format'), 'png')
  }
  assert.equal(participationLinks(42, 'seminarfeedback', {}), null)
  assert.equal(participationLinks(42, 'seminarfeedback', { SURVEY_ORIGINS: origins[0] + ',https://evil.invalid/path' }), null)
  assert.equal(participationLinks(42, 'seminarfeedback', { SURVEY_ORIGIN: 'http://127.0.0.1:3212' })![0].url, 'http://127.0.0.1:3212/f/seminarfeedback')
})

test('Linkkennungen können weder Pfade noch fremde Ziele einschleusen', () => {
  for (const slug of ['', '../admin', 'a/b', 'a?next=evil', 'a#other', 'https://evil.invalid', 'a\r\nInjected', 'UPPER', 'a'.repeat(81)]) {
    assert.equal(validSurveySlug(slug), false, slug)
    assert.equal(participationLinks(1, slug, { SURVEY_ORIGIN: origins[0] }), null)
  }
  assert.equal(participationLinks(0, 'sample', { SURVEY_ORIGIN: origins[0] }), null)
  assert.equal(participationLinks(Number.MAX_SAFE_INTEGER + 1, 'sample', { SURVEY_ORIGIN: origins[0] }), null)
})

test('PNG-Codes lassen sich unabhängig zum exakten Formularlink beider Domains decodieren', async () => {
  for (const link of participationLinks(42, 'seminarfeedback-2026', { SURVEY_ORIGINS: origins.join(',') })!) {
    const image = await participationQR(link.url, 'png')
    assert.notEqual(typeof image, 'string')
    const png = PNG.sync.read(image as Buffer)
    assert.equal(png.width, 1024)
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    assert.equal(decoded?.data, link.url)
    const svg = await participationQR(link.url, 'svg')
    assert.match(svg as string, /^<svg /)
    assert.ok(!(svg as string).includes('<script'))
  }
})
