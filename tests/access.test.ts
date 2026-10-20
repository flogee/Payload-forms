import test from 'node:test'
import assert from 'node:assert/strict'
import { internalHostnames, validateAccess, validateAccessApplications, validatePublicParticipation, verifyAccess } from '../scripts/check-access.mjs'

const [first, second] = internalHostnames
const app = { id: 'internal', type: 'self_hosted', domain: first, destinations: internalHostnames.map(uri => ({ type: 'public', uri })) }
const policy = { decision: 'allow', include: [{ email: { email: 'operator@example.org' } }] }
const emails = ['operator@example.org']

test('internal release requires both complete domains in a single Access application', () => {
  assert.doesNotThrow(() => validateAccess(app, [policy], emails))
  assert.doesNotThrow(() => validateAccess({ type: 'self_hosted', domain: first, self_hosted_domains: [first, second] }, [policy], emails))
  assert.throws(() => validateAccess({ type: 'self_hosted', domain: first }, [policy], emails))
  assert.throws(() => validateAccess({ ...app, destinations: [{ type: 'public', uri: first }] }, [policy], emails))
  assert.throws(() => validateAccess({ ...app, destinations: [{ type: 'public', uri: first }, { type: 'public', uri: `${second}/admin` }] }, [policy], emails))
  assert.throws(() => validateAccess(app, [policy], []))
  assert.throws(() => validateAccess(app, [policy], ['other@example.org']))
  assert.doesNotThrow(() => validateAccess(app, [policy], [...emails, 'other@example.org']))
  assert.doesNotThrow(() => validateAccess(app, [{ decision: 'allow', include: [{ email: { email: 'other@example.org' } }] }], ['other@example.org']))
})

test('modern destinations take precedence over legacy display domains, including empty destinations', () => {
  for (const destinations of [[], [{ type: 'public', uri: first }], [{ type: 'private', hostname: second }]]) {
    assert.throws(() => validateAccess({ ...app, self_hosted_domains: [first, second], destinations }, [policy], emails))
  }
  assert.doesNotThrow(() => validateAccess({ ...app, domain: 'display.example.org/admin', self_hosted_domains: ['ignored.example.org'] }, [policy], emails))
})

test('internal release rejects bypass, service authentication, broad selectors and public overrides', () => {
  for (const extra of [
    { decision: 'bypass', include: [{ everyone: {} }] },
    { decision: 'non_identity', include: [{ any_valid_service_token: {} }] },
    { decision: 'allow', include: [{ email_domain: { domain: 'gmail.com' } }] },
    { decision: 'allow', include: [{ email: { email: emails[0] } }, { service_token: { token_id: 'token' } }] },
    { decision: 'allow', include: [] },
  ]) assert.throws(() => validateAccess(app, [policy, extra], emails))
  assert.throws(() => validateAccess({ ...app, destinations: [app.destinations[0], { ...app.destinations[1], overrides: [{ behavior: 'public', path_pattern: '/api/*' }] }] }, [policy], emails))
  assert.throws(() => validateAccess({ ...app, destinations: [{ type: 'public', uri: '*.example.org' }, app.destinations[1]] }, [policy], emails))
})

test('other Access applications cannot overlap either internal hostname or its paths', () => {
  assert.doesNotThrow(() => validateAccessApplications([app, { id: 'other', domain: 'other.example.org' }], app.id))
  assert.throws(() => validateAccessApplications([], app.id))
  for (const host of internalHostnames) {
    for (const other of [
      { domain: host },
      { domain: `${host}/api` },
      { self_hosted_domains: [`${host}/api/*`] },
      { destinations: [{ type: 'public', uri: `${host}/api/*` }] },
      { destinations: [{ type: 'public', uri: `*.${host.split('.').slice(1).join('.')}/admin` }] },
    ]) assert.throws(() => validateAccessApplications([app, { id: 'other', ...other }], app.id))
  }
  assert.doesNotThrow(() => validateAccessApplications([app, { id: 'other', domain: second, self_hosted_domains: [second], destinations: [{ type: 'public', uri: 'other.example.org' }] }], app.id))
  assert.doesNotThrow(() => validateAccessApplications([app, { id: 'other', destinations: [{ type: 'public', uri: `other.${second}` }] }], app.id))
})

