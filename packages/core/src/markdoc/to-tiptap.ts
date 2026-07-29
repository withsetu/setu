import Markdoc from '@markdoc/markdoc'
import type {
  MdNode,
  RoundtripOptions,
  TiptapDoc,
  TiptapMark,
  TiptapNode
} from './types'
import { defaultKnownBlockTags } from '../config/default-config'
import { ATOM_TAG_TO_NODE } from './atom-blocks'
import { parseMdoc } from './frontmatter'

// Markdoc AST node attributes are `unknown` (parsed, untyped input — see MdNode in
// ./types). A real `src`/`alt`/`title`/`content` attribute is always a string coming out
// of the Markdoc parser; a plain `String(x)` on a non-string would silently produce
// "[object Object]" instead of surfacing the bug (@typescript-eslint/no-base-to-string
// caught this once MdNode.attributes moved from `any` to `Record<string, unknown>`).
const attrString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const hasError = (node: MdNode): boolean =>
  node.type === 'error' ||
  (Array.isArray(node.errors) && node.errors.length > 0)

/** Markdoc tags that are editor MARKS rather than blocks, and the mark each carries.
 *  The single source for both halves of the inline-tag question: `inlineToTiptap` reads
 *  it to build the mark, and the block-tag detection below reads its KEYS to decide
 *  which inline tags are really block-level tags written on one line. Two separate lists
 *  would drift, and a tag missing from the mark half would then be promoted to a block.
 *  Enforced by `packages/core/test/single-line-tag-roundtrip.test.ts`
 *  ("leaves the sub/sup inline MARK tags alone"). */
const INLINE_TAG_MARKS: Record<string, string> = {
  sub: 'subscript',
  sup: 'superscript'
}

/** Add `mark` to an inline run's mark list, unless a mark of that type is already
 *  carried. A ProseMirror mark set is a SET: the same type cannot appear twice, and
 *  Tiptap collapses a duplicate on load. Markdown nesting does not respect that —
 *  CommonMark reads `_a*a*_` as em(text, em(text)), so descending this tree while
 *  blindly appending produced a run holding `italic` twice.
 *
 *  That is model state the editor can never hold, and the writer wrapped such a run in
 *  two delimiter pairs (`_a*a*_` -> `*a*a**`), whose trailing `**` re-parses as a
 *  literal asterisk pair — the same delimiter-run corruption as #693, reached from the
 *  reader rather than the writer. Collapsing here drops only the redundant nesting;
 *  no text and no mark is lost.
 *
 *  `link` is compared by href as well, so genuinely different nested links are kept
 *  distinct rather than silently merged into the outer one. */
const withMark = (marks: TiptapMark[], mark: TiptapMark): TiptapMark[] =>
  marks.some(
    (m) =>
      m.type === mark.type &&
      (m.type !== 'link' || m.attrs?.['href'] === mark.attrs?.['href'])
  )
    ? marks
    : [...marks, mark]

