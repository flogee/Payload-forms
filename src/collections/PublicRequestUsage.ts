import { APIError, type CollectionConfig } from 'payload'
import { PUBLIC_LIMITS } from '../survey/public-limits'

export const PublicRequestUsage: CollectionConfig = {
  slug: 'public-request-usage', timestamps: false, admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [({ operation, args }: any) => {
    if (['create', 'update', 'delete'].includes(operation)) throw new APIError('Teilnahmekontingente werden ausschließlich atomar durch den Worker verwaltet.', 403)
    return args
  }] },
  fields: [
    { name: 'month', type: 'text', required: true, unique: true },
    { name: 'reads', type: 'number', required: true, min: 0, max: PUBLIC_LIMITS.reads },
    { name: 'submissions', type: 'number', required: true, min: 0, max: PUBLIC_LIMITS.submissions },
  ],
}
