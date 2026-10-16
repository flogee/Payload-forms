import { configuredSurveyOrigins } from './origins'

export const validSurveySlug = (slug: unknown): slug is string => typeof slug === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(slug)

export type ParticipationLink = { origin: string; url: string; qrSVG: string; qrPNG: string }

export function participationLinks(surveyID: number, slug: string, env: { SURVEY_ORIGINS?: string; SURVEY_ORIGIN?: string }): ParticipationLink[] | null {
  if (!Number.isSafeInteger(surveyID) || surveyID <= 0 || !validSurveySlug(slug)) return null
  const origins = configuredSurveyOrigins(env)
  if (!origins) return null
  return [...origins].map(origin => {
    const qr = `/api/survey/share/${surveyID}?origin=${encodeURIComponent(origin)}`
    return { origin, url: `${origin}/f/${slug}`, qrSVG: `${qr}&format=svg`, qrPNG: `${qr}&format=png` }
  })
}
