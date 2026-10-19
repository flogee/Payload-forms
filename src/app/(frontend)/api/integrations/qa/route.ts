import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { handleQAMachineRequest } from '@/survey/qa-machine'
import { responseDatabase } from '@/survey/response-store'
import { fromStored } from '@/survey/storage'

export async function POST(request: Request) {
  return handleQAMachineRequest(request, { ...cloudflareEnvironment, ...process.env }, async () => {
    const payload = await getPayload({ config })
    return { db: responseDatabase(payload), secret: payload.secret,
      async loadInstrument(id) {
        // Only a scoped, verified service principal reaches this internal read.
        // Never create a Payload user to impersonate that principal.
        try {
          const survey = await payload.findByID({ collection: 'surveys', id, depth: 0, overrideAccess: true })
          return { id: survey.id, slug: survey.slug, phase: survey.phase, definition: fromStored(survey) }
        } catch (error) {
          if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null
          throw error
        }
      } }
  })
}
