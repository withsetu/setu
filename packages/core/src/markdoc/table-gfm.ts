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
 *  escape here — `buildInline('inline')` applies exactly that contract, and it also
 *  escapes a `{%` in literal text so a cell's prose can never masquerade as a Markdoc
 *  tag. Deliberately routes paragraphs through `buildInline` rather than `serializeBlock`
 *  so a cell-nested paragraph's `textAlign` never emits an `{% align %}` annotation into
 *  the cell (see `withAlign`) — whole-column alignment is the header's job. */
function inlineToCell(content: TiptapNode[]): string {
  const inline = buildInline(content, 'inline')
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
 *  becomes an inline image; the body-bearing tag wrappers are unwrapped (see
 *  CELL_UNWRAP). Everything else — lists, code, blockquotes, thematic rules — is reused
 *  verbatim from `serializeBlock`, whose text already carries the inline escaping, so a
 *  literal `-`/`#`/`{%` in it re-reads as itself. */
function cellFragments(nodes: TiptapNode[]): string[] {
  return nodes.flatMap((n) => {
    if (n.type === 'paragraph') return [inlineToCell(n.content ?? [])]
    if (n.type === 'imageBlock') return [inlineToCell([inlineImageNode(n)])]
    if (n.type === 'codeBlock') return [inlineToCell(codeInlineNodes(n))]
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
