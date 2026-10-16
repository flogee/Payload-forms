import { APIError, type CollectionConfig } from 'payload'

const protectedState = {
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [({ operation, args }: any) => {
    if (['create', 'update', 'delete'].includes(operation)) throw new APIError('Fristerinnerungen werden ausschließlich atomar durch den Worker verwaltet.', 403)
    return args
  }] },
} satisfies Partial<CollectionConfig>

export const RetentionReminders: CollectionConfig = {
  ...protectedState, slug: 'retention-reminders', fields: [
    { name: 'reminderKey', type: 'text', required: true, unique: true },
    { name: 'survey', type: 'relationship', relationTo: 'surveys', required: true },
    { name: 'period', type: 'text', required: true },
    { name: 'recipient', type: 'email', required: true },
    { name: 'status', type: 'select', required: true, options: ['pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled'] },
    { name: 'attempts', type: 'number', required: true, min: 0, max: 3 },
    { name: 'within90', type: 'number', required: true, min: 0 },
    { name: 'within30', type: 'number', required: true, min: 0 },
    { name: 'overdue', type: 'number', required: true, min: 0 },
    { name: 'claimToken', type: 'text' }, { name: 'claimedAt', type: 'date' },
    { name: 'nextAttemptAt', type: 'date' }, { name: 'lastError', type: 'text' },
    { name: 'providerMessageId', type: 'text' },
  ],
}
export const RetentionReminderMonitor: CollectionConfig = {
  ...protectedState, slug: 'retention-reminder-monitor', timestamps: false,
  fields: [{ name: 'checkedAt', type: 'date', required: true }],
}
