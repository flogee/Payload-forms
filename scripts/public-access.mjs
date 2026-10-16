// Example inventory for fixtures. Releases pass the explicitly selected install's hosts.
export const internalHostnames = ['forms.example.org', 'forms.example.net']
export const publicParticipationName = 'Payload-forms – Teilnahme'
export const publicParticipationPaths = ['/f/*', '/datenschutz/*', '/api/survey/submit', '/_next/static/*']
export const participationDestinations = hosts => hosts.flatMap(host => publicParticipationPaths.map(path => `${host}${path}`))
export const publicParticipationDestinations = participationDestinations(internalHostnames)

export function configuredHostnames(internal) {
  const routes = internal?.routes
  if (!Array.isArray(routes) || !routes.length || routes.length > 10 ||
    routes.some(route => route.custom_domain !== true || typeof route.pattern !== 'string' ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(route.pattern)) ||
    new Set(routes.map(route => route.pattern)).size !== routes.length) {
    throw new Error('Configure 1–10 unique complete custom-domain hosts; wildcards and paths are forbidden.')
  }
  return routes.map(route => route.pattern)
}
