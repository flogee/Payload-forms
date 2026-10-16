import { randomUUID } from 'node:crypto'
import { APIError, type CollectionConfig, type PayloadRequest } from 'payload'
import { staff } from './Users'
import { IMAGE_LIMITS, IMAGE_PREFIX } from '../survey/image-budget'
import { imageExtension } from '../survey/image-files'

export const mediaStaff = ({ req }: { req: PayloadRequest }) => staff({ req }) && !(req.user && '_strategy' in req.user && req.user._strategy === 'mcp-api-key')
export const Media: CollectionConfig = {
  slug: 'media', labels: { singular: 'Bild', plural: 'Bilder' },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'filename', 'filesize'], description: 'PNG, JPG oder WebP bis 2 MB. Gesamtgrenze 128 MB; 256 Schreibversuche und 100.000 Leseoperationen pro Monat. Bilder bleiben unveränderlich, damit gestartete Fassungen erhalten bleiben.',
    components: { beforeListTable: ['/components/MediaBudgetStatus#MediaBudgetStatus'] } },
  access: { read: mediaStaff, create: mediaStaff, update: () => false, delete: () => false },
  upload: { mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], filesRequiredOnCreate: true, crop: false, focalPoint: false, pasteURL: false,
    modifyResponseHeaders: ({ headers }) => { headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Cache-Control', 'private, no-store'); return headers } },
  hooks: { beforeOperation: [({ args, operation, req }) => {
    if (operation === 'update' || operation === 'delete') throw new APIError('Bilder sind unveränderlich. Für Änderungen ein neues Bild hochladen.', 403)
    if (operation !== 'create') return args
    if (!mediaStaff({ req })) throw new APIError('Team-Anmeldung erforderlich.', 403)
    const file = req.file
    if (!file || !file.data || file.data.length < 1 || file.data.length > IMAGE_LIMITS.fileBytes) throw new APIError('Bitte ein Bild bis 2 MB hochladen.', 400)
    const extension = imageExtension(file.data, file.mimetype)
    if (!extension) throw new APIError('Bitte eine gültige PNG-, JPG- oder WebP-Datei hochladen.', 400)
    file.name = `${randomUUID()}.${extension}`
    // Ignore user-provided storage destinations; external URLs/direct uploads are disabled.
    if ('data' in args && args.data) { args.data.prefix = IMAGE_PREFIX; delete args.data._objectKey }
    return args
  }] },
  fields: [
    { name: 'title', label: 'Bildname', type: 'text', required: true, maxLength: 100 },
    { name: 'budgetStatus', type: 'ui', admin: { components: { Field: '/components/MediaBudgetStatus#MediaBudgetStatus' } } },
  ],
}
