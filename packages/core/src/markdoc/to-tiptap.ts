import Markdoc from '@markdoc/markdoc'
import type { MdNode, RoundtripOptions, TiptapDoc, TiptapMark, TiptapNode } from './types'
import { defaultKnownBlockTags } from '../config/default-config'

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
    case 'tag': {
      if (node.tag === 'sub') return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'subscript' }]))
      if (node.tag === 'sup') return kids.flatMap((c) => inlineToTiptap(c, [...marks, { type: 'superscript' }]))
      return []
    }
    default:
      return []
  }
}

const collectInline = (node: MdNode): TiptapNode[] =>
  (node.children ?? []).flatMap((c) => inlineToTiptap(c))

/** GFM task marker at the very start of an item's text: "[ ] ", "[x] ", "[X] ",
 *  or a bare "[ ]"/"[x]" at end of line (an empty task row). */
const TASK_RE = /^\[( |x|X)\](?: |$)/

/** The inline AST node holding a list item's text — directly (tight list) or inside
 *  the item's first paragraph (loose list). undefined if the item has no text. */
function itemInlineNode(item: MdNode): MdNode | undefined {
  const children = item.children ?? []
  const direct = children.find((c) => c.type === 'inline')
  if (direct) return direct
  const para = children.find((c) => c.type === 'paragraph')
  return para?.children?.find((c) => c.type === 'inline')
}

/** If `item`'s first inline child is a text node beginning with a task marker, the
 *  parsed marker; else null. Only a leading plain-text marker counts (so a list item
 *  starting with bold/link is never a task item). */
function taskMarker(item: MdNode): { checked: boolean } | null {
  const inline = itemInlineNode(item)
  const first = inline?.children?.[0]
  if (first?.type !== 'text' || typeof first.attributes.content !== 'string') return null
  const m = TASK_RE.exec(first.attributes.content)
  return m ? { checked: m[1] !== ' ' } : null
}

/** A list is a checklist iff it is unordered and EVERY item starts with a marker. */
function isTaskList(node: MdNode): boolean {
  if (node.attributes.ordered) return false
  const items = node.children ?? []
  return items.length > 0 && items.every((it) => taskMarker(it) !== null)
}

/** Remove the leading task marker from already-converted inline content. Drops the
 *  first text node entirely if it becomes empty. */
function stripMarker(inline: TiptapNode[]): TiptapNode[] {
  const [first, ...rest] = inline
  if (first && first.type === 'text' && typeof first.text === 'string') {
    const stripped = first.text.replace(TASK_RE, '')
    return stripped === '' ? rest : [{ ...first, text: stripped }, ...rest]
  }
  return inline
}

/** Markdoc list → Tiptap list, recursively. Checklist detection is per level. Each
 *  item becomes [paragraph, ...nested lists]. */
function listToTiptap(node: MdNode): TiptapNode {
  const task = isTaskList(node)
  const listType = task ? 'taskList' : node.attributes.ordered ? 'orderedList' : 'bulletList'
  return {
    type: listType,
    content: (node.children ?? []).map((item) => {
      const inlineNode = itemInlineNode(item)
      const inline = inlineNode ? inlineToTiptap(inlineNode) : []
      const nested = (item.children ?? []).filter((c) => c.type === 'list').map(listToTiptap)
      const paragraph: TiptapNode = { type: 'paragraph', content: task ? stripMarker(inline) : inline }
      const content = [paragraph, ...nested]
      if (task) return { type: 'taskItem', attrs: { checked: taskMarker(item)!.checked }, content }
      return { type: 'listItem', content }
    }),
  }
}

/** Tiptap textAlign attrs for a block, from a Markdoc node's `align` attribute.
 *  `left`/absent → none (default stays clean). */
function alignAttr(node: MdNode): { textAlign: string } | Record<string, never> {
  const a = node.attributes.align
  return a && a !== 'left' ? { textAlign: String(a) } : {}
}

function blockToTiptap(node: MdNode): TiptapNode | null {
  switch (node.type) {
    case 'heading':
      return { type: 'heading', attrs: { level: node.attributes.level, ...alignAttr(node) }, content: collectInline(node) }
    case 'paragraph':
      return { type: 'paragraph', ...(node.attributes.align && node.attributes.align !== 'left' ? { attrs: alignAttr(node) } : {}), content: collectInline(node) }
    case 'list':
      return listToTiptap(node)
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
    case 'table': {
      const cellAlign = (cell: MdNode): string | null => (cell.attributes.align as string) ?? null
      const cellToTiptap = (cell: MdNode, header: boolean): TiptapNode => ({
        type: header ? 'tableHeader' : 'tableCell',
        attrs: { align: cellAlign(cell) },
        content: [{ type: 'paragraph', content: collectInline(cell) }],
      })
      const rowToTiptap = (tr: MdNode, header: boolean): TiptapNode => ({
        type: 'tableRow',
        content: (tr.children ?? []).map((c) => cellToTiptap(c, header)),
      })
      const rows: TiptapNode[] = []
      for (const section of node.children ?? []) {
        const header = section.type === 'thead'
        for (const tr of section.children ?? []) rows.push(rowToTiptap(tr, header))
      }
      return { type: 'table', content: rows }
    }
    default:
      return null
  }
}

export function markdocToTiptap(source: string, opts: RoundtripOptions = {}): TiptapDoc {
  const known = opts.knownBlockTags ?? defaultKnownBlockTags
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
