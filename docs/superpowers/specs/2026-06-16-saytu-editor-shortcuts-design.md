# Design — Editor keyboard shortcuts (hints + link shortcut + cheat sheet)

_Date: 2026-06-16 · Status: approved (converged in UAT discussion)_

## Purpose

Make the editor's keyboard shortcuts **exist, discoverable, and documented**: add a
`Cmd/Ctrl+K` shortcut for links, show each toolbar button's shortcut on hover/focus, and
provide a cheat-sheet of all editor shortcuts. A single **shortcuts registry** is the source
of truth so the hints and the cheat sheet never drift.

## Key context (verified)

- **Tiptap's Link extension binds NO shortcut** — their docs: *"this extension doesn't bind a
  specific keyboard shortcut; you'd probably open your custom UI on `Mod-k`."* So `Mod-k` is
  ours to add — no double-binding.
- **StarterKit mark defaults** (Cmd on Mac / Ctrl elsewhere): **Bold `Mod-b`, Italic `Mod-i`,
  Strikethrough `Mod-Shift-s`, Code `Mod-e`** (Underline `Mod-u` — but we disabled underline).
  Our **block moves** are `Alt-Shift-ArrowUp` / `Alt-Shift-ArrowDown` (BlockActions).
- `tippy.js` is already a dependency (used by SlashCommand/BlockMenu); it shows on hover **and**
  focus — good for the tooltips' a11y.

## Scope

**In:**

1. **`editor/shortcuts.ts` — the registry (source of truth).** An array of
   `{ id, label, keys: string[], group }` (groups: `Formatting` / `Links` / `Blocks`), and a
   pure **`formatKeys(keys, mac)`** that renders platform glyphs (`⌘ ⌥ ⇧ ↑ ↓` on Mac;
   `Ctrl Alt Shift ↑ ↓` elsewhere; letters upper-cased). A browser-only `detectMac()` reads
   `navigator`. Both the tooltips and the cheat sheet consume this — they can't disagree.
2. **`editor/editor-events.ts` — a tiny event bridge.** Two request channels with
   `on…(cb) → unsubscribe` + `request…()`: `requestLinkEdit` and `requestShortcuts`. This
   bridges the Tiptap keymap (outside React) to React components (the bubble / the dialog)
   without prop-drilling through the BubbleMenu portal.
3. **`KeyboardShortcuts` extension** — a Tiptap extension binding our two custom keys:
   - `Mod-k`: if the selection is **non-empty**, `requestLinkEdit()` and return `true`; if
     empty, return `false` (no-op, v1).
   - `Mod-/`: `requestShortcuts()` (open the cheat sheet).
   (Mark + block-move shortcuts stay where they are — StarterKit / BlockActions; the registry
   just documents them.)
4. **Tooltips on the format-bubble buttons.** A small `Tooltip` wrapper (tippy, trigger
   `mouseenter focus`) shows `"<label>  <formatted keys>"` for each FormatBubble button
   (Bold/Italic/Code/Strike/Link); buttons also get `aria-keyshortcuts` (W3C format, e.g.
   `Meta+B`) for screen readers. `FormatBubbleToolbar` subscribes to `onRequestLinkEdit` → opens
   its existing inline `LinkInput`.
5. **`ShortcutsDialog` — the cheat sheet.** A modal (`role="dialog"` `aria-modal`, focus-trap,
   Esc closes, click-backdrop closes) listing the registry grouped by section, each row =
   label + rendered keys. Opened by a **keyboard `?` button in the editor top strip**
   (`ed-strip-right`) **or** `Mod-/`. `EditorScreen` owns the open state and subscribes to
   `onRequestShortcuts`.

**Out (deferred):**

- User-customizable / re-bindable shortcuts.
- Tooltips on the BlockMenu items and slash menu (the cheat sheet documents those; toolbar
  hover-hints are the v1 ask).
- `Mod-k` selecting the word under the caret when there's no selection (v1 no-ops).
- Auto-deriving shortcut strings from ProseMirror keymaps (not cleanly enumerable; the registry
  is hand-authored and kept truthful by matching the verified defaults).

## Architecture / components

```
apps/saytu-admin/src/editor/
├── shortcuts.ts                 # NEW — registry + formatKeys(keys, mac) + detectMac()
├── editor-events.ts             # NEW — requestLinkEdit/onRequestLinkEdit, requestShortcuts/onRequestShortcuts
├── extensions/KeyboardShortcuts.ts  # NEW — Tiptap extension: Mod-k (link) + Mod-/ (cheat sheet)
├── Tooltip.tsx                  # NEW — tippy wrapper (hover+focus) for a single child
├── ShortcutsDialog.tsx          # NEW — the cheat-sheet modal
├── FormatBubble.tsx             # MODIFY — wrap buttons in Tooltip + aria-keyshortcuts; subscribe to onRequestLinkEdit
├── Canvas.tsx                   # MODIFY — register KeyboardShortcuts
└── EditorScreen.tsx             # MODIFY — a "?" strip button + ShortcutsDialog state + onRequestShortcuts
apps/saytu-admin/src/styles/editor.css  # MODIFY — tooltip + dialog + strip-button styles
```

