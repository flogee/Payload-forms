import assert from 'node:assert/strict'
import { pbkdf2Sync, scryptSync } from 'node:crypto'
import test from 'node:test'

const directory = new URL('./auth/strategies/local/', import.meta.resolve('payload'))
const { generatePasswordSaltHash, isCurrentPasswordHash, getPasswordHashParameters } = await import(new URL('generatePasswordSaltHash.js', directory).href)
const { authenticateLocalStrategy } = await import(new URL('authenticate.js', directory).href)
const fixture = 'TEST ONLY — ä§!🔒'
const createHash = (password = fixture) => generatePasswordSaltHash({
  collection: { slug: 'users' }, password,
  req: { payload: { config: {} }, t: (key: string) => key },
})

test('scrypt passwords preserve Unicode and match the native reference parameters', async () => {
  const { hash, salt } = await createHash()
  assert.ok(isCurrentPasswordHash(hash), 'npm install must apply the reviewed Payload patch')
  assert.match(hash, /^scrypt-payload-forms-v1-n32768-r8-p3:[a-f0-9]{64}$/)
  assert.match(salt, /^[a-f0-9]{64}$/)
  const expected = scryptSync(fixture, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 })
  assert.equal(getPasswordHashParameters(hash).hash, expected.toString('hex'))
  const doc = { id: 1, hash, salt }
  assert.deepEqual(await authenticateLocalStrategy({ doc, password: fixture }), { doc, shouldUpdatePasswordHash: false })
  assert.equal(await authenticateLocalStrategy({ doc, password: fixture + 'wrong' }), null)
})

test('each password gets a fresh random salt', async () => {
  const first = await createHash()
  const second = await createHash()
  assert.notEqual(first.salt, second.salt)
  assert.notEqual(first.hash, second.hash)
})

test('tampered hashes, unsupported parameters and missing salt fail closed', async () => {
  const valid = await createHash()
  for (const hash of [valid.hash.slice(0, -2), valid.hash.replace('r8', 'r1'), 'unknown:abcd', null]) {
    assert.equal(await authenticateLocalStrategy({ doc: { id: 1, hash, salt: valid.salt }, password: fixture }), null)
  }
  assert.equal(await authenticateLocalStrategy({ doc: { id: 1, hash: valid.hash }, password: fixture }), null)
})

test('original Payload password validation is retained', async () => {
  await assert.rejects(createHash(''), /password/i)
  await assert.rejects(createHash('a'), /password/i)
})

test('existing PBKDF2 formats verify with their original parameters and request rehash', async () => {
  const salt = 'ab'.repeat(32)
  for (const [iterations, length, prefix] of [[600000, 32, 'pbkdf2-sha256-v1:'], [25000, 512, '']] as const) {
    const hash = prefix + pbkdf2Sync(fixture, salt, iterations, length, 'sha256').toString('hex')
    const doc = { id: 1, hash, salt }
    assert.deepEqual(await authenticateLocalStrategy({ doc, password: fixture }), { doc, shouldUpdatePasswordHash: true })
    assert.equal(await authenticateLocalStrategy({ doc, password: fixture + 'wrong' }), null)
  }
})
