// Browser mutations authenticated by Access cookies still need a CSRF boundary.
export function accessMutationAllowed(request: Request): boolean {
  if (!['POST','PUT','PATCH','DELETE'].includes(request.method)) return true
  const origin = request.headers.get('origin')
  if (origin) return origin === new URL(request.url).origin
  // MCP machine requests use a bearer API key and are authorized by the MCP plugin.
  return new URL(request.url).pathname === '/api/mcp' && /^Bearer [^\s]+$/.test(request.headers.get('authorization') ?? '')
}
