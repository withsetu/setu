# Design — Enriched format bubble + toolbar keyboard model

_Date: 2026-06-16 · Status: approved (design + the two product choices confirmed in UAT discussion)_

## Purpose

Make the format bubble carry **toolbar-grade formatting** so the editor needs no top toolbar
(the owner's direction: "what's in the toolbar should be part of our bubble"). Add a **"Turn
into ▾" block-type switcher** alongside the existing inline marks, and give both floating
toolbars (the format bubble and the callout color/icon toolbar) a proper **keyboard model**
(roving-tabindex arrow navigation + Esc-to-leave) — closing the a11y gaps the owner flagged
(Shift+Tab reaches the bubble but arrows don't navigate; callout toolbar doesn't Esc-away).

## Key context (verified)

- **Block types already round-trip both directions** (`packages/core/src/markdoc/`): heading
  (with `level`), paragraph, bulletList/orderedList (`list`), blockquote, codeBlock (`fence`).
  So the structural controls are **content-safe** — no `@setu/core` converter change needed.
- The **slash menu** (`extensions/SlashCommand.tsx` + `blocks.ts`) already *inserts* blocks
  (Text, H1, H2, lists, quote, code, divider, callout). This increment *transforms* the selected
  block and **shares one block-type registry** with the slash menu so they can't drift.
- The **format bubble** (`FormatBubble.tsx`) is a `@tiptap/react/menus` `BubbleMenu` shown on a
  non-empty text selection; its buttons use `onMouseDown preventDefault` so they never steal
  focus (the editor keeps the selection). It already has `role="toolbar"`.
- **Esc-to-leave is already handled** by the shipped focus-independent document listener in
  `FormatBubble` (`collapseSelectionOnEscape` → collapses selection, refocuses the editor →
  bubble hides). So the bubble's keyboard model needs **arrow navigation**, not new Esc wiring.
- The **callout toolbar** (`extensions/Callout.tsx` node view) shows on CSS `:focus-within`;
  "Esc-to-leave" there means moving focus out of the callout chrome back into the editor.

## Product decisions (confirmed)

- **Bubble shape:** a compact **"Turn into ▾" dropdown** (Notion-style) for block types, NOT a row
  of inline block buttons — keeps the bubble small and scales as we add color later.
- **Heading depth:** body offers **H2, H3, H4** (reserve `<h1>` for the rendered entry title,
  which is a separate `metadata.title` field) — SEO-clean. **The slash menu is updated to match**
  (replace its H1/H2 with H2/H3/H4) so the two surfaces agree.

## Scope

**In:**

1. **`editor/block-types.ts` — one shared block-type registry (source of truth).** An array of
   `{ id, label, icon, isActive(editor), setOn(chain) }` for: Text (paragraph), Heading 2,
   Heading 3, Heading 4, Bullet list, Numbered list, Quote, Code block. `isActive` reports whether
   the current selection is that type (e.g. `editor.isActive('heading', { level: 2 })`); `setOn`
   applies the transform to a Tiptap chain (`setNode('paragraph')` / `setNode('heading',{level})`
   / `toggleBulletList()` / `toggleOrderedList()` / `toggleBlockquote()` / `toggleCodeBlock()`).
   Pure data + thin helpers — unit-testable (every entry has label/icon/known id; `currentBlockType`
   picks the active one or Text).
2. **Slash menu consumes the registry** (`blocks.ts`) — its built-in block entries derive from the
   shared registry (slash *inserts*: `deleteRange(range)` then the same `setOn`), replacing the
   hardcoded H1/H2 with H2/H3/H4. Divider + Callout stay slash-only (insert-only; not block
   transforms, so not in the bubble dropdown).
3. **`TurnIntoMenu` in the format bubble** — a button labelled with the current block type
   (e.g. "Heading 2 ▾", default "Text ▾") that opens a small dropdown (`role="menu"`) listing the
   registry; picking an item applies `setOn` to the selection's block and closes. The dropdown is
   an absolutely-positioned panel anchored under the trigger (no nested tippy); it reuses
   `useDismiss` (Esc / click-outside close the dropdown back to the toolbar). The active item is
   marked (`aria-checked`/✓).
4. **Bubble layout:** `[ Turn into ▾ │ B I </> S │ 🔗 ]` — the dropdown trigger first, then the
   existing mark buttons, then Link. (The marks/link wiring + tooltips + `aria-keyshortcuts` from
   prior increments are unchanged.)
5. **Toolbar keyboard model (WAI-ARIA `toolbar`)** on the format bubble:
   - **Roving tabindex:** exactly one control has `tabIndex=0` (the rest `-1`), so the bubble is a
     single Tab stop. **Tab / Shift+Tab** moves focus in/out from the editor.
   - **← / →** move the active control (wrapping); **Home / End** jump to first/last;
     **Enter / Space** activate. The "Turn into" control opens its dropdown on Enter / ↓.
   - **Dropdown keys:** ↑/↓ move, Enter selects, **Esc** closes the dropdown back to the trigger.
   - **Esc** on the toolbar (dropdown closed) leaves the bubble = the already-shipped dismiss
     (collapse selection + refocus editor). No new Esc code; just don't swallow it.
   - **Mouse unchanged:** buttons keep `onMouseDown preventDefault` (no focus steal, selection
     preserved); roving tabindex only governs keyboard focus.
6. **Same keyboard model on the callout color/icon toolbar** (`Callout.tsx` node view): roving
   tabindex + ←/→ across the tone swatches + icon picker, and **Esc** moves focus from the toolbar
   back into the callout body (so the `:focus-within` chrome hides) — matching the bubble.
7. **Round-trip guard:** a test that a doc with H2/H3/H4 + lists + quote + code block survives
   `tiptapToMarkdoc` → `markdocToTiptap` (leaning on the core converter already handling these).

**Out (deferred — separate increments):**

- **Color / highlight** (new mark → needs Markdoc converter work first; see `docs/roadmap.md`).
- **Clever editor** typography + emoji input rules (separate, round-trip-safe increment).
- Text alignment, divider-in-bubble (stays a slash insert), nested-list controls, font family/size.
- Reworking the slash menu's own keyboard nav (already an ARIA listbox with arrows; unchanged
  beyond the registry swap).