function inlineToTiptap(node: MdNode, marks: TiptapMark[] = []): TiptapNode[] {
  const kids = node.children ?? []
  switch (node.type) {
    case 'inline':
      return kids.flatMap((c) => inlineToTiptap(c, marks))
    case 'text':
      return [
        {
          type: 'text',
          text: String(node.attributes.content),
          ...(marks.length ? { marks } : {})
        }
      ]
    case 'strong':
      return kids.flatMap((c) =>
        inlineToTiptap(c, withMark(marks, { type: 'bold' }))
      )
    case 'em':
      return kids.flatMap((c) =>
        inlineToTiptap(c, withMark(marks, { type: 'italic' }))
      )
    case 's':
      return kids.flatMap((c) =>
        inlineToTiptap(c, withMark(marks, { type: 'strike' }))
      )
    case 'code':
      return [
        {
          type: 'text',
          text: String(node.attributes.content),
          marks: withMark(marks, { type: 'code' })
        }
      ]
    case 'link':
      return kids.flatMap((c) =>
        inlineToTiptap(
          c,
          withMark(marks, {
            type: 'link',
            attrs: { href: node.attributes.href }
          })
        )
      )
    case 'hardbreak':
      return [{ type: 'hardBreak' }]
    /** #667: a SOFT break — the plain newline a hard-wrapped paragraph is made of —
     *  used to become a single space, and `buildInline` had no inverse, so the first
     *  save reflowed every hard-wrapped paragraph onto one line. Rendered HTML is
     *  identical either way, which is exactly why it went unnoticed; in a Git-backed
     *  CMS it means one save produces a WHOLE-FILE diff, burying the real change in
     *  review and destroying `git blame`.
     *
     *  It is modelled as a `\n` inside a text node rather than as a new schema node:
     *  a bare `text` node is already legal everywhere inline content is, so no editor
     *  extension is needed, and it collapses to a space in the canvas exactly as it
     *  does in rendered HTML. Carrying `marks` is load-bearing — a dedicated node
     *  would split `*a\nb*` into two runs and so into two delimiter pairs, which is
     *  the #693 corruption class. */
    case 'softbreak':
      return [{ type: 'text', text: '\n', ...(marks.length ? { marks } : {}) }]
    case 'image':
      return [
        {
          type: 'image',
          attrs: {
            src: attrString(node.attributes.src),
            alt: attrString(node.attributes.alt),
            title:
              node.attributes.title != null
                ? attrString(node.attributes.title)
                : null
          }
        }
      ]
    /** The ONLY tags that legitimately live in an inline run: they are editor MARKS,
     *  not blocks. Every other tag reaching an inline position is a block-level tag the
     *  author wrote on one line, and is handled a level up (see `soleInlineBlockTag` /
     *  `hasInlineBlockTag`) — falling through to `[]` here is what deleted it in #967. */
    case 'tag': {
      const mark = INLINE_TAG_MARKS[node.tag ?? '']
      if (mark)
        return kids.flatMap((c) =>
          inlineToTiptap(c, withMark(marks, { type: mark }))
        )
      return []
    }
    default:
      return []
  }
}

const collectInline = (node: MdNode): TiptapNode[] =>
  (node.children ?? []).flatMap((c) => inlineToTiptap(c))

/** Widen our structural `MdNode` view (./types) back to Markdoc's own node type, so
 *  parsed children can be handed to `Markdoc.Ast.Node`'s constructor. `MdNode` is a
 *  deliberate SUBSET of the real thing and every value reaching here came out of
 *  `Markdoc.parse`, so this only restores type information the subset dropped — it never
 *  claims anything about a node that is not already true. */
const mdocNodes = (
  nodes: MdNode[] | undefined
): InstanceType<typeof Markdoc.Ast.Node>[] =>
  (nodes ?? []) as InstanceType<typeof Markdoc.Ast.Node>[]

/** A Markdoc tag sitting in an INLINE position that is not one of the mark tags — i.e. a
 *  body-bearing block tag the author wrote on one line. Markdoc parses
 *  `{% button %}x{% /button %}` as `paragraph > inline > tag`, a shape the Tiptap schema
 *  has no node for, so it needs lifting back out to block level (#967). */
const isInlineBlockTag = (node: MdNode): boolean =>
  node.type === 'tag' && INLINE_TAG_MARKS[node.tag ?? ''] === undefined

/** The `inline` child holding a paragraph's inline run. */
const inlineRunOf = (para: MdNode): MdNode | undefined =>
  (para.children ?? []).find((c) => c.type === 'inline')

/** Does this inline run carry a block-level tag ANYWHERE — including inside a mark, as in
 *  `**{% button %}Go{% /button %}**`? A shallow check would miss that one and it would be
 *  deleted exactly as the bare form was. */
function runHasBlockTag(nodes: MdNode[]): boolean {
  return nodes.some(
    (n) => isInlineBlockTag(n) || runHasBlockTag(n.children ?? [])
  )
}

