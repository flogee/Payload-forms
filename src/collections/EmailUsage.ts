import type { CollectionConfig } from 'payload'
import { staff } from './Users'

// Separate from deletable notification rows, so erasures cannot reset the cap.
export const EmailUsage: CollectionConfig = {
  slug: 'email-usage', admin: { hidden: true },
  access: { read: staff, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'month', type: 'text', required: true, unique: true },
    { name: 'attempts', type: 'number', required: true, min: 0 },
  ],
}
