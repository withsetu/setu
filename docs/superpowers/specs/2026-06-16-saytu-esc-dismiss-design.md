# Design — Esc dismisses the active editor popup

_Date: 2026-06-16 · Status: approved (design + the one UX choice confirmed in UAT discussion)_

## Purpose

Make **Esc** a uniform, predictable "dismiss the thing that's open, put me back in my text"
gesture across the editor. The owner flagged this as **"very important for a smooth flow"**:
today some editor popups swallow Esc and some don't, so the behavior is inconsistent.

## Key context (verified — current reality)

A read of the editor popups found:

- **Already close on Esc:** the slash menu (`SlashCommand` — suggestion `onKeyDown` → `popup.hide()`),
  the block menu (`BlockMenu` — `onClose()` on Escape; Canvas's `close()` also refocuses the
  editor), the inline link URL input (`LinkInput` — Escape → `onCancel()` → refocus), and the
  shortcuts dialog (`ShortcutsDialog` — document keydown → `onClose()`).
- **Do NOT close on Esc (the gap):**
  - **The format bubble** (`FormatBubble`) — visibility is driven by the text selection
    (`BubbleMenu` `shouldShow`), so it only hides when the selection collapses; Esc is ignored.
  - **The link card** (`LinkTools` / `LinkPopup`) — hides only via a grace-timer when the caret or
    pointer leaves the link; Esc is ignored.
- **Consistency nit:** `SlashCommand` and `LinkTools` don't *explicitly* return focus to the caret
  on dismiss (slash stays in the editor anyway since the user is typing; the link card is passive).
- **No shared dismiss/Escape utility exists** — each popup rolls its own. This increment adds a
  small shared helper so the new behavior is consistent rather than re-rolled.

## Scope

**In:**

