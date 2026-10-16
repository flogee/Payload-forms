import type { CollectionConfig } from 'payload'
import { staff } from './Users'

export const ResponseContacts: CollectionConfig = {
  slug: 'response-contacts', dbName: 'response_contacts',
  labels: { singular: 'Kontakt zur Rückmeldung', plural: 'Kontakte zur Rückmeldung' },
  admin: { useAsTitle: 'name', defaultColumns: ['response', 'name', 'createdAt'],
    description: 'Getrennt gespeicherte Kontaktangaben. Keine Verwendung in normalen Antwortexporten oder MCP. Bitte im Pretest ausschließlich erfundene Angaben verwenden.' },
  access: { read: staff, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'response', label: 'Zugehörige Antwort', type: 'relationship', relationTo: 'responses', unique: true, required: true },
    { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 },
    { name: 'email', label: 'E-Mail zur Rückmeldung', type: 'email', required: true },
    { name: 'testOnly', label: 'Testdaten', type: 'checkbox', required: true },
    { name: 'privacyReceipt', label: 'Informations- und Zustimmungsnachweis', type: 'json', required: true },
  ],
}
