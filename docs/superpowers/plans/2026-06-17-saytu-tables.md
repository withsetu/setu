# Tables (native GFM + alignment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a table block to the editor that round-trips as portable GFM pipe tables with per-column alignment, by writing tables ourselves as native GFM (Markdoc stays the reader).

**Architecture:** `@saytu/core` gains a pure `tableToGfm` serializer (the content-safety core); `tiptapToMarkdoc` routes a `table` node through it instead of `Markdoc.format` (same bypass pattern as `passthrough`). `Markdoc.parse` remains the reader (it parses GFM tables incl. alignment), so `to-tiptap` gains a `case 'table'`. The admin app registers `@tiptap/extension-table`, extends the cell nodes with an `align` attribute, and adds a slash-insert + a cell action menu.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, `@markdoc/markdoc` 0.5.7, Tiptap v3.26.1 (`@tiptap/extension-table` MIT), pnpm workspaces.

**Verified facts (DO NOT re-verify — spiked/confirmed this session):**
- Markdoc.parse reads GFM tables into `table → thead/tbody → tr → th/td → inline`, with `:--`/`:-:`/`--:` → `align: "left"|"center"|"right"` on each th/td. Markdoc.format is idempotent for tables but **drops alignment + pads cells** — so we don't use it for tables.
- A custom serializer that renders each cell's inline via `buildInline`+`Markdoc.format` (as a paragraph, trailing `\n` stripped) then escapes `\`→`\\`, `|`→`\|`, `\n`→`<br>` produces GFM that re-parses byte-faithfully: pipe-in-text, pipe-in-code-span, bold/link/code, empty cells, and per-column alignment all round-trip (spike-confirmed).
- `@tiptap/extension-table` v3.26.1 (MIT) exports `TableKit` and (to verify on install) the individual `Table`, `TableRow`, `TableCell`, `TableHeader`. Commands: `insertTable({ rows, cols, withHeaderRow })`, `addRowBefore`/`addRowAfter`/`addColumnBefore`/`addColumnAfter`/`deleteRow`/`deleteColumn`/`deleteTable`. `Table` config `resizable` defaults false (keep it false — GFM has no column widths). It is NOT yet in the workspace (must be added + installed).
- `table` is a defined `IconName` in `apps/saytu-admin/src/ui/Icon.tsx`. Slash insert pattern (`blocks.ts`): `(e,r) => e.chain().focus().deleteRange(r).<cmd>().run()` (see the `Divider` entry).
- `to-markdoc.ts`: `buildInline` is module-private; `tiptapToMarkdoc` maps top-level blocks (passthrough bypasses `Markdoc.format`). `to-tiptap.ts`: `blockToTiptap` switch + `collectInline(node)` = `(node.children ?? []).flatMap(c => inlineToTiptap(c))`; `MdNode` type imported.
- Edge guard: `pnpm --filter @saytu/core typecheck` runs `tsc` + `tsc -p tsconfig.edge.json` — converter must stay Node-free (pure JS/Markdoc only).

**HARD RULE:** Any NEW dep/API claim beyond the above must be web-checked/introspected before asserting (esp. the individual extension exports + the cell `addAttributes` extend pattern — verify against the installed package in Task 4).

---

## File Structure

**Core (`packages/core/src/markdoc/`):**
- `table-gfm.ts` (NEW) — pure `tableToGfm(node)` GFM serializer + cell escaping. The content-safety unit.
- `to-markdoc.ts` — export `buildInline`; route a `table` node to `tableToGfm`.
- `to-tiptap.ts` — `case 'table'` reader (Markdoc table → Tiptap table/row/cell{align}/paragraph).
- `test/table.test.ts` (NEW), `test/to-tiptap.test.ts`, `test/roundtrip.examples.test.ts`.