const hasInlineBlockTag = (para: MdNode): boolean =>
  runHasBlockTag(inlineRunOf(para)?.children ?? [])

/** The one block-level tag this paragraph consists ENTIRELY of, or null. Whitespace-only
 *  text siblings do not count against it (Markdown has already trimmed the line's own
 *  padding, so nothing visible is dropped by ignoring them). */
function soleInlineBlockTag(para: MdNode): MdNode | null {
  // An annotation such as `{% align="center" %}` belongs to the PARAGRAPH, and promoting
  // the tag out of it would drop the annotation. Leave those to the passthrough branch,
  // which keeps the whole line verbatim instead.
  if (Object.keys(para.attributes ?? {}).length > 0) return null
  const kids = (inlineRunOf(para)?.children ?? []).filter(
    (c) =>
      !(c.type === 'text' && attrString(c.attributes['content']).trim() === '')
  )
  const only = kids.length === 1 ? kids[0]! : null
  return only !== null && isInlineBlockTag(only) ? only : null
}

/** Re-shape a single-line tag into the AST the BLOCK converter already understands: the
 *  same tag, with its inline run wrapped in one paragraph. Callout, columns, the atoms
 *  and the generic setuBlock fallback are then all reached through the ONE tag arm of
 *  `blockToTiptap` — a parallel inline implementation is exactly the hand-mirroring that
 *  ./atom-blocks exists to prevent.
 *
 *  Built from `Markdoc.Ast.Node` rather than an object literal so the result is a REAL
 *  Markdoc node: the paragraph it wraps can be handed back to `Markdoc.format` by
 *  `formatParagraph` when the recursion lands on the mixed-content branch. */
function asBlockTag(tag: MdNode): MdNode {
  const N = Markdoc.Ast.Node
  const para = new N('paragraph', {}, [
    new N('inline', {}, mdocNodes(tag.children))
  ])
  return new N('tag', tag.attributes, [para], tag.tag)
}

/** A paragraph's own Markdoc source, via Markdoc's formatter.
 *
 *  Used for the passthrough fallback everywhere BELOW the top level — a tag body, a
 *  blockquote, a list item — where the top-level loop's source slice is unavailable: the
 *  source lines there carry container prefixes (`> `) and indentation that the writer
 *  re-adds, so slicing them would double up. Formatting is faithful but not necessarily
 *  byte-identical (Markdoc normalises emphasis markers and escapes), so a nested mixed
 *  paragraph may be re-spelled ONCE and is stable after that; the top level keeps the
 *  author's exact bytes. Both are covered by
 *  `packages/core/test/single-line-tag-roundtrip.test.ts`
 *  ("a tag mixed with other inline content in one paragraph"). */
const formatParagraph = (para: MdNode): string =>
  Markdoc.format(para as never).replace(/\n+$/, '')

/** A literal `<br>` (any spelling) inside a table cell. Markdoc parses a GFM cell as
 *  INLINE content and never recognises `<br>` as a break — it lands as literal text — so
 *  the reader restores it to a `hardBreak` node here. This is the inverse of the writer's
 *  `\n` -> `<br>` cell flattening (#752): a multi-block cell serialises its inter-block
 *  breaks as `<br>`, and without this they would re-read as the literal characters
 *  `<br>`, whose `<` the next save escapes to `\<br>` — the break decays to visible text.
 *  markdown-it has already resolved any `\<br>` escape to `<br>` before we see it, so only
 *  the bare form needs matching.
 *
 *  #772 — the known, deliberate casualty. An author who writes `\<br>` in a cell MEANS the
 *  visible characters `<br>`, and this rule turns them into a real break: the escape is
 *  reinterpreted, not just reformatted. It cannot be told apart here. Markdoc hands a cell
 *  over as a SINGLE `text` node whose content has already had every backslash escape
 *  resolved and (raw HTML being off) any `<br>` re-inlined as text, so `a\<br>b` and `a<br>b`
 *  arrive byte-identical, with no location detail below the line to separate them. No
 *  writer-side spelling escapes it either — `&lt;br>` and `&#60;br>` are both decoded back
 *  to `<br>` before this runs. The only fix is re-deriving cell text from the raw source by
 *  offset, a second coordinate system in the reader for the one shape it would rescue (the
 *  #674 class of bug). Left alone deliberately: a bare `<br>` in a cell is a line break in
 *  GFM everywhere else too, and #769 made the published page agree, so healing it is the
 *  behaviour that matches the rest of the world; only the escaped spelling loses. */
