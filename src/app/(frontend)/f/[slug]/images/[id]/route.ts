import { participationMode } from '@/survey/participation'
import { getPayload } from 'payload'
import config, { cloudflareEnvironment } from '@payload-config'
import { fromStored } from '@/survey/storage'
import { readBranding, surveyImageIDs } from '@/survey/branding'
import { validSurveySlug } from '@/survey/sharing'
import { validImageKey, IMAGE_PREFIX } from '@/survey/image-budget'

export const dynamic = 'force-dynamic'
const missing = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  if (!validSurveySlug(slug) || !/^[1-9][0-9]{0,9}$/.test(id)) return missing()
  const payload = await getPayload({ config })
  const found = await payload.find({ collection: 'surveys', where: { slug: { equals: slug }, phase: { in: ['pretest', 'live'] } }, limit: 1, depth: 0 })
  const survey = found.docs[0]
  if (!survey || !participationMode(survey) || !surveyImageIDs(fromStored(survey), readBranding(survey.branding)).includes(Number(id))) return missing()
  const media = await payload.find({ collection: 'media', where: { id: { equals: Number(id) } }, limit: 1, depth: 0, overrideAccess: true })
  const image = media.docs[0], key = `${IMAGE_PREFIX}/${image?.filename}`
  if (!image || !validImageKey(key) || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) return missing()
  try {
    const object = await cloudflareEnvironment.MEDIA.get(key)
    if (!object) return missing()
    return new Response(object.body, { headers: { 'Content-Type': image.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } })
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }) }
}
