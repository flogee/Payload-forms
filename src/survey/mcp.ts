import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { definitionSchema } from './validation'
import { toStored } from './storage'
import type { Definition } from './types'

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  definition: definitionSchema
}).strict()
const updatedSchema = draftSchema.extend({ surveyID: z.number().int().positive() })
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
export const draftTools = [
  {
    name: 'createSurveyDraft',
    description: 'Legt einen vollständigen Fragebogen als Entwurf an. definition enthält version, introduction und sections mit stabilen Fragekennungen. Keine Veröffentlichung und keine Rohantworten.',
    parameters: draftSchema.shape,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      if (!req.user) throw new Error('Anmeldung erforderlich')
      const data = draftSchema.parse(args)
      const survey = await req.payload.create({ collection: 'surveys', data: { title: data.title, slug: data.slug, phase: 'draft', ...toStored(data.definition as Definition) }, req, overrideAccess: false })
      return result({ id: survey.id, version: survey.version, phase: survey.phase })
    }
  },
  {
    name: 'updateSurveyDraft',
    description: 'Ersetzt einen bestehenden Entwurf mit der vollständig angegebenen Fassung. Begonnene Pretests und geschlossene Fassungen sind gesperrt.',
    parameters: updatedSchema.shape,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      if (!req.user) throw new Error('Anmeldung erforderlich')
      const data = updatedSchema.parse(args)
      const previous = await req.payload.findByID({ collection: 'surveys', id: data.surveyID, req, overrideAccess: false })
      if (previous.phase !== 'draft') throw new Error('Diese Erhebungsfassung ist eingefroren. Bitte einen neuen Entwurf anlegen.')
      const survey = await req.payload.update({ collection: 'surveys', id: previous.id, data: { title: data.title, slug: data.slug, ...toStored(data.definition as Definition) }, req, overrideAccess: false })
      return result({ id: survey.id, version: survey.version, phase: survey.phase })
    }
  }
]
