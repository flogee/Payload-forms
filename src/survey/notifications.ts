import { z } from 'zod'
import { configuredSurveyOrigins } from './origins'

export const notificationStates = ['pending', 'sending', 'sent', 'failed', 'cancelled', 'uncertain'] as const
export type NotificationState = typeof notificationStates[number]
export const MAX_RECIPIENTS = 10

export function recipientAddresses(value: unknown): string[] {
  if (value == null || value === '') return []
  if (typeof value !== 'string' || value.length > 3000) throw new Error('Bitte höchstens zehn E-Mail-Adressen eintragen.')
  const addresses = [...new Set(value.split(/[\n,;]+/).map(address => address.trim().toLowerCase()).filter(Boolean))]
  if (addresses.length > MAX_RECIPIENTS || addresses.some(address => !z.string().max(254).email().safeParse(address).success || /[\r\n]/.test(address))) {
    throw new Error('Bitte gültige E-Mail-Adressen eintragen, höchstens zehn und eine je Zeile.')
  }
  return addresses
}

export function readNotificationSettings(value: unknown) {
  if (value == null) return { enabled: false, recipients: [] as string[] }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Benachrichtigungseinstellungen prüfen.')
  const settings = value as { enabled?: unknown; recipients?: unknown }
  if (settings.enabled != null && typeof settings.enabled !== 'boolean') throw new Error('Benachrichtigungseinstellungen prüfen.')
  const recipients = recipientAddresses(settings.recipients)
  const enabled = settings.enabled === true
  if (enabled && !recipients.length) throw new Error('Zum Einschalten mindestens eine Empfängeradresse eintragen.')
  return { enabled, recipients }
}

export type EmailBinding = { send(message: { to: string; from: string; subject: string; text: string }): Promise<{ messageId: string }> }
export type MailEnvironment = {
  EMAIL?: EmailBinding; MAIL_ENABLED?: string; MAIL_FROM?: string; MAIL_ORIGIN?: string
  OPS_ALERT_RECIPIENT?: string; MAIL_ALLOWED_RECIPIENTS?: string; MAIL_MONTHLY_LIMIT?: string; MAIL_LOCAL_TEST?: string
  SURVEY_ORIGINS?: string; SURVEY_ORIGIN?: string
}

export function mailPolicy(env: MailEnvironment) {
  let allowedRecipients: string[] = []
  try { allowedRecipients = recipientAddresses(env.MAIL_ALLOWED_RECIPIENTS) } catch { /* Fail closed on invalid deployment settings. */ }
  const sender = z.string().max(254).email().safeParse(env.MAIL_FROM).success && !/[\r\n]/.test(env.MAIL_FROM || '') ? env.MAIL_FROM! : null
  let origin: string | undefined
  try {
    const url = new URL(env.MAIL_ORIGIN || '')
    const production = url.protocol === 'https:' && !url.port
    const local = env.MAIL_LOCAL_TEST === '1' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    if ((production || local) && env.MAIL_ORIGIN === url.origin && configuredSurveyOrigins(env)?.has(url.origin)) origin = url.origin
  } catch { /* Only configured application origins may appear in emails. */ }
  const limit = Number(env.MAIL_MONTHLY_LIMIT || '500')
  const validLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 1000
  return { configured: env.MAIL_ENABLED === '1' && !!sender && !!origin && !!allowedRecipients.length && validLimit && typeof env.EMAIL?.send === 'function',
    sender, origin, allowedRecipients, limit: validLimit ? limit : 500, routineLimit: (validLimit ? limit : 500) - Math.min(40, Math.ceil((validLimit ? limit : 500) * 0.08)),
    alertRecipient: allowedRecipients.includes(env.OPS_ALERT_RECIPIENT || '') ? env.OPS_ALERT_RECIPIENT : undefined }
}

export function notificationMessage(sender: string, recipient: string, origin: string, reference: string) {
  if (!z.string().uuid().safeParse(reference).success) throw new Error('Ungültige Antwortreferenz.')
  return { from: sender, to: recipient, subject: 'Payload Forms: neue Einsendung',
    text: `Eine neue Einsendung ist eingegangen.\n\nDie Antwort kannst du nach Anmeldung im geschützten Teamzugang öffnen:\n${origin}/antwort/${reference}\n\nDiese Nachricht enthält keine Antwortinhalte oder Kontaktangaben. Die Empfängeradresse allein gewährt keinen Zugriff.\n\nPayload Forms` }
}
