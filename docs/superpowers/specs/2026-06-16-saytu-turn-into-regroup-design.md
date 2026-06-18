# Design — Turn-into menu regroup (categorized, inline-expand)

_Date: 2026-06-16 · Status: approved (bubble-v2 slice 1; submenu style confirmed in UAT discussion)_

## Purpose

Restructure the format bubble's "Turn into ▾" dropdown from a flat list into **categories**, per
the owner's ask: **Heading** is one entry that expands to its levels, **List** is one entry that
expands to its kinds, and **Quote** / **Code** stay as direct entries. This is **slice 1 of
"bubble v2"** — pure editor UI, no content-model change (all the block types already round-trip).
Subscript/superscript (slice 2) and checklist (slice 3) follow as their own increments.

## Key context (verified)

- `apps/admin/src/editor/block-types.ts` already exports the flat `BLOCK_TYPES`
  (`{id,label,icon,isActive,setOn}`) + `currentBlockType(editor)`, consumed by BOTH the slash menu
  (`blocks.ts`) and the bubble's `TurnIntoMenu.tsx`. The slash menu stays flat; only the bubble
  menu gains grouping. The grouped view is **derived from the same `BLOCK_TYPES`** so nothing
  drifts.
- `TurnIntoMenu.tsx` is a `role="menu"` dropdown with keyboard nav (↑/↓/Enter/Esc), `useDismiss`
  for click-outside, and `registerBubblePopup()` so the bubble's Esc defers while it's open. The
  trigger shows `currentBlockType(editor).label` and participates in the toolbar roving
  (`data-toolbar-item`).
- Confirmed submenu style: **inline expand** (clicking Heading/List expands its options indented
  within the same panel) — no off-screen flyouts; simplest keyboard model for a floating bubble.

## Scope

**In:**

1. **A grouped view-model `TURN_INTO_GROUPS`** in `block-types.ts` — an ordered list of menu
   entries, each either a **leaf** (applies a block type directly) or a **group** (expands to
   sub-options). Derived from `BLOCK_TYPES` (references the same `BlockType` objects, so
   `isActive`/`setOn`/`label`/`icon` are shared — DRY):
   - `Text` → leaf (`paragraph`)
   - `Heading` → group → [`h2`, `h3`, `h4`]
   - `List` → group → [`bulletList`, `orderedList`]  *(Checklist is added here in slice 3)*
   - `Quote` → leaf (`blockquote`)
   - `Code` → leaf (`codeBlock`)
   Shape: `TurnIntoEntry = { kind: 'leaf'; type: BlockType } | { kind: 'group'; id; label; icon; items: BlockType[] }`.
   A helper `groupContaining(editor)` returns the id of the group whose item is currently active
   (so the menu can auto-expand it on open), or null.

2. **`TurnIntoMenu` rebuilt to render groups with inline expand.** A group row shows its label +
   a chevron and `aria-expanded`; clicking it (or Enter) toggles its expanded state, revealing its
   items indented below (in the same panel). A leaf row (or an expanded item) applies its
   transform and closes. On open, the group containing the current block type is **auto-expanded**
   and its active item is focused/checked; if the current type is a leaf (Text/Quote/Code) the menu
   opens with all groups collapsed and the active leaf focused.

3. **Keyboard model (over visible rows).** The menu computes its list of **visible rows** (all
   leaves + group headers + the items of expanded groups, in display order). ↑/↓ move focus through
   visible rows (wrapping); Enter on a **group** toggles its expansion; Enter on a **leaf or item**
   applies + closes; Esc closes the menu (stopPropagation so it doesn't collapse the selection,
   per the shipped guard); focus returns to the trigger. Items are `role="menuitemradio"`
   (`aria-checked` = active); groups are `role="menuitem"` with `aria-expanded`.

4. **CSS:** indentation for expanded items, a rotating expand chevron on group rows; reuse the
   existing `.ti-menu`/`.ti-item` tokens.

**Out (deferred — later slices / unaffected):**

- **Checklist** (slice 3) — the List group gains a third item then; no task-list node yet.
- **Subscript/superscript** (slice 2) — marks, not block types; not in this menu.
- The **slash menu** stays a flat list (it inserts; the flat `BLOCK_TYPES` order already reads
  fine there) — no grouping there.
