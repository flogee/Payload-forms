export function imageExtension(bytes: Uint8Array, mimeType: string): 'png' | 'jpg' | 'webp' | undefined {
  const prefix = Array.from(bytes.slice(0, 12))
  if (mimeType === 'image/png' && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => prefix[index] === byte)) return 'png'
  if (mimeType === 'image/jpeg' && prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) return 'jpg'
  if (mimeType === 'image/webp' && String.fromCharCode(...prefix.slice(0, 4)) === 'RIFF' && String.fromCharCode(...prefix.slice(8, 12)) === 'WEBP') return 'webp'
}
