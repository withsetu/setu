import Markdoc from '@markdoc/markdoc'
import type { TiptapDoc, TiptapMark, TiptapNode } from './types'
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

/** Marks that nest INSIDE any tag mark, in `Markdoc.format`'s own vocabulary. */
const NATIVE_MARKS = new Set(['bold', 'italic', 'strike', 'link'])

/** Marks serialized as an inline Markdoc tag ({% sub %} / {% sup %}). */
const TAG_MARKS = new Set(['subscript', 'superscript'])

/** Does this run END a line, so that the NEXT run begins at column 0? A soft break
 *  is a `\n` inside a text node (#667) and a hard break is its own node; either way
 *  the run after it is at a block start and its leading `#`/`>`/`-`/`1.` is a live
 *  block marker. The line-start rule cannot be answered inside `escapeText` alone,
 *  because the break and the marker routinely sit in DIFFERENT runs — `*a*\n# b` is
 *  three of them. */
const endsLine = (t: TiptapNode | undefined): boolean =>
  t?.type === 'hardBreak' ||
  (t?.type === 'text' && (t.text ?? '').endsWith('\n'))

/** One serialized inline run, plus the marks still to be wrapped around it,
 *  OUTERMOST first. Splitting "render the leaf" from "wrap the marks" is what
 *  lets adjacent runs share a delimiter pair (#693) — the leaf keeps its own
 *  position-dependent escaping, which depends on its index in the ORIGINAL run
 *  list and so cannot be recomputed after grouping. */
interface InlineRun {
  node: InstanceType<typeof N>
  marks: TiptapMark[]
}

/** Whether two marks open the same construct, and so may share one delimiter
 *  pair across adjacent runs. `link` is the only one with a distinguishing
 *  attribute: two neighbouring links to different hrefs must stay separate. */
const sameMark = (a: TiptapMark, b: TiptapMark): boolean =>
  a.type === b.type &&
  (a.type !== 'link' || a.attrs?.['href'] === b.attrs?.['href'])

function wrapMark(
  m: TiptapMark,
  children: InstanceType<typeof N>[]
): InstanceType<typeof N> {
  switch (m.type) {
    case 'bold':
      return new N('strong', { marker: '**' }, children)
    case 'italic':
      return new N('em', { marker: '*' }, children)
    case 'strike':
      return new N('s', {}, children)
    case 'link':
      return new N('link', { href: m.attrs?.['href'] }, children)
    default: {
      const tag = new N(
        'tag',
        {},
        children,
        m.type === 'subscript' ? 'sub' : 'sup'
      )
      tag.inline = true
      return tag
    }
  }
}

/** Wrap `runs` in their marks, merging each MAXIMAL group of adjacent runs that
 *  share the mark at this depth so it emits ONE delimiter pair.
 *
 *  #693: the previous version wrapped every run individually, so `*a `b` c*` —
 *  three runs that all carry `italic`, the middle one also carrying `code` (the
 *  model #653 established) — came out as `*a**`b`**c*`. The doubled `**` re-parses
 *  as a literal asterisk pair rather than emphasis, so the mark was lost, a stray
 *  `**` was rendered, and the next save escaped it: the file never converged.
 *
 *  Merging is the only sound repair. Marker alternation (`*` vs `_`) is only
 *  conditionally safe (`_` does not open emphasis intraword), and separating the
 *  runs with an HTML comment is not idempotent. */
function nestRuns(runs: InlineRun[], depth: number): InstanceType<typeof N>[] {
  const out: InstanceType<typeof N>[] = []
  let i = 0
  while (i < runs.length) {
    const mark = runs[i]!.marks[depth]
    if (!mark) {
      out.push(runs[i]!.node)
      i += 1
      continue
    }
    let end = i + 1
    while (end < runs.length) {
      const next = runs[end]!.marks[depth]
      if (!next || !sameMark(mark, next)) break
      end += 1
    }
    out.push(wrapMark(mark, nestRuns(runs.slice(i, end), depth + 1)))
    i = end
  }
  return out
}

