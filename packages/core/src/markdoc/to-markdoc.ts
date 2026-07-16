import Markdoc from '@markdoc/markdoc'
import type { TiptapDoc, TiptapNode } from './types'
import { tableToGfm } from './table-gfm'

const N = Markdoc.Ast.Node

export function buildInline(
  content: TiptapNode[] = []
): InstanceType<typeof N>[] {
  return content.map((t) => {
    if (t.type === 'hardBreak') return new N('hardbreak')
    if (t.type === 'image') {
      const a = t.attrs ?? {}
      const attrs: Record<string, unknown> = {
        src: a.src ?? '',
        alt: a.alt ?? ''
      }
      if (a.title != null && a.title !== '') attrs.title = a.title
      return new N('image', attrs)
    }
    let n: InstanceType<typeof N> = new N('text', { content: t.text })
    // Apply markdown-native marks first (innermost), then tag marks (outermost).
    // This ensures {% sub %}**b**{% /sub %} rather than **{% sub %}b{% /sub %}**,
    // which Markdoc.format cannot render cleanly across inline tag boundaries.
    for (const m of t.marks ?? []) {
      if (m.type === 'code') n = new N('code', { content: t.text })
      else if (m.type === 'bold') n = new N('strong', { marker: '**' }, [n])
      else if (m.type === 'italic') n = new N('em', { marker: '*' }, [n])
      else if (m.type === 'strike') n = new N('s', {}, [n])
      else if (m.type === 'link')
        n = new N(
          'link',
          { href: (m.attrs as Record<string, unknown>)?.href },
          [n]
        )
    }
    for (const m of t.marks ?? []) {
      if (m.type === 'subscript') {
        const tag = new N('tag', {}, [n], 'sub')
        tag.inline = true
        n = tag
      } else if (m.type === 'superscript') {
        const tag = new N('tag', {}, [n], 'sup')
        tag.inline = true
        n = tag
      }
    }
    return n
  })
}

/** Build a Markdoc `item` from a Tiptap list item. Uses the item's first paragraph
 *  for inline content (prefixed with a task marker when `task`), and recurses into any
 *  nested lists, appending them as block children of the item. */
function buildListItem(
  item: TiptapNode,
  task: boolean
): InstanceType<typeof N> {
  const children = item.content ?? []
  const firstPara = children.find((c) => c.type === 'paragraph')
  const inlineNodes = buildInline(firstPara?.content ?? [])
  if (task) {
    const checked = item.attrs?.['checked'] === true
    inlineNodes.unshift(new N('text', { content: checked ? '[x] ' : '[ ] ' }))
  }
  const nested = children
    .filter(
      (c) =>
        c.type === 'bulletList' ||
        c.type === 'orderedList' ||
        c.type === 'taskList'
    )
    .map(buildBlock)
  return new N('item', {}, [new N('inline', {}, inlineNodes), ...nested])
}

/** Attach a Markdoc `{% align="…" %}` annotation to a built block node when the Tiptap
 *  node has a center/right textAlign. left/null/undefined → no annotation (clean default).
 *  Mirrors the `tag.inline = true` write pattern in buildInline. */
function withAlign(
  built: InstanceType<typeof N>,
  node: TiptapNode
): InstanceType<typeof N> {
  const ta = node.attrs?.['textAlign']
  if (ta === 'center' || ta === 'right') {
    built.annotations = [{ type: 'attribute', name: 'align', value: ta }]
  }
  return built
}

function buildBlock(node: TiptapNode): InstanceType<typeof N> {
  const attrs = node.attrs ?? {}
  switch (node.type) {
    case 'heading':
      return withAlign(
        new N('heading', { level: attrs['level'] }, [
          new N('inline', {}, buildInline(node.content))
        ]),
        node
      )
    case 'paragraph':
      return withAlign(
        new N('paragraph', {}, [
          new N('inline', {}, buildInline(node.content))
        ]),
        node
      )
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const ordered = node.type === 'orderedList'
      return new N(
        'list',
        { ordered, marker: ordered ? '.' : '-' },
        (node.content ?? []).map((item) =>
          buildListItem(item, node.type === 'taskList')
        )
      )
    }
    case 'blockquote':
      return new N('blockquote', {}, (node.content ?? []).map(buildBlock))
    case 'codeBlock':
      return new N('fence', {
        content: (node.content?.[0]?.text ?? '') + '\n',
        language: attrs['language'] || ''
      })
    case 'horizontalRule':
      return new N('hr')
    case 'callout':
      return new N(
        'tag',
        attrs['mdAttrs'] ?? {},
        (node.content ?? []).map(buildBlock),
        'callout'
      )
    case 'contactBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        [],
        'contact'
      )
    case 'heroBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        [],
        'hero'
      )
    case 'queryBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        [],
        'query'
      )
    case 'latestPostsBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        [],
        'latest-posts'
      )
    case 'embedBlock':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        [],
        'embed'
      )
    case 'setuBlock': {
      const tag = attrs['tag']
      if (typeof tag !== 'string' || tag === '') {
        throw new Error(
          'tiptapToMarkdoc: setuBlock node is missing its "tag" attribute'
        )
      }
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        (node.content ?? []).map(buildBlock),
        tag
      )
    }
    default:
      return new N('paragraph', {}, [])
  }
}

const formatNative = (node: TiptapNode): string =>
  Markdoc.format(new N('document', {}, [buildBlock(node)])).replace(/\n+$/, '')

/** Escape a string attribute value: backslash → \\, double-quote → \". */
function escapeAttrString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Serialize an `imageBlock` node to a self-closing {% image ... /%} tag.
 *  Returns the tag WITHOUT a trailing newline — the caller's join('\n\n') supplies it. */
function imageBlockToMarkdoc(node: TiptapNode): string {
  const attrs = node.attrs ?? {}
  const mdAttrs =
    (attrs['mdAttrs'] as Record<string, unknown> | undefined) ?? {}

  // Emit src/alt/caption/align first (when present), then any remaining keys — no key is dropped.
  const leadKeys = ['src', 'alt', 'caption', 'align']
  const remainingKeys = Object.keys(mdAttrs).filter(
    (k) => !leadKeys.includes(k)
  )
  const orderedKeys = [
    ...leadKeys.filter((k) => k in mdAttrs),
    ...remainingKeys
  ]

  const parts: string[] = []
  for (const key of orderedKeys) {
    const val = mdAttrs[key]
    if (typeof val === 'string') parts.push(`${key}="${escapeAttrString(val)}"`)
    else if (typeof val === 'number' || typeof val === 'boolean')
      parts.push(`${key}=${val}`)
    // Any other JSON value (object/array — not expected in practice for image attrs, but
    // frontmatter is user-authored/unknown-typed) — JSON.stringify instead of `String(val)`,
    // which would silently serialize it as the literal text "[object Object]" and corrupt
    // the persisted Markdoc (@typescript-eslint/no-base-to-string caught this).
    else if (val != null)
      parts.push(`${key}="${escapeAttrString(JSON.stringify(val))}"`)
  }

  return `{% image ${parts.join(' ')} /%}`
}

export function tiptapToMarkdoc(doc: TiptapDoc): string {
  const blocks = doc.content.map((node) => {
    const raw = node.attrs?.['raw']
    return node.type === 'passthrough'
      ? typeof raw === 'string'
        ? raw
        : ''
      : node.type === 'table'
        ? tableToGfm(node)
        : node.type === 'imageBlock'
          ? imageBlockToMarkdoc(node)
          : formatNative(node)
  })
  return blocks.join('\n\n') + '\n'
}
