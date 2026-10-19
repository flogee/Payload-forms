import { APIError, type CollectionConfig } from 'payload'
import { QA_MACHINE_LIMITS } from '../survey/qa-machine-limits'

export const QAMachineUsage: CollectionConfig = {
  slug: 'qa-machine-usage', timestamps: false, admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [({ operation, args }: any) => {
    if (['create', 'update', 'delete'].includes(operation)) throw new APIError('QA-Kontingente werden ausschließlich atomar durch den Worker verwaltet.', 403)
    return args
  }] },
  indexes: [{ fields: ['scope', 'month'], unique: true }],
  fields: [
    { name: 'scope', type: 'text', required: true },
    { name: 'month', type: 'text', required: true },
    { name: 'requests', type: 'number', required: true, min: 0, max: QA_MACHINE_LIMITS.installation.requests },
    { name: 'reports', type: 'number', required: true, min: 0, max: QA_MACHINE_LIMITS.installation.reports },
  ],
}
