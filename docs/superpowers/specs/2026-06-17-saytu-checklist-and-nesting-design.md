# Design — Checklist + list-wide nesting (bubble v2 slice 3)

_Date: 2026-06-17 · Status: approved (owner confirmed checklist + folding list-wide nesting in; round-trip de-risked by spikes)_

## Purpose

The final bubble-v2 piece, plus a folded-in upgrade the owner chose after we found the gap:

1. **Checklist (task list).** A `Checklist` block backed by Tiptap TaskList/TaskItem, available in
   the slash menu and the format bubble's Turn-into "List" group (Bullet / Numbered / Checklist),
   with a Markdoc round-trip so checklists persist as portable GFM `- [ ]` / `- [x]`.
2. **List-wide nesting.** Make nesting work for **all** list types (bullet, numbered, checklist,
   mixed). Today the converter is flat: a list item is reduced to its first paragraph and any nested
   sub-list is **silently dropped** on publish. This fixes that across the board.

## Key context (verified by spikes — do not re-verify)

- **Markdoc does NOT parse `- [ ]` as a task list.** markdown-it (Markdoc's backend) treats
  `- [ ] buy milk` as an ordinary bullet list whose item text is the literal string `"[ ] buy milk"`.
  Therefore **no Markdoc tokenizer/plugin work is needed** — all checklist logic lives in our own
  converter. Building a `list` whose item inline text is prefixed `[ ] ` / `[x] ` and calling
  `Markdoc.format` emits clean GFM (`- [ ] do the **thing**`), and re-parsing yields item text that
  begins with `[ ] ` / `[x] ` — byte-identical and idempotent, marks preserved.
- **Markdoc round-trips nesting perfectly, in both directions.** Verified: 6-level depth, mixed
  bullet+checklist, ordered>bullet, checklist>bullet, bullet>checklist — every case is byte-identical
  on parse→format and idempotent. The **build** direction also works: an `item` built as
  `[inline, nested list node]` formats to correctly-indented GFM. So Markdoc is never the blocker;
  the work is purely our converter recursion + the Tiptap wiring.
- **Tiptap (v3.26.1):** `TaskList` + `TaskItem` ship in **`@tiptap/extension-list`** (MIT;
  `ListKit`/`TaskList`/`TaskItem` exported). StarterKit does **not** enable them. Default toggle
  shortcut **`Mod-Shift-9`**; `toggleTaskList()` command; TaskItem has a `checked` attribute.
  `ListItem` and `TaskItem` both have content `"paragraph block*"` → nested lists are schema-legal.
  Both extensions bind `Tab` → `sinkListItem(this.name)` and `Shift-Tab` → `liftListItem(this.name)`.
- **Our custom Tab handler must learn task items.** `extensions/KeyboardShortcuts.ts` intercepts Tab
  globally (so it never escapes into a callout title — a shipped UAT fix) and currently only checks
  `editor.isActive('listItem')` → `sinkListItem('listItem')`. Task items are `taskItem`, not
  `listItem`, so under today's handler a checklist would NOT indent. The handler must sink/lift the
  **active** item type and add Shift-Tab outdent, keeping the no-escape guarantee.
- **Converter today (flat):**
  - `to-tiptap` `case 'list'`: builds `listItem` → `[{paragraph, content: collectInline(item)}]`;
    nested `list` children of an item are dropped (`inlineToTiptap` returns `[]` for a `list` node).
  - `to-markdoc` `bulletList`/`orderedList`: each item = `buildInline(item.content?.[0]?.content)` —
    only the first paragraph; nested lists dropped.
- **DRY surfaces:** `BLOCK_TYPES` (`block-types.ts`) feeds BOTH the slash menu (`blocks.ts`, flat
  map) and the bubble's `TURN_INTO_GROUPS`. Adding one `taskList` entry surfaces Checklist in both,
  with its `keys` rendered by the existing `formatKeys` in the menu row + cheat sheet (slice-2 path).
- **Icons:** `check` is a defined `IconName` (use it for Checklist).

## Scope

**In:**

### A. Core converter — recursive list conversion (`packages/core/src/markdoc/`)

1. **`to-markdoc` (`buildBlock`) — recurse + task markers.**
   - Add `case 'taskList'`. Both `taskList` and `bulletList`/`orderedList` build a Markdoc `list`
     (`ordered` + `marker` set as today; task lists are unordered `-`).
   - For each item, build the item node as `new N('item', {}, [ inline, ...nestedListNodes ])`:
     - `inline` = `new N('inline', {}, buildInline(firstParagraph.content))`, where
       `firstParagraph` is the item's first child whose `type === 'paragraph'`.
     - For a **taskItem**, prepend a `new N('text', { content })` of `'[x] '` when
       `item.attrs.checked === true`, else `'[ ] '`, to the inline children (before the built marks).
     - `nestedListNodes` = the item's subsequent children that are lists
       (`bulletList`/`orderedList`/`taskList`), each converted by a recursive `buildBlock` call,
       appended as block children of the `item`.
   - Non-list, non-first-paragraph children of an item (e.g. extra paragraphs in a loose list item)
     stay dropped — unchanged from today, out of scope.

2. **`to-tiptap` — recursive list reading + checklist detection.**
   - Replace the flat `case 'list'` in `blockToTiptap` with a recursive `listToTiptap(node)`:
     - **Detect checklist per level:** the list is a task list iff it is unordered AND **every**
       item's first inline text matches `^\[( |x|X)\]\s` (helper `taskMarker(item)` returning
       `{ checked: boolean } | null`). A partial/mixed-marker list is NOT a task list (stays a
       bullet list with the literal `[ ]` text preserved — lossless).
     - Build `taskList`/`taskItem` (with `attrs.checked`) or `bulletList`/`orderedList` + `listItem`.
     - For each item, content = `[ { type:'paragraph', content: inlineOfItem }, ...nestedLists ]`:
       - `inlineOfItem` = `collectInline(item)`; for a task item, strip the leading marker from the
         first text node (slice the matched `[ ] `/`[x] ` prefix; drop the text node if it becomes
         empty). `checked` = true for `[x]`/`[X]`.
       - `nestedLists` = each child of the item that is itself a `list`, converted by recursing
         `listToTiptap` — appended after the paragraph.
   - Existing flat lists produce identical output (no nested children → `[paragraph]` only), so
     current round-trip tests stay green.

