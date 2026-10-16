import QRCode from 'qrcode'

export async function participationQR(url: string, format: 'svg' | 'png') {
  // A four-module quiet zone and a white background keep the code usable in print.
  const options = { errorCorrectionLevel: 'M' as const, margin: 4, width: 1024, color: { dark: '#000000ff', light: '#ffffffff' } }
  return format === 'svg' ? QRCode.toString(url, { ...options, type: 'svg' }) : QRCode.toBuffer(url, { ...options, type: 'png' })
}
