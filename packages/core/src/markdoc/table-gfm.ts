import Markdoc from '@markdoc/markdoc'
import type { TiptapNode } from './types'
import { buildInline, serializeBlock } from './to-markdoc'

const N = Markdoc.Ast.Node
type Align = 'left' | 'center' | 'right' | null
const SEP: Record<string, string> = { left: ':--', center: ':-:', right: '--:' }

const alignOf = (cell: TiptapNode): Align =>
  (cell.attrs?.['align'] as Align) ?? null

/** Body-bearing tag blocks whose `{% tag %}…{% /tag %}` WRAPPER cannot survive in a
 *  GFM cell — a cell is inline-only, so Markdoc re-parses the opener as an INLINE tag
 *  and `to-tiptap` drops every inline tag that is not `sub`/`sup`, taking the body with
 *  it. Their CHILDREN can survive, so they are folded in place (the wrapper is the only
 *  thing lost, which GFM genuinely cannot represent). A block image is handled
 *  separately (mapped to an inline image); childless atom tags ({% hero /%}, …) have no
 *  inline form at all and are the one shape a cell still cannot hold. */
const CELL_UNWRAP = new Set(['callout', 'columns', 'column', 'setuBlock'])

/** Format a run of inline nodes as an escaped GFM cell fragment — the ORIGINAL
 *  single-paragraph path, kept byte-identical so existing tables are never rewritten.
 *
 *  Cell content is NOT at a block start (a `| ` precedes it), so `#`/`>`/`-` need no
 *  escape here — `buildInline('cell')` applies exactly that contract, and it also
 *  escapes a `{%` in literal text so a cell's prose can never masquerade as a Markdoc
 *  tag. Deliberately routes paragraphs through `buildInline` rather than `serializeBlock`
 *  so a cell-nested paragraph's `textAlign` never emits an `{% align %}` annotation into
 *  the cell (see `withAlign`) — whole-column alignment is the header's job.
 *
 *  #772: `'cell'`, not `'inline'`. They differ only AFTER a hard break, and that is
 *  exactly where the churn lived: `'inline'` treats a run following a break as being at
 *  a line start (true of a paragraph, whose break is a real newline) and escaped the
 *  `-`/`1.`/`#`/`>`/`---` that the fold had just written unescaped one save earlier. A
 *  cell's breaks are `<br>` HTML on one physical line, so nothing in it is ever at a
 *  block start. */
function inlineToCell(content: TiptapNode[]): string {
  const inline = buildInline(content, 'cell')
  return Markdoc.format(
    new N('paragraph', {}, [new N('inline', {}, inline)])
  ).replace(/\n+$/, '')
}

/** A fenced code block cannot survive in a cell as a fence — the ``` backticks re-parse
 *  as inline code-span delimiters. Its lines become inline `code`-marked runs instead,
 *  one per line separated by a `hardBreak` (rendered as `<br>`); `codeSpan` widens the
 *  fence around any literal backtick, so this round-trips. The info string (language) has
 *  no inline form and is dropped — the CONTENT, which is what was being lost, survives. */
function codeInlineNodes(node: TiptapNode): TiptapNode[] {
  const text = node.content?.[0]?.text ?? ''
  const out: TiptapNode[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ type: 'hardBreak' })
    if (line !== '')
      out.push({ type: 'text', text: line, marks: [{ type: 'code' }] })
  })
  return out
}

/** An `imageBlock` (a block-level {% image /%}) has no place in an inline-only GFM cell,
 *  but an INLINE image does — and it is the faithful, round-trip-stable representation:
 *  `to-tiptap` reads `![alt](src)` back as an inline `image`, whose next save reproduces
 *  it byte-for-byte. Carries src/alt/title across; drops the block-only extras. */
