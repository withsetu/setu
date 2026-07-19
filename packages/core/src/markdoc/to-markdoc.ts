import Markdoc from '@markdoc/markdoc'
import type { TiptapDoc, TiptapNode } from './types'
import { tableToGfm } from './table-gfm'
import { ATOM_NODE_TO_TAG } from './atom-blocks'
import {
  codeSpan,
  decodeProtected,
  escapeText,
  protectText
} from './escape-inline'

const N = Markdoc.Ast.Node

/** A `text` node whose content is already final markdown source. `protectText`
 *  hides it from `Markdoc.format`'s own text escaper, which would otherwise
 *  double-escape what `escapeText`/`codeSpan` just produced (see
 *  ./escape-inline for the contract). `tiptapToMarkdoc` decodes once at the end. */
const rawText = (source: string): InstanceType<typeof N> =>
  new N('text', { content: protectText(source) })

/** An autolink `<https://…>` is the canonical form Markdoc.format emits when a
 *  link's text equals its href, and we must keep emitting it or every such line
 *  in existing content would be rewritten to `[href](href)`. Markdoc compares
 *  the FORMATTED children to the href, which protected text can never equal, so
 *  the case is recognised here instead — and, unlike Markdoc, only for a real
 *  URI scheme, so a non-URL link text is not turned into raw HTML. */
const AUTOLINK_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

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
  content: TiptapNode[] = [],
  /** Where this inline run sits, for the position-dependent escape rules:
   *  `block` = paragraph / list item (first characters are at a line start, so
   *  `#`, `>`, `-`, `1.` are block markers); `heading` = heading content (a
   *  TRAILING `#` run is the ATX closing sequence); `inline` = table cells and
   *  anything else, where no positional rule applies. See ./escape-inline. */
  context: 'block' | 'heading' | 'inline' = 'inline'
): InstanceType<typeof N>[] {
  return content.map((t, index) => {
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
    const marks = t.marks ?? []
    const text = t.text ?? ''

    // Autolink: exactly one link mark whose href is the visible text.
    const soleLink = marks.length === 1 && marks[0]!.type === 'link'
    if (soleLink) {
      const href = (marks[0]!.attrs as Record<string, unknown>)?.['href']
      if (href === text && AUTOLINK_SCHEME.test(text))
        return rawText(`<${text}>`)
    }

    const hasCode = marks.some((m) => m.type === 'code')
    // A code span's content is literal — backslash-escaping it would corrupt it.
    // The fence width carries the ambiguity instead (#677); `Markdoc.format`'s
    // own `code` case hard-codes a single backtick, so it is bypassed here.
    // A positional rule only binds when nothing else occupies that position:
    // a leading `**`/`[` from a mark, or a preceding sibling run, displaces it.
    const bare = marks.length === 0
    let n: InstanceType<typeof N> = hasCode
      ? rawText(codeSpan(text))
      : rawText(
          escapeText(text, {
            atBlockStart: context === 'block' && index === 0 && bare,
            atHeadingEnd:
              context === 'heading' && index === content.length - 1 && bare
          })
        )
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
  // A task item's text is preceded by the `[x] ` marker, so it is NOT at a
  // block start; a plain bullet's text is.
  const inlineNodes = buildInline(
    firstPara?.content ?? [],
    task ? 'inline' : 'block'
  )
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
          new N('inline', {}, buildInline(node.content, 'heading'))
        ]),
        node
      )
    case 'paragraph':
      return withAlign(
        new N('paragraph', {}, [
          new N('inline', {}, buildInline(node.content, 'block'))
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

/** Serialize an `imageBlock` node to a self-closing {% image ... /%} tag.
 *  Returns the tag WITHOUT a trailing newline — the caller's join('\n\n') supplies it.
 *
 *  #668: this used to build the tag by hand with an `escapeAttrString` that escaped
 *  only backslash and double-quote. A caption carrying a newline or a tab was emitted
 *  raw, producing an unterminated attribute; re-reading that file yielded a flagged
 *  passthrough and the author saw an "Unparsed Markdoc" blob. Markdoc's own formatter
 *  escapes the full set, so it does the quoting now — the same seam openTagFor uses. */
function imageBlockToMarkdoc(node: TiptapNode): string {
  const attrs = node.attrs ?? {}
  const mdAttrs =
    (attrs['mdAttrs'] as Record<string, unknown> | undefined) ?? {}

  // Emit src/alt/caption/align first (when present), then any remaining keys — no key
  // is dropped. Markdoc.format emits attributes in object insertion order, so this
  // reordering is load-bearing: it is what keeps existing files byte-stable.
  const leadKeys = ['src', 'alt', 'caption', 'align']
  const ordered: Record<string, unknown> = {}
  for (const key of leadKeys) if (key in mdAttrs) ordered[key] = mdAttrs[key]
  for (const key of Object.keys(mdAttrs))
    if (!leadKeys.includes(key)) ordered[key] = mdAttrs[key]

  // Markdoc.format wraps a tag opening wider than 80 chars across lines. The
  // hand-rolled serializer never did, and image `src` paths routinely exceed it, so
  // keep it on one line or every existing {% image %} would be rewritten.
  return selfClosingTagFor('image', ordered, {
    maxTagOpeningWidth: Number.POSITIVE_INFINITY
  })
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
function selfClosingTagFor(
  tag: string,
  mdAttrs: Record<string, unknown>,
  opts?: { maxTagOpeningWidth?: number }
): string {
  return Markdoc.format(
    new N('document', {}, [new N('tag', mdAttrs, [], tag)]),
    opts
  ).replace(/\n+$/, '')
}

function openTagFor(tag: string, mdAttrs: Record<string, unknown>): string {
  return selfClosingTagFor(tag, mdAttrs).replace(/ \/%\}$/, ' %}')
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
  // Single decode point for the escaping contract: every inline text node was
  // handed to Markdoc pre-escaped and sentinel-protected (see ./escape-inline),
  // and this is where the protection comes back off.
  return decodeProtected(doc.content.map(serializeBlock).join('\n\n') + '\n')
}