test('release verifies the active database team list, fixed audience and sole policy before deploying', async () => {
  const env = { CLOUDFLARE_API_TOKEN: 'fixture-only', CLOUDFLARE_ACCOUNT_ID: 'account', FORMS_ACCESS_APP_ID: app.id, FORMS_ALLOWED_EMAILS: 'stale@example.invalid' }
  for (const migrated of [false, true]) {
    const queries: string[] = []
    const request: typeof fetch = async (input, options) => {
      const url = String(input)
      let result: unknown
      if (options.method === 'POST') {
        const sql = JSON.parse(String(options.body)).sql
        queries.push(sql)
        result = [{ success: true, results: sql.includes('pragma_table_info')
          ? (migrated ? [{ name: 'enabled' }] : [{ name: 'email' }]) : [{ email: emails[0] }] }]
      } else result = url.endsWith('/policies?per_page=100') ? [{ ...policy, id: 'policy' }]
        : url.endsWith('/access/policies/policy') ? { ...policy, id: 'policy', app_count: 1 }
        : url.endsWith('/apps?per_page=100') ? [app] : { ...app, aud: 'audience' }
      return Response.json({ success: true, result })
    }
    await verifyAccess(env, { databaseID: 'database', audience: 'audience', policyID: 'policy', request })
    assert.equal(queries.length, 2)
    assert.equal(queries[1].includes('WHERE enabled = 1'), migrated)
    await assert.rejects(verifyAccess(env, { databaseID: 'database', audience: 'wrong', request }), /Anmeldekennung/)
    await assert.rejects(verifyAccess(env, { databaseID: 'database', policyID: 'wrong', request }), /eindeutig/)
  }
})

test('release refuses unconfirmed or shared reusable-policy ownership', async () => {
  const env = { CLOUDFLARE_API_TOKEN: 'fixture-only', CLOUDFLARE_ACCOUNT_ID: 'account', FORMS_ACCESS_APP_ID: app.id, FORMS_ALLOWED_EMAILS: emails[0] }
  for (const reusable of [{ id: 'policy' }, { id: 'policy', app_count: 0 }, { id: 'policy', app_count: 2 }, { id: 'other', app_count: 1 }]) {
    const request: typeof fetch = async input => {
      const url = String(input)
      const result = url.endsWith('/access/policies/policy') ? reusable
        : url.endsWith('/policies?per_page=100') ? [{ ...policy, id: 'policy' }]
        : url.endsWith('/apps?per_page=100') ? [app] : app
      return Response.json({ success: true, result })
    }
    await assert.rejects(verifyAccess(env, { policyID: 'policy', request }), /genau einer Anwendung/)
  }
})

test('release refuses missing, oversized or unmatched database team lists', async () => {
  const env = { CLOUDFLARE_API_TOKEN: 'fixture-only', CLOUDFLARE_ACCOUNT_ID: 'account', FORMS_ACCESS_APP_ID: app.id, FORMS_ALLOWED_EMAILS: emails[0] }
  for (const rows of [[], [{ email: null }], Array.from({ length: 41 }, () => ({ email: emails[0] })), [{ email: emails[0] }, { email: 'new@example.invalid' }]]) {
    const request: typeof fetch = async (input, options) => {
      const url = String(input)
      const result = options.method === 'POST'
        ? [{ success: true, results: String(options.body).includes('pragma_table_info') ? [{ name: 'enabled' }] : rows }]
        : url.endsWith('/policies?per_page=100') ? [{ ...policy, id: 'policy' }]
        : url.endsWith('/apps?per_page=100') ? [app] : app
      return Response.json({ success: true, result })
    }
    await assert.rejects(verifyAccess(env, { databaseID: 'database', request }), /Teamliste|abgeglichen/)
  }
})

const publicName = 'Payload-forms – Teilnahme'
const publicApp = { id: 'participation', name: publicName, type: 'self_hosted', destinations: internalHostnames.flatMap(host =>
  ['/f/*', '/datenschutz/*', '/api/survey/submit', '/_next/static/*'].map(path => ({ type: 'public', uri: `${host}${path}` }))) }
const bypass = { decision: 'bypass', include: [{ everyone: {} }], exclude: [] as unknown[], require: [] as unknown[] }
const foreignPublicApp = { ...publicApp, id: 'foreign-participation', destinations: publicApp.destinations.map(destination =>
  ({ ...destination, uri: destination.uri.replace(first, 'other.example.com').replace(second, 'another.example.com') })) }