const CELL_BR = /<br\s*\/?>/gi

/** Split every text node in a cell's inline run on `<br>`, interleaving `hardBreak`
 *  nodes and preserving each fragment's marks. Non-text inline nodes pass through.
 *
 *  #785 — a code span is EXEMPT. Markdoc hands one over as a text node carrying a
 *  `code` mark (the `code` case above), not as a distinct node type, so the plain
 *  `type !== 'text'` guard did not cover it and `` `a<br>b` `` came back as two code
 *  runs around a real break. Saving then rewrote the cell to `` `a`<br>`b` `` — one
 *  `<code>` element on the published page became two, in content the author never
 *  edited. Code-span content is literal by definition, which is why the writer refuses
 *  to escape it (see escape-inline) and why the site renderer leaves a `<br>` inside a
 *  code span alone (`markdoc.config.mjs`, which skips `child.name === 'code'` by an
 *  EXPLICIT exemption — the transform emits `Tag('code', {}, ['a<br>b'])`, so the
 *  payload is a child string and the recursion would otherwise reach it). This is the
 *  reader agreeing with both.
 *
 *  Enforced by `packages/core/test/table-cell-code-span.test.ts` (this side) and
 *  `apps/site/test/table-cell-breaks.test.ts` (the renderer side). */
function splitCellBreaks(inline: TiptapNode[]): TiptapNode[] {
  return inline.flatMap((node) => {
    if (node.type !== 'text' || typeof node.text !== 'string') return [node]
    if ((node.marks ?? []).some((m) => m.type === 'code')) return [node]
    const pieces = node.text.split(CELL_BR)
    if (pieces.length === 1) return [node]
    const out: TiptapNode[] = []
    pieces.forEach((piece, i) => {
      if (i > 0) out.push({ type: 'hardBreak' })
      if (piece !== '')
        out.push({
          type: 'text',
          text: piece,
          ...(node.marks ? { marks: node.marks } : {})
        })
    })
    return out
  })
}

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
  if (first?.type !== 'text' || typeof first.attributes.content !== 'string')
    return null
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

/** #967: the children of a list item whose leading text carries a block-level tag.
 *
 *  The item's inline run is re-wrapped as a paragraph and sent through `blockToTiptap`,
 *  which is where single-line tags are lifted back to block level. A task item's `[x] `
 *  marker is removed from the SOURCE first — left in place it makes every task item look
 *  like "a tag mixed with prose" and the whole line would degrade to a passthrough that
 *  re-emits the marker as literal text.
 *
 *  Enforced by `packages/core/test/single-line-tag-roundtrip.test.ts`
 *  ("single-line tags nested inside other blocks"). */
function itemLeadWithBlockTag(
  inlineNode: MdNode,
  task: boolean,
  rest: TiptapNode[]
): TiptapNode[] {
  const N = Markdoc.Ast.Node
  let kids = inlineNode.children ?? []
  const first = kids[0]
  if (task && first?.type === 'text') {
    const stripped = attrString(first.attributes['content']).replace(
      TASK_RE,
      ''
    )
    kids =
      stripped === ''
        ? kids.slice(1)
        : [new N('text', { content: stripped }), ...kids.slice(1)]
  }
  const para = new N('paragraph', {}, [
    new N('inline', {}, mdocNodes(kids))
  ]) as unknown as MdNode
  const lead = blockToTiptap(para)
  if (lead?.type === 'paragraph') return [lead, ...rest]
  // The Tiptap item schema requires a leading paragraph; an empty one is re-inserted on
  // the next read, so nothing is added to the file by it (see listItemToMarkdoc's drop).
  return [{ type: 'paragraph', content: [] }, ...(lead ? [lead] : []), ...rest]
}

