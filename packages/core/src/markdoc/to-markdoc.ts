import Markdoc from '@markdoc/markdoc'
import type { TiptapDoc, TiptapNode } from './types'

const N = Markdoc.Ast.Node

function buildInline(content: TiptapNode[] = []): InstanceType<typeof N>[] {
  return content.map((t) => {
    if (t.type === 'hardBreak') return new N('hardbreak')
    let n: InstanceType<typeof N> = new N('text', { content: t.text })
    for (const m of t.marks ?? []) {
      if (m.type === 'code') n = new N('code', { content: t.text })
      else if (m.type === 'bold') n = new N('strong', { marker: '**' }, [n])
      else if (m.type === 'italic') n = new N('em', { marker: '*' }, [n])
      else if (m.type === 'strike') n = new N('s', {}, [n])
      else if (m.type === 'link') n = new N('link', { href: (m.attrs as Record<string, unknown>)?.href }, [n])
    }
    return n
  })
}

function buildBlock(node: TiptapNode): InstanceType<typeof N> {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  switch (node.type) {
    case 'heading':
      return new N('heading', { level: attrs['level'] }, [new N('inline', {}, buildInline(node.content))])
    case 'paragraph':
      return new N('paragraph', {}, [new N('inline', {}, buildInline(node.content))])
    case 'bulletList':
    case 'orderedList':
      return new N(
        'list',
        { ordered: node.type === 'orderedList', marker: node.type === 'orderedList' ? '.' : '-' },
        (node.content ?? []).map(
          (item) => new N('item', {}, [new N('inline', {}, buildInline(item.content?.[0]?.content ?? []))]),
        ),
      )
    case 'blockquote':
      return new N('blockquote', {}, (node.content ?? []).map(buildBlock))
    case 'codeBlock':
      return new N('fence', { content: (node.content?.[0]?.text ?? '') + '\n', language: attrs['language'] || '' })
    case 'horizontalRule':
      return new N('hr')
    case 'callout':
      return new N('tag', attrs['mdAttrs'] ?? {}, (node.content ?? []).map(buildBlock), 'callout')
    default:
      return new N('paragraph', {}, [])
  }
}

const formatNative = (node: TiptapNode): string =>
  Markdoc.format(new N('document', {}, [buildBlock(node)])).replace(/\n+$/, '')

export function tiptapToMarkdoc(doc: TiptapDoc): string {
  const blocks = doc.content.map((node) =>
    node.type === 'passthrough' ? String((node.attrs as Record<string, unknown>)?.['raw'] ?? '') : formatNative(node),
  )
  return blocks.join('\n\n') + '\n'
}
