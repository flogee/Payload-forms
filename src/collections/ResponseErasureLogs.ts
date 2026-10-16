import type { CollectionConfig } from 'payload'
import { staff } from './Users'

export const ResponseErasureLogs: CollectionConfig = {
  slug: 'response-erasure-logs', dbName: 'response_erasure_logs',
  labels: { singular: 'Löschprotokoll', plural: 'Löschprotokolle' },
  admin: { defaultColumns: ['survey', 'reason', 'erasedAt', 'retentionUntil'],
    description: 'Minimale Nachweise ohne Antwortinhalte oder Teilnehmenden-Kontaktdaten. Für Wiederherstellungen getrennt sichern. Es gibt noch keine automatische Bereinigung; Fristen und externe Sicherungen vor Entfernung prüfen.' },
  access: { read: staff, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'responseKey', label: 'Geschützter Löschabgleich', type: 'text', unique: true, required: true, admin: { readOnly: true } },
    { name: 'survey', label: 'Fragebogen', type: 'relationship', relationTo: 'surveys', required: true },
    { name: 'version', label: 'Erhebungsfassung', type: 'text', required: true },
    { name: 'reason', label: 'Grund', type: 'select', required: true, options: [
      { value: 'request', label: 'Betroffenenanfrage' }, { value: 'retention', label: 'Aufbewahrungsfrist' }, { value: 'test-cleanup', label: 'Testdatenbereinigung' },
    ] },
    { name: 'erasedBy', label: 'Ausgeführt durch', type: 'relationship', relationTo: 'users', required: true },
    { name: 'erasedAt', label: 'Gelöscht am', type: 'date', required: true },
    { name: 'retentionUntil', label: 'Aufbewahrung des Protokolls prüfen ab', type: 'date', required: true },
  ],
}
