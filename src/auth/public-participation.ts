import { validSurveySlug } from '../survey/sharing'
import { PUBLIC_LIMITS } from '../survey/public-limits'
import { reservePublicRequest, recordPublicRateBlock } from '../survey/public-budget'

type PublicEnvironment = { PUBLIC_GUARD_ENABLED?: string; D1: D1Database; PUBLIC_IP_RATE: RateLimit; PUBLIC_TOTAL_RATE: RateLimit }

export function publicRequestKind(path: string): 'participation' | 'submissions' | 'static' | 'invalid' | undefined {
  if (path === '/api/survey/submit' || path === '/api/survey/submit/') return 'submissions'
  if (path.startsWith('/api/survey/submit/')) return 'invalid'
  if (path.startsWith('/_next/static/')) return 'static'
  if (path.startsWith('/f/') || path.startsWith('/datenschutz/')) {
    const parts = path.replace(/\/$/, '').split('/')
    if (!validSurveySlug(parts[2])) return 'invalid'
    if (parts.length === 3 || (parts[1] === 'f' && parts.length === 5 && parts[3] === 'images' && /^[1-9]\d{0,9}$/.test(parts[4]))) return 'participation'
    return 'invalid'
  }
}

function unavailable(request: Request, message: string, status: number, retryAfter?: number) {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
  if (retryAfter) headers['Retry-After'] = String(retryAfter)
  if (request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
    headers['Content-Type'] = 'text/html; charset=utf-8'
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    return new Response(`<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teilnahme vorübergehend nicht verfügbar</title><style>body{font:18px/1.6 system-ui;margin:12vh auto;padding:24px;max-width:600px;color:#243c35}a{color:inherit}</style><main><h1>Bitte später erneut versuchen</h1><p>${message}</p><p><a href="">Seite erneut laden</a></p></main></html>`, { status, headers })
  }
  return Response.json({ error: message }, { status, headers })
}

export async function guardPublicParticipation(request: Request, env: PublicEnvironment): Promise<Response | undefined> {
  if (env.PUBLIC_GUARD_ENABLED !== '1') return
  const kind = publicRequestKind(new URL(request.url).pathname)
  if (!kind) return // Protected administration, answers and results remain available.
  if (kind === 'invalid') return unavailable(request, 'Dieser Teilnahmelink ist nicht verfügbar.', 404)
  if (!(kind === 'submissions' ? request.method === 'POST' : ['GET', 'HEAD'].includes(request.method))) return unavailable(request, 'Diese Anfrage ist nicht zulässig.', 405)
  if (kind === 'static') return // Native static assets incur no D1/R2 operation.
  if (kind === 'submissions') {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return unavailable(request, 'JSON erforderlich.', 415)
    const length = request.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > PUBLIC_LIMITS.bodyBytes)) return unavailable(request, 'Antwort zu groß.', 413)
  }
  try {
    // Cloudflare sets this header; it is never stored in the application DB.
    // Generous IP limits account for seminar participants sharing a connection.
    const ip = request.headers.get('cf-connecting-ip') || 'unknown'
    if (!(await env.PUBLIC_IP_RATE.limit({ key: `payload-forms:participation:${ip}` })).success ||
        !(await env.PUBLIC_TOTAL_RATE.limit({ key: 'payload-forms:participation:all' })).success) {
      await recordPublicRateBlock(env.D1)
      return unavailable(request, 'Zu viele Anfragen in kurzer Zeit. Bitte warte eine Minute. Deine Eingaben bleiben im geöffneten Fragebogen erhalten.', 429, 60)
    }
    if (!await reservePublicRequest(env.D1, kind)) return unavailable(request,
      'Das Teilnahmekontingent ist erreicht. Bitte kontaktiere die Formularverwaltung. Deine Eingaben bleiben im geöffneten Fragebogen erhalten; halte diesen Tab geöffnet.', 429)
  } catch {
    console.error('PUBLIC_PARTICIPATION_GUARD_UNAVAILABLE')
    return unavailable(request, 'Die Teilnahme kann gerade nicht sicher geprüft werden. Bitte später erneut versuchen oder die Formularverwaltung kontaktieren. Deine Eingaben bleiben im geöffneten Fragebogen erhalten.', 503, 60)
  }
}
