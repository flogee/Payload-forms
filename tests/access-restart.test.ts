import test from 'node:test'
import assert from 'node:assert/strict'
import { restartAccessLogin } from '../src/auth/restart'
test('explicit Access recovery expires only the current host application cookie', () => {
  for (const host of ['forms.example.org', 'forms.example.net']) {
    const request = new Request(`https://${host}/auth/restart?redirect=https://other.invalid`)
    const response = restartAccessLogin(request, true)!
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('Location'), '/admin')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual(response.headers.getSetCookie(), [
      'CF_Authorization=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax',
      `CF_Authorization=; Domain=${host}; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`,
    ])
    assert.equal(restartAccessLogin(request, false), null)
  }
  assert.equal(restartAccessLogin(new Request('https://forms.example.net/admin'), true), null)
  assert.equal(restartAccessLogin(new Request('https://forms.example.net/auth/restart', { method: 'POST' }), true)!.status, 405)
})