function inlineImageNode(node: TiptapNode): TiptapNode {
  const md = (node.attrs?.['mdAttrs'] ?? {}) as Record<string, unknown>
  const attrs: Record<string, unknown> = {
    src: md['src'] ?? '',
    alt: md['alt'] ?? ''
  }
  if (md['title'] != null && md['title'] !== '') attrs['title'] = md['title']
  return { type: 'image', attrs }
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

/** The cell spelling of a list marker. Always the FIRST marker of the family —
 *  `serializeSiblings`' alternation (#694) exists so two adjacent lists cannot merge
 *  on the next read, and inside a cell there are no lists to merge: the whole thing
 *  is flattened to literal text. Using `*` here would only add a backslash. */
const listMarker = (list: TiptapNode, item: TiptapNode): string => {
  if (list.type === 'orderedList') return '1. '
  if (list.type !== 'taskList') return '- '
  return item.attrs?.['checked'] === true ? '- [x] ' : '- [ ] '
}

/** Fold a list into the cell's inline form: the marker as LITERAL TEXT, then the
 *  item's own content, one `hardBreak` between items.
 *
 *  #772 — why this exists rather than `serializeBlock(list)`. A GFM cell is inline-only,
 *  so a folded list's `- ` / `1. ` / `- [x] ` markers are not markers on the way back in;
 *  the reader sees them as ordinary cell text. `serializeBlock` emits them as STRUCTURE,
 *  unescaped, so the next save escaped them as the text they had become (`- \[x\] done`)
 *  and the file changed on a save that changed no content. Building the marker as a text
 *  node instead hands it to the SAME escaper the reader's round trip will use, so the
 *  first write is already the fixed point. (`-` and `1.` need no escape in a cell; the
 *  task marker's `[`/`]` do, and now get it on write one.) */
function listCellInline(node: TiptapNode, depth: number): TiptapNode[] {
  const out: TiptapNode[] = []
  ;(node.content ?? []).forEach((item) => {
    if (out.length > 0) out.push({ type: 'hardBreak' })
    out.push({
      type: 'text',
      text: '    '.repeat(depth) + listMarker(node, item)
    })
    ;(item.content ?? []).forEach((child, j) => {
      if (j > 0) out.push({ type: 'hardBreak' })
      out.push(...blockCellInline(child, depth + 1))
    })
  })
  return out
}

/** One block's inline form inside a cell. Anything without one keeps the existing
 *  `serializeBlock` path via `cellFragments`; here it can only be reached as a list
 *  item's child, where it is wrapped in a text node so the escaper still owns it. */
function blockCellInline(node: TiptapNode, depth: number): TiptapNode[] {
  if (node.type === 'paragraph') return node.content ?? []
  if (node.type === 'imageBlock') return [inlineImageNode(node)]
  if (node.type === 'codeBlock') return codeInlineNodes(node)
  if (LIST_TYPES.has(node.type)) return listCellInline(node, depth)
  return [{ type: 'text', text: serializeBlock(node) }]
}

/** Fold a table cell's block children into inline-safe GFM fragments — one per line,
 *  `<br>`-joined by `cellToGfm`.
 *
 *  #752 — the #658 defect, in the OTHER string-only serializer. `cellToGfm` kept only
 *  `content.find(c => c.type === 'paragraph')` — the FIRST paragraph — and dropped every
 *  other block. `@tiptap/extension-table` declares a cell as `block+`, so a second
 *  paragraph (press Enter), a list, an image or a code block (slash-insert / paste) is
 *  schema-valid and was destroyed on save without a word. Folding ALL children through
 *  the SAME per-type serializers (`serializeBlock`) is the fix; a GFM cell is inline-only
 *  so the block STRUCTURE (list markers, a fence) flattens to text, but nothing is lost.
 *
 *  Paragraphs use the inline path (byte-identity + no `{% align %}` leak); a block image
 *  becomes an inline image; a code block becomes code spans; lists are flattened to their
 *  literal marker text (#772, see `listCellInline`); the body-bearing tag wrappers are
 *  unwrapped (see CELL_UNWRAP). Everything else — blockquotes, headings, thematic rules,
 *  nested tables — is reused verbatim from `serializeBlock`, whose text already carries
 *  the inline escaping, so a literal `-`/`#`/`{%` in it re-reads as itself; their leading
 *  markers need no escape either, because a cell has no block start (#772). */
function cellFragments(nodes: TiptapNode[]): string[] {
  return nodes.flatMap((n) => {
    if (n.type === 'paragraph') return [inlineToCell(n.content ?? [])]
    if (n.type === 'imageBlock') return [inlineToCell([inlineImageNode(n)])]
    if (n.type === 'codeBlock') return [inlineToCell(codeInlineNodes(n))]
    // #772: a list's markers are literal text once folded — build them as text so the
    // escaper, not `Markdoc.format`'s list structure, decides their bytes.
    if (LIST_TYPES.has(n.type)) return [inlineToCell(listCellInline(n, 0))]
    if (CELL_UNWRAP.has(n.type)) return cellFragments(n.content ?? [])
    return [serializeBlock(n)]
  })
}

/** Serialize a Tiptap table cell to an escaped GFM table-cell string. Folds EVERY block
 *  child (#752), flattening the newlines a multi-block cell produces to `<br>`. The `|`
 *  is escaped because GFM splits rows on pipes BEFORE inline parsing (which is also why
 *  it must be escaped inside code spans). This used to additionally double every
 *  backslash (`\\` -> `\\\\`), compensating for Markdoc.format never escaping backslashes;
 *  now that `escapeText` emits `\\` for a literal backslash, doubling would corrupt every
 *  escape in a cell. */
function cellToGfm(cell: TiptapNode): string {
  return (
    cellFragments(cell.content ?? [])
      .join('\n')
      .replace(/\|/g, '\\|')
      // Every newline a folded cell holds becomes a `<br>`: the plain `\n` between
      // fragments AND the `\<newline>` that `Markdoc.format` emits for a `hardBreak`
      // inside a paragraph (which the reader restores from a `<br>`, closing the loop).
      // Consuming that leading backslash is what makes a hard break re-read as `<br>`
      // rather than the site-visible literal `\<br>`.
      .replace(/\\?\n/g, '<br>')
  )
}

/** Serialize a Tiptap `table` node to a GFM pipe table: header row, alignment separator
 *  (per column, from the header cells' `align`), then body rows. No trailing newline
 *  (tiptapToMarkdoc joins blocks and adds the final newline). Pure. */
export function tableToGfm(node: TiptapNode): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const headerCells = rows[0]!.content ?? []
  const cols = headerCells.length
  const aligns: Align[] = headerCells.map(alignOf)

  const renderRow = (row: TiptapNode): string => {
    const cells = row.content ?? []
    const out: string[] = []
    for (let i = 0; i < cols; i++)
      out.push(cells[i] ? cellToGfm(cells[i]!) : '')
    return '| ' + out.join(' | ') + ' |'
  }
  const sep = '| ' + aligns.map((a) => (a ? SEP[a]! : '---')).join(' | ') + ' |'
  return [renderRow(rows[0]!), sep, ...rows.slice(1).map(renderRow)].join('\n')
}
