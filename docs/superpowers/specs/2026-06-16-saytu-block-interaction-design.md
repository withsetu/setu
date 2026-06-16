# Design — Block interaction layer (move / act on blocks, mouse + keyboard)

_Date: 2026-06-16 · Status: approved (converged in UAT discussion)_

## Purpose

Make the editor *feel* like a real, modern block editor: a writer can **grab a block
and move it, duplicate it, or delete it — equally well with the mouse or the keyboard**.
This is the first of the "nail the editor" increments and the **interaction substrate**
every future block (images, code, embeds) will sit on, so it's built once, properly,
with keyboard/accessibility as a first-class requirement — not a follow-up.

It also clears the tracked a11y debt: you currently can't move from a callout's title
into its body with the keyboard.

## Decision: build our own drag handle (no Tiptap drag-handle extension)

Tiptap's `@tiptap/extension-drag-handle` is MIT/free, but its **required** peers pull in
`@tiptap/extension-collaboration` + `@tiptap/y-tiptap` (→ **yjs**) — a CRDT/collaboration
stack bundled into the in-browser admin just to reorder blocks, with no collaboration in
play. Since we're hand-building the block-actions menu *and* keyboard reorder regardless
(the extension only supplies the mouse grip), the extension buys little for its dependency
cost. We build a small ProseMirror drag-handle plugin instead — lean, no new heavy deps,
and full control over the interaction (which is the editor wedge). Revisit Tiptap's
collab-coupled tooling if/when real-time collaboration (Pro) is built.

## Scope

**In:**

1. **`BlockActions` extension** — editor commands + keyboard shortcuts, the single source
   of truth for the verbs:
   - `moveBlockUp` / `moveBlockDown` — shortcuts **Alt+Shift+↑ / Alt+Shift+↓**.
   - `duplicateBlock`, `deleteBlock`.
   Both the drag-handle menu and the keyboard invoke these same commands.
2. **`DragHandle` plugin + grip** — a ProseMirror plugin: on hover, a grip (⋮⋮) appears in
   the left gutter aligned to the hovered top-level block; **drag to reorder**; clicking
   the grip opens the **block menu** (Move up / Move down / Duplicate / Delete) wired to the
   `BlockActions` commands.
3. **Callout title↔body keyboard nav** — **↓ / Enter** in the callout title moves the
   selection into the callout body; **↑** at the very start of the body returns focus to the
   title.
4. **CSS** — grip, hover affordance, drag/drop indicator, and the block menu, ported in the
   existing `editor.css` style.

**Out (deliberate, deferred to follow-on increments):**

- **The format bubble menu** (bold/italic/link on a text selection) — text-level, a
  different interaction; its own increment.
- **Nested reordering** — dragging blocks *into/out of* a callout, or reordering inside
  nested lists. v1 operates on **top-level blocks only** (see guard below).
- **"Turn into" / block-type conversion**, multi-block selection / multi-drag.
- New **block types** (images, code, embeds) — the *next* increment, which this substrate
  makes cheaper.

## Scope guard — top-level blocks only

Drag and all four actions operate on **direct children of the document node** (`doc.content`).
A callout (or any container block) moves/duplicates/deletes **as one unit**; the selection's
top-level ancestor is the "current block" for keyboard actions. Moving content across
container boundaries is the corruption-prone case and is **deferred**. This keeps the drag
math and transactions tractable and the content provably safe.

## Architecture / data flow

```
apps/saytu-admin/src/editor/
├── extensions/
│   ├── BlockActions.ts      # NEW — commands (move/duplicate/delete) + keyboard shortcuts
│   ├── DragHandle.tsx       # NEW — ProseMirror plugin: hover grip + drag-reorder + opens menu
│   ├── BlockMenu.tsx        # NEW — the role=menu popover (reuses the slash-menu popup tooling)
│   └── Callout.tsx          # MODIFY — title↔body keyboard nav via node-view editor + getPos
├── Canvas.tsx               # MODIFY — register BlockActions + DragHandle in the extensions array
└── styles/editor.css        # MODIFY — grip / drag indicator / block menu
```

### `BlockActions` (the verbs)

A Tiptap `Extension.create` exposing commands that operate on the **top-level block**
containing the current selection (resolve `selection.$from` up to depth 1):

- **`moveBlockUp` / `moveBlockDown`** — swap the target top-level node with its previous/next
  sibling via a single transaction (delete + reinsert at the new position, preserving the
  node and its content). No-op (return `false`) at the first/last block.
- **`duplicateBlock`** — insert a deep copy of the target node immediately after it.
- **`deleteBlock`** — remove the target node. If it is the **only** remaining top-level block,
  replace it with an empty paragraph so the document never becomes invalid/empty.

Keyboard shortcuts via `addKeyboardShortcuts`: `Alt-Shift-ArrowUp` → `moveBlockUp`,
`Alt-Shift-ArrowDown` → `moveBlockDown`. (Duplicate/Delete are menu-only in v1; no default
shortcut, to avoid clobbering OS/browser combos. Revisit if desired.)

### `DragHandle` (the grip + drag)

A Tiptap extension wrapping a ProseMirror plugin (`addProseMirrorPlugins`):

