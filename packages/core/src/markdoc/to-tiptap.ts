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
    case 'tag': {
      if (node.tag === 'sub')
        return kids.flatMap((c) =>
          inlineToTiptap(c, withMark(marks, { type: 'subscript' }))
        )
      if (node.tag === 'sup')
        return kids.flatMap((c) =>
          inlineToTiptap(c, withMark(marks, { type: 'superscript' }))
        )
      return []
    }
    default:
      return []
  }
}

const collectInline = (node: MdNode): TiptapNode[] =>
  (node.children ?? []).flatMap((c) => inlineToTiptap(c))

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
 *  code span alone (`markdoc.config.mjs`; its payload is an attribute with no children
 *  to split). This is the reader agreeing with both. */
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
      const content = [paragraph, ...rest]
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
    case 'paragraph':
      return {
        type: 'paragraph',
        ...(isAligned(node) ? { attrs: alignAttr(node) } : {}),
        content: collectInline(node)
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
      if (tag === 'image') {
        return { type: 'imageBlock', attrs: { mdAttrs: node.attributes } }
      }
      // Childless atom blocks ({% hero %} → heroBlock, …) are driven by the shared
      // ATOM_TAG_TO_NODE map (see ./atom-blocks) so this direction and to-markdoc can't drift.
      const atomNode = ATOM_TAG_TO_NODE[tag]
      if (atomNode) {
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
  const isPreserve = (node: MdNode): boolean =>
    hasError(node) || (node.type === 'tag' && !known.has(node.tag ?? ''))

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
