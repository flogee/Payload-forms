type OriginConfig = { SURVEY_ORIGINS?: string; SURVEY_ORIGIN?: string }

// Only canonical origins are accepted: no paths, credentials, wildcards or URL normalization.
export function configuredSurveyOrigins(env: OriginConfig): Set<string> | null {
  const configured = env.SURVEY_ORIGINS ?? env.SURVEY_ORIGIN
  if (!configured) return null
  const origins = (env.SURVEY_ORIGINS != null ? configured.split(',') : [configured]).map(origin => origin.trim())
  for (const origin of origins) {
    try {
      const url = new URL(origin)
      const localHTTP = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      if ((!localHTTP && url.protocol !== 'https:') || origin.includes('*') || url.origin !== origin) return null
    } catch { return null }
  }
  return new Set(origins)
}

export function surveyOriginStatus(origin: string | null, env: OriginConfig): 503 | 403 | null {
  const allowed = configuredSurveyOrigins(env)
  if (!allowed) return 503
  return origin && allowed.has(origin) ? null : 403
}
