import { z } from 'zod'
import { imageIDs } from './content'
import type { Definition } from './types'

const text = z.string().trim().min(1, 'Bitte einen Namen für die Kopfzeile eingeben.').max(100)
const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }),
  z.object({ mode: z.literal('text'), text }),
  z.object({ mode: z.literal('logo'), text, logo: z.number().int().positive().max(2147483647) }),
])
export type SurveyBranding = z.infer<typeof schema>

// Presentation is independent of the immutable research instrument. Native
// upload relationships may be populated; exports keep only the media ID.
export function readBranding(value: unknown): SurveyBranding {
  if (value == null) return { mode: 'default' }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Bitte die Kopfzeile prüfen.')
  const input = value as Record<string, unknown>
  const logo = input.logo && typeof input.logo === 'object' ? (input.logo as Record<string, unknown>).id : input.logo
  return schema.parse({ mode: input.mode ?? 'default', text: input.text, logo })
}

export function surveyImageIDs(definition: Definition, branding: SurveyBranding): number[] {
  return [...new Set([...imageIDs(definition), ...(branding.mode === 'logo' ? [branding.logo] : [])])]
}
