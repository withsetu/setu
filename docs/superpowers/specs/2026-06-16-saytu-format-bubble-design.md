# Design — Format bubble menu + link card (inline text formatting)

_Date: 2026-06-16 · Status: approved (converged in UAT discussion)_

## Purpose

Complete the editor's *editing feel*: the just-shipped block-interaction layer covers
block-level manipulation; this adds the **text-level** complement — a **format bubble menu**
on a text selection (bold / italic / inline-code / strike / link) and a **link card** that
appears when the caret enters a link (keyboard) or the mouse hovers one, letting you open it
in a new tab, edit, or remove it. Inline formatting is the other half of "feels like a real
modern editor."

## Key context (verified)

- **StarterKit v3 already includes the marks** — Bold, Italic, Strike, Code, **Link** (and
  Underline). So **no new dependency**: we configure StarterKit's Link, we don't add
  `@tiptap/extension-link`. (`linkifyjs`, Link's dep, is already in the bundle.)
- **The Markdoc round-trip already handles** `bold`, `italic`, `strike`, `code`, and
  `link {href}` in both directions (`packages/core/src/markdoc/`). No converter work needed.
- **BubbleMenu** is imported from `@tiptap/react/menus` in v3 (uses `@floating-ui/dom`).
- **Underline is the exception** — StarterKit bundles it, but the converter does NOT
  round-trip underline, so a stray Cmd+U would silently drop formatting on publish. We
  **disable underline** here (cardinal rule); "underline round-trip" goes to the roadmap.

## Scope

**In:**

1. **Configure StarterKit** — `link: { openOnClick: false }` (clicking a link in the editor
   places the caret rather than navigating; opening is the link card's explicit job), and
   `underline: false` (prevents un-round-trippable formatting).
2. **`FormatBubble`** — a `BubbleMenu` (from `@tiptap/react/menus`) shown when there is a
   **non-empty text selection** in an editable doc. Controls: **Bold, Italic, Inline-code,
   Strike** (mark toggles, `aria-pressed` reflecting `editor.isActive`), and **Link**. Clicking
   Link swaps the button row for an **inline URL input** (Enter = apply via `setLink({href})`,
   Esc = cancel); if the selection is already linked, the input is pre-filled and shows
   **Remove**.
3. **`LinkPopup`** (the link card) — shown when the selection is **empty but inside a link**
   (caret/keyboard) **or** the mouse **hovers** a link. Contents: the href as an **Open ↗**
   anchor (`target="_blank" rel="noopener noreferrer"`), **Edit** (reopens the URL input on
   that link), **Remove** (`unsetLink`). Keyboard-reachable.
4. **Round-trip tests** — a selection with each mark + a link survives
   `tiptapToMarkdoc(getJSON())` unchanged.

**Out (deferred — see `docs/roadmap.md`):**

- **Per-link attributes** — "open in new window" (`target`) + `nofollow` (`rel`) on the stored
  link. Needs a Markdoc converter/round-trip extension (Markdown links can't carry
  target/rel); its own slice. (The link card's *Open ↗* opens in a new tab as an editor
  convenience only — not a stored attribute.)
- **Underline round-trip** support in the converter (then re-enable the mark).
- Autolink-on-paste, URL validation beyond non-empty, `sponsored`/`ugc` rels, link titles.

## Architecture / components

```
apps/saytu-admin/src/editor/
├── Canvas.tsx              # configure StarterKit (link openOnClick:false, underline:false);
│                           # render <FormatBubble/> + <LinkPopup/> inside the editor context
├── FormatBubble.tsx        # NEW — selection bubble: 4 mark toggles + Link (inline URL input)
└── LinkPopup.tsx           # NEW — caret-in-link / hover-link card: Open ↗ / Edit / Remove
apps/saytu-admin/src/styles/editor.css   # bubble + link-card styles
```

- **FormatBubble** uses `BubbleMenu`'s `shouldShow` to appear only on a non-empty selection
  (`!selection.empty` and editable). Mark buttons call `editor.chain().focus().toggleBold()`
  etc.; state via `editor.isActive('bold')`. The Link sub-state (showing the URL input) is
  local component state; applying calls `setLink({ href })`, removing calls `unsetLink()`.
- **LinkPopup** appears via two triggers sharing one card:
  - **caret/keyboard:** a `BubbleMenu` (or `shouldShow`) condition `selection.empty &&
    editor.isActive('link')`, anchored to the link.
  - **mouse hover:** a lightweight hover handler on `.ProseMirror a` elements that anchors the
    same card to the hovered link.
  The exact floating mechanism (a second BubbleMenu vs. a small positioned popover) is a
  plan-level detail; behavior is: show the card for the active/hovered link, hide on
  leave/Esc.
- **Open ↗** is a real `<a href target="_blank" rel="noopener noreferrer">` so Enter/click both
  open it; opening is never automatic (StarterKit `openOnClick:false`).

## Error handling / edge cases

- **Empty/whitespace URL** in the input → no-op (don't create an empty link); Esc/blur cancels.
- **Apply over an existing link** → updates the href (`setLink` extends the mark).
- **Remove** → `unsetLink` over the link's range; caret preserved.
- **Read-only** (`editable=false`) → neither the bubble nor edit/remove actions appear; the
  link card may still show **Open ↗** (read-only viewers can follow links) but not Edit/Remove.
- **Selection spanning mixed formatting** → toggles apply Tiptap's default (toggle to uniform);
  no special handling.
- **Round-trip** → only already-supported marks are exposed, so serialization is safe; asserted
  by tests. Underline disabled so it can't be introduced.

## Accessibility (standing bar)

- The format bubble appears on **selection** (keyboard or mouse), not hover — so it's reachable
  by selecting text with the keyboard. Buttons are real `<button>`s with `aria-pressed`; the
  bubble is `role="toolbar"`, arrow/Tab navigable; Esc returns focus to the editor.
- The link card triggers on **caret-in-link** (keyboard), not only hover; its actions are
  buttons/links, keyboard-operable; **Open ↗** is a focusable anchor.
- No focus traps; closing returns focus to the editor selection.

## Testing (behavior)

- **Mark toggles:** selecting text and toggling bold/italic/code/strike adds/removes the mark
  (`editor.isActive`), and `tiptapToMarkdoc(getJSON())` reflects it (round-trip).
- **Link create/edit/remove:** apply a URL to a selection → `link` mark with `href`; re-open →
  pre-filled; Remove → mark gone; round-trip preserves `[text](href)`.
- **Bubble visibility:** `shouldShow` true for a non-empty selection, false when empty / not
  editable.
- **Link card:** shows for a caret inside a link; **Open ↗** has `target="_blank"
  rel="noopener noreferrer"`; Edit reopens the input; Remove unlinks.
- **Underline disabled:** the underline command/mark is not active (no silent un-round-trippable
  formatting).
- Existing editor tests stay green; `verbatimModuleSyntax` + `noUncheckedIndexedAccess` clean;
  build keeps fonts + stays jiti-free; **no new dependency added**.

## Definition of done

- `pnpm --filter @setu/admin test` green (bubble + link tests + existing suite); typecheck
  clean; `pnpm --filter @setu/admin build` OK.
- `pnpm dev`: select text → bubble appears → toggles work; Link → inline URL input → link
  created; caret into a link (or hover) → card with Open ↗ / Edit / Remove; everything
  keyboard-operable; Cmd+U does nothing (underline disabled).
- Built test-first via the subagent-driven flow.

## Note on scope

Self-contained, editor-only increment: configure StarterKit + two small floating components +
CSS, no new deps and no converter changes (marks already round-trip). Decomposed into tight TDD
tasks in the plan: (1) StarterKit config + FormatBubble mark toggles + round-trip tests,
(2) link create/edit/remove via the inline input, (3) LinkPopup (caret + hover) with Open/Edit/
Remove, (4) CSS. Per-link attributes and underline round-trip are deferred to the roadmap.
