import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'

// Exercise the default native fetch in workerd, rather than injecting a Node
// fetch mock into reconcileTeamAccess. All outbound traffic stays in this fixture.
test('native Worker fetch reconciles the team and rejects redirects without forwarding credentials', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { reconcileTeamAccess } from './src/auth/team-sync.ts'
      export default { async fetch(_request, env) {
        let status = 'pending', lastError = null
        const db = {
          prepare(sql) { return { sql, values: [], bind(...values) { this.values = values; return this } } },
          async batch(statements) { return statements.map(({ sql, values }) => {
            let results = []
            if (sql.startsWith('SELECT email')) results = [{ email: 'first@example.invalid' }, { email: 'second@example.invalid' }]
            if (sql.includes('RETURNING id')) results = [{ id: 1 }]
            if (sql.includes("SET status = 'synced'")) status = 'synced'
            if (sql.includes("SET status = 'failed', last_error = ?")) { status = 'failed'; lastError = values[0] }
            return { results, meta: { changes: 1 } }
          }) },
        }
        await reconcileTeamAccess(db, env)
        return Response.json({ status, lastError })
      } }
    ` }, bundle: true, write: false, format: 'esm', platform: 'node', external: ['node:*'],
  })
  const policyID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  for (const scenario of ['success', 'read-redirect', 'write-redirect']) {
    const calls: { url: string; method: string }[] = []
    let emails = ['first@example.invalid']
    const worker = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-10-05', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      bindings: { ACCESS_SYNC_ENABLED: '1', ACCESS_SYNC_TOKEN: 'fixture-only-not-a-secret',
        ACCESS_ACCOUNT_ID: 'a'.repeat(32), ACCESS_APP_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        ACCESS_POLICY_ID: policyID, ACCESS_INITIAL_EMAILS: 'first@example.invalid' },
      outboundService: async request => {
        assert.equal(new URL(request.url).host, 'api.cloudflare.com')
        assert.equal(request.headers.get('authorization'), 'Bearer fixture-only-not-a-secret')
        calls.push({ url: request.url, method: request.method })
        if (scenario === 'read-redirect' || (scenario === 'write-redirect' && request.method === 'PUT')) {
          return new RuntimeResponse('PRIVATE_PROVIDER_BODY', { status: 307, headers: { Location: 'https://untrusted.example.invalid/' } })
        }
        if (request.method === 'PUT') {
          const body = await request.json() as { include: { email: { email: string } }[] }
          emails = body.include.map(rule => rule.email.email)
        }
        const result = request.url.includes('/apps/') ? [{ id: policyID }]
          : { id: policyID, app_count: 1, decision: 'allow', include: emails.map(email => ({ email: { email } })),
            require: [] as unknown[], exclude: [] as unknown[], session_duration: '12h' }
        return RuntimeResponse.json({ success: true, result })
      },
    }))
    try {
      const response = await worker.dispatchFetch('https://fixture.example.invalid/')
      const state = await response.json() as { status: string; lastError: string | null }
      assert.equal(response.status, 200)
      if (scenario === 'success') {
        assert.deepEqual(state, { status: 'synced', lastError: null })
        assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'PUT', 'GET'])
        assert.deepEqual(emails, ['first@example.invalid', 'second@example.invalid'])
      } else {
        assert.deepEqual(state, { status: 'failed', lastError: 'Cloudflare-Abgleich fehlgeschlagen (HTTP 307).' })
        assert.equal(calls.length, scenario === 'read-redirect' ? 1 : 3)
        assert.deepEqual(emails, ['first@example.invalid'])
      }
    } finally { await worker.dispose() }
  }
})
