import { APIError, type CollectionConfig } from 'payload'
export const TeamAccessMonitor: CollectionConfig = {
  slug: 'team-access-monitor', admin: { hidden: true }, timestamps: false,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [({ operation, args }) => {
    if (['create', 'update', 'delete'].includes(operation)) throw new APIError('Der Teamabgleich wird ausschließlich durch den Worker verwaltet.', 403)
    return args
  }] },
  fields: [
    { name: 'desiredDigest', type: 'text', required: true },
    { name: 'syncedEmails', type: 'json' }, { name: 'attemptedEmails', type: 'json' },
    { name: 'status', type: 'select', required: true, options: ['pending', 'syncing', 'synced', 'failed'] },
    { name: 'attempts', type: 'number', required: true, min: 0, max: 3 },
    { name: 'checkedAt', type: 'date' }, { name: 'syncedAt', type: 'date' }, { name: 'lastError', type: 'text' },
    { name: 'leaseToken', type: 'text' }, { name: 'leaseUntil', type: 'date' },
  ],
}
