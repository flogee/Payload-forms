import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { migrations } from '../src/migrations'

// Real Worker entry/origin guard and JOSE native fetch. The generated Next
// handler/Run reads are test doubles. Reservations use native local D1 and rate
// bindings; synthetic JWKS/Host ingress is NOT real Cloudflare Access proof.
test('native machine JWKS verification stays separate from the unchanged human-origin guard', async () => {
  const issuer = 'https://fictional-qa.cloudflareaccess.com', origin = 'https://forms.example.invalid'
  const clientID = `${'a'.repeat(32)}.access`, clientKey = '20000000-0000-4000-8000-000000000001'
  const pair = await generateKeyPair('RS256'), jwk = { ...await exportJWK(pair.publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' }
  const bindings = { ACCESS_LOGIN_ENABLED: '1', ACCESS_TEAM_DOMAIN: issuer, ACCESS_AUD: 'c'.repeat(64),
    QA_MACHINE_ENABLED: '1', QA_MACHINE_AUD: 'd'.repeat(64), SURVEY_ORIGINS: origin,
    QA_MACHINE_CLIENTS: JSON.stringify([{ key: clientKey, accessClientID: clientID, surveyVersions: ['native-fixture-v1'] }]),
    RUN_EXPIRES: new Date(Date.now() + 86400000).toISOString() }
  const bundle = await build({ entryPoints: ['worker.ts'], bundle: true, write: false, format: 'esm', platform: 'node', external: ['node:*'],
    plugins: [{ name: 'qa-test-next-boundary', setup(builder) {
      builder.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({ path: 'handler', namespace: 'qa-next-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'qa-next-fixture' }, () => ({ resolveDir: process.cwd(), contents: `
        import { handleQAMachineRequest } from './src/survey/qa-machine.ts'
        export default { async fetch(request, env) {
          if (new URL(request.url).pathname !== '/api/integrations/qa') return new Response('Human-route test stub')
          const row = { id: 1, key: '00000000-0000-4000-8000-000000000001', context_ref: '10000000-0000-4000-8000-000000000001',
            survey_id: 1, version: 'native-fixture-v1', integration_client: '${clientKey}', status: 'open', expires_at: env.RUN_EXPIRES,
            instrument: JSON.stringify({version:'native-fixture-v1',introduction:[],sections:[]}) }
          const db = { prepare(sql) { return {sql,values:[],bind(...values){return{sql,values,bind:this.bind}}} },
            async batch(statements) { return statements.map(s => ({results:s.sql.includes('FROM evaluation_runs')?[row]:[],meta:{changes:0}})) } }
          // Miniflare's HTTP proxy always replaces Host with loopback, even if
          // dispatchFetch supplied it. Model the edge-to-Next Host explicitly
          // in this test-only Next stub. Real ingress remains a separate gate.
          const headers = new Headers(request.headers); headers.set('host', new URL(request.url).host)
          return handleQAMachineRequest(new Request(request, {headers}), env, async () => ({db,secret:'fictional-native-machine-secret-32-characters',loadInstrument:async()=>null}))
        } }
      ` }))
    } }],
  })
  let certRequests = 0
  const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-05', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'], bindings,
    d1Databases: ['D1'], ratelimits: {
      PUBLIC_IP_RATE: { namespace_id: '1001', simple: { limit: 300, period: 60 } },
      PUBLIC_TOTAL_RATE: { namespace_id: '1002', simple: { limit: 1000, period: 60 } },
    },
    outboundService: async request => {
      assert.equal(request.url, `${issuer}/cdn-cgi/access/certs`)
      assert.equal(request.headers.get('authorization'), null)
      certRequests++; return RuntimeResponse.json({ keys: [jwk] })
    },
  }))
  try {
    const db = await worker.getD1Database('D1'), dialect = new SQLiteSyncDialect()
    for (const migration of migrations) await migration.up({ db: { run: async (statement: any) => db.prepare(dialect.sqlToQuery(statement).sql).run() } } as any)
    const now = Math.floor(Date.now() / 1000)
    const jwt = await new SignJWT({ type: 'app', sub: '', common_name: clientID, iss: issuer, aud: bindings.QA_MACHINE_AUD, iat: now, exp: now + 60 })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(pair.privateKey)
    const send = (path: string, assertion?: string, extra: Record<string, string> = {}) => worker.dispatchFetch(`${origin}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}), ...extra },
      body: JSON.stringify({ action: 'report', key: '00000000-0000-4000-8000-000000000001' }),
    })
    assert.equal((await send('/api/integrations/qa')).status, 401)
    const response = await send('/api/integrations/qa', jwt)
    assert.equal(response.status, 200)
    const report = await response.json() as any
    assert.equal(report.format, 'evaluation-run-report'); assert.equal(report.report.responses, null)
    assert.equal(certRequests, 1)
    assert.equal((await send('/api/survey/runs', jwt)).status, 403)
    assert.equal((await send('/api/integrations/qa/', jwt)).status, 403)
    assert.equal((await send('/api/integrations/qa?key=foreign', jwt)).status, 403)
    assert.equal((await send('/api/integrations/qa', jwt, { origin })).status, 403)
    assert.equal((await worker.dispatchFetch('https://untrusted.example.invalid/api/integrations/qa', {method: 'POST',
      headers: {'content-type': 'application/json', 'cf-access-jwt-assertion': jwt}, body: JSON.stringify({action:'report',key:'00000000-0000-4000-8000-000000000001'})})).status, 403)
    assert.equal(certRequests, 1)
    await db.prepare('UPDATE qa_machine_usage SET requests=80,reports=49').run()
    const burst = await Promise.all(Array.from({ length: 20 }, () => send('/api/integrations/qa', jwt)))
    assert.equal(burst.filter(response => response.status === 200).length, 1)
    assert.equal(burst.filter(response => response.status === 429).length, 19)
    const usage = (await db.prepare('SELECT requests,reports FROM qa_machine_usage').all()).results
    assert.equal(usage.length, 2)
    assert.ok(usage.every((row: Record<string, unknown>) => row.requests === 81 && row.reports === 50), 'native D1 both counters stop at report cap')
    assert.equal((await db.prepare("SELECT count(*) n FROM budget_alerts WHERE scope=? AND metric='qaReports' AND level='blocked'").bind(clientKey).first())?.n, 1)
  } finally { await worker.dispose() }
})