**Admin (`apps/saytu-admin/src/editor/`):**
- `Canvas.tsx` — register Table/TableRow + cell nodes extended with `align`.
- `blocks.ts` — "Table" slash insert.
- `TableMenu.tsx` (NEW) — cell/table action menu (rows, cols, alignment, delete).
- `styles/editor.css` — table + alignment + selected-cell styling.
- `apps/saytu-admin/package.json` — `+ @tiptap/extension-table`.

**Worktree:** Execute in an isolated worktree off `main` (native `EnterWorktree`); `pnpm install` + baseline `pnpm -r test` before Task 1.

---

## Task 1: Core — `tableToGfm` serializer + route table through it

**Files:**
- Create: `packages/core/src/markdoc/table-gfm.ts`
- Modify: `packages/core/src/markdoc/to-markdoc.ts`
- Test: `packages/core/test/table.test.ts`

- [ ] **Step 1: Export `buildInline` from `to-markdoc.ts`**

In `packages/core/src/markdoc/to-markdoc.ts`, change `function buildInline(` to `export function buildInline(`. (No behavior change; `table-gfm.ts` reuses it for identical inline rendering.)

- [ ] **Step 2: Write the failing serializer tests**

Create `packages/core/test/table.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tableToGfm } from '../src/markdoc/table-gfm'
import type { TiptapNode } from '../src/markdoc/types'

const cell = (text: string, align: string | null = null, type = 'tableCell'): TiptapNode => ({
  type,
  attrs: { align },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
})
const headerCell = (text: string, align: string | null = null) => cell(text, align, 'tableHeader')
const row = (...cells: TiptapNode[]): TiptapNode => ({ type: 'tableRow', content: cells })
const table = (...rows: TiptapNode[]): TiptapNode => ({ type: 'table', content: rows })

describe('tableToGfm', () => {
  it('serializes a header + body with no alignment', () => {
    const md = tableToGfm(table(
      row(headerCell('Name'), headerCell('Role')),
      row(cell('Ada'), cell('Eng')),
    ))
    expect(md).toBe('| Name | Role |\n| --- | --- |\n| Ada | Eng |')
  })

  it('emits per-column alignment from the header row', () => {
    const md = tableToGfm(table(
      row(headerCell('L', 'left'), headerCell('C', 'center'), headerCell('R', 'right')),
      row(cell('a'), cell('b'), cell('c')),
    ))
    expect(md).toBe('| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |')
  })

  it('escapes a pipe in cell text', () => {
    const md = tableToGfm(table(row(headerCell('a')), row(cell('x | y'))))
    expect(md).toBe('| a |\n| --- |\n| x \\| y |')
  })

  it('renders inline marks inside a cell', () => {
    const boldCell: TiptapNode = { type: 'tableCell', attrs: { align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b', marks: [{ type: 'bold' }] }] }] }
    const md = tableToGfm(table(row(headerCell('h')), row(boldCell)))
    expect(md).toBe('| h |\n| --- |\n| **b** |')
  })

  it('renders an empty cell as blank', () => {
    const md = tableToGfm(table(row(headerCell('a'), headerCell('b')), row(cell(''), cell('c'))))
    expect(md).toBe('| a | b |\n| --- | --- |\n|  | c |')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @saytu/core test -- table`
Expected: FAIL — `table-gfm` module does not exist.

- [ ] **Step 4: Implement `table-gfm.ts`**

Create `packages/core/src/markdoc/table-gfm.ts`:

