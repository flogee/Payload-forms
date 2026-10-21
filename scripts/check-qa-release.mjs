import { validateQAMachineAccessInventory } from './check-qa-access.mjs'
import { isPublicParticipationCandidate } from './check-access.mjs'

/** Read-only live metadata preflight, not ingress acceptance or policy creation.
 * read(url, true) must require a complete bounded single-page result.
 * No credentials, snapshots or provider error bodies are returned or logged.
 */
export async function verifyQAMachineRelease({ settings, applications, humanApplication, humanPolicyID,
  humanAudience, publicApplicationID, hostnames, accountPath, read }) {
  const machine = await read(`${accountPath}/access/apps/${settings.applicationID}`)
  const policies = await read(`${accountPath}/access/apps/${settings.applicationID}/policies?per_page=100`, true)
  const reusablePolicy = await read(`${accountPath}/access/policies/${settings.policyID}`)
  const metadata = settings.enabled ? await read(`${accountPath}/access/service_tokens?per_page=100`, true) : []
  const selectedIDs = new Set(settings.clients.map(client => client.serviceTokenID))
  // The API may return unrelated operational metadata; only the configured
  // identities and fields relevant to authorization enter the pure validator.
  const serviceTokens = metadata.filter(token => selectedIDs.has(token?.id)).map(token => ({
    ...Object.fromEntries(['id', 'client_id', 'expires_at', 'expires_on', 'enabled', 'status', 'revoked']
      .filter(key => Object.hasOwn(token, key)).map(key => [key, token[key]])),
    ...(token.leak_reported_at != null ? { revoked: true } : {}),
  }))
  const publicID = publicApplicationID ?? applications.find(app => isPublicParticipationCandidate(app, hostnames))?.id
  const input = { applicationID: settings.applicationID, policyID: settings.policyID, audience: settings.audience,
    humanApplicationID: humanApplication.id, humanPolicyID, humanAudience, hostnames, clients: settings.clients,
    ...(publicID ? { publicApplicationID: publicID } : {}), applications, policies, reusablePolicy, serviceTokens }
  // Both the complete list and current detail reads must satisfy the exact
  // expectations. An inconsistent or missing list entry cannot be replaced away.
  const options = { requireActiveTokens: settings.enabled }
  validateQAMachineAccessInventory(input, options)
  validateQAMachineAccessInventory({ ...input, applications: applications.map(app =>
    app.id === settings.applicationID ? machine : app.id === humanApplication.id ? humanApplication : app) }, options)
  return applications.filter(app => app.id !== settings.applicationID)
}
