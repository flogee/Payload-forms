// Explicit recovery for a stale Access cookie after a team-domain change.
// It clears only this host's application session, without reading credentials.
export function restartAccessLogin(request: Request, enabled: boolean): Response | null {
  const url = new URL(request.url)
  if (!enabled || url.pathname !== '/auth/restart') return null
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
  const headers = new Headers({ Location: '/admin', 'Cache-Control': 'no-store' })
  const attributes = 'Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax'
  headers.append('Set-Cookie', `CF_Authorization=; ${attributes}`)
  headers.append('Set-Cookie', `CF_Authorization=; Domain=${url.hostname}; ${attributes}`)
  return new Response(null, { status: 303, headers })
}