1. **Format bubble closes on Esc by collapsing the selection.** The confirmed UX choice: Esc
   collapses the current text selection to a caret (at the selection's `to`/end), which makes
   `BubbleMenu`'s `shouldShow` go false and the bubble disappears; **editor keeps focus**. This is
   the standard editor behavior (Notion / Google Docs). **Priority:** if the bubble's inline
   **link URL input is open**, Esc closes the input first (returns to the bubble's button row) —
   that path already exists in `LinkInput`; we just ensure one Esc performs one action (the input's
   Escape must not also collapse the selection). The bubble-level Esc (collapse selection) applies
   only when the input is **not** open.
2. **Link card closes on Esc.** When the link card is shown (caret-in-link or hover), Esc hides it
   and **suppresses re-show until the caret leaves the link** (so it doesn't immediately pop back
   while the caret is still inside). Focus stays in the editor. Implemented via a "dismissed for
   this link range" flag in `LinkTools` cleared when the caret moves out of the link.
3. **Focus return on dismiss is consistent.** Every Esc dismissal leaves focus in the editor at the
   caret. Where a popup already refocuses (block menu, link input) keep it; where it doesn't
   (link card) add it.
4. **A tiny shared helper** for "is this keydown an Escape" / dismiss-and-refocus, so the format
   bubble and link card don't each hand-roll subtly different handlers. Keep it minimal (no
   over-abstraction): e.g. a pure `isEscape(e)` + a `dismissToEditor(editor)` that collapses any
   selection-driven chrome and calls `editor.commands.focus()`. The already-working popups
   (slash, block menu, dialog, link input) are left as-is unless they need the focus-return nit.

**Out (deferred):**

- Click-outside / backdrop dismissal for the bubble or link card (Esc is the ask; the bubble
  already auto-hides on selection change, the card on caret/pointer-leave).
- A global "Esc closes everything" document-level manager that knows a priority stack across all
  popups — not needed; at most one of {bubble, link card} is meaningfully "the active popup" at a
  time, and the slash/block menus already own their Esc while open. We keep each popup's Esc local
  but behaviorally uniform.
- Changing the slash/block menu Esc behavior (already correct).
- Esc behavior for the callout toolbar / node-view chrome (separate; not a popup the owner flagged).

## Architecture / components

```
apps/saytu-admin/src/editor/
├── dismiss.ts                   # NEW — isEscape(e) + dismissToEditor(editor) (pure-ish helpers)
├── FormatBubble.tsx             # MODIFY — bubble-level onKeyDown: Esc collapses selection (when link input closed)
├── extensions/LinkTools.tsx     # MODIFY — Esc hides the card + "dismissed until caret leaves link" flag + refocus
└── (SlashCommand.tsx / BlockMenu.tsx — verify focus-return; change only if missing)
```

- **`dismiss.ts`** — `isEscape(e: KeyboardEvent | React.KeyboardEvent): boolean` (`e.key === 'Escape'`);
  `dismissToEditor(editor)` — collapse selection to its `to` (`editor.chain().focus().setTextSelection(to).run()`),
  used by the bubble. Pure/thin; unit-testable for `isEscape`.
- **FormatBubble** — add an `onKeyDown` on the toolbar container (or a keydown listener while
  mounted): when the link input is **not** open and Esc is pressed, call `dismissToEditor(editor)`
  → selection collapses → `BubbleMenu` hides. The existing `LinkInput` Esc (cancel) keeps working
  and `stopPropagation`s so it doesn't bubble to the collapse handler.
- **LinkTools** — on the card, handle Esc (the card content or a plugin-level keydown): `hide()` +
  set a `dismissedRange` (the link's from/to or href identity); the `update()`/`showFor` path skips
  showing while the caret is still within `dismissedRange`; clear it when the caret leaves. Add
  `editor.commands.focus()` if focus isn't already in the editor.

## Error handling / edge cases

- **Esc with link input open** → input cancels (existing), selection is NOT collapsed (input handler
  stops propagation / the bubble handler checks `linking` state first). One Esc = one action.
- **Esc with no selection / bubble not shown** → nothing to collapse; harmless no-op (the bubble
  isn't mounted/shown).
- **Esc while link card dismissed and caret still in link** → stays hidden (the flag), no flicker;
  moving the caret out and back in re-shows it (flag cleared on leave).
- **Esc precedence with slash/block menus open** → those own Esc while active (suggestion/menu
  keydown) and already hide; the bubble/card handlers won't be the active target then.
- **Focus** — after collapse, `editor.commands.focus()` keeps the user typing where they were.

## Accessibility (standing bar)

- Esc-to-dismiss is a standard a11y expectation for transient UI; this makes the bubble and link
  card keyboard-dismissable like the menus/dialog already are. Focus returns to the editing caret
  so keyboard users aren't stranded. No focus traps introduced.

## Testing (behavior)

- **`isEscape`** (pure unit): true for `key:'Escape'`, false otherwise.
- **Format bubble Esc collapses selection (integration, @testing-library + real Editor):** select
  text → bubble's toolbar present → fire Esc on the toolbar → selection is collapsed
  (`editor.state.selection.empty === true`) and the toolbar's `shouldShow` would be false.
- **Esc with link input open cancels the input, does NOT collapse selection:** open `LinkInput`
  (set `linking`) → Esc → the URL textbox is gone (back to buttons) AND the selection is still
  non-empty (one action only).
- **Link card Esc hides + suppresses re-show (LinkTools):** with the card shown for a caret-in-link,
  Esc → card hidden; an `update()` with the caret still in the same link does NOT re-show; moving
  the caret out clears the flag. (Test the predicate/flag logic; the tippy float itself is
  build+manual verified, consistent with prior LinkTools tests.)
- Existing editor suites stay green; `verbatimModuleSyntax` (`import type`) + `noUncheckedIndexedAccess`
  clean; build keeps fonts + jiti-free; **no new deps**.

## Definition of done

- `pnpm --filter @saytu/admin test` green (isEscape + bubble-Esc-collapses + input-Esc-priority +
  link-card-Esc) + existing; typecheck clean; build OK; no new deps.
- `pnpm dev`: select text → Esc hides the bubble and keeps the caret; open the link URL input →
  Esc returns to the bubble buttons (selection intact); click into a link → Esc hides the card and
  it stays hidden until the caret leaves the link; slash/block menus still Esc-close.
- Built test-first via the subagent-driven flow.

## Note on scope

One tight, well-bounded increment: a small shared dismiss helper plus Esc handling on the two
popups that lack it (format bubble → collapse selection; link card → hide + suppress-until-leave),
with consistent focus-return. The slash menu, block menu, link input, and shortcuts dialog already
handle Esc and are left alone (only a focus-return nit if missing). No new dependencies.