export function buildInline(
  content: TiptapNode[] = [],
  /** Where this inline run sits, for the position-dependent escape rules:
   *  `block` = paragraph / list item (first characters are at a line start, so
   *  `#`, `>`, `-`, `1.` are block markers); `heading` = heading content (a
   *  TRAILING `#` run is the ATX closing sequence); `inline` = table cells and
   *  anything else, where no positional rule applies. See ./escape-inline. */
  context: 'block' | 'heading' | 'inline' = 'inline'
): InstanceType<typeof N>[] {
  const runs = content.map((t, index): InlineRun => {
    if (t.type === 'hardBreak') return { node: new N('hardbreak'), marks: [] }
    if (t.type === 'image') {
      const a = t.attrs ?? {}
      const attrs: Record<string, unknown> = {
        src: a.src ?? '',
        alt: a.alt ?? ''
      }
      if (a.title != null && a.title !== '') attrs.title = a.title
      return { node: new N('image', attrs), marks: [] }
    }
    const marks = t.marks ?? []
    const text = t.text ?? ''

    // Autolink: exactly one link mark whose href is the visible text.
    const soleLink = marks.length === 1 && marks[0]!.type === 'link'
    if (soleLink) {
      const href = (marks[0]!.attrs as Record<string, unknown>)?.['href']
      if (href === text && AUTOLINK_SCHEME.test(text))
        return { node: rawText(`<${text}>`), marks: [] }
    }

    // #665: an unrecognized mark used to be dropped without a sound, so schema/
    // serializer drift silently ate formatting. Fail loudly instead — same posture
    // as the setuBlock missing-tag throw below.
    for (const m of marks) {
      if (!SERIALIZED_MARKS.has(m.type) && !UNPERSISTED_MARKS.has(m.type)) {
        throw new Error(
          `tiptapToMarkdoc: unrecognized mark type "${m.type}" — add a case in buildInline, or add it to UNPERSISTED_MARKS if it is deliberately not persisted`
        )
      }
    }

    // A `code` mark becomes the INNERMOST node, whatever its position in the mark
    // array. Markdoc's `code` node renders from its `content` attribute and ignores
    // its children, so it can only ever be a leaf. It previously ASSIGNED `n` inside
    // the mark loop instead of wrapping (#653) — and to-tiptap emits `code` last, so
    // the link/bold/italic/strike built before it was silently discarded:
    // [`api`](https://example.com) collapsed to `api`, losing the href entirely.
    const hasCode = marks.some((m) => m.type === 'code')
    // A code span's content is literal — backslash-escaping it would corrupt it.
    // The fence width carries the ambiguity instead (#677); `Markdoc.format`'s
    // own `code` case hard-codes a single backtick, so it is bypassed here.
    // A positional rule only binds when nothing else occupies that position:
    // a leading `**`/`[` from a mark, or a preceding sibling run, displaces it.
    const bare = marks.length === 0
    const node = hasCode
      ? rawText(codeSpan(text))
      : rawText(
          escapeText(text, {
            // Offset 0 of the block keeps the original rule (a mark's own opening
            // delimiter displaces the marker). A run that FOLLOWS a break is at a
            // line start regardless of its marks: the delimiter that opened them
            // sits on the previous line, so it displaces nothing here. Escaping is
            // idempotent, so erring towards an extra backslash is safe; erring the
            // other way splits the block (#667).
            atBlockStart:
              index === 0
                ? context === 'block' && bare
                : endsLine(content[index - 1]),
            atHeadingEnd:
              context === 'heading' && index === content.length - 1 && bare
          })
        )

    // `to-tiptap` appends marks as it DESCENDS, so the array is already ordered
    // outermost-first — which is the order `nestRuns` needs. Tag marks are hoisted
    // outside every native mark regardless: {% sub %}**b**{% /sub %} rather than
    // **{% sub %}b{% /sub %}**, which Markdoc.format cannot render cleanly across
    // inline tag boundaries. `code` is excluded — it is the leaf, built above.
    return {
      node,
      marks: [
        ...marks.filter((m) => TAG_MARKS.has(m.type)),
        ...marks.filter((m) => NATIVE_MARKS.has(m.type))
      ]
    }
  })
  return nestRuns(runs, 0)
}

