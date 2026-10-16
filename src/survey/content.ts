import { z } from 'zod'

export type RichTextNode = {
  [key: string]: unknown;
  type: string; children?: RichTextNode[]; text?: string; format?: number | string;
  tag?: string; listType?: string; start?: number; value?: number;
  fields?: { url: string; newTab?: boolean; linkType?: string };
  version: number; direction?: null; indent?: number; detail?: number; mode?: string; style?: string;
}
export type RichTextContent = { root: RichTextNode & { type: 'root'; children: RichTextNode[]; format: ''; indent: 0; direction: null; version: 1 } }
export type ContentBlock = { blockType: 'text'; content: RichTextContent; afterQuestion?: string }
  | { blockType: 'image'; image: number; alt: string; caption?: string; afterQuestion?: string }

export function safeRichTextURL(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000 || /[\s\u0000-\u001f\u007f]/u.test(value)) return false
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

// Normalize to the supported Lexical features, retaining an editor-readable document.
// Arbitrary HTML, uploads, styles and internal document references are never accepted.
export function parseRichTextContent(input: unknown): RichTextContent {
  let nodes = 0, characters = 0
  function read(value: any, depth: number, parent?: string): RichTextNode {
    if (++nodes > 400 || depth > 12 || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Textblock ist zu groß oder ungültig.')
    const type = value.type
    const allowed = parent == null ? ['root'] : parent === 'root' ? ['paragraph', 'heading', 'list']
      : parent === 'list' ? ['listitem'] : parent === 'listitem' ? ['text', 'linebreak', 'link', 'autolink', 'list', 'paragraph']
        : ['text', 'linebreak', ...(parent === 'link' || parent === 'autolink' ? [] : ['link', 'autolink'])]
    if (!allowed.includes(type)) throw new Error('Dieser Inhaltstyp wird im Textblock nicht unterstützt.')
    if (type === 'text') {
      if (typeof value.text !== 'string' || (characters += value.text.length) > 20000) throw new Error('Textblock enthält zu viel Text.')
      if (value.format != null && (!Number.isInteger(value.format) || value.format < 0 || value.format > 255)) throw new Error('Ungültige Textformatierung.')
      return { type, version: 1, text: value.text, format: (value.format ?? 0) & 3, detail: 0, mode: 'normal', style: '' }
    }
    if (type === 'linebreak') return { type, version: 1 }
    if (!Array.isArray(value.children)) throw new Error('Textblock enthält keine gültigen Absätze.')
    const node: RichTextNode = { type, version: 1, direction: null, format: '', indent: 0,
      children: value.children.map((child: unknown) => read(child, depth + 1, type)) }
    if (type === 'heading') {
      if (!['h2', 'h3'].includes(value.tag)) throw new Error('Bitte Überschrift 2 oder 3 verwenden.')
      node.tag = value.tag
    }
    if (type === 'list') {
      if (!['bullet', 'number'].includes(value.listType)) throw new Error('Ungültige Liste.')
      node.listType = value.listType; node.tag = value.listType === 'number' ? 'ol' : 'ul'
      node.start = Number.isInteger(value.start) && value.start >= 1 && value.start <= 1000 ? value.start : 1
    }
    if (type === 'listitem') node.value = Number.isInteger(value.value) && value.value >= 1 && value.value <= 1000 ? value.value : 1
    if (type === 'link' || type === 'autolink') {
      if (value.fields?.linkType === 'internal' || !safeRichTextURL(value.fields?.url)) throw new Error('Links müssen eine gültige http-, https- oder mailto-Adresse enthalten.')
      node.version = 3; node.fields = { linkType: 'custom', url: value.fields.url, newTab: value.fields.newTab === true }
    }
    return node
  }
  const root = read((input as any)?.root, 0)
  if (!characters || !JSON.stringify(root).includes('"text":')) throw new Error('Bitte Text in den Inhaltsblock eingeben.')
  return { root: root as RichTextContent['root'] }
}

export const richTextContentSchema = z.unknown().transform((input, ctx) => {
  try { return parseRichTextContent(input) } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Ungültiger Textblock.' }); return z.NEVER
  }
})
const placement = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/).optional()
export const contentBlockSchema = z.discriminatedUnion('blockType', [
  z.object({ blockType: z.literal('text'), content: richTextContentSchema, afterQuestion: placement }),
  z.object({ blockType: z.literal('image'), image: z.number().int().positive(), alt: z.string().trim().min(1).max(500), caption: z.string().max(1000).optional(), afterQuestion: placement }),
])
export const contentBlocksSchema = z.array(contentBlockSchema).max(30)
export function imageIDs(definition: { introContent?: ContentBlock[]; sections: { content?: ContentBlock[] }[] }) {
  return [...new Set([...(definition.introContent ?? []), ...definition.sections.flatMap(section => section.content ?? [])]
    .filter((block): block is Extract<ContentBlock, { blockType: 'image' }> => block.blockType === 'image').map(block => block.image))]
}