/** Markdoc list → Tiptap list, recursively. Checklist detection is per level. Each
 *  item becomes [paragraph, ...every other block child].
 *
 *  #658: this used to keep only the item's first paragraph plus nested lists — the
 *  read-side mirror of the serializer bug. A second paragraph, a table, an image or
 *  a code block inside a list item survived in Git but vanished the moment the entry
 *  was opened, so the next save wrote the loss back. */
function listToTiptap(node: MdNode): TiptapNode {
  const task = isTaskList(node)
  const listType = task
    ? 'taskList'
    : node.attributes.ordered
      ? 'orderedList'
      : 'bulletList'
  return {
    type: listType,
    content: (node.children ?? []).map((item) => {
      const inlineNode = itemInlineNode(item)
      const inline = inlineNode ? inlineToTiptap(inlineNode) : []
      // The paragraph that supplied the item's inline text is consumed into the
      // leading paragraph below; every OTHER block child is carried through the
      // normal block converter, so nested lists, tables, images and code blocks
      // all survive (#658).
      const consumed = (item.children ?? []).find(
        (c) =>
          c.type === 'paragraph' && c.children?.includes(inlineNode as never)
      )
      const rest = (item.children ?? [])
        .filter((c) => c.type !== 'inline' && c !== consumed)
        .map(blockToTiptap)
        .filter((n): n is TiptapNode => n !== null)
      const paragraph: TiptapNode = {
        type: 'paragraph',
        content: task ? stripMarker(inline) : inline
      }
      // #967. `- {% button %}Go{% /button %}` reaches the inline converter through THIS
      // path, not through blockToTiptap's paragraph arm, so the tag was deleted here too.
      // The diversion is taken only when a block tag is actually present, leaving the
      // (heavily load-bearing: #711, #725, #744) ordinary item path byte-for-byte as it
      // was. `listItem`/`taskItem` are `paragraph block*`, so a promoted block cannot be
      // the first child — it follows an empty paragraph, which `listItemToMarkdoc` drops
      // again when the item has further children, giving back the author's own line.
      const content =
        inlineNode && runHasBlockTag(inlineNode.children ?? [])
          ? itemLeadWithBlockTag(inlineNode, task, rest)
          : [paragraph, ...rest]
      if (task)
        return {
          type: 'taskItem',
          attrs: { checked: taskMarker(item)!.checked },
          content
        }
      return { type: 'listItem', content }
    })
  }
}

/** Whether a block carries a non-default alignment (anything but `left`/absent). */
function isAligned(node: MdNode): boolean {
  const a = node.attributes.align
  return Boolean(a) && a !== 'left'
}

/** Tiptap textAlign attrs for a block, from a Markdoc node's `align` attribute.
 *  `left`/absent → none (default stays clean). */
function alignAttr(
  node: MdNode
): { textAlign: string } | Record<string, never> {
  return isAligned(node) ? { textAlign: String(node.attributes.align) } : {}
}

/** `{% columns %}` → the bespoke multi-slot `columns` node (#181), but ONLY when the
 *  tag is well-formed for the editor schema (`column{2,4}`): every child a `column`
 *  tag and 2–4 of them. Anything else returns null so the caller falls back to the
 *  generic setuBlock path, which round-trips arbitrary structure verbatim. Each empty
 *  column seeds one empty paragraph (the Tiptap `column` node requires `block+`). */
function columnsToTiptap(node: MdNode): TiptapNode | null {
  const kids = node.children ?? []
  const allColumns =
    kids.length >= 2 &&
    kids.length <= 4 &&
    kids.every((k) => k.type === 'tag' && k.tag === 'column')
  if (!allColumns) return null
  const columns = kids.map((k): TiptapNode => {
    const body = (k.children ?? [])
      .map(blockToTiptap)
      .filter((n): n is TiptapNode => n !== null)
    return {
      type: 'column',
      attrs: { mdAttrs: k.attributes },
      content: body.length ? body : [{ type: 'paragraph', content: [] }]
    }
  })
  return {
    type: 'columns',
    attrs: { mdAttrs: node.attributes },
    content: columns
  }
}

