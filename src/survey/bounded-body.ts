import { PUBLIC_LIMITS } from './public-limits'

export class BodyTooLarge extends Error {}

export async function boundedBody(request: Request, limit: number = PUBLIC_LIMITS.bodyBytes): Promise<string> {
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new BodyTooLarge()
  if (!request.body) return ''
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new BodyTooLarge() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
