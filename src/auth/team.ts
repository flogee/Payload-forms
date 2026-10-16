export function isTeamUser(user: unknown): user is { id: number; collection: 'users'; enabled?: boolean; role?: string; _strategy?: string } {
  return !!user && typeof user === 'object' && 'collection' in user && user.collection === 'users'
    && (!('enabled' in user) || user.enabled === true)
}
export function managesTeam(user: unknown): boolean {
  return isTeamUser(user) && user.role === 'admin' && user._strategy !== 'mcp-api-key'
}
export function normalizeTeamEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email) ? email : null
}