test('public participation discovery is scoped to the selected installation, not its account-wide name', () => {
  assert.equal(validateAccessApplications([app, foreignPublicApp], app.id), undefined)
  for (const applications of [[app, foreignPublicApp, publicApp], [publicApp, foreignPublicApp, app]]) {
    assert.equal(validateAccessApplications(applications, app.id)?.id, publicApp.id)
    assert.equal(validateAccessApplications(applications, app.id, publicApp.id)?.id, publicApp.id)
    assert.throws(() => validateAccessApplications(applications, app.id, foreignPublicApp.id))
  }
  assert.throws(() => validateAccessApplications([app, foreignPublicApp], app.id, foreignPublicApp.id))
  // Modern destinations, not a stale legacy display domain, define ownership.
  assert.equal(validateAccessApplications([app, { ...foreignPublicApp, domain: first,
    self_hosted_domains: internalHostnames }], app.id), undefined)
})

test('same-name applications still reject ambiguous, malformed or overlapping destinations', () => {
  for (const destinations of [[], null, {}, [{ type: 'private', uri: 'other.example.com' }],
    [{ type: 'public', uri: null }], [{ type: 'public', uri: `${first}:443/f/*` }],
    [{ type: 'public', uri: `user@${first}/f/*` }],
    [{ type: 'public', uri: 'other.example.com/f/*', overrides: [{ path_pattern: '/admin' }] }],
    [...foreignPublicApp.destinations, { type: 'public', uri: `${second}/admin` }],
    [{ type: 'public', uri: '*.example.net/f/*' }],
  ]) assert.throws(() => validateAccessApplications([app, { ...foreignPublicApp, destinations }], app.id))
  assert.throws(() => validateAccessApplications([app, foreignPublicApp, publicApp, { ...publicApp, id: 'duplicate' }], app.id))
})

test('public participation has an exact unique inventory and cannot hide overlapping apps', () => {
  assert.equal(validateAccessApplications([app, publicApp], app.id)?.id, publicApp.id)
  assert.equal(validateAccessApplications([app], app.id), undefined)
  assert.throws(() => validateAccessApplications([app], app.id, publicApp.id))
  assert.throws(() => validateAccessApplications([app, publicApp], app.id, 'wrong'))
  for (const changed of [
    { name: 'different' }, { type: 'bookmark' }, { destinations: publicApp.destinations.slice(1) },
    { destinations: [...publicApp.destinations, { type: 'public', uri: `${first}/api/*` }] },
    { destinations: [publicApp.destinations[0], ...publicApp.destinations.slice(0, 7)] },
    { destinations: publicApp.destinations.map((d, i) => i === 0 ? { ...d, uri: `${first}/*` } : d) },
    { destinations: publicApp.destinations.map((d, i) => i === 0 ? { ...d, overrides: [{ path_pattern: '/admin' }] } : d) },
  ]) assert.throws(() => validateAccessApplications([app, { ...publicApp, ...changed }], app.id))
  for (const extra of [{ ...publicApp, id: 'duplicate' }, { id: 'third', domain: `${second}/f/*` },
    { id: 'third', domain: '*.example.net/api/*' }]) {
    assert.throws(() => validateAccessApplications([app, publicApp, extra], app.id))
  }
})

test('public participation requires exactly one unqualified Everyone bypass policy', () => {
  assert.doesNotThrow(() => validatePublicParticipation(publicApp, [bypass]))
  for (const policies of [[], [bypass, bypass], [policy], [{ ...bypass, decision: 'non_identity' }],
    [{ ...bypass, include: [{ everyone: {}, email: { email: emails[0] } }] }],
    [{ ...bypass, include: [{ everyone: [] }] }], [{ ...bypass, include: [{ everyone: { extra: true } }] }],
    [{ ...bypass, include: [{ everyone: {} }, { everyone: {} }] }],
    [{ ...bypass, exclude: [{ email: { email: emails[0] } }] }], [{ ...bypass, require: [{ country: { country: 'AT' } }] }],
    [{ ...bypass, require: {} }]]) assert.throws(() => validatePublicParticipation(publicApp, policies))
})

