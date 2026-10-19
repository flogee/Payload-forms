import { open } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { validateAccessApplications, validatePublicParticipation } from './check-access.mjs'
import { configuredHostnames, publicParticipationName } from './public-access.mjs'

const path = '/api/integrations/qa'
const failure = 'QA Access offline inventory is invalid or incomplete.'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const clientID = /^[a-f0-9]{32}\.access$/
const audience = /^[a-f0-9]{64}$/
const own = (object, key) => Object.hasOwn(object, key)
const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
const check = condition => { if (!condition) throw new Error(failure) }
const keys = (value, allowed) => check(record(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)))
const list = (value, min, max) => check(Array.isArray(value) && value.length >= min && value.length <= max)
const unique = values => check(new Set(values).size === values.length)
const emptyList = (value, key) => check(!own(value, key) || (Array.isArray(value[key]) && value[key].length === 0))
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)

// Reject secret-bearing, huge, non-JSON or accessor-bearing snapshots before examining
// them. Provider metadata is not printed, including in validation failures.
function boundedSnapshot(input) {
  let nodes = 0
  function visit(value, depth) {
    check(++nodes <= 50000 && depth <= 16)
    if (value instanceof Date) { check(depth === 1 && Number.isFinite(value.getTime())); return }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
    if (typeof value === 'string') { check(value.length <= 4096); return }
    check(Array.isArray(value) || record(value))
    check(Object.getOwnPropertySymbols(value).length === 0 && (!Array.isArray(value) || value.length <= 50000))
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue
      check(key.length <= 100 && !/secret|password|authorization/i.test(key) && own(descriptor, 'value'))
      visit(descriptor.value, depth + 1)
    }
  }
  visit(input, 0)
}

