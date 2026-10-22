import { privacyMissing, readPrivacySettings } from './privacy'

export type SubmissionMode = 'pretest' | 'live'

// Exact opt-in only: absent, disabled and malformed values never enable collection.
export function realSurveysEnabled(env: Record<string, unknown> = process.env): boolean {
  return env.FORMS_REAL_SURVEYS_ENABLED === '1'
}

export function livePrivacyReady(value: unknown): boolean {
  try {
    const settings = readPrivacySettings(value)
    return settings.reviewed && privacyMissing(settings).length === 0
  } catch { return false }
}

export function participationMode(survey: { phase?: unknown; privacy?: unknown }, env: Record<string, unknown> = process.env): SubmissionMode | undefined {
  if (survey.phase === 'pretest') return 'pretest'
  if (survey.phase === 'live' && realSurveysEnabled(env) && livePrivacyReady(survey.privacy)) return 'live'
  return undefined
}
