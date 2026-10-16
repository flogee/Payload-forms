import type { EmailBinding } from './notifications'

const permanentErrors = new Set(['E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED', 'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_CONTENT_TOO_LARGE', 'E_DELIVERY_FAILED',
  'E_HEADER_NOT_ALLOWED', 'E_HEADER_USE_API_FIELD', 'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG', 'E_HEADER_NAME_INVALID', 'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY'])
const retryErrors = new Set(['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED'])

// Only definite rejections are replayed. Timeouts/network errors may already
// have sent a message, so record uncertainty rather than creating mail storms.
type MailOutcome = { state: 'sent' | 'pending' | 'failed' | 'uncertain'; messageId?: string; error?: string; nextAttemptAt?: string }
export async function attemptMail(binding: EmailBinding, message: Parameters<EmailBinding['send']>[0], attempts: number, now: Date, timeoutMs: number): Promise<MailOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const accepted = await Promise.race([binding.send(message), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('UNCONFIRMED')), timeoutMs)
    })])
    if (!accepted || typeof accepted.messageId !== 'string' || !accepted.messageId || accepted.messageId.length > 254) throw new Error('UNCONFIRMED')
    return { state: 'sent' as const, messageId: accepted.messageId }
  } catch (error) {
    const candidate = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    const code = typeof candidate === 'string' ? candidate : 'UNCONFIRMED'
    if (retryErrors.has(code)) {
      const retry = attempts < 3, delay = code === 'E_DAILY_LIMIT_EXCEEDED' ? 3600000 : 300000
      return { state: retry ? 'pending' as const : 'failed' as const, error: code,
        ...(retry ? { nextAttemptAt: new Date(now.getTime() + delay * attempts).toISOString() } : {}) }
    }
    return { state: permanentErrors.has(code) ? 'failed' as const : 'uncertain' as const,
      error: permanentErrors.has(code) || code === 'E_INTERNAL_SERVER_ERROR' ? code : 'UNCONFIRMED' }
  } finally { if (timer) clearTimeout(timer) }
}
