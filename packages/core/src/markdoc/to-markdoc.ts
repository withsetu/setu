import Markdoc from '@markdoc/markdoc'
import type { TiptapDoc, TiptapNode } from './types'
import { tableToGfm } from './table-gfm'
import { ATOM_NODE_TO_TAG } from './atom-blocks'

const N = Markdoc.Ast.Node

/** Mark types buildInline serializes. Kept next to the loops it guards (#665). */
const SERIALIZED_MARKS = new Set([
  'code',
  'bold',
  'italic',
  'strike',
  'link',
  'subscript',
  'superscript'
])

/** Marks deliberately carried in the editor but never written to Markdoc. Empty
 *  today: every mark the admin editor registers round-trips. A mark belongs here
 *  only if dropping it on save is the intended behaviour — otherwise give it a case
 *  in buildInline. (`textAlign` is an attribute, not a mark; see withAlign.) */
const UNPERSISTED_MARKS = new Set<string>([])

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
    // A `code` mark becomes the INNERMOST node, whatever its position in the mark
    // array. Markdoc's `code` node renders from its `content` attribute and ignores
    // its children, so it can only ever be a leaf. It previously ASSIGNED `n` inside
    // the mark loop instead of wrapping (#653) — and to-tiptap emits `code` last, so
    // the link/bold/italic/strike built before it was silently discarded:
    // [`api`](https://example.com) collapsed to `api`, losing the href entirely.
    const hasCode = (t.marks ?? []).some((m) => m.type === 'code')
    let n: InstanceType<typeof N> = hasCode
      ? new N('code', { content: t.text })
      : new N('text', { content: t.text })
    // Apply markdown-native marks first (innermost), then tag marks (outermost).
    // This ensures {% sub %}**b**{% /sub %} rather than **{% sub %}b{% /sub %}**,
    // which Markdoc.format cannot render cleanly across inline tag boundaries.
    for (const m of t.marks ?? []) {
      if (m.type === 'code') continue
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
    // #665: an unrecognized mark used to be dropped by both loops without a sound, so
    // schema/serializer drift silently ate formatting. Fail loudly instead — same
    // posture as the setuBlock missing-tag throw below.
    for (const m of t.marks ?? []) {
      if (!SERIALIZED_MARKS.has(m.type) && !UNPERSISTED_MARKS.has(m.type)) {
        throw new Error(
          `tiptapToMarkdoc: unrecognized mark type "${m.type}" — add a case in buildInline, or add it to UNPERSISTED_MARKS if it is deliberately not persisted`
        )
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
  // Childless atom blocks ({% hero /%}, {% gallery /%}, …) are driven by the shared
  // ATOM_TAG_TO_NODE map (see ./atom-blocks) so this direction and to-tiptap can't drift.
  const atomTag = ATOM_NODE_TO_TAG[node.type]
  if (atomTag) {
    return new N(
      'tag',
      (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
      [],
      atomTag
    )
  }
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
    case 'columns':
    case 'column':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        (node.content ?? []).map(buildBlock),
        node.type
      )
    default:
      // #665: this used to `return new N('paragraph', {}, [])`, so any node type the
      // serializer did not know about vanished into a bare "\n" — schema drift ate
      // content with no signal at all. Fail loudly, like the setuBlock arm above.
      throw new Error(
        `tiptapToMarkdoc: unrecognized node type "${node.type}" — add a case to buildBlock or a string-level serializer to serializeBlock`
      )
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

/** The set of body-bearing tag node types serialized at the STRING level (open tag +
 *  recursively serialized children + close tag) instead of through Markdoc.format.
 *  Rationale: several block types (imageBlock, table, passthrough) have string-only
 *  serializers with no faithful Markdoc AST form — routing a tag's children through
 *  Markdoc.format alone silently DROPPED those nodes (an `{% image /%}` inside a
 *  callout body vanished on save). String-level recursion reuses the exact same
 *  per-type serializers at every nesting depth. */
const TAG_NODE_TYPES: Record<string, (node: TiptapNode) => string> = {
  callout: () => 'callout',
  columns: () => 'columns',
  column: () => 'column',
  setuBlock: (node) => {
    const tag = node.attrs?.['tag']
    if (typeof tag !== 'string' || tag === '') {
      throw new Error(
        'tiptapToMarkdoc: setuBlock node is missing its "tag" attribute'
      )
    }
    return tag
  }
}

/** Open-tag text (`{% tag attr="v" %}`) via Markdoc's own formatter — a synthetic
 *  self-closing tag is formatted and its ` /%}` tail rewritten to ` %}` — so attribute
 *  ordering/quoting/escaping stays byte-identical to what Markdoc.format produced when
 *  whole subtrees went through it (round-trip stability for existing content). */
function openTagFor(tag: string, mdAttrs: Record<string, unknown>): string {
  const selfClosing = Markdoc.format(
    new N('document', {}, [new N('tag', mdAttrs, [], tag)])
  ).replace(/\n+$/, '')
  return selfClosing.replace(/ \/%\}$/, ' %}')
}

/** Serialize a body-bearing tag node at the string level (see TAG_NODE_TYPES). */
function tagBlockToMarkdoc(tag: string, node: TiptapNode): string {
  const mdAttrs =
    (node.attrs?.['mdAttrs'] as Record<string, unknown> | undefined) ?? {}
  const body = (node.content ?? []).map(serializeBlock).join('\n\n')
  return `${openTagFor(tag, mdAttrs)}\n${body}\n{% /${tag} %}`
}

/** Serialize a blockquote at the string level so its children reuse the same
 *  per-type serializers as everywhere else. Previously the blockquote arm of
 *  buildBlock recursed with `buildBlock`, which has no case for the string-only
 *  types (`table`, `imageBlock`, `passthrough`) — all of them `group: 'block'` and
 *  so schema-valid inside a blockquote. They hit the default arm and were destroyed
 *  ("> > \n> > \n"). Byte-identical to Markdoc.format for prose-only blockquotes. */
function blockquoteToMarkdoc(node: TiptapNode): string {
  const body = (node.content ?? []).map(serializeBlock).join('\n\n')
  return body
    .split('\n')
    .map((line) => (line === '' ? '> ' : `> ${line}`))
    .join('\n')
}

/** Serialize one block node to Markdoc source. Used for top-level blocks AND,
 *  recursively, for the children of body-bearing tags. */
function serializeBlock(node: TiptapNode): string {
  if (node.type === 'blockquote') return blockquoteToMarkdoc(node)
  if (node.type === 'passthrough') {
    const raw = node.attrs?.['raw']
    return typeof raw === 'string' ? raw : ''
  }
  if (node.type === 'table') return tableToGfm(node)
  if (node.type === 'imageBlock') return imageBlockToMarkdoc(node)
  const tagOf = TAG_NODE_TYPES[node.type]
  if (tagOf) return tagBlockToMarkdoc(tagOf(node), node)
  return formatNative(node)
}

export function tiptapToMarkdoc(doc: TiptapDoc): string {
  return doc.content.map(serializeBlock).join('\n\n') + '\n'
}
