import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { AuthStrategy } from 'payload'
import { normalizeTeamEmail } from './team'
export type AccessEnvironment = { ACCESS_LOGIN_ENABLED?: string; ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }
export function accessSettings(env: AccessEnvironment) {
  if (env.ACCESS_LOGIN_ENABLED !== '1') return null
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN ?? '')
    || !/^[a-f0-9]{64}$/.test(env.ACCESS_AUD ?? '')) throw new Error('Access-Anmeldung ist unvollständig konfiguriert.')
  return { issuer: env.ACCESS_TEAM_DOMAIN!, audience: env.ACCESS_AUD! }
}
export function accessStrategy(env: AccessEnvironment, testKey?: JWTVerifyGetKey): AuthStrategy {
  const settings = accessSettings(env)
  // A warm Worker reuses a bounded key cache, never a URL supplied by a token.
  const key = settings && (testKey ?? createRemoteJWKSet(new URL(`${settings.issuer}/cdn-cgi/access/certs`), {
    timeoutDuration: 3000, cooldownDuration: 30000, cacheMaxAge: 600000,
  }))
  return { name: 'cloudflare-access', authenticate: async ({ headers, payload, req }) => {
    if (!settings) return { user: null }
    const token = headers.get('cf-access-jwt-assertion')
    if (!token || token.length > 16384) return { user: null }
    try {
      const { payload: claims } = await jwtVerify(token, key!, {
        issuer: settings.issuer, audience: settings.audience, algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'], clockTolerance: 5,
      })
      const email = normalizeTeamEmail(claims.email)
      if (!email || claims.type !== 'app' || claims.non_identity === true || typeof claims.sub !== 'string' || !claims.sub) return { user: null }
      const found = await payload.find({ collection: 'users', where: { email: { equals: email }, enabled: { equals: true } },
        depth: 0, limit: 1, pagination: false, overrideAccess: true, req })
      const user = found.docs[0]
      if (!user || user.enabled !== true) return { user: null }
      return { user: { ...user, collection: 'users', _strategy: 'cloudflare-access' } }
    } catch {
      // Assertions, email addresses and provider response bodies stay out of logs.
      return { user: null }
    }
  } }
}
