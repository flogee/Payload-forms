import type { CollectionConfig } from 'payload'
import { staff } from './Users'
export const Responses: CollectionConfig = {
  slug: 'responses', labels: { singular: 'Antwort', plural: 'Antworten' },
  admin: { useAsTitle: 'submissionKey', defaultColumns: ['survey', 'version', 'testOnly', 'createdAt'] },
  access: { read: ({ req }) => staff({ req }) ? req.user && '_strategy' in req.user && req.user._strategy === 'mcp-api-key' ? { testOnly: { equals: true } } : true : false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'submissionKey', type: 'text', unique: true, required: true },
    { name: 'survey', type: 'relationship', relationTo: 'surveys', required: true },
    { name: 'evaluationRun', type: 'relationship', relationTo: 'evaluation-runs', index: true },
    { name: 'version', type: 'text', required: true },
    { name: 'testOnly', type: 'checkbox', required: true },
    { name: 'durationSeconds', type: 'number', min: 0, max: 86400, admin: { description: 'Vom Browser gemeldete Bearbeitungsdauer, kein geprüfter Messwert.' } },
    { name: 'answers', label: 'Unveränderte validierte Antworten', type: 'json', required: true },
    { name: 'instrument', label: 'Fragebogenfassung zum Antwortzeitpunkt', type: 'json', required: true },
    { name: 'privacyReceipt', label: 'Informations- und Zustimmungsnachweis', type: 'json' },
    { name: 'retentionReviewDueAt', label: 'Personenbezogene Angaben spätestens prüfen bis', type: 'date', index: true, admin: { readOnly: true,
      description: 'Bei Einsendung gespeicherte Frist. Keine automatische Löschung oder Bestätigung einer Anonymisierung. Bei älteren Antworten ohne strukturierte Frist leer.' } },
    { name: 'submissionDigest', type: 'text', admin: { hidden: true } },
    { name: 'notificationReference', type: 'text', unique: true, admin: { hidden: true } },
    { name: 'privacyActions', label: 'Auskunft und Löschung', type: 'ui', admin: { components: { Field: '/components/ResponsePrivacyActions#ResponsePrivacyActions' } } },
  ]
}
