import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { sample } from '../src/survey/sample'
import { toStored } from '../src/survey/storage'
import { parseRichTextContent } from '../src/survey/content'
import { IMAGE_LIMITS } from '../src/survey/image-budget'
import { QA_MACHINE_LIMITS } from '../src/survey/qa-machine-limits'
import { testText } from './content-fixture'

export async function checkContentHTTP(base: string, token: string, apiKey: string) {
  const auth = { Authorization: `JWT ${token}` }, mcp = { Authorization: `Bearer ${apiKey}` }
  const request = (path: string, init?: RequestInit) => fetch(base + path, init)
  const json = (path: string, data: unknown, method = 'POST') => request(path, { method, headers: { ...auth, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(data) })
  const status = async (pending: Promise<Response>, expected: number, label: string) => {
    const response = await pending; assert.equal(response.status, expected, label); await response.body?.cancel()
  }
  const budgetPath = '/api/survey/media/status'
  await status(request(budgetPath), 401, 'image quotas require team login')
  await status(request(budgetPath, { headers: mcp }), 401, 'MCP keys cannot access image quotas')
  await status(request(`/api/survey/runs/export?key=${randomUUID()}`, { headers: mcp }), 401, 'MCP keys cannot read raw Run exports')
  for (const collection of ['image-storage-usage', 'image-request-usage', 'qa-machine-usage', 'budget-alerts', 'budget-alert-monitor']) {
    await status(request(`/api/${collection}`, { headers: auth }), 403, 'team cannot edit quota collections')
    await status(json(`/api/${collection}/1`, { reservedBytes: 0, reads: 0 }, 'PATCH'), 403, 'quota reset is forbidden')
  }
  const png = new PNG({ width: 2, height: 2 })
  png.data.fill(130)
  const bytes = PNG.sync.write(png)
  const upload = (data = bytes, mime = 'image/png', headers: Record<string, string> = auth) => {
    const body = new FormData()
    body.set('_payload', JSON.stringify({ title: 'HTTP TEST IMAGE', prefix: 'unapproved', _objectKey: 'unapproved/overwrite' }))
    body.set('file', new Blob([new Uint8Array(data)], { type: mime }), 'untrusted-name.png')
    return request('/api/media', { method: 'POST', headers: { ...headers, Origin: base }, body })
  }
  await status(upload(bytes, 'image/png', {}), 403, 'anonymous uploads are forbidden')
  await status(upload(bytes, 'image/png', mcp), 403, 'MCP image uploads are forbidden')
  await status(upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml'), 400, 'SVG uploads are forbidden')
  await status(upload(Buffer.from('<html>not an image</html>')), 400, 'mime spoofing is rejected')
  await status(request('/api/media/paste-url?src=https://example.invalid/test.png', { headers: auth }), 400, 'external URL imports are disabled before any remote fetch')
  const large = await upload(Buffer.alloc(IMAGE_LIMITS.fileBytes + 1))
  assert.ok(large.status >= 400, 'oversized file cannot be stored'); await large.body?.cancel()
  const uploaded = await upload()
  assert.equal(uploaded.status, 201, 'native upload stores a valid PNG in local R2')
  const image = (await uploaded.json() as any).doc
  assert.match(image.filename, /^[0-9a-f-]{36}\.png$/)
  assert.equal(image.prefix, 'forms-images', 'storage destination is server-controlled')
  await status(request(image.url), 403, 'native media reads require staff')
  await status(request(image.url, { headers: mcp }), 403, 'MCP cannot read image files')
  const beforeNative = await (await request(budgetPath, { headers: auth })).json() as any
  const native = await request(image.url, { headers: auth })
  assert.equal(native.status, 200)
  assert.deepEqual(Buffer.from(await native.arrayBuffer()), bytes)
  await status(json(`/api/media/${image.id}`, { title: 'Forbidden edit' }, 'PATCH'), 403, 'media metadata is immutable')
  await status(request(`/api/media/${image.id}`, { method: 'DELETE', headers: auth }), 403, 'media deletion is forbidden')
  const budget = await request(budgetPath, { headers: auth })
  assert.match(budget.headers.get('cache-control') || '', /no-store/)
  const info = await budget.json() as any
  assert.equal(info.qa.enabled, false, 'ordinary installed build keeps machine QA off')
  assert.deepEqual(info.qa.usage, [{ scope: 'installation', requests: { used: 0, limit: QA_MACHINE_LIMITS.installation.requests },
    reports: { used: 0, limit: QA_MACHINE_LIMITS.installation.reports } }], 'protected status shows fixed QA limits without creating usage rows')
  assert.doesNotMatch(JSON.stringify(info.qa), /accessClientID|serviceTokenID|secret/)
  assert.equal(typeof info.warnings.configured, 'boolean')
  assert.equal(typeof info.warnings.stale, 'boolean')
  assert.ok(Array.isArray(info.warnings.alerts))
  assert.ok(info.warnings.mailTotalLimit > info.mail.limit, 'operational warnings retain a mail reserve')
  assert.equal(info.storage.reservedBytes, bytes.length)
  assert.equal(info.storage.reservedObjects, 1)
  assert.equal(info.writes.used, 1)
  assert.equal(info.reads.used - beforeNative.reads.used, 2, 'native file HEAD and GET both consume shared read quota')

  const slug = `content-test-${randomUUID()}`
  const text = parseRichTextContent(testText('Text <script>escaped</script>'))
  const def = { ...sample, version: slug, introContent: [{ blockType: 'text' as const, content: text }, { blockType: 'image' as const, image: image.id, alt: 'Fiktives Testbild', caption: 'TEST CAPTION' }],
    sections: sample.sections.map((section, i) => i ? section : { ...section, content: [{ blockType: 'text' as const, content: text, afterQuestion: section.questions[0].id }] }) }
  await status(json('/api/surveys', { title: 'CONTENT TEST ONLY', slug: `${slug}-bad`, phase: 'draft', ...toStored({ ...def, introContent: [{ blockType: 'image', image: 2147483647, alt: 'Missing' }] }) }), 400, 'draft rejects missing image references')
  const created = await json('/api/surveys', { title: 'CONTENT TEST ONLY', slug, phase: 'draft', ...toStored(def) })
  assert.equal(created.status, 201, 'draft accepts rich text and image blocks')
  const survey = (await created.json() as any).doc
  const imagePath = `/f/${slug}/images/${image.id}`
  await status(request(imagePath), 404, 'draft images are not served to participants')
  await status(json(`/api/surveys/${survey.id}`, { phase: 'pretest' }, 'PATCH'), 200, 'publish the disposable content pretest')
  await status(json(`/api/surveys/${survey.id}`, { branding: { mode: 'text', text: 'TEST <Brand>' } }, 'PATCH'), 200, 'presentation can change after pretest start')
  const textHeader = await (await request(`/f/${slug}`)).text()
  assert.ok(textHeader.includes('class="survey-brand__text">TEST &lt;Brand&gt;</strong>'), 'custom header text is escaped')
  await status(json(`/api/surveys/${survey.id}`, { branding: { mode: 'logo', text: 'Test logo', logo: 2147483647 } }, 'PATCH'), 400, 'header rejects missing media')
  await status(json(`/api/surveys/${survey.id}`, { branding: { mode: 'text', text: ' ' } }, 'PATCH'), 400, 'header requires a nonblank name')
  const logoUpload = await upload()
  assert.equal(logoUpload.status, 201)
  const logo = (await logoUpload.json() as any).doc
  const logoPath = `/f/${slug}/images/${logo.id}`
  await status(request(logoPath), 404, 'an uploaded logo is not exposed before selection')
  await status(json(`/api/surveys/${survey.id}`, { branding: { mode: 'logo', text: 'TEST LOGO', logo: logo.id } }, 'PATCH'), 200, 'header-only media can be selected')
  await status(request(logoPath), 200, 'the selected header logo is served within its questionnaire')
  await status(request(`/f/sample/images/${logo.id}`), 404, 'logo cannot be read through an unrelated questionnaire')
  await status(json(`/api/surveys/${survey.id}`, { branding: { text: 'TEST LOGO RENAMED' } }, 'PATCH'), 200, 'partial text edit preserves selected logo and mode')
  await status(json(`/api/surveys/${survey.id}`, { notifications: { enabled: false } }, 'PATCH'), 200, 'operational edit preserves branding')
  const logoHeader = await (await request(`/f/${slug}`)).text()
  assert.ok(logoHeader.includes(`class="survey-brand__logo" src="${logoPath}" alt="TEST LOGO RENAMED"`))
  await status(json(`/api/surveys/${survey.id}`, { branding: { mode: 'default' } }, 'PATCH'), 200, 'restore default header')
  await status(request(logoPath), 404, 'deselected header-only logo is no longer served')
  const defaults = await (await request(`/api/surveys/${survey.id}?depth=0`, { headers: auth })).json() as any
  assert.equal(defaults.branding.logo, null, 'inactive native upload reference is cleared')
  await status(json(`/api/surveys/${survey.id}`, { branding: { mode: 'text', text: 'TEST TEXT' } }, 'PATCH'), 200, 'text header remains configurable')
  const html = await (await request(`/f/${slug}`)).text()
  assert.ok(html.includes('Text &lt;script&gt;escaped&lt;/script&gt;'), 'formatted text escapes executable markup')
  assert.ok(html.includes(`src="${imagePath}"`) && html.includes('TEST CAPTION'), 'participant form renders its own image and caption')
  assert.ok(html.indexOf('survey-privacy-trigger') > html.indexOf('<footer'), 'privacy access lives in the footer')
  const served = await request(imagePath)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes)
  await status(request(`/f/sample/images/${image.id}`), 404, 'an image is not served under an unrelated survey')
  await status(request(`/f/${slug}/images/2147483647`), 404, 'unreferenced image is not served')
  await status(json(`/api/surveys/${survey.id}`, { introContent: [] }, 'PATCH'), 400, 'started intro blocks are frozen')
  await status(json(`/api/surveys/${survey.id}`, { sections: toStored(sample).sections }, 'PATCH'), 400, 'started section blocks are frozen')
  const saved = await json('/api/survey/submit', { surveyID: survey.id, version: slug, submissionID: randomUUID(), confirmTest: true, answers: { F01_name: 'CONTENT HTTP DUMMY' }, durationSeconds: 2 })
  assert.equal(saved.status, 201)
  const response = await (await request(`/api/responses/${(await saved.json() as any).id}?depth=0`, { headers: auth })).json() as any
  assert.equal(response.instrument.introContent[1].image, image.id, 'response snapshot keeps the immutable media reference')
  assert.equal('branding' in response.instrument, false, 'operational branding does not rewrite the frozen instrument')
  assert.equal(response.instrument.sections[0].content[0].afterQuestion, sample.sections[0].questions[0].id)
  assert.deepEqual(response.answers, { F01_name: 'CONTENT HTTP DUMMY' }, 'content blocks are not answers')
  await status(json(`/api/surveys/${survey.id}`, { phase: 'closed' }, 'PATCH'), 200, 'close the disposable content pretest')
  await status(request(imagePath), 404, 'closing the survey stops scoped image serving')
}
