import Markdoc from '@markdoc/markdoc'
import type { MdNode, RoundtripOptions, TiptapDoc, TiptapMark, TiptapNode } from './types'

const DEFAULT_KNOWN_BLOCK_TAGS = new Set(['callout'])

const hasError = (node: MdNode): boolean =>
  node.type === 'error' || (Array.isArray(node.errors) && node.errors.length > 0)

function inlineToTiptap(node: MdNode, marks: TiptapMark[] = []): TiptapNode[] {
  const kids = node.children ?? []
  switch (node.type) {
    case 'inline':
      return kids.flatMap((c) => inlineToTiptap(c, marks))
    case 'text':
      return [{ type: 'text', text: String(node.attributes.content), ...(marks.length ? { marks } : {}) }]
    case 'strong':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'bold' }]))
    case 'em':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'italic' }]))
    case 's':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'strike' }]))
    case 'code':
      return [{ type: 'text', text: String(node.attributes.content), marks: [...marks, { type: 'code' }] }]
    case 'link':
      return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'link', attrs: { href: node.attributes.href } }]))
    case 'hardbreak':
      return [{ type: 'hardBreak' }]
    case 'softbreak':
      return [{ type: 'text', text: ' ' }]
    default:
      return []
  }
}

const collectInline = (node: MdNode): TiptapNode[] =>
  (node.children ?? []).flatMap((c) => inlineToTiptap(c))

function blockToTiptap(node: MdNode): TiptapNode | null {
  switch (node.type) {
    case 'heading':
      return { type: 'heading', attrs: { level: node.attributes.level }, content: collectInline(node) }
    case 'paragraph':
      return { type: 'paragraph', content: collectInline(node) }
    case 'list':
      return {
        type: node.attributes.ordered ? 'orderedList' : 'bulletList',
        content: (node.children ?? []).map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: collectInline(item) }],
        })),
      }
    case 'blockquote':
      return {
        type: 'blockquote',
        content: (node.children ?? []).map(blockToTiptap).filter((n): n is TiptapNode => n !== null),
      }
    case 'fence':
      return {
        type: 'codeBlock',
        attrs: { language: node.attributes.language || null },
        content: [{ type: 'text', text: String(node.attributes.content).replace(/\n$/, '') }],
      }
    case 'hr':
      return { type: 'horizontalRule' }
    case 'tag':
      return {
        type: 'callout',
        attrs: { mdAttrs: node.attributes },
        content: (node.children ?? []).map(blockToTiptap).filter((n): n is TiptapNode => n !== null),
      }
    default:
      return null
  }
}

export function markdocToTiptap(source: string, opts: RoundtripOptions = {}): TiptapDoc {
  const known = opts.knownBlockTags ?? DEFAULT_KNOWN_BLOCK_TAGS
  const isPreserve = (node: MdNode): boolean =>
    hasError(node) || (node.type === 'tag' && !known.has(node.tag ?? ''))

  const lines = source.split('\n')
  // `location` is supported at runtime (spike-proven) but not in Markdoc's published parse types.
  const ast = (Markdoc.parse as (s: string, a?: unknown) => MdNode)(source, { location: true })
  const kids = ast.children ?? []
  const out: TiptapNode[] = []

  const startOf = (i: number): number => kids[i]?.location?.start?.line ?? lines.length
  const slice = (from: number, to: number): string => lines.slice(from, to).join('\n').replace(/\n+$/, '')

  for (let i = 0; i < kids.length; ) {
    const node = kids[i]!
    if (isPreserve(node)) {
      const startLine = startOf(i)
      let j = i
      if (hasError(node)) {
        while (j + 1 < kids.length) {
          j++
          if (hasError(kids[j]!)) break
        }
      }
      const endLine = startOf(j + 1)
      out.push({ type: 'passthrough', attrs: { raw: slice(startLine, endLine), flagged: hasError(node) } })
      i = j + 1
      continue
    }
    const tt = blockToTiptap(node)
    if (tt) out.push(tt)
    i++
  }
  return { type: 'doc', content: out }
}
