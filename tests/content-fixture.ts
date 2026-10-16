import type { RichTextContent } from '../src/survey/content'

export function testText(text = 'Inhaltsblock mit Testtext'): RichTextContent {
  return { root: { type: 'root', version: 1, format: '', indent: 0, direction: null,
    children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', version: 1, text, format: 3 }] }] } }
}
