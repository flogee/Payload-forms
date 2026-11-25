import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import { definitionSchema } from './validation'
import { toStored } from './storage'
import type { Definition } from './types'
import { participantLanguages } from './participant-language'

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  definition: definitionSchema,
  participantLanguage: z.enum(participantLanguages).optional(),
  hideQuestionCodes: z.boolean().optional(),
}).strict()
const createSchema = draftSchema.extend({ emailRegistration: z.literal(true).optional() })
const updatedSchema = draftSchema.extend({ surveyID: z.number().int().positive() })
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
export const draftTools = [
  {
    name: 'createSurveyDraft',
    description: 'Legt einen vollständigen Fragebogen als Entwurf an. definition enthält version, introduction und sections mit stabilen Fragekennungen. Für eine eigenständige E-Mail-Anmeldung emailRegistration: true mit leeren sections verwenden. Die Datenschutzhinweise werden im Editor ergänzt. Keine Veröffentlichung und keine Rohantworten.',
    parameters: createSchema.shape,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      if (!req.user) throw new Error('Anmeldung erforderlich')
      const data = createSchema.parse(args)
      const survey = await req.payload.create({ collection: 'surveys', data: {
        title: data.title, slug: data.slug, phase: 'draft', ...toStored(data.definition as Definition),
        ...(data.emailRegistration ? { privacy: { contactMode: 'email-only' } } : {}),
        ...(data.participantLanguage !== undefined ? { participantLanguage: data.participantLanguage } : {}),
        ...(data.hideQuestionCodes !== undefined ? { hideQuestionCodes: data.hideQuestionCodes } : {}),
      }, req, overrideAccess: false })
      return result({ id: survey.id, version: survey.version, phase: survey.phase })
    }
  },
  {
    name: 'updateSurveyDraft',
    description: 'Aktualisiert die angegebene surveyID im Status draft oder pretest mit der vollständigen Definition. Für denselben Teilnahmelink den vorhandenen Pretest und dessen slug und version beibehalten. Ein separater Entwurf aktualisiert den Pretest nicht. Testantworten sperren die Fassung nicht. Nach der ersten echten Antwort sowie im Status live oder closed ist dieses Werkzeug gesperrt. Ändert keinen Status. Optionaler formatierter Dankestext: definition.thankYouContent; weglassen zum Beibehalten, null zum Leeren. Optional: hideQuestionCodes blendet Fragekürzel für Teilnehmende aus. Ohne Angabe wird die Einstellung beibehalten. Optional: participantLanguage setzt die Oberflächensprache (de oder en).',
    parameters: updatedSchema.shape,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      if (!req.user) throw new Error('Anmeldung erforderlich')
      const data = updatedSchema.parse(args)
      const previous = await req.payload.findByID({ collection: 'surveys', id: data.surveyID, req, overrideAccess: false })
      if (!['draft', 'pretest'].includes(previous.phase) || previous.firstRealResponseAt) throw new Error('Diese Erhebungsfassung ist eingefroren. Bitte einen neuen Entwurf anlegen.')
      const survey = await req.payload.update({ collection: 'surveys', id: previous.id, data: {
        title: data.title, slug: data.slug, ...toStored(data.definition as Definition),
        ...(data.participantLanguage !== undefined ? { participantLanguage: data.participantLanguage } : {}),
        ...(data.hideQuestionCodes !== undefined ? { hideQuestionCodes: data.hideQuestionCodes } : {}),
      }, req, overrideAccess: false })
      return result({ id: survey.id, version: survey.version, phase: survey.phase })
    }
  }
]