test('Access preflight reports participation and fetches its own sole policy while retaining team ownership', async () => {
  const env = { CLOUDFLARE_API_TOKEN: 'fixture-only', CLOUDFLARE_ACCOUNT_ID: 'account', FORMS_ACCESS_APP_ID: app.id, FORMS_ALLOWED_EMAILS: emails[0] }
  for (const present of [false, true]) {
    const urls: string[] = []
    const request: typeof fetch = async input => {
      const url = String(input)
      urls.push(url)
      const result = url.includes('/apps/participation/policies?') ? [bypass]
        : url.endsWith('/access/policies/policy') ? { id: 'policy', app_count: 1 }
        : url.endsWith('/policies?per_page=100') ? [{ ...policy, id: 'policy' }]
        : url.endsWith('/apps?per_page=100') ? [app, foreignPublicApp, ...(present ? [publicApp] : [])] : app
      return Response.json({ success: true, result })
    }
    assert.deepEqual(await verifyAccess(env, { policyID: 'policy', request }), { publicParticipation: present })
    assert.equal(urls.some(url => url.includes('/apps/participation/policies?')), present)
    assert.equal(urls.some(url => url.includes(`/apps/${foreignPublicApp.id}/policies?`)), false)
    if (present) await assert.rejects(verifyAccess(env, { request: async (url, options) => String(url).includes('/apps/participation/policies?')
      ? Response.json({ success: true, result: [policy] }) : request(url, options) }), /Bypass-Everyone/)
  }
})

test('public policy API cannot omit its result or truncate the inventory', async () => {
  const env = { CLOUDFLARE_API_TOKEN: 'fixture-only', CLOUDFLARE_ACCOUNT_ID: 'account', FORMS_ACCESS_APP_ID: app.id, FORMS_ALLOWED_EMAILS: emails[0] }
  for (const data of [{ success: true }, { success: true, result: [bypass], result_info: { total_pages: 2 } }]) {
    const request: typeof fetch = async input => {
      const url = String(input)
      if (url.includes('/apps/participation/policies?')) return Response.json(data)
      return Response.json({ success: true, result: url.endsWith('/apps?per_page=100') ? [app, publicApp]
        : url.endsWith('/policies?per_page=100') ? [policy] : app })
    }
    await assert.rejects(verifyAccess(env, { request }), /vollständig|unvollständig/)
  }
})

test('an installer-selected single host retains full-host and exact public-path protections', async () => {
  const hosts = ['forms.fixture.dev']
  const ownApp = { ...app, destinations: [{ type: 'public', uri: hosts[0] }] }
  const ownPublic = { ...publicApp, destinations: ['/f/*', '/datenschutz/*', '/api/survey/submit', '/_next/static/*'].map(path => ({ type: 'public', uri: hosts[0] + path })) }
  assert.doesNotThrow(() => validateAccess(ownApp, [policy], emails, hosts))
  assert.throws(() => validateAccess(ownApp, [policy], emails))
  assert.doesNotThrow(() => validatePublicParticipation(ownPublic, [bypass], hosts))
  assert.equal(validateAccessApplications([ownApp, ownPublic], app.id, ownPublic.id, hosts)?.id, ownPublic.id)
  assert.throws(() => validateAccessApplications([ownApp, { id: 'overlap', domain: '*.fixture.dev/admin' }], app.id, undefined, hosts))
})

test('first bootstrap uses the explicit initial allowlist only for a proven empty team table', async () => {
  const env = { CLOUDFLARE_API_TOKEN: 'fixture-only', CLOUDFLARE_ACCOUNT_ID: 'account', FORMS_ACCESS_APP_ID: app.id, FORMS_ALLOWED_EMAILS: emails[0] }
  for (const tableExists of [false, true]) {
    for (const disabledAccountExists of [false, true]) {
      const request: typeof fetch = async (input, options) => {
        const url = String(input)
        let result: any
        if (options.method === 'POST') {
          const sql = JSON.parse(String(options.body)).sql
          result = [{ success: true, results: sql.includes('pragma_table_info') ? (tableExists ? [{ name: 'enabled' }] : [])
            : sql === 'SELECT id FROM users LIMIT 1' && disabledAccountExists ? [{ id: 1 }] : [] }]
        } else result = url.endsWith('/policies?per_page=100') ? [policy] : url.endsWith('/apps?per_page=100') ? [app] : app
        return Response.json({ success: true, result })
      }
      if (tableExists && disabledAccountExists) await assert.rejects(verifyAccess(env, { databaseID: 'database', initialSetup: true, request }), /disabled/)
      else await verifyAccess(env, { databaseID: 'database', initialSetup: true, request })
      await assert.rejects(verifyAccess(env, { databaseID: 'database', request }), /Teamliste/)
    }
  }
})
