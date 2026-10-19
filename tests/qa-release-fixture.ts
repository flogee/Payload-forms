import { installFixture } from './install-fixture'
import { participationDestinations, publicParticipationName } from '../scripts/public-access.mjs'

export function qaReleaseFixture() {
  const config = installFixture()
  const vars = config.env.internal.vars
  const id = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
  const clients = [1, 2].map(n => ({ key: id(n + 10), accessClientID: String(n).repeat(32) + '.access', surveyVersions: ['fictional-v1'] }))
  Object.assign(vars, { QA_MACHINE_ENABLED: '1', QA_MACHINE_APP_ID: id(1), QA_MACHINE_POLICY_ID: id(2),
    QA_MACHINE_AUD: 'e'.repeat(64), QA_MACHINE_CLIENTS: JSON.stringify(clients),
    QA_MACHINE_SERVICE_TOKEN_IDS: JSON.stringify(Object.fromEntries(clients.map((client, i) => [client.key, id(i + 20)]))) })
  const hosts = config.env.internal.routes.map((route: any) => route.pattern)
  const human = { id: vars.ACCESS_APP_ID, type: 'self_hosted', aud: vars.ACCESS_AUD,
    destinations: hosts.map((uri: string) => ({ type: 'public', uri })), policies: [{ id: vars.ACCESS_POLICY_ID }] }
  const machine = { id: vars.QA_MACHINE_APP_ID, type: 'self_hosted', aud: vars.QA_MACHINE_AUD,
    destinations: hosts.map((host: string) => ({ type: 'public', uri: host + '/api/integrations/qa' })), policies: [{ id: vars.QA_MACHINE_POLICY_ID }] }
  const publicApp = { id: id(3), type: 'self_hosted', name: publicParticipationName,
    destinations: participationDestinations(hosts).map((uri: string) => ({ type: 'public', uri })) }
  const machinePolicy: any = { id: vars.QA_MACHINE_POLICY_ID, decision: 'non_identity',
    include: clients.map((_, i) => ({ service_token: { token_id: id(i + 20) } })) }
  const humanPolicy = { id: vars.ACCESS_POLICY_ID, decision: 'allow', include: [{ email: { email: vars.ACCESS_INITIAL_EMAILS } }] }
  const publicPolicy = { decision: 'bypass', include: [{ everyone: {} }] }
  const tokens: any[] = clients.map((client, i) => ({ id: id(i + 20), client_id: client.accessClientID, enabled: true, expires_at: '2035-01-01T00:00:00Z' }))
  return { config, vars, hosts, clients, human, machine, publicApp, machinePolicy, humanPolicy, publicPolicy, tokens }
}
