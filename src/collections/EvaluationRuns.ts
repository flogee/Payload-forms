import type { CollectionConfig } from 'payload'

// Only the narrow run service may create or close runs. General REST/MCP writes
// must not change a released instrument, its context or an existing assignment.
export const EvaluationRuns: CollectionConfig = {
  slug: 'evaluation-runs', admin: { hidden: true },
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true },
    { name: 'contextRef', type: 'text', required: true },
    { name: 'integrationClient', type: 'text', admin: { readOnly: true } },
    { name: 'survey', type: 'relationship', relationTo: 'surveys', required: true },
    { name: 'version', type: 'text', required: true },
    { name: 'instrument', type: 'json', required: true },
    { name: 'status', type: 'select', required: true, options: ['open', 'closed'] },
    { name: 'expiresAt', type: 'date', required: true },
  ],
}
