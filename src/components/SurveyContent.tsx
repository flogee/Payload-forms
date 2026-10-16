'use client'

import { Fragment, useState, type ReactNode } from 'react'
import type { ContentBlock, RichTextNode } from '@/survey/content'
import { safeRichTextURL } from '@/survey/content'

function renderNode(node: RichTextNode, key: number): ReactNode {
  const children = node.children?.map(renderNode)
  switch (node.type) {
    case 'root': return <Fragment key={key}>{children}</Fragment>
    case 'paragraph': return <p key={key}>{children}</p>
    case 'heading':
      if (node.tag === 'h2') return <h2 key={key}>{children}</h2>
      if (node.tag === 'h3') return <h3 key={key}>{children}</h3>
      return <Fragment key={key}>{children}</Fragment>
    case 'list': return node.listType === 'number'
      ? <ol key={key} start={Number.isSafeInteger(node.start) && node.start > 0 ? node.start : undefined}>{children}</ol>
      : <ul key={key}>{children}</ul>
    case 'listitem': return <li key={key} value={Number.isSafeInteger(node.value) && node.value > 0 ? node.value : undefined}>{children}</li>
    case 'linebreak': return <br key={key} />
    case 'text': {
      const formats = typeof node.format === 'string' ? node.format.split(/\s+/) : []
      const bits = typeof node.format === 'number' ? node.format : 0
      let text: ReactNode = node.text || ''
      if ((bits & 1) || formats.includes('bold')) text = <strong>{text}</strong>
      if ((bits & 2) || formats.includes('italic')) text = <em>{text}</em>
      return <Fragment key={key}>{text}</Fragment>
    }
    case 'link':
    case 'autolink': {
      const href = safeRichTextURL(node.fields?.url) ? node.fields.url : undefined
      return href ? <a key={key} href={href} target={node.fields?.newTab ? '_blank' : undefined}
        rel={node.fields?.newTab ? 'noopener noreferrer' : undefined}>{children}</a>
        : <Fragment key={key}>{children}</Fragment>
    }
    default: return null
  }
}

function ContentImage({ block, homeURL }: { block: Extract<ContentBlock, { blockType: 'image' }>; homeURL: string }) {
  const [failed, setFailed] = useState(false)
  const validSource = /^\/f\/[a-z][a-z0-9-]{0,79}$/.test(homeURL) && Number.isSafeInteger(block.image) && block.image > 0
  return <figure className="survey-content survey-content--image">
    {failed || !validSource ? <p className="survey-content__image-fallback" role="status">Bild konnte nicht geladen werden: {block.alt}</p>
      : <img src={`${homeURL}/images/${block.image}`} alt={block.alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    {block.caption && <figcaption>{block.caption}</figcaption>}
  </figure>
}

export function SurveyContent({ blocks, homeURL }: { blocks?: ContentBlock[]; homeURL: string }) {
  return <>{blocks?.map((block, index) => block.blockType === 'text'
    ? <div className="survey-content survey-content--text" key={index}>{renderNode(block.content.root, 0)}</div>
    : block.blockType === 'image' ? <ContentImage key={`${index}-${homeURL}-${block.image}`} block={block} homeURL={homeURL} /> : null)}</>
}