function blockToTiptap(node: MdNode): TiptapNode | null {
  switch (node.type) {
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: node.attributes.level, ...alignAttr(node) },
        content: collectInline(node)
      }
    case 'paragraph': {
      // #967. A paragraph is the wrapper Markdoc puts a SINGLE-LINE tag in, so it is
      // checked for one before it is treated as prose. `{% button %}Get started{% /button %}`
      // — the shape content/post/en/kitchen-sink.mdoc ships — used to reach `collectInline`,
      // where the inline `tag` arm returned [] and destroyed the tag AND its text.
      const sole = soleInlineBlockTag(node)
      if (sole) {
        const promoted = blockToTiptap(asBlockTag(sole))
        // `inlineBody` records the shape the author wrote so the writer can give it back
        // byte-for-byte (see tagBlockToMarkdoc). It is a hint, never a requirement: a node
        // that loses it — an editor whose schema does not declare the attribute, a block
        // pasted from elsewhere — serializes as the `\n`-wrapped form, which is stable and
        // lossless. Honouring it matters because the two shapes RENDER differently:
        // Markdoc transforms the one-line form to `<p><Button>text</Button></p>` and the
        // wrapped form to `<Button><p>text</p></Button>`, and `.setu-button` is
        // `display: inline-flex`, so normalising would put a block `<p>` inside it and
        // change the published page.
        if (promoted)
          return {
            ...promoted,
            attrs: { ...(promoted.attrs ?? {}), inlineBody: true }
          }
      }
      // Mixed with prose, or buried inside a mark. The Tiptap schema has no inline node a
      // block-level tag can live in (`paragraph` is `inline*`; `callout`/`setuBlock` are
      // `group: 'block'`), so the whole line degrades to a VISIBLE passthrough — the #664
      // escape hatch — rather than losing the tag silently.
      if (hasInlineBlockTag(node))
        return {
          type: 'passthrough',
          attrs: { raw: formatParagraph(node), flagged: false }
        }
      return {
        type: 'paragraph',
        ...(isAligned(node) ? { attrs: alignAttr(node) } : {}),
        content: collectInline(node)
      }
    }
    case 'list':
      return listToTiptap(node)
    case 'blockquote':
      return {
        type: 'blockquote',
        content: (node.children ?? [])
          .map(blockToTiptap)
          .filter((n): n is TiptapNode => n !== null)
      }
    case 'fence':
      return {
        type: 'codeBlock',
        attrs: { language: node.attributes.language || null },
        content: [
          {
            type: 'text',
            text: String(node.attributes.content).replace(/\n$/, '')
          }
        ]
      }
    case 'hr':
      return { type: 'horizontalRule' }
    case 'tag': {
      const tag = node.tag ?? ''
      if (tag === 'columns') {
        const columns = columnsToTiptap(node)
        if (columns) return columns
        // Structurally invalid (stray non-column children, out-of-range count):
        // fall through to the generic setuBlock chrome — never drop content.
      }
      const kids = (node.children ?? [])
        .map(blockToTiptap)
        .filter((n): n is TiptapNode => n !== null)
      if (tag === 'callout') {
        return {
          type: 'callout',
          attrs: { mdAttrs: node.attributes },
          content: kids
        }
      }
      // #967, second half. An atom node carries props and NO children, so routing a tag
      // that has a body through one deletes that body — `{% hero %}text{% /hero %}` was
      // written back as `{% hero /%}`, in BOTH written shapes, for all nine atom tags plus
      // `image`. Hand-authored `.mdoc` is a first-class workflow (§1), so the body is kept
      // by falling through to the generic setuBlock arm, which round-trips any tag
      // verbatim. A well-formed self-closing atom has no children and is untouched.
      const hasBody = (node.children ?? []).length > 0
      if (tag === 'image' && !hasBody) {
        return { type: 'imageBlock', attrs: { mdAttrs: node.attributes } }
      }
      // Childless atom blocks ({% hero %} → heroBlock, …) are driven by the shared
      // ATOM_TAG_TO_NODE map (see ./atom-blocks) so this direction and to-markdoc can't drift.
      const atomNode = ATOM_TAG_TO_NODE[tag]
      if (atomNode && !hasBody) {
        return { type: atomNode, attrs: { mdAttrs: node.attributes } }
      }
      return {
        type: 'setuBlock',
        attrs: { tag, mdAttrs: node.attributes },
        content: kids
      }
    }
    case 'table': {
      const cellAlign = (cell: MdNode): string | null =>
        (cell.attributes.align as string) ?? null
      const cellToTiptap = (cell: MdNode, header: boolean): TiptapNode => ({
        type: header ? 'tableHeader' : 'tableCell',
        attrs: { align: cellAlign(cell) },
        content: [
          { type: 'paragraph', content: splitCellBreaks(collectInline(cell)) }
        ]
      })
      const rowToTiptap = (tr: MdNode, header: boolean): TiptapNode => ({
        type: 'tableRow',
        content: (tr.children ?? []).map((c) => cellToTiptap(c, header))
      })
      const rows: TiptapNode[] = []
      for (const section of node.children ?? []) {
        const header = section.type === 'thead'
        for (const tr of section.children ?? [])
          rows.push(rowToTiptap(tr, header))
      }
      return { type: 'table', content: rows }
    }
    default:
      return null
  }
}

