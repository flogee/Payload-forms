import { APIError, type CollectionConfig } from 'payload'
import { IMAGE_LIMITS } from '../survey/image-budget'

const protectedBudget = {
  timestamps: false,
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [({ operation, args }: any) => {
    if (['create', 'update', 'delete'].includes(operation)) throw new APIError('Bildkontingente werden ausschließlich atomar durch den Bildspeicher verwaltet.', 403)
    return args
  }] },
} satisfies Partial<CollectionConfig>
export const ImageStorageUsage: CollectionConfig = {
  ...protectedBudget, slug: 'image-storage-usage', fields: [
    { name: 'reservedBytes', type: 'number', required: true, min: 0, max: IMAGE_LIMITS.storageBytes },
    { name: 'reservedObjects', type: 'number', required: true, min: 0, max: IMAGE_LIMITS.objects },
  ],
}
export const ImageRequestUsage: CollectionConfig = {
  ...protectedBudget, slug: 'image-request-usage', fields: [
    { name: 'month', type: 'text', required: true, unique: true },
    { name: 'reads', type: 'number', required: true, min: 0, max: IMAGE_LIMITS.monthlyReads },
    { name: 'writes', type: 'number', required: true, min: 0, max: IMAGE_LIMITS.monthlyWrites },
  ],
}
