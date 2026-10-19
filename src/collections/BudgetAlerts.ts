import { APIError, type CollectionConfig } from 'payload'

const protectedState = {
  admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: { beforeOperation: [({ operation, args }: any) => {
    if (['create', 'update', 'delete'].includes(operation)) throw new APIError('Betriebswarnungen werden ausschließlich atomar durch den Worker verwaltet.', 403)
    return args
  }] },
} satisfies Partial<CollectionConfig>

export const BudgetAlerts: CollectionConfig = {
  ...protectedState, slug: 'budget-alerts', fields: [
    { name: 'alertKey', type: 'text', required: true, unique: true },
    { name: 'metric', type: 'select', required: true, options: ['storage', 'objects', 'reads', 'writes', 'mail', 'participation', 'submissions', 'rate', 'qaRequests', 'qaReports', 'qaRate'] },
    { name: 'scope', type: 'text', required: true, defaultValue: '' },
    { name: 'period', type: 'text', required: true },
    { name: 'level', type: 'select', required: true, options: ['warning', 'blocked'] },
    { name: 'used', type: 'number', required: true, min: 0 },
    { name: 'quotaLimit', type: 'number', required: true, min: 1 },
    { name: 'status', type: 'select', required: true, options: ['pending', 'sending', 'sent', 'failed', 'uncertain', 'superseded'] },
    { name: 'attempts', type: 'number', required: true, min: 0, max: 3 },
    { name: 'claimToken', type: 'text' }, { name: 'claimedAt', type: 'date' },
    { name: 'nextAttemptAt', type: 'date' }, { name: 'lastError', type: 'text' },
    { name: 'providerMessageId', type: 'text' },
  ],
}
export const BudgetAlertMonitor: CollectionConfig = {
  ...protectedState, slug: 'budget-alert-monitor', timestamps: false,
  fields: [{ name: 'checkedAt', type: 'date', required: true }],
}