## Architecture / components

```
apps/admin/src/editor/
├── block-types.ts          # NEW — shared registry {id,label,icon,isActive,setOn} + currentBlockType()
├── TurnIntoMenu.tsx        # NEW — the bubble's block-type dropdown (role=menu, useDismiss, keyboard)
├── useToolbarRoving.ts     # NEW — roving-tabindex + ←/→/Home/End hook for a role=toolbar container
├── FormatBubble.tsx        # MODIFY — add TurnIntoMenu + apply useToolbarRoving to the toolbar
├── blocks.ts               # MODIFY — slash built-ins derive from block-types (H2/H3/H4)
├── extensions/Callout.tsx  # MODIFY — apply useToolbarRoving + Esc-to-body on the variant toolbar
└── styles/editor.css       # MODIFY — Turn-into trigger + dropdown styles (reuse tokens)
```

- **`block-types.ts`** — the single list; `currentBlockType(editor)` returns the active entry (or
  the Text entry). Pure except for reading `editor.isActive` / building chains. Both the slash
  menu and `TurnIntoMenu` map over it.
- **`useToolbarRoving(containerRef, itemCount)`** — manages an `activeIndex`, sets `tabIndex` on the
  toolbar's focusable children (query `[data-toolbar-item]`), handles ←/→/Home/End to move focus.
  Generic enough for both the bubble and the callout toolbar. Esc is intentionally NOT handled here
  (the bubble's document listener / the callout's own handler own it).
- **`TurnIntoMenu`** — controlled open state; on open, focuses the active item; ↑/↓/Enter/Esc; reuses
  `useDismiss(panelRef, close, open)` for click-outside + Esc-closes-dropdown.

