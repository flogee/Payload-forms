import { createHash, createHmac } from 'node:crypto'
import type { PrivacyNotice } from './privacy'

export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJSON(item)).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function privacyHash(notice: PrivacyNotice): string {
  return digest(notice)
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value)).digest('hex')
}

// The journal supports restore filtering and retry suppression without retaining
// a participant name, email, answer or plaintext submission identifier.
export function erasureKey(submissionKey: string, secret: string): string {
  if (!secret || secret.length < 32) throw new Error('Dauerhaftes Anwendungsgeheimnis erforderlich.')
  return createHmac('sha256', secret).update(`response-erasure-v1:${submissionKey}`).digest('hex')
}