- **`formatKeys(keys, mac)`** maps token → glyph: `Mod`→`⌘`/`Ctrl`, `Alt`→`⌥`/`Alt`,
  `Shift`→`⇧`/`Shift`, `ArrowUp`→`↑`, `ArrowDown`→`↓`, single letters → upper-case; joined with
  a thin space (Mac) / `+` (other). Pure → unit-tested for both platforms.
- **`aria-keyshortcuts`** uses the W3C token form (`Meta+B`, `Meta+Shift+S`, `Meta+K`) — derived
  by a small mapper from the same `keys` (so it stays in sync).
- **Registry entries (v1):** Formatting — Bold `[Mod,b]`, Italic `[Mod,i]`, Inline code
  `[Mod,e]`, Strikethrough `[Mod,Shift,s]`; Links — Add/edit link `[Mod,k]`; Blocks — Move block
  up `[Alt,Shift,ArrowUp]`, Move block down `[Alt,Shift,ArrowDown]`; Help — Keyboard shortcuts
  `[Mod,/]`.
- **Mod-k flow:** `KeyboardShortcuts` (registered in Canvas) `Mod-k` → `requestLinkEdit()`. The
  format bubble is already visible whenever the selection is non-empty, so its
  `FormatBubbleToolbar` (subscribed via `useEffect`) flips to `linking` and shows the
  pre-filled `LinkInput`. No second link UI.

## Error handling / edge cases

- **`Mod-k` with empty selection** → handler returns `false` (no link UI; lets the keystroke
  fall through). v1 no-op by design.
- **Event bus with no listener** (e.g. `Mod-k` when the bubble isn't mounted) → `request…()`
  iterates zero listeners, harmless no-op.
- **Dialog focus-trap** → focus moves into the dialog on open and is restored to the trigger on
  close; Esc and backdrop click both close.
- **Platform detection** is best-effort (`navigator`); the keys still *work* regardless of glyph
  shown (Tiptap's `Mod` already resolves per-platform).
- **Tooltip teardown** — the tippy instance is destroyed on unmount (no leak), mirroring the
  BlockMenu/LinkTools pattern.

## Accessibility (standing bar)

- Tooltips trigger on **focus** as well as hover, so keyboard users see the hint; buttons carry
  `aria-keyshortcuts`.
- The cheat sheet is a proper `role="dialog"` `aria-modal="true"` with a focus trap, Esc-to-close,
  labelled by its heading; the `?` trigger is a real labelled button reachable by keyboard, and
  `Mod-/` opens it from anywhere in the editor.
- The block-move / mark shortcuts are all listed so they're discoverable without a mouse.

## Testing (behavior)

- **`formatKeys` (pure unit):** `[Mod,b]` → `⌘B` (mac) / `Ctrl+B` (non-mac); `[Mod,Shift,s]` →
  `⌘⇧S` / `Ctrl+Shift+S`; `[Alt,Shift,ArrowUp]` → `⌥⇧↑` / `Alt+Shift+↑`. The W3C
  `aria-keyshortcuts` mapper: `[Mod,k]` → `Meta+K`.
- **Registry:** every entry has a label + non-empty keys + a known group (guards drift).
- **`Tooltip`:** renders its child and exposes the content (assert the tippy content / the
  button's `aria-keyshortcuts`).
- **`Mod-k` → link input (integration):** with a non-empty selection, `requestLinkEdit()` (or the
  keymap) opens the FormatBubble's URL input (the `LinkInput` textbox appears).
- **`ShortcutsDialog` (testing-library):** the `?` button opens it; it lists representative
  shortcuts (e.g. "Bold", "Add/edit link"); Esc / backdrop close it; focus returns to the trigger.
- Existing suites stay green; `verbatimModuleSyntax` + `noUncheckedIndexedAccess` clean; build
  keeps fonts + jiti-free; no new deps (tippy already present).

## Definition of done

- `pnpm --filter @saytu/admin test` green (formatKeys + registry + Tooltip + Mod-k + dialog) +
  existing; typecheck clean; build OK.
- `pnpm dev`: hovering/focusing a format button shows its shortcut; `Cmd/Ctrl+K` on a selection
  opens the link input; the `?` strip button and `Cmd/Ctrl+/` open the cheat sheet listing all
  shortcuts; Esc closes it.
- Built test-first via the subagent-driven flow.

## Note on scope

One well-bounded increment hung on a shared registry: registry+formatKeys, the event bridge, a
Tiptap keymap extension, button tooltips, and a cheat-sheet modal. Decomposed into tight TDD
tasks in the plan: (1) `shortcuts.ts` (registry + formatKeys + aria mapper) + tests; (2)
`editor-events.ts` + `KeyboardShortcuts` extension (Mod-k/Mod-/) + Canvas registration; (3)
`Tooltip` + FormatBubble hints + Mod-k-opens-LinkInput wiring; (4) `ShortcutsDialog` + strip
button + Mod-/ wiring; (5) CSS. No new dependencies.
