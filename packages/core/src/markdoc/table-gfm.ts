import Markdoc from '@markdoc/markdoc'
import type { TiptapNode } from './types'
import { buildInline } from './to-markdoc'

const N = Markdoc.Ast.Node
type Align = 'left' | 'center' | 'right' | null
const SEP: Record<string, string> = { left: ':--', center: ':-:', right: '--:' }

const alignOf = (cell: TiptapNode): Align =>
  (cell.attrs?.['align'] as Align) ?? null

/** Render a Tiptap table cell's first paragraph to an escaped GFM table-cell string.
 *  Reuses buildInline + Markdoc to format inline marks, then escapes for a pipe cell.
 *
 *  Cell content is NOT at a block start (a `| ` precedes it), so `#`/`>`/`-` need
 *  no escape here. `buildInline` has already applied the inline escaping contract
 *  (see ./escape-inline), so the only thing left is the cell delimiter: `|` has to
 *  be escaped because GFM splits rows on pipes BEFORE inline parsing, which is also
 *  why it must be escaped inside code spans. This used to additionally double every
 *  backslash (`\\` -> `\\\\`), which was compensating for Markdoc.format never
 *  escaping backslashes at all; now that `escapeText` emits `\\` for a literal
 *  backslash, doubling here would corrupt every escape in a cell. */
function cellToGfm(cell: TiptapNode): string {
  const para = (cell.content ?? []).find((c) => c.type === 'paragraph')
  const inline = buildInline(para?.content ?? [], 'inline')
  const md = Markdoc.format(
    new N('paragraph', {}, [new N('inline', {}, inline)])
  ).replace(/\n+$/, '')
  return md.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
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