/** Where a block sits relative to the start of a line, for the position-dependent
 *  escape rules in ./escape-inline.
 *
 *  `block-start` — the block's own first character is the first character of its
 *    line, so a leading `#`, `>`, `-`, `+` or `1.` would parse as a block marker
 *    and must be escaped. This is the case for every top-level block, for a
 *    blockquote's or tag body's children, for a plain bullet's first paragraph,
 *    AND for a list item's SECOND paragraph or any nested block — those sit on
 *    their own indented line, where `# x` really is a heading.
 *  `after-inline-marker` — the block's text is emitted on the same line AFTER
 *    something else, so no block marker can start there. Today that is exactly a
 *    task item's first paragraph, which follows the `[x] ` / `[ ] ` marker.
 *    Escaping there would be spurious churn: `- [x] # a` re-reads as the literal
 *    text `# a` with no escape needed, so adding one would rewrite existing files
 *    on their next save. */
type BlockPosition = 'block-start' | 'after-inline-marker'

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

function buildBlock(
  node: TiptapNode,
  /** Position of THIS node only — it governs the node's own inline content and is
   *  never inherited by children, which always start their own line. */
  position: BlockPosition = 'block-start'
): InstanceType<typeof N> {
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
          new N(
            'inline',
            {},
            buildInline(
              node.content,
              position === 'block-start' ? 'block' : 'inline'
            )
          )
        ]),
        node
      )
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
        (node.content ?? []).map((c) => buildBlock(c)),
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
        (node.content ?? []).map((c) => buildBlock(c)),
        tag
      )
    }
    case 'columns':
    case 'column':
      return new N(
        'tag',
        (attrs['mdAttrs'] ?? {}) as Record<string, unknown>,
        (node.content ?? []).map((c) => buildBlock(c)),
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

const formatNative = (
  node: TiptapNode,
  position: BlockPosition = 'block-start'
): string =>
  Markdoc.format(new N('document', {}, [buildBlock(node, position)])).replace(
    /\n+$/,
    ''
  )

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
  const body = (node.content ?? []).map((c) => serializeBlock(c)).join('\n\n')
  return `${openTagFor(tag, mdAttrs)}\n${body}\n{% /${tag} %}`
}

/** Serialize a blockquote at the string level so its children reuse the same
 *  per-type serializers as everywhere else. Previously the blockquote arm of
 *  buildBlock recursed with `buildBlock`, which has no case for the string-only
 *  types (`table`, `imageBlock`, `passthrough`) — all of them `group: 'block'` and
 *  so schema-valid inside a blockquote. They hit the default arm and were destroyed
 *  ("> > \n> > \n"). Byte-identical to Markdoc.format for prose-only blockquotes. */
