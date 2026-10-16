import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { normalizeTeamEmail } from './team'

// Called only by the explicit remote bootstrap CLI, after config and Access preflight.
// Never called by a request handler or ordinary application startup.
export async function ensureInitialAdmin(payload: Pick<Payload, 'count' | 'create'>, initialEmails: string | undefined) {
  const existing = await payload.count({ collection: 'users', overrideAccess: true })
  if (existing.totalDocs !== 0) return 'existing' as const
  const values = initialEmails?.split(',') || []
  const email = values.length === 1 && normalizeTeamEmail(values[0])
  if (!email) throw new Error('First bootstrap requires exactly one configured initial administrator email.')
  // Local password login remains disabled in Access mode. The random field is
  // never printed, returned, or used as a shared installation credential.
  await payload.create({ collection: 'users', overrideAccess: true, data: {
    email, role: 'admin', enabled: true, password: randomBytes(48).toString('hex'),
  } })
  return 'created' as const
}