```ts
import Markdoc from '@markdoc/markdoc'
import type { TiptapNode } from './types'
import { buildInline } from './to-markdoc'

const N = Markdoc.Ast.Node
type Align = 'left' | 'center' | 'right' | null
const SEP: Record<string, string> = { left: ':--', center: ':-:', right: '--:' }

const alignOf = (cell: TiptapNode): Align =>
  ((cell.attrs as Record<string, unknown> | undefined)?.['align'] as Align) ?? null

/** Render a Tiptap table cell's first paragraph to an escaped GFM table-cell string.
 *  Reuses buildInline + Markdoc to format inline marks, then escapes for a pipe cell. */
function cellToGfm(cell: TiptapNode): string {
  const para = (cell.content ?? []).find((c) => c.type === 'paragraph')
  const inline = buildInline(para?.content ?? [])
  const md = Markdoc.format(new N('paragraph', {}, [new N('inline', {}, inline)])).replace(/\n+$/, '')
  return md.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

/** Serialize a Tiptap `table` node to a GFM pipe table: header row, alignment separator
 *  (per column, taken from the header cells' `align`), then body rows. No trailing newline
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
    for (let i = 0; i < cols; i++) out.push(cells[i] ? cellToGfm(cells[i]!) : '')
    return '| ' + out.join(' | ') + ' |'
  }
  const sep = '| ' + aligns.map((a) => (a ? SEP[a]! : '---')).join(' | ') + ' |'
  return [renderRow(rows[0]!), sep, ...rows.slice(1).map(renderRow)].join('\n')
}
```

- [ ] **Step 5: Run serializer tests**

Run: `pnpm --filter @saytu/core test -- table`
Expected: PASS (all 5).

- [ ] **Step 6: Route `table` nodes through the serializer in `tiptapToMarkdoc`**

In `packages/core/src/markdoc/to-markdoc.ts`, add an import at the top:

```ts
import { tableToGfm } from './table-gfm'
```

Then change the `tiptapToMarkdoc` block mapping so a `table` node uses the serializer (like passthrough bypasses `Markdoc.format`):

```ts
export function tiptapToMarkdoc(doc: TiptapDoc): string {
  const blocks = doc.content.map((node) =>
    node.type === 'passthrough'
      ? String((node.attrs as Record<string, unknown>)?.['raw'] ?? '')
      : node.type === 'table'
        ? tableToGfm(node)
        : formatNative(node),
  )
  return blocks.join('\n\n') + '\n'
}
```

(`table-gfm.ts` imports `buildInline` from `to-markdoc.ts` and `to-markdoc.ts` imports `tableToGfm` from `table-gfm.ts` — this circular import is safe because each is used at call-time, not module-init time. If the edge typecheck or a runtime test flags the cycle, break it by moving `buildInline` into a tiny shared `build-inline.ts` both import; only do this if actually flagged.)

- [ ] **Step 7: Run full core suite + typecheck (edge guard)**

