# Design — Tables (native GFM, alignment included)

_Date: 2026-06-17 · Status: approved (owner chose native-GFM serialization over Markdoc.format; round-trip de-risked by spike)_

## Purpose

Add a table block to the editor that persists as portable **GFM pipe tables**
(`| a | b |` with a `--- / :-- / :-: / --:` separator row), including **per-column
alignment**. Tables are a top wishlist item; this is the first of the larger roadmap
nodes (tables / images / syntax-highlight / text-align / RTL / ToC).

## The architectural decision (owner-driven)

Markdoc's **formatter** discards GFM column alignment (parses `:--`/`:-:`/`--:` into
`align` attrs, but `Markdoc.format` writes plain `---`) and pads cells to column width.
So instead of routing tables through `Markdoc.format`, we **write tables ourselves as
native GFM** and keep Markdoc only as the **reader**. This is the same pattern already
used for `passthrough` blocks (written verbatim, not via `Markdoc.format`).

- **Reader stays Markdoc** — non-negotiable: tables coexist with `{% callout %}`/`{% if %}`
  tags in `.mdoc`, and only Markdoc parses those. Markdoc's parser already reads GFM
  tables **including alignment** (verified).
- **Writer is ours** — a small `tableToGfm` serializer. Trade-off accepted: we own GFM
  cell escaping (the content-safety surface), de-risked below.

## Key context (verified by spike — do not re-verify)

