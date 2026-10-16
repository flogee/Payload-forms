import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ensureInitialAdmin } from '../src/auth/bootstrap'
import { createHarness } from './payload-memory-fixture.mjs'

const env = { ACCESS_LOGIN_ENABLED: '1', ACCESS_TEAM_DOMAIN: 'https://fixture.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64) }

test('fresh Access installation provisions one explicit admin even though local first-register is disabled', async () => {
  const h = await createHarness(fileURLToPath(new URL('..', import.meta.url)), { usersEnvironment: env })
  try {
    assert.equal(await ensureInitialAdmin(h.payload, 'OWNER@example.invalid'), 'created')
    const first = await h.payload.find({ collection: 'users', overrideAccess: true })
    assert.equal(first.totalDocs, 1)
    assert.equal(first.docs[0].email, 'owner@example.invalid')
    assert.equal(first.docs[0].role, 'admin')
    assert.equal(first.docs[0].enabled, true)
    assert.equal(await ensureInitialAdmin(h.payload, 'someone-else@example.invalid'), 'existing')
    await h.payload.update({ collection: 'users', id: first.docs[0].id, overrideAccess: true, data: { enabled: false } })
    assert.equal(await ensureInitialAdmin(h.payload, 'owner@example.invalid'), 'existing')
    const unchanged = await h.payload.findByID({ collection: 'users', id: first.docs[0].id, overrideAccess: true })
    assert.equal(unchanged.enabled, false, 'bootstrap never revives a disabled account')
    assert.equal((await h.payload.count({ collection: 'users', overrideAccess: true })).totalDocs, 1)
  } finally { await h.close() }
})

test('empty or ambiguous initial allowlist cannot choose or create an administrator', async () => {
  let writes = 0
  const payload = { count: async () => ({ totalDocs: 0 }), create: async () => { writes++; return {} } } as any
  for (const emails of [undefined, '', 'invalid', 'one@example.invalid,two@example.invalid']) {
    await assert.rejects(ensureInitialAdmin(payload, emails), /exactly one/)
  }
  assert.equal(writes, 0)
})