- **Hover tracking:** on `mousemove` over the editor, find the top-level block under the
  pointer (`view.posAtCoords` → resolve to depth-1 node) and position a single
  absolutely-positioned grip element in the left gutter aligned to that block's top.
- **Drag to reorder:** the grip is `draggable`. On `dragstart`, record the source block's
  position; on `dragover`, compute the drop target block boundary (`posAtCoords`) and show a
  drop indicator; on `drop`, if the target differs from the source, dispatch a move
  transaction (reuse the same node-move logic as `moveBlock*`). Constrained to top-level
  positions.
- **Open menu:** clicking the grip (or pressing Enter/Space when it's focused) opens
  `BlockMenu` anchored to the grip, targeting the grip's current block.

### `BlockMenu` (the actions popover)

A React popover (reusing the **same popup tooling the SlashCommand already uses** — no new
dependency) with `role="menu"` and four `role="menuitem"` buttons: Move up, Move down,
Duplicate, Delete. Each calls the corresponding `BlockActions` command on the target block,
then closes. Keyboard: ↑/↓ move between items, Enter activates, Esc closes and returns focus
to the editor. Move up/down are disabled at the document edges.

### Callout title↔body (a11y fix)

`CalloutView` already has access to `editor` and `getPos` (via `ReactNodeViewProps`). The
title `<input>` currently calls `e.stopPropagation()` on every keydown. Refine it:

- On **ArrowDown**, or **Enter**, or **ArrowRight at caret end** → prevent default and move the
  editor selection into the **start of the callout body** (`editor.chain().focus().setTextSelection(getPos() + offsetToBodyStart).run()`), then blur the input.
- Conversely, in the callout body, **ArrowUp at the very start** of the first child → focus the
  title input (the node view exposes a ref to the input; the body's keydown handler detects
  start-of-body and calls `input.focus()`).
- Other keys still `stopPropagation` so typing in the title doesn't trigger editor shortcuts.

## Error handling / edge cases

- **Move at an edge** → command returns `false` (no-op); menu items disabled at edges.
- **Delete last block** → replaced with an empty paragraph; document stays valid.
- **Drag dropped in place / outside the editor** → no-op transaction.
- **Read-only mode** (`editable=false`) → no grip, no shortcuts, menu not reachable.
- **Passthrough atoms & callouts** → first-class top-level blocks; move/duplicate/delete as
  whole units (their internal content rides along).
- **Round-trip** → all four ops only rearrange/clone/remove existing nodes, so
  `tiptapToMarkdoc(getJSON())` stays valid Markdoc; asserted by tests.

## Accessibility (standing quality bar)

- Every drag action has a keyboard equivalent (move via shortcut; duplicate/delete via the
  keyboard-reachable menu).
- The grip is a real focusable control (`aria-label="Block actions"`); the menu is
  `role="menu"` with full Arrow/Enter/Esc handling and focus return.
- The callout title↔body gap is closed (the specific tracked debt).
- No keyboard traps introduced; focus order through blocks remains logical.

## Testing (behavior)

- **`BlockActions` commands (unit, with an editor instance):** moveUp/moveDown reorder
  top-level blocks (and are no-ops at edges); duplicate produces an adjacent identical node;
  delete removes it; deleting the sole block yields an empty paragraph.
- **Round-trip safety:** after each op, `tiptapToMarkdoc(editor.getJSON())` equals the
  expected reordered/duplicated/deleted Markdoc (content-safety cardinal rule).
- **Keyboard shortcuts:** Alt+Shift+↑/↓ invoke move on the selection's top-level block.
- **`BlockMenu` (testing-library):** opening the menu, keyboard nav between items, Enter
  activates the right command, Esc closes; edge items disabled appropriately.
- **Callout title↔body:** ArrowDown/Enter in the title moves selection into the body;
  ArrowUp at body start returns to the title.
- **Drag:** the underlying move transaction is covered by the command tests; a focused test
  exercises the plugin's drop→move mapping (source/target position → resulting order) without
  simulating raw HTML5 drag events.
- Existing editor tests stay green; `verbatimModuleSyntax` (`import type`) +
  `noUncheckedIndexedAccess` clean; build keeps fonts + stays jiti-free; no new heavy deps
  (no yjs/collaboration).

## Definition of done

- `pnpm --filter @saytu/admin test` green (new BlockActions/menu/callout tests + existing
  suite); typecheck clean; `pnpm --filter @saytu/admin build` OK (fonts, jiti-free, no yjs in
  the bundle).
- `pnpm dev`: hover a block → grip appears → drag to reorder; grip menu does
  Move/Duplicate/Delete; **Alt+Shift+↑/↓** moves the current block; in a callout, ↓/Enter
  goes title→body and ↑ at body start goes back. Read-only mode shows no grip.
- Built test-first via the subagent-driven flow.

## Note on scope

Self-contained, editor-only increment: two new extensions (`BlockActions`, `DragHandle`),
one menu component, a Callout focus refinement, and CSS — decomposed into tight TDD tasks in
the plan: (1) `BlockActions` commands + shortcuts + round-trip tests, (2) the drag-handle
plugin + grip + reorder, (3) the `BlockMenu` UI + a11y, (4) callout title↔body nav, (5) CSS.
The format bubble menu and richer block types are the next increments this substrate enables.
```