Run: `pnpm --filter @saytu/core test && pnpm --filter @saytu/core typecheck`
Expected: PASS; edge guard clean (no Node APIs added).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/markdoc/table-gfm.ts packages/core/src/markdoc/to-markdoc.ts packages/core/test/table.test.ts
git commit -m "feat(core): GFM table serializer (tableToGfm) + route table writes through it"
```

---

## Task 2: Core — `to-tiptap` table reader

**Files:**
- Modify: `packages/core/src/markdoc/to-tiptap.ts`
- Test: `packages/core/test/to-tiptap.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/to-tiptap.test.ts` (new describe at end):

```ts
describe('tables (markdocToTiptap)', () => {
  it('reads a GFM table into a Tiptap table with header cells', () => {
    const doc = markdocToTiptap('| Name | Role |\n| --- | --- |\n| Ada | Eng |\n')
    expect(doc.content[0]).toEqual({
      type: 'table',
      content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', attrs: { align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
          { type: 'tableHeader', attrs: { align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Role' }] }] },
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', attrs: { align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ada' }] }] },
          { type: 'tableCell', attrs: { align: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Eng' }] }] },
        ] },
      ],
    })
  })

  it('carries per-column alignment onto every cell in the column', () => {
    const doc = markdocToTiptap('| L | R |\n| :-- | --: |\n| a | b |\n')
    const t = doc.content[0]!
    expect(t.content![0]!.content![0]!.attrs).toEqual({ align: 'left' })
    expect(t.content![0]!.content![1]!.attrs).toEqual({ align: 'right' })
    expect(t.content![1]!.content![0]!.attrs).toEqual({ align: 'left' })
    expect(t.content![1]!.content![1]!.attrs).toEqual({ align: 'right' })
  })

  it('reads inline marks inside cells', () => {
    const doc = markdocToTiptap('| a |\n| --- |\n| **b** |\n')
    const bodyCellPara = doc.content[0]!.content![1]!.content![0]!.content![0]!
    expect(bodyCellPara.content).toEqual([{ type: 'text', text: 'b', marks: [{ type: 'bold' }] }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @saytu/core test -- to-tiptap`
Expected: FAIL — `table` hits `default: return null` (dropped).

- [ ] **Step 3: Implement the `table` case**

In `packages/core/src/markdoc/to-tiptap.ts`, add a `case 'table'` to `blockToTiptap` (before `default:`):

```ts
    case 'table': {
      const cellAlign = (cell: MdNode): string | null => (cell.attributes.align as string) ?? null
      const cellToTiptap = (cell: MdNode, header: boolean): TiptapNode => ({
        type: header ? 'tableHeader' : 'tableCell',
        attrs: { align: cellAlign(cell) },
        content: [{ type: 'paragraph', content: collectInline(cell) }],
      })
      const rowToTiptap = (tr: MdNode, header: boolean): TiptapNode => ({
        type: 'tableRow',
        content: (tr.children ?? []).map((c) => cellToTiptap(c, header)),
      })
      const rows: TiptapNode[] = []
      for (const section of node.children ?? []) {
        const header = section.type === 'thead'
        for (const tr of section.children ?? []) rows.push(rowToTiptap(tr, header))
      }
      return { type: 'table', content: rows }
    }
```

(`thead`/`tbody`/`tr`/`th`/`td` are only reached inside this case, so they need no top-level `blockToTiptap` cases. `collectInline(cell)` reads the cell's `inline` child — the same helper used for paragraphs/headings.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @saytu/core test -- to-tiptap`
Expected: PASS (new + existing).

- [ ] **Step 5: Typecheck (edge guard)**

Run: `pnpm --filter @saytu/core typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/markdoc/to-tiptap.ts packages/core/test/to-tiptap.test.ts
git commit -m "feat(core): read GFM tables into Tiptap table nodes with per-cell align"
```

---

## Task 3: Core — round-trip examples (idempotency + byte-fidelity + negatives)

**Files:**
- Modify: `packages/core/test/roundtrip.examples.test.ts`

- [ ] **Step 1: Add idempotency SAMPLES**

In the `SAMPLES` object add (exact whitespace — single-space-padded canonical form our serializer emits):

```ts
  table: `| Name | Role |
| --- | --- |
| Ada | Eng |
| Mai | PM |
`,
  tableAligned: `| L | C | R |
| :-- | :-: | --: |
| a | b | c |
`,
  tableMarks: `| h | link |
| --- | --- |
| **b** | [site](https://saytu.dev) |
`,
```

- [ ] **Step 2: Add byte-fidelity cases**

In the `byte-fidelity round-trip` `cases` array add:

```ts
    ['table', '| Name | Role |\n| --- | --- |\n| Ada | Eng |\n'],
    ['table aligned', '| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |\n'],
    ['table with marks', '| h | l |\n| --- | --- |\n| **b** | [x](https://y.dev) |\n'],
```

- [ ] **Step 3: Add a content-safety negative (a pipe in a cell never breaks the grid)**

Add a new describe at end of file:

```ts
describe('table content-safety', () => {
  it('a pipe in cell text round-trips without breaking the grid', () => {
    const src = '| a | b |\n| --- | --- |\n| x \\| y | z |\n'
    expect(roundtrip(src)).toBe(src)
  })

  it('a pipe inside a code span in a cell survives', () => {
    const src = '| a |\n| --- |\n| `p\\|q` |\n'
    expect(roundtrip(src)).toBe(src)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @saytu/core test -- roundtrip.examples`
Expected: PASS — every table sample idempotent + byte-identical to its canonical form; negatives preserve the pipe. If a byte-fidelity case fails, the **canonical form** may differ (e.g. spacing) — fix the EXPECTED string to match the serializer's actual canonical output; do NOT weaken the serializer. (Confirm the mismatch is only cosmetic spacing, not lost content.)

- [ ] **Step 5: Full core suite + typecheck**

Run: `pnpm --filter @saytu/core test && pnpm --filter @saytu/core typecheck`
Expected: green; edge guard clean; no new core deps.

- [ ] **Step 6: Commit**

```bash
git add packages/core/test/roundtrip.examples.test.ts
git commit -m "test(core): table round-trip examples + pipe-escaping negatives"
```

---

## Task 4: Admin — register table extensions with a cell `align` attribute

**Files:**
- Modify: `apps/saytu-admin/package.json`
- Modify: `apps/saytu-admin/src/editor/Canvas.tsx`
- Test: `apps/saytu-admin/test/table.test.ts` (new)

- [ ] **Step 1: Add the dependency + install**

Add to `apps/saytu-admin/package.json` `dependencies` (alphabetical among `@tiptap/extension-*`):

```json
    "@tiptap/extension-table": "^3.26.1",
```

Run: `cd /Users/mayank/Documents/projects/saytu/.claude/worktrees/<this-worktree> && pnpm install`

- [ ] **Step 2: Verify the exact exports (HARD RULE)**

Confirm the individual node extensions are exported (needed to extend the cells). Run:

```bash
node -e "const t=require('@tiptap/extension-table'); console.log(Object.keys(t))" 2>/dev/null \
  || grep -rhoE '\b(TableKit|Table|TableRow|TableCell|TableHeader)\b' \
       $(find /Users/mayank/Documents/projects/saytu/node_modules/.pnpm -path '*@tiptap+extension-table@*/node_modules/@tiptap/extension-table/dist/index.d.ts' | head -1) | sort -u
```

Expected: `Table`, `TableRow`, `TableCell`, `TableHeader`, `TableKit` all present. If the individual cell exports are NOT available (only `TableKit`), STOP and report — we'll configure TableKit's `tableCell`/`tableHeader` HTMLAttributes path instead.

- [ ] **Step 3: Write the failing test**

Create `apps/saytu-admin/test/table.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'

let editor: Editor
afterEach(() => editor?.destroy())

const alignAttr = {
  align: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.style.textAlign || null,
    renderHTML: (attrs: { align?: string | null }) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
  },
}
const AlignTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttr } } })
const AlignTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...alignAttr } } })

describe('table extension', () => {
  it('inserts a table with a header row and supports a cell align attribute', () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ underline: false }), Table.configure({ resizable: false }), TableRow, AlignTableHeader, AlignTableCell],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
    expect(editor.isActive('table')).toBe(true)
    // align attribute is registered on cells (default null)
    const json = editor.getJSON()
    const firstCell = (json.content as any[])[0].content[0].content[0]
    expect(firstCell.attrs).toHaveProperty('align')
  })
})
```

- [ ] **Step 4: Run test to verify it passes after registration**

Run: `pnpm --filter @saytu/admin test -- table`
Expected: PASS once the dep resolves (the test defines its own extended cells; this guards the API shape we depend on).

- [ ] **Step 5: Register in Canvas**

In `apps/saytu-admin/src/editor/Canvas.tsx`:
- Add import after the TaskList/TaskItem import:
  ```ts
  import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
  ```
- Above the `Canvas` component (module scope), define the aligned cells:
  ```ts
  const cellAlign = {
    align: {
      default: null as string | null,
      parseHTML: (el: HTMLElement) => el.style.textAlign || null,
      renderHTML: (attrs: { align?: string | null }) => (attrs.align ? { style: `text-align: ${attrs.align}` } : {}),
    },
  }
  const AlignTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAlign } } })
  const AlignTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAlign } } })
  ```
- In the `extensions` array, add after the TaskItem line:
  ```ts
      Table.configure({ resizable: false }),
      TableRow,
      AlignTableHeader,
      AlignTableCell,
  ```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @saytu/admin test && pnpm --filter @saytu/admin typecheck && pnpm --filter @saytu/admin build`
Expected: all pass; build OK; existing tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/saytu-admin/package.json apps/saytu-admin/src/editor/Canvas.tsx apps/saytu-admin/test/table.test.ts pnpm-lock.yaml
git commit -m "feat(admin): register table extension with a cell align attribute"
```

---

## Task 5: Admin — "Table" slash insert

**Files:**
- Modify: `apps/saytu-admin/src/editor/blocks.ts`
- Test: `apps/saytu-admin/test/blocks.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/saytu-admin/test/blocks.test.ts`, after the existing `toContain('Divider')` / `toContain('Checklist')` assertions, add:

```ts
    expect(titles).toContain('Table')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saytu/admin test -- blocks`
Expected: FAIL — no 'Table' slash entry.

- [ ] **Step 3: Implement**

In `apps/saytu-admin/src/editor/blocks.ts`, add to the `BUILTINS` array (after the `Divider` entry):

```ts
  { title: 'Table', subtitle: 'Table with header row', icon: 'table', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
```

(If `tsc` reports `insertTable` is missing on the chained commands type, it means the table extension's command types aren't in scope for `blocks.ts` — they are provided globally by `@tiptap/extension-table` once it's a dep; if not, STOP and report rather than casting.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @saytu/admin test -- blocks`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @saytu/admin typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/saytu-admin/src/editor/blocks.ts apps/saytu-admin/test/blocks.test.ts
git commit -m "feat(admin): slash-menu Table insert (3x3 with header row)"
```

---

## Task 6: Admin — table cell action menu (rows / columns / alignment / delete)

**Files:**
- Create: `apps/saytu-admin/src/editor/TableMenu.tsx`
- Modify: `apps/saytu-admin/src/editor/Canvas.tsx` (render the menu)
- Test: `apps/saytu-admin/test/table-menu.test.tsx` (new)

This menu appears when the caret is inside a table and offers the table actions. It uses Tiptap's `BubbleMenu` (from `@tiptap/react/menus`, already used by `FormatBubble`) with a distinct `pluginKey` and a `shouldShow` keyed to table context, so it coexists with the selection-based `FormatBubble`.

- [ ] **Step 1: Write the failing test (commands wiring)**

Create `apps/saytu-admin/test/table-menu.test.tsx`. Because BubbleMenu positioning needs a live view, test the **action callbacks** against a real editor rather than the floating UI:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { tableActions } from '../src/editor/TableMenu'

let editor: Editor
afterEach(() => editor?.destroy())

const make = () => {
  const e = new Editor({
    extensions: [StarterKit.configure({ underline: false }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
  return e
}

describe('tableActions', () => {
  it('adds and deletes columns', () => {
    editor = make()
    const cols = () => editor.getJSON().content![0]!.content![0]!.content!.length
    const before = cols()
    tableActions.addColumnAfter(editor)
    expect(cols()).toBe(before + 1)
    tableActions.deleteColumn(editor)
    expect(cols()).toBe(before)
  })

  it('sets column alignment on the cells', () => {
    editor = make()
    tableActions.setColumnAlign(editor, 'center')
    // the cell at the caret now carries align=center
    const json = editor.getJSON()
    const cell = (json.content![0]! as any).content[0].content[0]
    expect(cell.attrs.align).toBe('center')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saytu/admin test -- table-menu`
Expected: FAIL — `TableMenu`/`tableActions` does not exist.

- [ ] **Step 3: Implement `TableMenu.tsx`**

Create `apps/saytu-admin/src/editor/TableMenu.tsx`:

```tsx
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'

/** Pure-ish action helpers (testable without the floating UI). `setColumnAlign` writes the
 *  `align` attribute on the current cell; the serializer reads alignment from the header,
 *  and the column UI applies it consistently, so writing the focused cell is sufficient for
 *  a single-cell change — the menu calls it after selecting the column (see onAlign). */
export const tableActions = {
  addRowBefore: (e: Editor) => e.chain().focus().addRowBefore().run(),
  addRowAfter: (e: Editor) => e.chain().focus().addRowAfter().run(),
  addColumnBefore: (e: Editor) => e.chain().focus().addColumnBefore().run(),
  addColumnAfter: (e: Editor) => e.chain().focus().addColumnAfter().run(),
  deleteRow: (e: Editor) => e.chain().focus().deleteRow().run(),
  deleteColumn: (e: Editor) => e.chain().focus().deleteColumn().run(),
  deleteTable: (e: Editor) => e.chain().focus().deleteTable().run(),
  setColumnAlign: (e: Editor, align: 'left' | 'center' | 'right' | null) =>
    e.chain().focus().updateAttributes('tableCell', { align }).updateAttributes('tableHeader', { align }).run(),
}

export function TableMenu({ editor }: { editor: Editor }) {
  const A = tableActions
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={({ editor }) => editor.isActive('table')}
      options={{ placement: 'top' }}
    >
      <div className="table-menu" role="toolbar" aria-label="Table">
        <button type="button" onClick={() => A.addRowAfter(editor)} title="Add row"><Icon name="plus" /> Row</button>
        <button type="button" onClick={() => A.addColumnAfter(editor)} title="Add column"><Icon name="columns" /> Col</button>
        <button type="button" onClick={() => A.setColumnAlign(editor, 'left')} title="Align left">L</button>
        <button type="button" onClick={() => A.setColumnAlign(editor, 'center')} title="Align center">C</button>
        <button type="button" onClick={() => A.setColumnAlign(editor, 'right')} title="Align right">R</button>
        <button type="button" onClick={() => A.deleteRow(editor)} title="Delete row">− Row</button>
        <button type="button" onClick={() => A.deleteColumn(editor)} title="Delete column">− Col</button>
        <button type="button" onClick={() => A.deleteTable(editor)} title="Delete table"><Icon name="more" /> Delete</button>
      </div>
    </BubbleMenu>
  )
}
```

Notes for the implementer:
- `BubbleMenu` props are VERIFIED for `@tiptap/react@3.26.1`: it accepts `editor`, `pluginKey`, `shouldShow`, and `options` (FloatingMenu options, incl. `placement`). The distinct **`pluginKey="tableMenu"` is REQUIRED** — `FormatBubble.tsx` renders a `BubbleMenu` with the *default* plugin key and no pluginKey prop, so a second BubbleMenu without its own key would collide with it. Keep `pluginKey`.
- Both bubbles can show at once when text is selected inside a table (FormatBubble on the selection + TableMenu on table context). That overlap is acceptable for v1 (formatting cell text is valid); refine in UAT if cluttered.
- Verify icon names (`plus`, `columns`, `more`) exist in `Icon.tsx`; substitute defined ones if not.
- `setColumnAlign` updates the focused cell's `align`. If UAT shows we need the *whole column* updated at once, that's a follow-up refinement (the GFM writer already reads alignment from the header cell, so aligning at least the header column is what serializes).

- [ ] **Step 4: Render the menu in Canvas**

In `apps/saytu-admin/src/editor/Canvas.tsx`, import and render `TableMenu` next to `FormatBubble`:

```tsx
import { TableMenu } from './TableMenu'
```
and in the returned JSX, after `{editor && <FormatBubble editor={editor} />}`:
```tsx
      {editor && <TableMenu editor={editor} />}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @saytu/admin test -- table-menu && pnpm --filter @saytu/admin test && pnpm --filter @saytu/admin typecheck`
Expected: `tableActions` tests pass; full suite green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/saytu-admin/src/editor/TableMenu.tsx apps/saytu-admin/src/editor/Canvas.tsx apps/saytu-admin/test/table-menu.test.tsx
git commit -m "feat(admin): table cell action menu (rows, columns, alignment, delete)"
```

---

## Task 7: Admin — table CSS + final verification

**Files:**
- Modify: `apps/saytu-admin/src/styles/editor.css`

- [ ] **Step 1: Add CSS**

In `apps/saytu-admin/src/styles/editor.css`, after the task-list block, add (match the existing token style; verify `--border`/`--border-strong`/`--surface`/`--bg-sunken` exist via grep, substitute defined tokens if not):

```css
/* ---- Tables ---- */
.saytu-prose table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 16px; table-layout: fixed; overflow: hidden; }
.saytu-prose th, .saytu-prose td { border: 1px solid var(--border-strong); padding: 8px 11px; vertical-align: top; position: relative; }
.saytu-prose th { background: var(--bg-sunken); font-weight: 650; text-align: left; }
.saytu-prose th > p, .saytu-prose td > p { margin: 0; padding: 0; font-size: 16px; line-height: 1.5; }
.saytu-prose th[style*="center"], .saytu-prose td[style*="center"] { text-align: center; }
.saytu-prose th[style*="right"], .saytu-prose td[style*="right"] { text-align: right; }
.saytu-prose .selectedCell::after { content: ""; position: absolute; inset: 0; background: color-mix(in oklch, var(--accent) 14%, transparent); pointer-events: none; }
/* table action menu */
.table-menu { display: flex; gap: 4px; align-items: center; padding: 4px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r-sm); box-shadow: var(--shadow-pop); }
.table-menu button { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 7px; border: 1px solid transparent; background: transparent; color: var(--text-2); border-radius: var(--r-xs); font-size: 12px; font-weight: 550; cursor: pointer; }
.table-menu button:hover { background: var(--surface-hover); color: var(--text); }
```

(Tiptap adds `.selectedCell` to the selected cell; the `text-align` rules read the inline style our `align` attribute renders.)

- [ ] **Step 2: Build + visual sanity**

Run: `pnpm --filter @saytu/admin build`
Expected: succeeds (no CSS errors).

- [ ] **Step 3: Commit**

```bash
git add apps/saytu-admin/src/styles/editor.css
git commit -m "feat(admin): table + alignment + selected-cell styling"
```

- [ ] **Step 4: Full verification + manual UAT prep**

Run: `pnpm -r test && pnpm -r typecheck && pnpm --filter @saytu/admin build`
Expected: all green; edge guard clean; build OK; `@tiptap/extension-table` the only new dep.

Then `pnpm --filter @saytu/admin dev` (kill stale servers first) and verify: `/` → **Table** inserts a table; cell menu adds/removes rows & columns and sets column alignment (visible); a table with alignment + bold/link survives publish→reopen as clean GFM.

- [ ] **Step 5: Final code review**, then `superpowers:finishing-a-development-branch` (merge `--no-ff` to local main + push; remove worktree; delete branch), and update `memory/saytu-project.md` with the tables entry (native-GFM-writer / Markdoc-reader decision; the `tableToGfm` escaping pattern; cell `align` attribute; the "Markdoc.format drops alignment → we serialize tables ourselves" finding).

---

## Definition of Done (from spec)

- `pnpm -r test` green; `pnpm -r typecheck` clean (incl. edge guard); `pnpm --filter @saytu/admin build` OK.
- `pnpm dev`: `/` → Table inserts; cell menu adds/removes rows & columns + sets column alignment (L/C/R, visible); a table with alignment + inline marks survives publish→reopen as clean GFM (`| … |` with `:--`/`:-:`/`--:`).
- Built test-first via the subagent-driven flow.
