import type { ContentBlock } from './content'
import { digest } from './privacy-crypto'
import type { Definition, Question } from './types'

function known(value: object, keys: string[]) {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unbekanntes Strukturfeld: ${key}`)
  }
}
function content(blocks: ContentBlock[] = []) {
  return blocks.map(block => {
    known(block, block.blockType === 'text' ? ['blockType', 'content', 'afterQuestion'] : ['blockType', 'image', 'alt', 'caption', 'afterQuestion'])
    if (block.blockType !== 'text' && block.blockType !== 'image') throw new Error('Unbekannter Inhaltsblock')
    return { blockType: block.blockType, afterQuestion: block.afterQuestion }
  })
}
function question(q: Question) {
  known(q, ['id', 'block', 'label', 'kind', 'help', 'options', 'rows', 'allowNA', 'min', 'max', 'step', 'lowLabel', 'highLabel', 'showIf', 'optional'])
  if (q.showIf) known(q.showIf, ['field', 'values'])
  return { id: q.id, block: q.block, kind: q.kind, optional: q.optional ?? false, allowNA: q.allowNA ?? false,
    min: q.min, max: q.max, step: q.step, showIf: q.showIf,
    options: (q.options ?? []).map(option => {
      known(option, ['value', 'label', 'exclusive'])
      return { value: option.value, exclusive: option.exclusive ?? false }
    }),
    rows: (q.rows ?? []).map(row => { known(row, ['key', 'label']); return { key: row.key } }),
  }
}

/** Only the explicitly listed editorial fields may change within a frozen instrument. */
export function definitionStructureHash(definition: Definition): string {
  known(definition, ['version', 'introduction', 'sections', 'introContent', 'thankYouContent'])
  return digest({ version: definition.version, introContent: content(definition.introContent),
    sections: definition.sections.map(section => {
      known(section, ['id', 'title', 'description', 'questions', 'content'])
      return { id: section.id, questions: section.questions.map(question), content: content(section.content) }
    }),
  })
}
