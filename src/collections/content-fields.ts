import { APIError, type Block, type Field } from 'payload'
import { lexicalEditor, ParagraphFeature, BoldFeature, ItalicFeature, HeadingFeature, UnorderedListFeature, OrderedListFeature, LinkFeature, FixedToolbarFeature, InlineToolbarFeature } from '@payloadcms/richtext-lexical'
import { parseRichTextContent } from '../survey/content'

function blocks(placed: boolean): Block[] {
  const position: Field[] = placed ? [{ name: 'afterQuestion', label: 'Position im Abschnitt', type: 'text', admin: { components: { Field: '/components/ContentPlacementField#ContentPlacementField' }, description: 'Vor der ersten Frage oder unmittelbar nach der gewählten Frage.' } }] : []
  return [
    { slug: 'text', labels: { singular: 'Formatierter Text', plural: 'Formatierte Texte' }, admin: { components: { Label: '/components/SurveyEditorRowLabels#SurveyEditorContentLabel' } }, fields: [...position,
      { name: 'content', label: 'Text', type: 'richText', required: true,
        editor: lexicalEditor({ features: () => [ParagraphFeature(), BoldFeature(), ItalicFeature(), HeadingFeature({ enabledHeadingSizes: ['h2', 'h3'] }), UnorderedListFeature(), OrderedListFeature(), LinkFeature({ enabledCollections: [] }), FixedToolbarFeature(), InlineToolbarFeature()] }),
        hooks: { beforeChange: [({ value }) => { try { return parseRichTextContent(value) } catch (error) { throw new APIError(error instanceof Error ? error.message : 'Ungültiger Textblock.', 400) } }] } },
    ] },
    { slug: 'image', labels: { singular: 'Bild', plural: 'Bilder' }, admin: { components: { Label: '/components/SurveyEditorRowLabels#SurveyEditorContentLabel' } }, fields: [...position,
      { name: 'image', label: 'Bild hochladen oder auswählen', type: 'upload', relationTo: 'media', required: true },
      { name: 'alt', label: 'Alternativtext', type: 'text', required: true, maxLength: 500, admin: { description: 'Beschreibt den Inhalt für Personen, die das Bild nicht sehen können.' } },
      { name: 'caption', label: 'Bildunterschrift', type: 'textarea', maxLength: 1000 },
    ] },
  ]
}
export const introContentField: Field = { name: 'introContent', label: 'Inhaltsblöcke in der Einleitung', labels: { singular: 'Inhaltsblock', plural: 'Inhaltsblöcke' }, type: 'blocks', admin: { initCollapsed: true, className: 'survey-editor__content' }, maxRows: 30, blocks: blocks(false) }
export const sectionContentField: Field = { name: 'content', label: 'Text- und Bildblöcke', labels: { singular: 'Inhaltsblock', plural: 'Inhaltsblöcke' }, type: 'blocks', admin: { initCollapsed: true, className: 'survey-editor__content' }, maxRows: 30, blocks: blocks(true) }