- Multi-level nesting beyond one level; drag/reorder; per-item descriptions.

## Architecture / components

```
apps/admin/src/editor/
├── block-types.ts        # MODIFY — add TurnIntoEntry + TURN_INTO_GROUPS + groupContaining()
├── TurnIntoMenu.tsx      # MODIFY — render groups w/ inline expand + visible-row keyboard nav
└── styles/editor.css     # MODIFY — .ti-group/.ti-sub indentation + chevron
```

- `TURN_INTO_GROUPS` references `BLOCK_TYPES` entries by id (a small lookup), so the transforms and
  active-state stay single-sourced. `currentBlockType` (flat) still drives the trigger label.
- `TurnIntoMenu` holds `open` + an `expanded: Set<string>` (group ids). Opening seeds `expanded`
  from `groupContaining(editor)`. A derived `visibleRows` array drives both render and ↑/↓ nav,
  so keyboard and display can't disagree.

## Error handling / edge cases

- **Current type is a leaf** → no group auto-expands; the active leaf row is the initial focus.
- **Selection spans mixed block types** → `currentBlockType` falls back to Text (existing
  behavior); menu opens collapsed.
- **Esc with a group expanded** → Esc closes the whole menu (not just collapses a group) — simplest,
  matches the "Esc leaves the popup" model; the bubble selection is preserved (popup guard).
- **Re-picking the active type** → applies the same transform (idempotent for headings/paragraph;
  toggles off for list/quote/code, existing Tiptap behavior) — unchanged from today.
- **Click-outside / selection change** → menu closes via `useDismiss` / unmount; `expanded` resets
  on next open.

## Accessibility (standing bar)

- `role="menu"` with `menuitem` (groups, `aria-expanded`) and `menuitemradio` (`aria-checked`)
  items; ↑/↓ over visible rows, Enter to expand/apply, Esc to close, focus returned to the trigger.
  The trigger keeps `aria-haspopup="menu"`/`aria-expanded`. Inline expand keeps everything in one
  scrollable panel (no focus teleport to a detached flyout).

## Testing (behavior)

- **`TURN_INTO_GROUPS` (pure):** the entries are Text(leaf)/Heading(group h2,h3,h4)/List(group
  bullet,ordered)/Quote(leaf)/Code(leaf); every group item and leaf references a real `BLOCK_TYPES`
  entry (id match); `groupContaining` returns 'heading' when an h3 is active, 'list' for a bullet
  list, null for a plain paragraph (drive a real `Editor`).
- **`TurnIntoMenu` (testing-library):**
  - opening with the caret in an H3 auto-expands Heading and shows H2/H3/H4, with H3 `aria-checked`.
  - clicking the **Heading** group row toggles it (items appear/disappear); clicking **Heading 4**
    turns the block into an H4 (assert `editor.isActive('heading',{level:4})`) and closes the menu.
  - clicking the **List** group then **Numbered** makes an ordered list.
  - a leaf (**Quote**) applies directly without expanding.
  - Esc closes the menu and does not collapse the selection (the shipped popup-guard test pattern).
- Existing `turn-into`/`format`/`block-types` suites stay green (the trigger label + the
  `currentBlockType`/`BLOCK_TYPES`/slash usage are unchanged). `verbatimModuleSyntax` +
  `noUncheckedIndexedAccess` clean; build OK; **no new deps**; no `@setu/core` change.

## Definition of done

- `pnpm --filter @setu/admin test` green (groups model + menu interactions) + existing; typecheck
  clean; build OK; no new deps.
- `pnpm dev`: the Turn-into menu shows **Text · Heading ▸ · List ▸ · Quote · Code**; Heading/List
  expand inline to their options; the current block type's group is pre-expanded with its item
  checked; keyboard ↑/↓/Enter/Esc work; picking transforms the block; the slash menu is unchanged.
- Built test-first via the subagent-driven flow.

## Note on scope

A focused UI slice: a grouped view-model derived from the existing registry + an inline-expand
menu + CSS. No content-model change. Subscript/superscript (slice 2) and checklist (slice 3),
which carry the Markdoc round-trip work, are separate increments — checklist slots into the List
group when it lands.