function destinations(application, modern = false) {
  let result
  if (own(application, 'destinations')) {
    list(application.destinations, 1, 100)
    result = application.destinations
  } else {
    check(!modern)
    check(!own(application, 'self_hosted_domains') || Array.isArray(application.self_hosted_domains))
    const uris = [application.domain, ...(application.self_hosted_domains ?? [])].filter(value => value !== undefined)
    result = uris.map(uri => ({ type: 'public', uri }))
    list(result, 1, 100)
  }
  for (const destination of result) {
    keys(destination, ['type', 'uri', 'overrides'])
    check(destination.type === 'public' && typeof destination.uri === 'string' && destination.uri.length <= 512)
    // Only DNS host/path syntax is understood by the overlap guard. Reject
    // schemes, ports, credentials and malformed alternatives instead of guessing.
    const [hostname] = destination.uri.split('/')
    check(hostname.length <= 253 && hostname.includes('.') && hostname.split('.').every(label =>
      label.length > 0 && label.length <= 63 && /^[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?$/.test(label)))
    check(!/[?#\s\\]/.test(destination.uri))
    emptyList(destination, 'overrides')
  }
  unique(result.map(destination => destination.uri))
  return result
}

function exactApplication(application, id, aud, uris, policyID) {
  check(application.id === id && application.type === 'self_hosted' && application.aud === aud)
  const actual = destinations(application, true)
  check(actual.length === uris.length && actual.every(destination => uris.includes(destination.uri)))
  if (own(application, 'policies')) {
    list(application.policies, 1, 1)
    check(record(application.policies[0]) && application.policies[0].id === policyID)
    if (own(application.policies[0], 'decision')) {
      check(application.policies[0].decision === (uris[0].endsWith(path) ? 'non_identity' : 'allow'))
    }
  }
}

function servicePolicy(policy, policyID, tokenIDs, reusable = false) {
  keys(policy, ['id', 'name', 'decision', 'include', 'exclude', 'require', 'app_count', 'precedence',
    'created_at', 'updated_at', 'session_duration', 'approval_required', 'approval_groups',
    'purpose_justification_required', 'purpose_justification_prompt', 'isolation_required'])
  check(policy.id === policyID && policy.decision === 'non_identity')
  if (reusable) check(policy.app_count === 1)
  else if (own(policy, 'app_count')) check(policy.app_count === 1)
  for (const key of ['require', 'exclude', 'approval_groups']) emptyList(policy, key)
  for (const key of ['approval_required', 'purpose_justification_required', 'isolation_required']) {
    check(!own(policy, key) || policy[key] === false)
  }
  check(!own(policy, 'purpose_justification_prompt') || policy.purpose_justification_prompt === '')
  list(policy.include, tokenIDs.length, tokenIDs.length)
  const actual = policy.include.map(rule => {
    keys(rule, ['service_token'])
    keys(rule.service_token, ['token_id'])
    check(uuid.test(rule.service_token.token_id))
    return rule.service_token.token_id
  })
  unique(actual)
  check(actual.every(id => tokenIDs.includes(id)))
}

/**
 * Validate a complete, explicitly collected OFFLINE snapshot. This does not fetch
 * provider state, prove snapshot completeness/freshness or authorize a release.
 * clients extends the runtime client shape only with serviceTokenID: the UUID
 * policy selector is NOT the native accessClientID used by JWT common_name.
 * now may be a Date or UTC ISO string for deterministic review/tests.
 */
export function validateQAMachineAccessInventory(input) {
  try {
    boundedSnapshot(input)
    keys(input, ['applications', 'applicationID', 'policyID', 'audience', 'humanApplicationID', 'humanAudience',
      'humanPolicyID', 'publicApplicationID', 'hostnames', 'clients', 'policies', 'reusablePolicy', 'serviceTokens', 'now'])
    for (const key of ['applicationID', 'policyID', 'humanApplicationID', 'humanPolicyID']) check(uuid.test(input[key]))
    check(input.applicationID !== input.humanApplicationID && input.policyID !== input.humanPolicyID)
    if (own(input, 'publicApplicationID')) {
      check(uuid.test(input.publicApplicationID) && ![input.applicationID, input.humanApplicationID].includes(input.publicApplicationID))
    }
    check(audience.test(input.audience) && audience.test(input.humanAudience) && input.audience !== input.humanAudience)
    list(input.hostnames, 1, 10)
    check(input.hostnames.every(host => typeof host === 'string' && host.length <= 253 && host.split('.').every(label => label.length <= 63)))
    configuredHostnames({ routes: input.hostnames.map(pattern => ({ pattern, custom_domain: true })) })
    list(input.clients, 1, 8)
    for (const client of input.clients) {
      keys(client, ['key', 'accessClientID', 'surveyVersions', 'serviceTokenID'])
      check(uuid.test(client.key) && clientID.test(client.accessClientID) && uuid.test(client.serviceTokenID))
      list(client.surveyVersions, 1, 16)
      check(client.surveyVersions.every(version => typeof version === 'string' && version.length >= 1 && version.length <= 100))
      unique(client.surveyVersions)
    }
    for (const key of ['key', 'accessClientID', 'serviceTokenID']) unique(input.clients.map(client => client[key]))
    list(input.applications, 2, 100)
    check(input.applications.every(application => record(application) && uuid.test(application.id)))
    unique(input.applications.map(application => application.id))
    for (const application of input.applications) {
      destinations(application)
      check(application.name !== publicParticipationName || application.id === input.publicApplicationID)
    }
    const target = input.applications.find(application => application.id === input.applicationID)
    const human = input.applications.find(application => application.id === input.humanApplicationID)
    check(target && human)
    exactApplication(target, input.applicationID, input.audience, input.hostnames.map(host => host + path), input.policyID)
    exactApplication(human, input.humanApplicationID, input.humanAudience, input.hostnames, input.humanPolicyID)
    if (input.publicApplicationID) {
      const participation = input.applications.find(application => application.id === input.publicApplicationID)
      check(participation)
      validatePublicParticipation(participation, undefined, input.hostnames)
    }
    // The existing release guard intentionally still rejects a QA overlap. Only
    // this isolated preparation excludes the explicitly checked QA application.
    validateAccessApplications(input.applications.filter(application => application.id !== input.applicationID),
      input.humanApplicationID, input.publicApplicationID, input.hostnames)
    list(input.policies, 1, 1)
    const tokenIDs = input.clients.map(client => client.serviceTokenID)
    servicePolicy(input.policies[0], input.policyID, tokenIDs)
    servicePolicy(input.reusablePolicy, input.policyID, tokenIDs, true)
    if (target.policies && Object.keys(target.policies[0]).some(key => !['id', 'precedence'].includes(key))) {
      servicePolicy(target.policies[0], input.policyID, tokenIDs)
    }
    const now = own(input, 'now') ? (input.now instanceof Date ? input.now.getTime() : date(input.now) ? Date.parse(input.now) : NaN) : Date.now()
    check(Number.isFinite(now))
    list(input.serviceTokens, 1, 100)
    for (const token of input.serviceTokens) {
      keys(token, ['id', 'client_id', 'expires_on', 'name', 'created_at', 'updated_at', 'duration', 'status', 'revoked'])
      check(uuid.test(token.id) && clientID.test(token.client_id) && date(token.expires_on))
      if (own(token, 'status')) check(['active', 'expired', 'revoked'].includes(token.status))
      if (own(token, 'revoked')) check(typeof token.revoked === 'boolean')
    }
    unique(input.serviceTokens.map(token => token.id))
    unique(input.serviceTokens.map(token => token.client_id))
    for (const client of input.clients) {
      const token = input.serviceTokens.find(token => token.id === client.serviceTokenID)
      check(token && token.client_id === client.accessClientID && Date.parse(token.expires_on) > now &&
        (!own(token, 'status') || token.status === 'active') && token.revoked !== true)
    }
    return { clients: input.clients.length, hosts: input.hostnames.length, path }
  } catch { throw new Error(failure) }
}

// JSON.parse intentionally uses last-key-wins semantics. Do not let a file with
// duplicate (including escaped-equivalent) keys make an offline review ambiguous.
function parseSnapshot(source) {
  const parsed = JSON.parse(source)
  const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) ?? []
  let index = 0
  function value(depth) {
    check(depth <= 16)
    const token = tokens[index++]
    if (token === '{') {
      const seen = new Set()
      if (tokens[index] !== '}') do {
        const key = JSON.parse(tokens[index++])
        check(!seen.has(key)); seen.add(key)
        check(tokens[index++] === ':')
        value(depth + 1)
      } while (tokens[index] === ',' && ++index)
      check(tokens[index++] === '}')
    } else if (token === '[') {
      if (tokens[index] !== ']') do { value(depth + 1) } while (tokens[index] === ',' && ++index)
      check(tokens[index++] === ']')
    }
  }
  value(0)
  check(index === tokens.length)
  return parsed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv.length === 4 && process.argv[2] === '--file')
    const file = await open(process.argv[3], 'r')
    let buffer
    try {
      check((await file.stat()).isFile())
      buffer = Buffer.alloc(1024 * 1024 + 1)
      let size = 0
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
        if (!bytesRead) break
        size += bytesRead
      }
      check(size > 0 && size <= 1024 * 1024)
      buffer = buffer.subarray(0, size)
    } finally { await file.close() }
    const summary = validateQAMachineAccessInventory(parseSnapshot(buffer.toString('utf8')))
    console.log(`PASS: offline QA Access inventory (${summary.clients} clients, ${summary.hosts} hosts, ${summary.path}). No live verification performed.`)
  } catch {
    console.error(failure)
    process.exitCode = 1
  }
}
