import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import type { ResponseDatabase } from '../survey/response-store'

export const QA_MACHINE_PATH = '/api/integrations/qa'
export class QAMachineError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message) }
}
const clientSchema = z.object({
  key: z.string().uuid().transform(value => value.toLowerCase()),
  accessClientID: z.string().regex(/^[a-f0-9]{32}\.access$/),
  surveyVersions: z.array(z.string().min(1).max(100)).min(1).max(16),
}).strict()
export type QAMachineClient = z.infer<typeof clientSchema>
export type QAMachineEnvironment = {
  QA_MACHINE_ENABLED?: string; QA_MACHINE_AUD?: string; QA_MACHINE_CLIENTS?: string
  ACCESS_LOGIN_ENABLED?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string
  SURVEY_ORIGINS?: string; SURVEY_ORIGIN?: string
  D1?: ResponseDatabase; PUBLIC_IP_RATE?: RateLimit; PUBLIC_TOTAL_RATE?: RateLimit
}
let cached: { issuer: string; key: JWTVerifyGetKey } | undefined
export function qaMachineSettings(env: QAMachineEnvironment) {
  if (env.QA_MACHINE_ENABLED !== '1') return null
  try {
    if (env.ACCESS_LOGIN_ENABLED !== '1' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN ?? '')
      || !/^[a-f0-9]{64}$/.test(env.ACCESS_AUD ?? '') || !/^[a-f0-9]{64}$/.test(env.QA_MACHINE_AUD ?? '') || env.QA_MACHINE_AUD === env.ACCESS_AUD
      || !env.QA_MACHINE_CLIENTS || env.QA_MACHINE_CLIENTS.length > 16384) throw new Error()
    const clients = z.array(clientSchema).min(1).max(8).parse(JSON.parse(env.QA_MACHINE_CLIENTS))
    if (new Set(clients.map(client => client.key)).size !== clients.length || new Set(clients.map(client => client.accessClientID)).size !== clients.length) throw new Error()
    const origins = (env.SURVEY_ORIGINS ?? env.SURVEY_ORIGIN ?? '').split(',').map(value => value.trim())
    if (!origins.length || origins.length > 10 || new Set(origins).size !== origins.length || origins.some(origin => {
      const url = new URL(origin)
      return url.origin !== origin || url.protocol !== 'https:' || !!url.username || !!url.password || !!url.port
    })) throw new Error()
    return { clients, issuer: env.ACCESS_TEAM_DOMAIN!, audience: env.QA_MACHINE_AUD!, hosts: origins.map(origin => new URL(origin).host) }
  } catch { throw new QAMachineError(503, 'QA-Maschinenzugang ist nicht vollständig konfiguriert.') }
}

// A separate non-human principal; never impersonate a Payload team user or
// accept raw CF-Access-Client-* headers as proof. Claims follow Cloudflare's
// documented application-token/service-token shape (type=app, empty sub).
export async function authenticateQAMachine(request: Request, env: QAMachineEnvironment, testKey?: JWTVerifyGetKey): Promise<QAMachineClient> {
  const settings = qaMachineSettings(env)
  if (!settings) throw new QAMachineError(404, 'Schnittstelle nicht verfügbar.')
  const url = new URL(request.url), host = request.headers.get('host') ?? url.host
  if (url.pathname !== QA_MACHINE_PATH || url.search || !settings.hosts.includes(host)
    || request.method !== 'POST' || request.headers.has('origin') || request.headers.has('cookie')
    || request.headers.has('authorization') || request.headers.has('sec-fetch-site')) {
    throw new QAMachineError(403, 'Kein zulässiger Maschinenaufruf.')
  }
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token || token.length > 16384) throw new QAMachineError(401, 'Service-Identität erforderlich.')
  if (!cached || cached.issuer !== settings.issuer) cached = { issuer: settings.issuer,
    key: createRemoteJWKSet(new URL(`${settings.issuer}/cdn-cgi/access/certs`), { timeoutDuration: 3000, cooldownDuration: 30000, cacheMaxAge: 600000 }) }
  try {
    const { payload: claims } = await jwtVerify(token, testKey ?? cached.key, {
      issuer: settings.issuer, audience: settings.audience, algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'type', 'common_name'], clockTolerance: 0,
    })
    const client = settings.clients.find(candidate => candidate.accessClientID === claims.common_name)
    const exactAudience = claims.aud === settings.audience || (Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === settings.audience)
    if (!client || !exactAudience || claims.type !== 'app' || claims.sub !== '' || claims.email !== undefined
      || typeof claims.iat !== 'number' || claims.iat <= 0 || claims.iat > Math.floor(Date.now() / 1000) + 5) throw new Error()
    return client
  } catch { throw new QAMachineError(401, 'Service-Identität konnte nicht bestätigt werden.') }
}