/** #743, half one: re-spell the `---` that opened a BOGUS frontmatter fence as `***`,
 *  the other legal spelling of the same thematic break, so Markdoc's frontmatter rule
 *  cannot claim it.
 *
 *  Length- and line-count-preserving by construction: only the three characters on the
 *  FIRST line change, so `location.line` and the `lines` index built from the ORIGINAL
 *  text stay in the same coordinate space (the #674 lesson — a parser input that drifts
 *  from the line index corrupts every passthrough slice after it). Only the parser ever
 *  sees this text; passthrough `raw` is still sliced from the author's own bytes, and a
 *  thematic break's Tiptap node carries no spelling at all, so nothing downstream can
 *  tell the difference. */
function respellFrontmatterFence(text: string): string {
  const nl = text.indexOf('\n')
  const first = nl === -1 ? text : text.slice(0, nl)
  const rest = nl === -1 ? '' : text.slice(nl)
  // A container prefix (`> `, `> > `, a list marker) may sit before it: Markdoc's rule
  // runs on the block ruler and reads line 0 of whatever container it is inside.
  if (!/---[ \t]*$/.test(first)) return text
  return first.replace(/---([ \t]*)$/, '***$1') + rest
}

export function markdocToTiptap(
  source: string,
  opts: RoundtripOptions = {}
): TiptapDoc {
  // defaultKnownBlockTags is now empty by default (blocks moved to auto-discovered folders).
  // Real callers (e.g., read-service) inject knownBlockTags from the block registry; without injection, tags pass through.
  const known = opts.knownBlockTags ?? defaultKnownBlockTags
  const isPreserve = (node: MdNode): boolean => {
    if (hasError(node)) return true
    if (node.type === 'tag') return !known.has(node.tag ?? '')
    // #967: at the top level a paragraph may be nothing but the wrapper Markdoc put a
    // single-line tag in, so it is routed by the SAME rule as the `\n`-wrapped form —
    // an unknown tag gets the byte-exact source slice its block twin already got. A tag
    // mixed with prose is preserved whole for the same reason (`blockToTiptap` has the
    // nested fallback for the depths this loop cannot slice).
    if (node.type === 'paragraph') {
      const sole = soleInlineBlockTag(node)
      return sole ? !known.has(sole.tag ?? '') : hasInlineBlockTag(node)
    }
    return false
  }

  // Markdoc (via markdown-it) normalizes CR and CRLF to LF BEFORE tokenizing, so its
  // `location.line` numbers are indices into the normalized text. A bare `\r` is a line
  // break there but not to `source.split('\n')`, which desynchronized the two index
  // spaces and made every subsequent passthrough slice start one line too early —
  // dropping the tag's own opening line and duplicating the preceding block, growing
  // the document without bound on every save (#674). Normalize once, up front, and
  // feed the SAME text to both the parser and the line index so they cannot drift.
  const text = source.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  // `location` is supported at runtime (spike-proven) but not in Markdoc's published parse types.
  const parse = Markdoc.parse as (s: string, a?: unknown) => MdNode
  let ast = parse(text, { location: true })

  // #743: Markdoc DELETES a leading `---` … `---` span into `ast.attributes.frontmatter`
  // with no YAML-shape guard of any kind — its rule is "line 0 trims to `---` and some
  // later line does too". A document whose first block is a thematic break therefore lost
  // every block up to the next one, and this reader never even looked at the attribute.
  // Two saves were enough to destroy arbitrary content, because the writer normalises the
  // author's `***` to `---` on pass 1 and pass 2 then reads its own output.
  //
  // `parseMdoc` (./frontmatter.ts) has always drawn this line correctly — frontmatter is a
  // CLOSED, ANCHORED fence whose YAML is a plain object — and it is reused verbatim here
  // rather than re-derived, so the two paths cannot drift apart again. Anything Markdoc
  // claimed that `parseMdoc` would not is body content: re-parse with the fence re-spelled.
  //
  // The rule is registered on the block ruler and only checks `startLine == 0` in whatever
  // CONTAINER it is running in, so a leading blockquote reaches it too: `"> ---\n> \n> ---"`
  // was emptied on the FIRST read, with no second save needed.
  const claimed = ast.attributes?.['frontmatter']
  if (
    typeof claimed === 'string' &&
    parseMdoc(text).rawFrontmatter === undefined
  )
    ast = parse(respellFrontmatterFence(text), { location: true })

  const kids = ast.children ?? []
  const out: TiptapNode[] = []

  const startOf = (i: number): number =>
    kids[i]?.location?.start?.line ?? lines.length
  const slice = (from: number, to: number): string =>
    lines.slice(from, to).join('\n').replace(/\n+$/, '')

  for (let i = 0; i < kids.length;) {
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
      out.push({
        type: 'passthrough',
        attrs: { raw: slice(startLine, endLine), flagged: hasError(node) }
      })
      i = j + 1
      continue
    }
    const tt = blockToTiptap(node)
    if (tt) {
      out.push(tt)
    } else {
      // #664 fail-safe: `blockToTiptap` returned null, i.e. a block type the editor
      // cannot model. Deleting it would destroy user content silently, so preserve the
      // source lines verbatim instead — the same escape hatch tags and errors use.
      //
      // No node type the CURRENT parser emits reaches here, so this is insurance, not
      // a live fix. Verified against @markdoc/markdoc 0.5.7: `NodeType` (src/types.ts)
      // has no footnote/html/reference-definition member; the tokenizer disables
      // `code` and `lheading` (src/tokenizer/index.ts), so indented code and setext
      // headings are parsed as paragraphs; and `comment` requires a Tokenizer option
      // `Markdoc.parse` does not accept. The five losses reported on #664 (footnote
      // definitions, fence meta, link titles, reference definitions, indented code)
      // are all parser- or attribute-level and are NOT fixed by this branch — see the
      // issue. This branch is what stops a future Markdoc node type from being deleted
      // on first save rather than surfacing as a visible passthrough.
      out.push({
        type: 'passthrough',
        attrs: { raw: slice(startOf(i), startOf(i + 1)), flagged: false }
      })
    }
    i++
  }
  return { type: 'doc', content: out }
}
