import type { Question } from '../survey/types'

export const answerFormats = {
  single: { label: 'Einfachauswahl', description: 'Eine Antwort auswählen. Die Antwortoptionen unten festlegen.' },
  multiple: { label: 'Mehrfachauswahl', description: 'Mehrere Antworten auswählen. Antwortoptionen festlegen; bei Bedarf eine Option als ausschließend markieren.' },
  text: { label: 'Kurzer Text', description: 'Ein einzeiliges Textfeld, zum Beispiel für eine kurze Bezeichnung.' },
  textarea: { label: 'Längerer Text', description: 'Ein mehrzeiliges Textfeld für Erläuterungen oder offene Rückmeldungen.' },
  count: { label: 'Zahl mit „weiß nicht“', description: 'Eine Zahl mit dem Status „weiß nicht“. Zahlenbereich und bei Bedarf „nicht zutreffend“ festlegen.' },
  counts: { label: 'Mehrere Zahlen mit Status', description: 'Je Zeile eine Zahl mit eigenem Status. Zeilen, Zahlenbereich und bei Bedarf „nicht zutreffend“ festlegen.' },
  matrix: { label: 'Skala / Bewertungszeilen', description: 'Eine Matrix mit anklickbaren Auswahlpunkten: je Zeile eine Antwort auf derselben Skala. Zeilen sind die Aussagen; Antwortoptionen bilden die gemeinsame Skala in den Spalten, zum Beispiel Zustimmung von „gar nicht“ bis „vollständig“. Auf schmalen Bildschirmen stehen die beschrifteten Optionen unter jeder Aussage.' },
  committees: { label: 'Gremienliste', description: 'Eine wiederholbare Liste mit Gremium und Entscheidungsvolumen. Teilnehmende können weitere Einträge ergänzen.' },
  slider: { label: 'Slider / Zahlen-Skala', description: 'Einen Wert mit Regler oder Zahleneingabe wählen. Standard: 0–10 in Einerschritten; Bereich bis 100, Schrittweite und Endbeschriftungen sind einstellbar. Ohne Auswahl bleibt die Frage unbeantwortet.' },
  stars: { label: 'Sterne-Bewertung', description: 'Eine Bewertung von 1 bis 5 Sternen. Bei Bedarf die Bedeutung der beiden Enden beschriften.' },
  smiley: { label: 'Smiley-Bewertung', description: 'Fünf Stufen von sehr unzufrieden bis sehr zufrieden, mit Symbolen und Text. Die beiden Endbeschriftungen lassen sich anpassen.' },
  ranking: { label: 'Rangfolge / Prioritäten', description: 'Zwei bis zehn Optionen vollständig ordnen. Platz 1 hat die höchste Priorität. Alle Optionen einmal verwenden; keine ausschließenden Optionen.' },
} satisfies Record<Question['kind'], { label: string; description: string }>

export function answerFormat(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(answerFormats, value)
    ? answerFormats[value as Question['kind']] : undefined
}

export type EditorRow = Record<string, unknown>
export type EditorRowLabel = { title: string; detail?: string }
const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
const fallback = (label: string, rowNumber?: number) => `${label}${rowNumber == null ? '' : ` ${rowNumber + 1}`}`

export function sectionRowLabel(data: EditorRow, rowNumber?: number): EditorRowLabel {
  const count = Array.isArray(data.questions) ? data.questions.length : 0
  return {
    title: text(data.title) || fallback('Neuer Abschnitt', rowNumber),
    detail: [text(data.key), `${count} ${count === 1 ? 'Frage' : 'Fragen'}`].filter(Boolean).join(' · '),
  }
}

export function questionRowLabel(data: EditorRow, rowNumber?: number): EditorRowLabel {
  return {
    title: [text(data.code), text(data.label)].filter(Boolean).join(' · ') || fallback('Neue Frage', rowNumber),
    detail: answerFormat(data.kind)?.label || 'Antwortformat wählen',
  }
}

export function itemRowLabel(data: EditorRow, field: 'text' | 'label', empty: string, rowNumber?: number): EditorRowLabel {
  return {
    title: text(data[field]) || fallback(empty, rowNumber),
    detail: field === 'label' ? text(data.value) || text(data.key) : undefined,
  }
}

// A small preview only: the native rich-text field remains the source of truth.
function richTextPreview(value: unknown, depth = 0): string {
  if (!value || typeof value !== 'object' || depth > 10) return ''
  const node = value as EditorRow
  if (typeof node.text === 'string') return node.text
  if (node.root) return richTextPreview(node.root, depth + 1)
  const separator = ['root', 'list', 'listitem'].includes(String(node.type)) ? ' ' : ''
  return Array.isArray(node.children) ? node.children.slice(0, 10).map(child => richTextPreview(child, depth + 1)).join(separator) : ''
}

export function contentRowLabel(data: EditorRow, rowNumber?: number): EditorRowLabel {
  const image = data.blockType === 'image'
  const preview = image ? text(data.caption) || text(data.alt) : text(richTextPreview(data.content))
  return {
    title: preview.length > 160 ? `${preview.slice(0, 160)}…` : preview || fallback(image ? 'Neues Bild' : 'Neuer Textblock', rowNumber),
    detail: image ? 'Bild' : 'Formatierter Text',
  }
}