function blockquoteToMarkdoc(node: TiptapNode): string {
  const body = (node.content ?? []).map((c) => serializeBlock(c)).join('\n\n')
  return body
    .split('\n')
    .map((line) => (line === '' ? '> ' : `> ${line}`))
    .join('\n')
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/** A line CommonMark reads as a THEMATIC BREAK: three or more of `-`, `*` or `_`,
 *  all the same character, spaces and tabs allowed between them and after. */
const THEMATIC_BREAK_LINE =
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/

/** #725. Does the marker line — the item's `- `/`1. `/`- [x] ` prefix followed by
 *  the first line of its first child — still OPEN A LIST ITEM, or do the two fuse
 *  into a different block?
 *
 *  Thematic-break recognition runs BEFORE list-item recognition, and it is the one
 *  rule that can see through a bullet marker: `- ` + `---` is the line `- ---`,
 *  which is four `-` separated by a space, i.e. a thematic break. Nothing else in
 *  CommonMark can fuse this way, because every other block opener is recognised
 *  only after the marker has been consumed. */
const fusesWithMarkerLine = (prefix: string, block: string): boolean =>
  THEMATIC_BREAK_LINE.test(prefix + (block.split('\n')[0] ?? ''))

/** Equivalent spellings of a block, tried in order when its canonical one fuses
 *  with the marker. A thematic break has three interchangeable spellings and only
 *  the one sharing the marker's character can fuse, so an alternative always
 *  exists — but this is keyed by node type so the repair generalises rather than
 *  hard-coding a second special case next to #711's. */
const MARKER_LINE_RESPELLINGS: Record<string, string[]> = {
  horizontalRule: ['***', '___']
}

/** Serialize a list at the string level so its items' children reuse the same
 *  per-type serializers as everywhere else.
 *
 *  #658: `buildListItem` kept ONLY `children.find(c => c.type === 'paragraph')` —
 *  the first paragraph — plus nested lists. The Tiptap `listItem` schema is
 *  `paragraph block*`, so a second paragraph, a table, an image or a code block is
 *  schema-valid inside an item and reachable by a single paste; every one of them
 *  was dropped on save without a word. Folding ALL children through `serializeBlock`
 *  also fixes the same class the blockquote half hit: `table`/`imageBlock`/
 *  `passthrough` have string-only serializers with no faithful Markdoc AST form.
 *
 *  Output is byte-identical to what `Markdoc.format` produced for the ordinary
 *  shapes (tight items, nested lists, task markers) — see the byte-stability test —
 *  so existing files are not rewritten on their next save. */
function listToMarkdoc(node: TiptapNode): string {
  const marker = node.type === 'orderedList' ? '1.' : '-'
  const indent = ' '.repeat(marker.length + 1)
  const task = node.type === 'taskList'
  return (node.content ?? [])
    .map((item) => listItemToMarkdoc(item, marker, indent, task))
    .join('\n')
}

function listItemToMarkdoc(
  item: TiptapNode,
  marker: string,
  indent: string,
  task: boolean
): string {
  const all = item.content ?? []
  // An item whose FIRST child is an empty paragraph but which carries further blocks
  // cannot be written with that paragraph: it would put a blank line immediately after
  // the marker, and CommonMark says an item beginning with a blank line is EMPTY — so
  // re-reading expelled every remaining child out of the list ("- #" round-tripped to
  // "-\n\n  # ", which re-read as a bare item plus a top-level heading). Dropping the
  // empty leading paragraph is lossless: `markdocToTiptap` re-inserts it, because the
  // Tiptap `listItem` schema is `paragraph block*` and so requires one.
  //
  // This shape is only reachable now that the two sides are merged: origin/main's
  // string-level item serializer (#658) is what emits multi-block items at all, and
  // this branch's widened property-test alphabet (#676) is what first generates a `#`
  // inside a bullet. Neither side could produce it alone.
  const children =
    all.length > 1 &&
    all[0]?.type === 'paragraph' &&
    (all[0].content ?? []).length === 0
      ? all.slice(1)
      : all
  // The position context the #652 escaping contract needs, threaded through the
  // #658 string-level structure: only a TASK item's first paragraph is displaced off
  // the line start (by the `[x] ` marker). A plain bullet's first paragraph, and every
  // later child of either kind of item, does begin its own line — so it keeps
  // `block-start` and a leading `#`/`>`/`-`/`1.` is still escaped.
  //
  // #711 — the regression, and the invariant that closes it. The marker-line paragraph
  // is identified by IDENTITY, never by index. Indexing `children` was the bug: once
  // the drop above could remove `all[0]`, "index 0" silently stopped meaning "the
  // paragraph on the marker line" and started meaning "whatever survived the drop".
  //
  // That matters because a task item's marker line already carries the `[x] ` checkbox,
  // which makes it INLINE content — only a paragraph can live there. A heading, table or
  // fence promoted onto it was emitted as `- [ ] # x`, which the reader flattens back to
  // literal paragraph text: the block was destroyed on save, and the file never settled.
  //
  // #725 corrects what this comment used to claim next — that "a bullet is immune: its
  // bare `- ` marker opens a fresh block context". That holds for every block opener
  // recognised AFTER the marker is consumed (`- # x` really is a heading inside the
  // item), and it is false for the one rule recognised BEFORE it: a thematic break.
  // `- ` + `---` is the line `- ---`, which is read as a thematic break, so the item
  // and everything after it left the list entirely. The marker line is therefore
  // guarded on BOTH sides below — the task rule here, the fusion rule after
  // serialization, where the child's actual first line is known.
  const markerParagraph =
    task && children[0]?.type === 'paragraph' ? children[0] : undefined
  const parts = children.map((child) => ({
    type: child.type,
    text: serializeBlock(
      child,
      child === markerParagraph ? 'after-inline-marker' : 'block-start'
    )
  }))
  // Nothing paragraph-shaped is available for the marker line, so leave it bare and let
  // every child begin an indented line of its own. `- [ ]` on its own line is still a
  // task marker to the reader, and — unlike the bullet case above — it is not a blank
  // line, so the following blocks stay inside the item instead of being expelled.
  const prefix = task
    ? `${marker} ${item.attrs?.['checked'] === true ? '[x] ' : '[ ] '}`
    : `${marker} `
  if (task && markerParagraph === undefined)
    parts.unshift({ type: 'paragraph', text: '' })
  // #725: the second half of the marker-line guard. Now that the first child's own
  // first line is known, reject the composition that fuses (see fusesWithMarkerLine)
  // and re-spell the block instead — `- ***` is the same thematic break and cannot
  // fuse with a `-` marker. Falling back to pushing the block off the marker line is
  // the same escape hatch the task branch above uses; it is unreachable today because
  // a thematic break is the only fusing block and it always has a spelling left.
  const first = parts[0]
  if (first && fusesWithMarkerLine(prefix, first.text)) {
    const alt = (MARKER_LINE_RESPELLINGS[first.type] ?? []).find(
      (spelling) => !fusesWithMarkerLine(prefix, spelling)
    )
    if (alt !== undefined) first.text = alt
    else parts.unshift({ type: 'paragraph', text: '' })
  }
  // A nested list hugs its parent item (no blank line) — that is what Markdoc.format
  // emitted. Any other block is separated by a blank line, which is what makes a
  // multi-block item parse back as belonging to the item rather than ending it.
  const body = parts
    .map(({ type, text }, i) => {
      if (i === 0) return text
      const sep = LIST_TYPES.has(type) ? '\n' : '\n\n'
      return sep + text
    })
    .join('')
  // Blank lines stay blank (never indent-only), and an empty item is just its marker.
  // Deliberately NOT a blanket trailing-space strip: that would edit the contents of
  // a fenced code block inside the item, which is the very loss this fixes.
  return body
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line === '' ? prefix.trimEnd() : prefix + line
      return line === '' ? '' : indent + line
    })
    .join('\n')
}

