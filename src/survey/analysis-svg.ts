import type { AnalysisReport, AnalysisSeries } from './analysis-types'

const xml = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const fmt = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 1 })
function wrap(text: string, width: number) {
  const lines: string[] = []
  for (const part of text.split(/\s+/)) {
    const words = part.length > width ? part.match(new RegExp(`.{1,${width}}`, 'gu'))! : [part]
    for (const word of words) {
      if (lines.length && lines.at(-1)!.length + word.length + 1 <= width) lines[lines.length - 1] += ` ${word}`
      else lines.push(word)
    }
  }
  return lines
}

/** Standalone passive SVG, all labels escaped; no scripts, external assets or raw answers. */
export function analysisSVG(report: AnalysisReport, series: AnalysisSeries): string {
  let y = 52
  const elements: string[] = []
  const text = (value: string, x: number, at: number, size = 16, fill = '#193b39') => `<text x="${x}" y="${at}" font-size="${size}" fill="${fill}">${xml(value)}</text>`
  elements.push(text('Payload Forms · Interne Team-Auswertung · Nur Testdaten', 36, y, 15, '#60716d')); y += 36
  for (const line of wrap(report.survey.title, 72)) { elements.push(text(line, 36, y, 24)); y += 30 }
  elements.push(text(`Fassung ${report.survey.version} · ${report.responses} Antworten`, 36, y, 16)); y += 35
  for (const line of wrap(series.label, 85)) { elements.push(text(line, 36, y, 20)); y += 25 }
  y += 8
  elements.push(text(`Beantwortet: ${series.answered} · Gefragt: ${series.eligible} · Fehlend: ${series.missing} · Übersprungen: ${series.notAsked}`, 36, y, 15)); y += 42
  if (series.display === 'completion') {
    elements.push(text('Inhalte werden nicht ausgegeben. Nur die Vollständigkeit wird gezählt.', 36, y, 16)); y += 38
  } else {
    const start = y, left = 442, width = 438
    for (const tick of [0, 25, 50, 75, 100]) {
      elements.push(text(`${tick} %`, left + width * tick / 100 - 12, start - 14, 13, '#60716d'))
    }
    for (const option of series.options) {
      const labels = wrap(option.label, 42), height = Math.max(48, labels.length * 20 + 16)
      const center = y + height / 2
      labels.forEach((line, i) => elements.push(text(line, 36, center - (labels.length - 1) * 10 + i * 20 + 5)))
      elements.push(`<rect x="${left}" y="${center - 10}" width="${width}" height="20" rx="3" fill="#edf2eb"/>`)
      elements.push(`<rect x="${left}" y="${center - 10}" width="${width * option.percent / 100}" height="20" rx="3" fill="#28665c"/>`)
      elements.push(text(`${option.count} · ${fmt(option.percent)} %`, left + width + 16, center + 5, 15))
      y += height
    }
    y += 16
    elements.push(text(`Prozente der ${series.answered} beantworteten Angaben${series.multipleChoice ? ' · Mehrfachauswahl, Summe kann über 100 % liegen' : ''}.`, 36, y, 14, '#60716d')); y += 26
  }
  if (series.display === 'count-status') { elements.push(text('Zahlenfragen: nur Angabestatus, keine individuellen Zahlen.', 36, y, 14, '#60716d')); y += 26 }
  elements.push(text('Antworten sind keine unabhängigen Organisationen. Keine Gesamtnote.', 36, y, 14, '#60716d')); y += 24
  elements.push(text('Interne Fallzahlen können klein sein. Vor Weitergabe prüfen; MCP-/Berichtsdaten nutzen.', 36, y, 14, '#60716d')); y += 24
  if (report.survey.phase === 'demo') { elements.push(text('Vollständig fiktives Beispiel; keine Ergebnisse einer realen Erhebung.', 36, y, 14, '#60716d')); y += 24 }
  elements.push(text(`Stand: ${report.generatedAt} · ${series.id}`, 36, y, 12, '#60716d')); y += 28
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="${y}" viewBox="0 0 1040 ${y}" role="img" aria-labelledby="title desc"><title id="title">${xml(series.label)}</title><desc id="desc">${xml(`${report.survey.title}, Fassung ${report.survey.version}. ${series.answered} beantwortete Angaben. Nur Testdaten.`)}</desc><rect width="1040" height="${y}" fill="#faf9f5"/><g font-family="Arial, sans-serif">${elements.join('')}</g></svg>`
}