- **Tiptap v3.26.1:** all table nodes are consolidated in **`@tiptap/extension-table`**
  (MIT); `TableKit` is its convenience export (bundles `Table`, `TableRow`, `TableCell`,
  `TableHeader`). Tiptap's table model: `table → tableRow → (tableHeader|tableCell) →
  block content (paragraph) → inline`. Tiptap cells have **no native alignment attribute**
  (only colspan/rowspan/colwidth) — we add one.
- **Markdoc reads GFM tables:** `Markdoc.parse` → `table → thead/tbody → tr → th/td → inline`;
  `:--`/`:-:`/`--:` → `align: "left"|"center"|"right"` on each `th`/`td`. `Markdoc.format`
  is idempotent for tables but **canonicalizes whitespace and drops alignment** — hence we
  don't use it for tables.
- **Custom serializer spike (DONE — de-risks the only real risk):** a `tableToGfm` that
  renders each cell's inline via `buildInline`+Markdoc then table-escapes the string
  produces GFM that re-parses **byte-faithful** through `Markdoc.parse`:
  - pipe in text (`x | y` → `x \| y`) and **pipe inside a code span** (`` `a|b` `` →
    `` `a\|b` `` → back to `a|b`) both survive;
  - bold / link / code / empty cells round-trip;
  - alignment colons round-trip per column;
  - escaping rule that worked: `\` → `\\`, then `|` → `\|`, then newline → `<br>`.
- **Converter shape (current):** `to-markdoc.ts` `buildBlock(node)` switch + `buildInline`;
  `tiptapToMarkdoc` formats each top-level block (passthrough bypasses `Markdoc.format`).
  `to-tiptap.ts` `blockToTiptap(node)` switch + `collectInline`. The edge guard
  (`tsconfig.edge.json`) requires the converter to stay Node-free.

## Scope

**In:**

### A. Core — GFM table serializer + reader (`packages/core/src/markdoc/`)

1. **`table-gfm.ts` (new) — `tableToGfm(node: TiptapNode): string`.** Pure. Given a Tiptap
   `table` node:
   - Rows = `node.content` (tableRow); cells = each row's `tableHeader`/`tableCell`.
   - **Column alignment** = read from the **header row** (row 0) cells' `align` attr
     (`left|center|right|null`); produce the separator: `:--` / `:-:` / `--:` / `---`.
   - **Cell string** = render the cell's first paragraph inline via the shared `buildInline`
     + `Markdoc.format` (wrapped in a paragraph, trailing newline stripped), then
     **table-escape**: `\`→`\\`, `|`→`\|`, then any remaining `\n`→`<br>`.
   - Emit `| c | c |` rows (header, separator, body), single-space padded, trailing `\n`.
   - `buildInline` is currently module-private in `to-markdoc.ts`; **export it** (or move
     it + the table serializer so both share it) so `table-gfm.ts` reuses identical inline
     rendering. No behavior change to existing callers.

2. **`to-markdoc.ts` — route `table` to the serializer.** `tiptapToMarkdoc` already maps
   each top-level block; add: a `table` node is serialized with `tableToGfm(node)` (its
   own string, like passthrough) rather than `Markdoc.format(buildBlock(...))`. (Tables are
   top-level only — no tables nested inside other blocks in v1.)

3. **`to-tiptap.ts` — `case 'table'`.** Markdoc `table` → Tiptap `table`:
   - `thead` `tr` → a `tableRow` of `tableHeader` cells; each `tbody` `tr` → a `tableRow`
     of `tableCell` cells.
   - Each cell: `{ type: 'tableHeader'|'tableCell', attrs: { align }, content: [{ type:
     'paragraph', content: collectInline(cellNode) }] }`, where `align` = the Markdoc
     `th/td` `align` attr (or null). Apply the column's alignment to **every** cell in the
     column (read side: each th/td already carries it).

### B. Editor (`apps/saytu-admin/`)

4. **Register tables.** Add `@tiptap/extension-table` (MIT) to `package.json`; register
   `TableKit` in `Canvas.tsx`. **Extend `TableCell` and `TableHeader`** (via
   `.extend({ addAttributes })`) with an `align` attribute (`left|center|right|null`),
   parsed from / rendered to `style="text-align:…"`, so alignment is stored on cells and
   shows in the editor. (Plan must verify the exact `TableKit` export + extend pattern
   against the installed package — HARD RULE.)

5. **Slash-menu insert (`blocks.ts`).** Add a **"Table"** entry (not in `BLOCK_TYPES` —
   that registry is for *transform*-into; a table is *inserted*). It inserts a starter
   table (e.g. 2 columns × 2 rows, first row = header) at the caret, like the existing
   `Divider` slash entry. Icon: a defined `IconName` (e.g. `columns` or `forms`; verify in
   `Icon.tsx`, add one only if needed).

6. **Cell menu + table actions.** A lightweight control (cell context affordance / small
   toolbar when the selection is in a table) offering: **insert row above/below**, **insert
   column left/right**, **delete row**, **delete column**, **delete table**, and **set
   column alignment (Left / Center / Right)** — alignment sets the `align` attr on all cells
   in the column (write side reads it from the header). Use Tiptap's table commands
   (`addRowBefore`/`addRowAfter`/`addColumnBefore`/`addColumnAfter`/`deleteRow`/
   `deleteColumn`/`deleteTable`); alignment is a small custom command/`updateAttributes`
   over the column's cells. Keyboard a11y consistent with the existing menu patterns.

7. **CSS (`styles/editor.css`).** Table borders/padding/header emphasis; `text-align` honored
   from the cell `align` attr; selected-cell affordance; sensible default column behavior.

**Out (deferred / not exposed — GFM can't represent, so we don't offer them):**

- **Merged cells** (colspan/rowspan) and **column resize / widths** — GFM has no syntax;
  we don't expose merge/resize so every table round-trips.
- **Block content inside a cell** (multiple paragraphs, lists, nested tables) — cells are
  single-line inline; extra block content in a cell is reduced to its first paragraph
  (consistent with the list-item limitation).
- **Paragraph/heading text-align** (the general `TextAlign` roadmap item) — no native
  Markdown; its own later increment. *Table column* alignment here is GFM-native and
  separate.
- A hard line break inside a cell serializes to `<br>` (GFM convention); rich multi-line
  cells are not a goal.

## Architecture / components

```
packages/core/src/markdoc/
├── table-gfm.ts       # NEW — pure tableToGfm(node) GFM serializer + cell escaping
├── to-markdoc.ts      # MODIFY — export buildInline; route `table` node → tableToGfm
├── to-tiptap.ts       # MODIFY — case 'table' → Tiptap table/row/cell(align)/paragraph
└── test/{table.test.ts (new), roundtrip.examples.test.ts}  # serializer + round-trip + negatives
apps/saytu-admin/src/editor/
├── Canvas.tsx         # MODIFY — register TableKit; extend TableCell/TableHeader with align
├── blocks.ts          # MODIFY — "Table" slash insert (starter 2x2 w/ header)
├── TableMenu.tsx      # NEW — cell/table actions (rows, cols, align, delete)
└── styles/editor.css  # MODIFY — table + alignment + selected-cell styling
apps/saytu-admin/package.json  # + @tiptap/extension-table
```

- `table-gfm.ts` is the one new unit and the content-safety centerpiece: pure, fully
  unit-tested, shares `buildInline` with `to-markdoc.ts` (no duplicate inline logic).

## Error handling / edge cases (content-safety)

- **Escaping:** `\`→`\\` then `|`→`\|` (order matters); newline→`<br>`. Spike-verified for
  text pipes, code-span pipes, empty cells; the plan adds tests for a literal backslash and
  a hard break in a cell.
- **Ragged rows** (rows with fewer/more cells than the header) — GFM requires uniform column
  count. On write, pad short rows with empty cells / ignore extras to the header's column
  count (Tiptap's table model keeps them uniform, so this is defensive).
- **Alignment source of truth:** the header row's per-column `align`. If body cells somehow
  disagree (shouldn't, since the UI sets a whole column), the header wins on write; on read
  every cell gets the column's alignment.
- **A `|` in body text never breaks the grid** — guaranteed by escaping; a dedicated test.
- **Empty header cell / empty table** — serialize valid GFM (header + separator minimum).

## Accessibility (standing bar)

- The table-action menu follows the existing menu/roving patterns (keyboard-reachable,
  Esc-to-close). Cells are normal editable content; alignment changes are real attribute
  edits (persist + publish). Tables use native `<table>`/`<th>`/`<td>` semantics.

## Testing (behavior)

- **Core (centerpiece):** `tableToGfm` unit tests — header+separator+body shape; alignment
  columns (`:--`/`:-:`/`--:`/`---`); escaping (pipe in text, pipe in code span, literal
  backslash, hard break → `<br>`); empty cell; inline marks (bold/link/code) in cells.
  Round-trip via `roundtrip.examples.test.ts`: a table (with + without alignment, with marks)
  is idempotent and byte-faithful to its canonical form; **negative** — a body cell
  containing `|` round-trips without breaking the grid. `to-tiptap` table-read tests
  (thead→header cells, alignment onto cells). Edge guard stays clean; no new core deps.
- **Editor:** slash "Table" inserts a 2×2 with a header row; add/remove row & column;
  set column alignment updates the column's cells; delete table; a table survives
  publish→reopen byte-clean. `@tiptap/extension-table` is the only new `package.json` change;
  build OK; existing suites green.

## Definition of done

- `pnpm -r test` green (core serializer + round-trip + admin table UI) ; `pnpm -r typecheck`
  clean (incl. edge guard) ; `pnpm --filter @setu/admin build` OK.
- `pnpm dev`: `/` → **Table** inserts a table; the cell menu adds/removes rows & columns and
  sets **column alignment** (L/C/R, visible in the editor); a table with alignment + inline
  marks **survives publish→reopen** as clean GFM (`| … |` with `:--`/`:-:`/`--:`).
- Built test-first via the subagent-driven flow.

## Note on scope

One focused increment: a pure GFM serializer (the de-risked content-safety core) + the
Tiptap table extension with a cell `align` attribute + insert/edit UI. Markdoc stays the
reader; we own only the table *writer*. General paragraph text-align and images are separate
later increments.
