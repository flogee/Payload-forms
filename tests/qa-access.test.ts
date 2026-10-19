import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateQAMachineAccessInventory } from '../scripts/check-qa-access.mjs'
import { validateAccessApplications } from '../scripts/check-access.mjs'
import { participationDestinations, publicParticipationName } from '../scripts/public-access.mjs'

const id = (value: number) => `${value.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
function fixture(): any {
  const applicationID = id(1), humanApplicationID = id(2), policyID = id(3), humanPolicyID = id(4)
  const audience = 'a'.repeat(64), humanAudience = 'b'.repeat(64)
  const hostnames = ['forms.example.org', 'forms.example.net']
  const clients = [1, 2].map(value => ({ key: id(10 + value), accessClientID: String(value).repeat(32) + '.access',
    serviceTokenID: id(20 + value), surveyVersions: ['fictional-v1'] }))
  const policy = { id: policyID, decision: 'non_identity', include: clients.map(client => ({ service_token: { token_id: client.serviceTokenID } })) }
  return { applicationID, humanApplicationID, policyID, humanPolicyID, audience, humanAudience, hostnames, clients,
    applications: [
      { id: applicationID, type: 'self_hosted', aud: audience, destinations: hostnames.map(host => ({ type: 'public', uri: host + '/api/integrations/qa' })), policies: [{ id: policyID }] },
      { id: humanApplicationID, type: 'self_hosted', aud: humanAudience, destinations: hostnames.map(uri => ({ type: 'public', uri })), policies: [{ id: humanPolicyID }] },
    ], policies: [policy], reusablePolicy: { ...structuredClone(policy), app_count: 1 },
    serviceTokens: clients.map(client => ({ id: client.serviceTokenID, client_id: client.accessClientID, expires_on: '2030-01-01T00:00:00Z' })),
    now: '2026-10-19T12:00:00Z' }
}
const rejects = (mutate: (input: any) => void) => {
  const input = fixture()
  mutate(input)
  assert.throws(() => validateQAMachineAccessInventory(input), { message: 'QA Access offline inventory is invalid or incomplete.' })
}

test('offline QA inventory returns only a sanitized summary without mutating input', () => {
  const input = fixture(), before = structuredClone(input)
  assert.deepEqual(validateQAMachineAccessInventory(input), { clients: 2, hosts: 2, path: '/api/integrations/qa' })
  assert.deepEqual(input, before)
  input.now = new Date(input.now)
  assert.doesNotThrow(() => validateQAMachineAccessInventory(input))
  input.reusablePolicy.include.reverse()
  assert.doesNotThrow(() => validateQAMachineAccessInventory(input))
})

test('strict expectations distinguish internal keys, native client IDs and policy UUID selectors', () => {
  for (const mutate of [
    (x: any) => { x.client = x.clients }, (x: any) => { x.clients[0].accessClientId = x.clients[0].accessClientID },
    (x: any) => { x.clients[0].key = x.clients[0].key.toUpperCase().replace('1111', 'AAAA') },
    (x: any) => { x.clients[0].accessClientID = x.clients[0].serviceTokenID },
    (x: any) => { x.clients[0].serviceTokenID = x.clients[0].accessClientID },
    (x: any) => { x.clients[0].surveyVersions = [] }, (x: any) => { x.clients[0].surveyVersions = ['v'.repeat(101)] },
    (x: any) => { x.clients[0].surveyVersions = Array.from({ length: 17 }, (_, i) => String(i)) },
    (x: any) => { x.clients[0].surveyVersions = ['v1', 'v1'] },
    (x: any) => { x.clients = [] }, (x: any) => { x.clients = Array.from({ length: 9 }, () => x.clients[0]) },
  ]) rejects(mutate)
  for (const field of ['key', 'accessClientID', 'serviceTokenID']) rejects(x => { x.clients[1][field] = x.clients[0][field] })
})

test('dedicated application, audience and policy expectations cannot alias human or public access', () => {
  for (const field of ['applicationID', 'policyID', 'humanApplicationID', 'humanPolicyID']) rejects(x => { x[field] = 'not-a-uuid' })
  for (const mutate of [
    (x: any) => { x.applicationID = x.humanApplicationID }, (x: any) => { x.policyID = x.humanPolicyID },
    (x: any) => { x.audience = x.humanAudience }, (x: any) => { x.audience = 'c'.repeat(63) },
    (x: any) => { x.publicApplicationID = x.applicationID }, (x: any) => { x.publicApplicationID = x.humanApplicationID },
    (x: any) => { x.applications[1].aud = x.audience }, (x: any) => { x.applications[1].policies[0].id = x.policyID },
  ]) rejects(mutate)
})

test('hosts and modern QA destinations must be exact, complete and override-free', () => {
  for (const host of ['Forms.example.org', '*.example.org', 'forms.example.org:443', 'https://forms.example.org',
    'forms.example.org/path', 'forms.example.org.', 'a'.repeat(64) + '.example.org']) rejects(x => { x.hostnames = [host] })
  for (const hosts of [[], Array(11).fill('forms.example.org'), ['forms.example.org', 'forms.example.org']]) rejects(x => { x.hostnames = hosts })
  for (const mutate of [
    (x: any) => { delete x.applications[0].destinations; x.applications[0].domain = x.hostnames[0] + '/api/integrations/qa' },
    (x: any) => { x.applications[0].destinations = [] }, (x: any) => { x.applications[0].destinations.pop() },
    (x: any) => { x.applications[0].destinations[0] = x.applications[0].destinations[1] },
    (x: any) => { x.applications[0].type = 'saas' }, (x: any) => { x.applications[0].aud = 'c'.repeat(64) },
    (x: any) => { x.applications[0].destinations[0].type = 'private' },
    (x: any) => { x.applications[0].destinations[0].overrides = [{ path_pattern: '/*' }] },
    (x: any) => { x.applications[0].destinations[0].override = [] },
  ]) rejects(mutate)
  for (const suffix of ['', '/api/*', '/api/integrations/qa/*', '/api/integrations/qa/', '/api/integrations/qa?x=1']) {
    rejects(x => { x.applications[0].destinations[0].uri = x.hostnames[0] + suffix })
  }
})

test('complete bounded application snapshots reject malformed, duplicated or overlapping alternatives', () => {
  for (const applications of [null, [], {}, Array(101).fill({})]) rejects(x => { x.applications = applications })
  rejects(x => { x.applications.pop() })
  rejects(x => { x.applications.push(x.applications[0]) })
  for (const extra of [
    { domain: 'forms.example.net/admin' }, { domain: '*.example.org/api/*' },
    { self_hosted_domains: ['forms.example.org/api/integrations/qa'] },
    { destinations: [{ type: 'public', uri: 'forms.example.net' }] },
    { destinations: null }, { domain: 'https://forms.example.org/admin' }, { domain: 'forms.example.org:443' },
  ]) rejects(x => { x.applications.push({ id: id(99), ...extra }) })
  const input = fixture()
  input.applications.push({ id: id(99), domain: 'unrelated.example.com' })
  assert.doesNotThrow(() => validateQAMachineAccessInventory(input))
  input.publicApplicationID = id(98)
  input.applications.push({ id: input.publicApplicationID, type: 'self_hosted', name: publicParticipationName,
    destinations: participationDestinations(input.hostnames).map((uri: string) => ({ type: 'public', uri })) })
  assert.doesNotThrow(() => validateQAMachineAccessInventory(input))
  delete input.publicApplicationID
  assert.throws(() => validateQAMachineAccessInventory(input))
})

test('sole reusable non-identity policy permits only the complete explicit UUID token set', () => {
  for (const decision of ['allow', 'bypass', 'deny', 'service_auth']) rejects(x => { x.policies[0].decision = decision })
  for (const include of [[], [{ everyone: {} }], [{ any_valid_service_token: {} }], [{ group: { id: id(1) } }],
    [{ email: { email: 'fictional@example.org' } }], [{ service_token: { token_id: '1'.repeat(32) + '.access' } }]]) {
    rejects(x => { x.policies[0].include = include })
  }
  for (const mutate of [
    (x: any) => { x.policies.push(x.policies[0]) }, (x: any) => { x.policies[0].id = id(99) },
    (x: any) => { x.policies[0].include[1] = x.policies[0].include[0] },
    (x: any) => { x.policies[0].include[0].everyone = {} },
    (x: any) => { x.policies[0].include[0].service_token.extra = true },
    (x: any) => { x.policies[0].include.push({ service_token: { token_id: id(99) } }) },
    (x: any) => { x.policies[0].includes = x.policies[0].include },
    (x: any) => { x.applications[0].policies.push({ id: id(99) }) },
    (x: any) => { x.applications[0].policies[0].decision = 'bypass' },
    (x: any) => { x.applications[0].policies[0].include = [{ everyone: {} }] },
  ]) rejects(mutate)
  for (const key of ['require', 'exclude']) for (const value of [null, {}, [{ everyone: {} }]]) rejects(x => { x.policies[0][key] = value })
  for (const key of ['approval_required', 'purpose_justification_required', 'isolation_required']) rejects(x => { x.policies[0][key] = true })
  rejects(x => { x.policies[0].approval_groups = [{ approvals_needed: 1 }] })
  rejects(x => { x.policies[0].purpose_justification_prompt = 'Why?' })
  for (const mutate of [
    (x: any) => { delete x.reusablePolicy.app_count }, (x: any) => { x.reusablePolicy.app_count = 2 },
    (x: any) => { x.reusablePolicy.id = id(99) }, (x: any) => { x.reusablePolicy.include[0].service_token.token_id = id(99) },
    (x: any) => { x.reusablePolicy.require = [{ everyone: {} }] },
  ]) rejects(mutate)
})

test('native Access policy metadata must confirm the same ID and reusable policy', () => {
  const input = fixture()
  for (const policy of [input.policies[0], input.reusablePolicy]) {
    policy.uid = policy.id
    policy.reusable = true
  }
  const before = structuredClone(input)
  assert.deepEqual(validateQAMachineAccessInventory(input), { clients: 2, hosts: 2, path: '/api/integrations/qa' })
  assert.deepEqual(input, before)
  for (const select of [(x: any) => x.policies[0], (x: any) => x.reusablePolicy]) {
    for (const uid of [id(99), null, 1, '', { id: input.policyID }]) {
      rejects(x => { select(x).uid = uid })
    }
    for (const reusable of [false, null, 'true', 1, {}]) {
      rejects(x => { select(x).reusable = reusable })
    }
    rejects(x => { select(x).uid = select(x).id; select(x).reusable = true; select(x).unexpected = true })
  }
})

test('service token snapshot proves UUID/native-ID binding and current unexpired status without secrets', () => {
  for (const mutate of [
    (x: any) => { x.serviceTokens = [] }, (x: any) => { x.serviceTokens.pop() },
    (x: any) => { x.serviceTokens.push(x.serviceTokens[0]) },
    (x: any) => { x.serviceTokens[1].client_id = x.serviceTokens[0].client_id },
    (x: any) => { x.serviceTokens[0].client_id = 'c'.repeat(32) + '.access' },
    (x: any) => { x.serviceTokens[0].id = id(99) }, (x: any) => { x.serviceTokens[0].status = 'revoked' },
    (x: any) => { x.serviceTokens[0].revoked = true }, (x: any) => { delete x.serviceTokens[0].expires_on },
    (x: any) => { x.serviceTokens[0].expires_on = x.now }, (x: any) => { x.serviceTokens[0].expires_on = '2020-01-01T00:00:00Z' },
    (x: any) => { x.serviceTokens[0].expires_on = 'invalid' },
    (x: any) => { x.serviceTokens[0].expires_on = '2030-02-31T00:00:00Z' },
    (x: any) => { x.serviceTokens[0].client_secret = 'fictional-secret-must-not-appear' },
    (x: any) => { x.now = 'invalid' }, (x: any) => { x.now = new Date('invalid') },
  ]) rejects(mutate)
})

test('malformed snapshots fail closed and existing release overlap guard remains unchanged', () => {
  for (const input of [null, [], {}, 'input', { ...fixture(), now: undefined }]) assert.throws(() => validateQAMachineAccessInventory(input))
  const input = fixture()
  Object.defineProperty(input, 'audience', { enumerable: true, get: () => { throw new Error('must-not-leak') } })
  assert.throws(() => validateQAMachineAccessInventory(input), { message: 'QA Access offline inventory is invalid or incomplete.' })
  const valid = fixture()
  assert.throws(() => validateAccessApplications(valid.applications, valid.humanApplicationID, undefined, valid.hostnames))
})

test('offline CLI reads a bounded file and emits no snapshot values or raw parse errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-access-test-')), file = join(directory, 'snapshot.json')
  const script = fileURLToPath(new URL('../scripts/check-qa-access.mjs', import.meta.url))
  try {
    writeFileSync(file, JSON.stringify(fixture()))
    const output = execFileSync(process.execPath, [script, '--file', file], { encoding: 'utf8' })
    assert.match(output, /No live verification performed/)
    assert.doesNotMatch(output, /\.access|forms\.example|11111111/)
    const duplicateKey = JSON.stringify(fixture()).replace('"applicationID":', '"applicationID":"ignored-ambiguous-value","applicationID":')
    const escapedKey = JSON.stringify(fixture()).replace('"applicationID":', '"\\u0061pplicationID":"ignored-ambiguous-value","applicationID":')
    for (const content of ['{"fictional-secret-must-not-appear":', 'x'.repeat(1024 * 1024 + 1), duplicateKey, escapedKey]) {
      writeFileSync(file, content)
      const result = spawnSync(process.execPath, [script, '--file', file], { encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr.trim(), 'QA Access offline inventory is invalid or incomplete.')
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
