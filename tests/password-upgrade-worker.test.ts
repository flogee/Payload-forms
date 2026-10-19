import test from 'node:test'
import assert from 'node:assert/strict'
import { scryptSync } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('native Worker verifies old and current scrypt formats and rejects tampering', async () => {
  const password = 'Fictional password ä§!🔒', salt = 'ef'.repeat(32)
  const digest = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { authenticateLocalStrategy } from './patches/payload-3.90.2-auth/authenticate.js'
    export default { async fetch(request) {
      const {doc,password} = await request.json()
      const result = await authenticateLocalStrategy({doc,password})
      return Response.json({authenticated:!!result,rehash:result?.shouldUpdatePasswordHash??null})
    } }
  ` }, bundle: true, write: false, format: 'esm', platform: 'node', external: ['node:*'],
    // Uncalled Payload field validation/error imports are outside this narrow
    // crypto test. The full HTTP suite separately checks the real Payload API.
    plugins: [{ name: 'unused-payload-validation', setup(builder) {
      builder.onResolve({ filter: /(?:errors\/index|fields\/validations)\.js$/ }, args => ({ path: args.path, namespace: 'unused-validation' }))
      builder.onLoad({ filter: /.*/, namespace: 'unused-validation' }, () => ({ contents: 'export class ValidationError extends Error {}; export const password=()=>{throw new Error("Not part of crypto test")}' }))
    } }],
  })
  const worker = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-05', compatibilityFlags: ['nodejs_compat'],
    outboundService: async () => { throw new Error('No external network in password compatibility test') },
  }))
  try {
    const send = async (hash: string, supplied = password) => {
      const response = await worker.dispatchFetch('https://password.example.invalid/', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: { hash, salt }, password: supplied }) })
      assert.equal(response.status, 200)
      return response.json()
    }
    for (const [prefix, rehash] of [['scrypt-soze-v1-n32768-r8-p3:', true], ['scrypt-payload-forms-v1-n32768-r8-p3:', false]] as const) {
      assert.deepEqual(await send(prefix + digest), { authenticated: true, rehash })
      assert.deepEqual(await send(prefix + digest, password + 'wrong'), { authenticated: false, rehash: null })
      assert.deepEqual(await send(prefix.replace('r8', 'r1') + digest), { authenticated: false, rehash: null })
    }
  } finally { await worker.dispose() }
})
