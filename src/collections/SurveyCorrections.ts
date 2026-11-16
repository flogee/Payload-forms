import type { CollectionConfig } from 'payload'
import { isTeamUser } from '../auth/team'

export const SurveyCorrections: CollectionConfig = {
  slug: 'survey-corrections', dbName: 'survey_corrections',
  labels: { singular: 'Fragebogenkorrektur', plural: 'Fragebogenkorrekturen' },
  admin: { defaultColumns: ['survey', 'reason', 'correctedBy', 'status', 'createdAt'],
    description: 'Unveränderliches Protokoll kleiner Korrekturen. Bisherige Antworten behalten ihre ursprüngliche Fragebogenfassung.' },
  access: { read: ({ req }) => isTeamUser(req.user) && req.user._strategy !== 'mcp-api-key', create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'survey', label: 'Fragebogen', type: 'relationship', relationTo: 'surveys', required: true, index: true },
    { name: 'correctedBy', label: 'Korrigiert durch', type: 'relationship', relationTo: 'users', required: true },
    { name: 'reason', label: 'Grund', type: 'textarea', required: true, maxLength: 500 },
    { name: 'status', label: 'Stand', type: 'select', required: true, options: [{ value: 'pending', label: 'Nicht abgeschlossen – Teilnahme gesperrt' }, { value: 'committed', label: 'Gespeichert' }] },
    { name: 'before', label: 'Ursprünglicher Stand', type: 'json', required: true },
    { name: 'after', label: 'Korrigierter Stand', type: 'json', required: true },
    { name: 'beforeHash', type: 'text', required: true, admin: { hidden: true } },
    { name: 'afterHash', type: 'text', required: true, admin: { hidden: true } },
    { name: 'editToken', type: 'text', required: true, unique: true, access: { read: () => false }, admin: { hidden: true } },
  ],
}
