import { setTimeout as delay } from 'node:timers/promises'
import { internalHostnames } from './check-access.mjs'

export const protectedPaths = ['/', '/f/sample', '/admin', '/api/users/me', '/api/survey/export', '/api/survey/share/1?format=png',
  '/datenschutz/sample', '/api/survey/responses/1/privacy', '/api/survey/notifications/status?surveyID=1',
  '/antwort/00000000-0000-4000-8000-000000000000', '/api/response-notifications',
  '/api/media', '/api/survey/media/status', '/f/sample/images/1',
  '/api/survey/retention/status?surveyID=1', '/api/survey/definition/1', '/api/team-access/status', '/api/survey/duplicate/1']

export const participationPaths = ['/f/sample', '/datenschutz/sample', '/f/sample/images/1',
  '/f/nonexistent', '/f/sample/images/2147483647', '/datenschutz/nonexistent',
  '/_next/static/access-probe.js', '/api/survey/submit']
export const privatePaths = [...protectedPaths.filter(path => !participationPaths.includes(path)),
  '/auswertung', '/auswertung/demo', '/api/survey/analysis?surveyID=1', '/api/surveys', '/api/responses', '/api/response-contacts', '/api/mcp',
  '/_next/image?url=%2Fadmin&w=640&q=75', '/api/survey', '/f', '/datenschutz', '/_next/static']

/**
 * @param {{ request?: (url: string, options: RequestInit) => Promise<Response>, wait?: (ms: number) => Promise<void>, now?: () => number, timeoutMs?: number, onRetry?: (message: string) => void, teamDomain?: string, hostnames?: string[], probeSlug?: string, publicParticipation?: boolean }} options
 */
export async function verifyReleaseHosts({ request = fetch, wait = delay, now = Date.now, timeoutMs = 300000, onRetry = console.log, teamDomain, hostnames = internalHostnames, probeSlug = 'sample', publicParticipation = false } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(probeSlug)) throw new Error('A safe existing pretest slug is required for the public release probe.')
  const deadline = now() + timeoutMs
  async function probe(hostname, path, options = {}) {
    while (true) {
      const remaining = deadline - now()
      if (remaining <= 0) throw new Error('Die HTTPS-Prüfung der internen Domains hat ihr Zeitlimit erreicht.')
      try {
        return await request(`https://${hostname}${path}`, { ...options, redirect: 'manual', signal: AbortSignal.timeout(Math.min(20000, remaining)) })
      } catch (error) {
        // Retry only DNS propagation; never retry public responses or TLS failures.
        const code = error.cause?.code || error.code
        if (!['ENOTFOUND', 'EAI_AGAIN'].includes(code) || now() + 5000 >= deadline) throw error
        onRetry(`DNS für ${hostname} noch nicht verfügbar; erneute Prüfung in 5 Sekunden.`)
        await wait(5000)
      }
    }
  }
  async function blocked(hostname, path, options) {
    const response = await probe(hostname, path, options)
    await response.body?.cancel()
    const location = response.headers.get('location') || ''
    const accessRedirect = response.status === 302 && new URL(location, `https://${hostname}`).hostname.endsWith('.cloudflareaccess.com')
      && (!teamDomain || new URL(location, `https://${hostname}`).origin === teamDomain)
    if (![401, 403].includes(response.status) && !accessRedirect) {
      throw new Error(`Anonymer Zugriff auf ${hostname}${path} wurde nicht wie erwartet durch Access blockiert (HTTP ${response.status}).`)
    }
  }
  async function status(hostname, path, expected, options) {
    const response = await probe(hostname, path, options)
    if (response.status !== expected) {
      await response.body?.cancel()
      throw new Error(`Öffentliche Teilnahme auf ${hostname}${path}: HTTP ${response.status} statt ${expected}.`)
    }
    return response
  }
  for (const hostname of hostnames) {
    for (const path of privatePaths) await blocked(hostname, path)
    const submission = { method: 'POST', headers: { Origin: `https://${hostname}`, 'Content-Type': 'application/json' }, body: '{' }
    if (!publicParticipation) {
      for (const path of participationPaths) await blocked(hostname, path, path === '/api/survey/submit' ? submission : undefined)
      continue
    }
    const form = await status(hostname, `/f/${probeSlug}`, 200)
    if (!form.headers.get('content-type')?.includes('text/html')) { await form.body?.cancel(); throw new Error('Öffentliche Formularantwort ist kein HTML.') }
    const html = await form.text()
    if (html.length > 2 * 1024 * 1024) throw new Error('Öffentliche Formularantwort überschreitet die Prüfgrenze.')
    const assets = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&'))
      .filter(path => path.startsWith('/_next/static/') && /\.(?:js|css)(?:\?|$)/.test(path)))]
    if (!assets.some(path => /\.js(?:\?|$)/.test(path)) || !assets.some(path => /\.css(?:\?|$)/.test(path)) || assets.length > 64) throw new Error('Öffentliche JS-/CSS-Dateien konnten nicht vollständig ermittelt werden.')
    for (const path of assets) {
      const asset = await status(hostname, path, 200)
      const type = asset.headers.get('content-type') || ''
      await asset.body?.cancel()
      if (/\.css(?:\?|$)/.test(path) ? !type.includes('text/css') : !/(?:javascript|ecmascript)/.test(type)) throw new Error('Öffentliche JS-/CSS-Antwort hat einen unerwarteten Inhaltstyp.')
    }
    for (const path of ['/f/nonexistent', `/f/${probeSlug}/images/2147483647`, '/datenschutz/nonexistent', '/api/survey/submit/extra']) {
      const missing = await status(hostname, path, 404)
      await missing.body?.cancel()
    }
    const invalid = await status(hostname, '/api/survey/submit', 400, submission)
    await invalid.body?.cancel()
  }
  console.log(`PASS: konfigurierte Domains geprüft; ${publicParticipation ? 'anonyme Teilnahme und geschützte Teamwege bestätigt' : 'anonymer Zugriff weiterhin gesperrt'}.`)
}
