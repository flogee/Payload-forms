import type { CollectionConfig } from 'payload'
import { staff } from './Users'
import { notificationStates } from '../survey/notifications'

const labels = { pending: 'Ausstehend', sending: 'In Bearbeitung', sent: 'Vom Versanddienst angenommen', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', uncertain: 'Versandstatus unklar' }
export const ResponseNotifications: CollectionConfig = {
  slug: 'response-notifications', labels: { singular: 'Benachrichtigung', plural: 'Versandprotokoll' },
  admin: { useAsTitle: 'recipient', defaultColumns: ['survey', 'recipient', 'status', 'createdAt'], description: 'Nur Eingangshinweise. Annahme zum Versand bestätigt keine Zustellung. Unklare Sendungen werden nicht automatisch erneut verschickt.' },
  access: { read: staff, create: () => false, update: () => false, delete: () => false },
  indexes: [{ fields: ['responseReference', 'recipient'], unique: true }],
  fields: [
    { name: 'response', type: 'relationship', relationTo: 'responses', required: true },
    { name: 'survey', type: 'relationship', relationTo: 'surveys', required: true },
    { name: 'responseReference', type: 'text', required: true, admin: { hidden: true } },
    { name: 'recipient', label: 'Empfänger', type: 'email', required: true },
    { name: 'status', label: 'Stand', type: 'select', required: true, options: notificationStates.map(value => ({ value, label: labels[value] })) },
    { name: 'attempts', label: 'Versandversuche', type: 'number', required: true, min: 0 },
    { name: 'lastError', label: 'Fehlerkennung', type: 'text', admin: { description: 'Nur eine Fehlerkennung; keine Antworten, Kontaktangaben oder ausführlichen Anbieterprotokolle.' } },
    { name: 'nextAttemptAt', label: 'Frühester nächster Versuch', type: 'date' },
    { name: 'claimedAt', type: 'date', admin: { hidden: true } },
    { name: 'claimToken', type: 'text', admin: { hidden: true } },
    { name: 'sentAt', label: 'Vom Versanddienst angenommen am', type: 'date' },
    { name: 'providerMessageId', type: 'text', admin: { hidden: true } },
  ],
}