## Error handling / edge cases

- **Selection spanning multiple block types** → `currentBlockType` returns the type of the
  selection's anchor block (or Text if mixed); applying a transform sets all spanned blocks (Tiptap
  `setNode`/toggle semantics). Acceptable v1.
- **Code block / list active** → `isActive` reflects it; re-picking the same type is a no-op or
  toggles off where that's the Tiptap behavior (lists/quote/code toggle; headings/paragraph set).
- **Dropdown open + selection changes** (e.g. caret moves) → the bubble re-renders / may hide; the
  dropdown closes via `useDismiss` / unmount. No stale apply.
- **Esc precedence:** dropdown open → Esc closes the dropdown only (stopPropagation so it doesn't
  also collapse the selection); dropdown closed → Esc collapses/dismisses the bubble (shipped).
- **Roving focus when bubble appears by mouse** → no auto-focus (selection preserved); the roving
  state initializes to index 0 and only takes effect once the user Tabs in.

## Accessibility (standing bar)

- The bubble is a real `role="toolbar"` with roving tabindex, ←/→ navigation, Home/End, and
  Enter/Space activation — the WAI-ARIA toolbar pattern. The Turn-into control is
  `aria-haspopup="menu"`/`aria-expanded`; its dropdown is `role="menu"` with `role="menuitemradio"`
  + `aria-checked` items. The callout toolbar gets the same roving model. Esc leaves either toolbar
  back to the editor. All reachable and operable without a mouse.

## Testing (behavior)

- **`block-types.ts` (pure):** every entry has a non-empty label, a known `IconName`, a unique id;
  `currentBlockType` returns Text by default and the right entry when a heading/list/etc. is active
  (drive a real `Editor`, set a heading, assert).
- **Slash registry parity:** the slash built-ins now include H2/H3/H4 (not H1) and map to the shared
  registry (assert titles/levels).
- **`useToolbarRoving` (integration):** render a toolbar with N `[data-toolbar-item]` buttons;
  ArrowRight/ArrowLeft/Home/End move which has `tabIndex=0`/focus; wraps at ends.
- **`TurnIntoMenu` (testing-library):** the trigger shows the current type; opening lists the
  registry; clicking "Heading 3" turns the selected block into an H3 (assert `editor.isActive`);
  Esc/outside-click close the dropdown without collapsing the selection.
- **Round-trip guard:** H2/H3/H4 + bullet/ordered list + quote + code block doc →
  `tiptapToMarkdoc` → `markdocToTiptap` deep-equals the structural shape (content-safety).
- **Callout toolbar:** ←/→ move across the tone swatches; Esc returns focus to the callout body
  (assert focus left the toolbar). (The floating render is build+manual-verified where jsdom can't.)
- Existing editor suites stay green; `verbatimModuleSyntax`/`noUncheckedIndexedAccess` clean; build
  keeps fonts + jiti-free; **no new deps** (tippy/@tiptap already present).

## Definition of done

- `pnpm --filter @setu/admin test` green (registry + slash parity + roving + TurnIntoMenu +
  round-trip + callout) + existing; `pnpm -r typecheck` clean; build OK; no new deps.
- `pnpm dev`: select text → the bubble shows "Turn into ▾" reflecting the block type; picking
  Heading/List/Quote/Code transforms the block; **Tab** into the bubble, **←/→** navigate,
  **Enter** on "Turn into" opens the dropdown (↑/↓/Enter/Esc), **Esc** leaves the bubble; the
  callout toolbar navigates by ←/→ and Esc returns to the body; published content with the new
  block types reopens identically.
- Built test-first via the subagent-driven flow.

## Note on scope

One coherent increment: a shared block-type registry, a Turn-into dropdown, a reusable
roving-tabindex toolbar hook applied to both floating toolbars, and the round-trip guard. The
content model is untouched (all types already round-trip). Color/highlight + clever-editor +
alignment are explicitly separate, later increments.