3. **Core tests** (`to-markdoc.test.ts`, `to-tiptap.test.ts`, `roundtrip.examples.test.ts`):
   - Flat checklist: `- [ ] a` / `- [x] b` ↔ taskList with `checked` true/false.
   - Checklist item with inner marks (`- [ ] do the **thing**`) round-trips byte-clean.
   - Nesting: 2–3 level, mixed bullet>checklist and checklist>bullet, ordered>bullet — idempotent
     and byte-identical where source is canonical.
   - **Negatives (content-safety):** a plain `- a` bullet stays a `bulletList` (no false checklist);
     a mixed list where only some items have `[ ]` stays a `bulletList` with literal `[ ]` text
     preserved; `[X]` (uppercase) reads as checked and writes back lowercase `[x]`.
   - Edge guard still passes (converter stays Node-free; no new core deps).

### B. Editor (`apps/saytu-admin/`)

4. **Register the extensions.** Add `@tiptap/extension-list` to `apps/saytu-admin/package.json`;
   import `{ TaskList, TaskItem }` and add them to the `Canvas.tsx` extensions array. (Keep
   StarterKit's existing list extensions; TaskList/TaskItem are additive.)

5. **One `BLOCK_TYPES` entry (`block-types.ts`).** Append:
   `{ id:'taskList', label:'Checklist', icon:'check', keys:['Mod','Shift','9'],
   isActive: e => e.isActive('taskList'), setOn: c => c.toggleTaskList() }`.
   Add `taskList` as the third item in the `List` group in `TURN_INTO_GROUPS`
   (`items: [byId('bulletList'), byId('orderedList'), byId('taskList')]`). The slash menu picks it
   up automatically via the `BLOCK_TYPES` map; add a `taskList` subtitle (e.g. "Checklist") to the
   `SUBTITLES` record in `blocks.ts`.

6. **Tab/Shift-Tab indent-outdent for both list kinds (`extensions/KeyboardShortcuts.ts`).**
   - `tabActionFor` returns `'indent'` when the caret is in `listItem` **or** `taskItem` (today only
     `listItem`). The Tab handler sinks the **active** item type:
     `editor.isActive('taskItem') ? sinkListItem('taskItem') : sinkListItem('listItem')`.
   - Add a `Shift-Tab` handler: when in a list item, **lift** the active item type
     (`liftListItem('taskItem'|'listItem')`) and return true; otherwise return false (let default
     behavior through). Keep the existing "Tab never escapes into a callout title" guarantee (Tab
     still always returns true inside the editor body).

7. **CSS (`styles/editor.css`).**
   - Task list: `ul[data-type="taskList"]` → `list-style:none; padding-left:…`; each
     `li[data-type="taskItem"]` lays out the checkbox (`> label`) beside the content (`> div`) with
     flex; style the `input[type=checkbox]`; reflect `data-checked="true"` (muted/strikethrough
     optional, minimal). (Render structure is TaskItem's default
     `<li><label><input/></label><div>…</div></li>`.)
   - Nested lists: ensure nested `ul`/`ol`/task lists indent and keep sensible markers at depth
     (reuse existing `.saytu-prose ul/ol` rules; verify nested spacing is acceptable).

**Out (deferred):**

- **Loose list items** (multiple paragraphs / block content beyond nested lists inside one item) —
  still reduced to the first paragraph + nested lists, as today.
- **Visual depth guardrail** (capping indent past N levels) — content model is depth-unlimited;
  YAGNI for now.
- Due-dates / assignees / any task metadata beyond `checked`.
- Drag-reordering across nesting levels (DragHandle behavior unchanged).

## Architecture / components

```
packages/core/src/markdoc/
├── to-markdoc.ts      # MODIFY — buildBlock: case 'taskList'; items recurse nested lists; task marker prefix
├── to-tiptap.ts       # MODIFY — listToTiptap recursion + checklist detection/marker strip
└── test/{to-markdoc,to-tiptap,roundtrip.examples}.test.ts  # MODIFY — checklist + nesting + negatives
apps/saytu-admin/src/editor/
├── block-types.ts                 # MODIFY — add taskList BlockType + List-group item
├── blocks.ts                      # MODIFY — taskList subtitle (slash menu)
├── Canvas.tsx                     # MODIFY — register TaskList + TaskItem
├── extensions/KeyboardShortcuts.ts# MODIFY — Tab sink + Shift-Tab lift for listItem & taskItem
└── styles/editor.css              # MODIFY — task checkbox layout + nested indentation
apps/saytu-admin/package.json      # + @tiptap/extension-list
```

- `listToTiptap` (to-tiptap) and the list branch of `buildBlock` (to-markdoc) are the only recursive
  units; both mirror each other. Detection is per list node, so it composes naturally with nesting.

## Error handling / edge cases

- **False-positive checklist:** only an **all-items-match** unordered list becomes a task list;
  partial/mixed lists stay bullets with literal `[ ]` text (preserved, never lost). A plain bullet
  is never misread.
- **Uppercase `[X]`:** read as checked; written back canonical lowercase `[x]`.
- **Empty task item (`- [ ] ` then nothing):** marker strip yields an empty text node → drop it so
  the paragraph is clean.
- **Tab on a first/top item:** `sinkListItem` is a no-op (can't indent the first item) but the
  handler still returns true (no escape) — matches the shipped behavior.
- **Shift-Tab at top level (not nested):** `liftListItem` lifts out of the list (standard Tiptap);
  acceptable. When not in a list, Shift-Tab returns false (default behavior).
- **Nested round-trip depth:** unlimited; recursion + Markdoc handle arbitrary depth (verified 6
  levels mixed).

## Accessibility (standing bar)

- TaskItem checkboxes are real `<input type="checkbox">` (keyboard-togglable, labelled by their
  content) — Tiptap default. The Checklist entry joins the existing Turn-into menu
  (`menuitemradio`, `aria-checked`) and slash menu with no new pattern. ⌘⇧9 shows in the menu row +
  cheat sheet (existing `formatKeys`/`ariaKeyshortcuts` path). Tab/Shift-Tab indent-outdent are
  standard list keyboard semantics.

## Testing (behavior)

- **Core (centerpiece):** the round-trip cases in §A.3 — flat checklist, marks-in-item, nesting
  (deep + mixed both directions), idempotency/byte-fidelity, and the negatives (plain bullet, mixed
  list literal preservation, `[X]` casing). Edge guard green; no new core deps.
- **block-types:** the `taskList` entry's `keys` = `['Mod','Shift','9']`; List group has three items
  (bullet, ordered, taskList).
- **TurnIntoMenu:** the List group expands to show Checklist with its ⌘⇧9 accelerator; picking it
  makes `editor.isActive('taskList')` true.
- **Slash menu:** a "Checklist" entry exists and inserts a task list.
- **KeyboardShortcuts:** `tabActionFor` returns `'indent'` for a caret in a task item; Tab sinks a
  task item (nests it) and a list item; Shift-Tab lifts each; Tab inside a callout title is still
  consumed (no escape).
- **Build/typecheck:** `pnpm -r test` green; `pnpm -r typecheck` clean (incl. edge guard);
  `pnpm --filter @setu/admin build` OK; `@tiptap/extension-list` is the only new `package.json`
  change; existing list/round-trip suites stay green.

## Definition of done

- `pnpm -r test` green (core checklist+nesting round-trip + admin display/menu/keymap) ;
  `pnpm -r typecheck` clean ; `pnpm --filter @setu/admin build` OK.
- `pnpm dev`: select text → bubble List ▸ shows Bullet / Numbered / **Checklist** (⌘⇧9); `/`
  inserts a Checklist; clicking a checkbox toggles done; **Tab nests** any list item (bullet,
  numbered, checklist, mixed) and **Shift-Tab outdents**; a checklist (and nested lists) survive a
  publish→reopen round-trip byte-clean; `Cmd/Ctrl+/` cheat sheet lists the Checklist shortcut.
- Built test-first via the subagent-driven flow.

## Note on scope

Two coupled changes shipped together because they share the same converter code path: the checklist
node + its GFM round-trip, and the recursion that makes ALL lists nest (fixing a pre-existing
silent-drop bug). The only real risk — content fidelity — is de-risked: Markdoc round-trips every
nesting/marker shape byte-clean in both directions; all logic is in our tested converter, not
Markdoc internals.