/** Serialize one block node to Markdoc source. Used for top-level blocks AND,
 *  recursively, for the children of body-bearing tags. */
function serializeBlock(
  node: TiptapNode,
  position: BlockPosition = 'block-start'
): string {
  if (LIST_TYPES.has(node.type)) return listToMarkdoc(node)
  if (node.type === 'blockquote') return blockquoteToMarkdoc(node)
  if (node.type === 'passthrough') {
    const raw = node.attrs?.['raw']
    return typeof raw === 'string' ? raw : ''
  }
  if (node.type === 'table') return tableToGfm(node)
  if (node.type === 'imageBlock') return imageBlockToMarkdoc(node)
  const tagOf = TAG_NODE_TYPES[node.type]
  if (tagOf) return tagBlockToMarkdoc(tagOf(node), node)
  // Only the native path carries inline text of its own; every branch above either
  // has no inline content or opens a line of its own, so `position` cannot bind there.
  return formatNative(node, position)
}

export function tiptapToMarkdoc(doc: TiptapDoc): string {
  // Single decode point for the escaping contract: every inline text node was
  // handed to Markdoc pre-escaped and sentinel-protected (see ./escape-inline),
  // and this is where the protection comes back off.
  return decodeProtected(
    doc.content.map((c) => serializeBlock(c)).join('\n\n') + '\n'
  )
}
