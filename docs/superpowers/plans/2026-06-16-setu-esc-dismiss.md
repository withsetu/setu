# Esc Dismisses the Active Editor Popup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Esc consistently dismiss the two editor popups that currently ignore it — the format bubble (by collapsing the selection) and the link card (hide + suppress re-show until the caret leaves the link) — with focus staying in the editor.

**Architecture:** The format bubble's buttons deliberately don't take focus (`onMouseDown preventDefault`), so while a selection is active **focus is in the ProseMirror editor, not the bubble** — therefore the bubble's Esc must be handled by the **editor keymap** (the existing `KeyboardShortcuts` extension), with a secondary React `onKeyDown` covering the keyboard-user-who-tabbed-into-the-bubble case. The link card lives in the `LinkTools` ProseMirror plugin, so its Esc is handled by that plugin's `handleKeyDown` plus a "dismissed for this link" flag. A tiny `dismiss.ts` holds the two shared, testable helpers.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), React 18, Tiptap v3 (`@tiptap/core`, `@tiptap/pm`), Vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-16-setu-esc-dismiss-design.md`

**Verified current state (do NOT re-verify):** Slash menu, block menu, link URL input (`LinkInput`), and shortcuts dialog already close on Esc. Only the **format bubble** and the **link card** (`LinkTools`/`LinkPopup`) do not. `LinkInput`'s Escape lives on a React input inside a tippy portal (outside `view.dom`), so the editor keymap never sees it — no propagation conflict. The `KeyboardShortcuts` extension already exists (`Mod-k`, `Mod-/`) and is the right home for an editor-level `Escape` keymap. Tiptap `addKeyboardShortcuts` handlers return `true` if handled / `false` to pass through.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/admin/src/editor/dismiss.ts` | `isEscape(e)` + `collapseSelectionOnEscape(editor)` | 1 |
| `apps/admin/src/editor/extensions/KeyboardShortcuts.ts` | add `Escape` keymap → collapse selection | 1 |
| `apps/admin/src/editor/FormatBubble.tsx` | secondary `onKeyDown` on the buttons view (tabbed-in keyboard users) | 1 |
| `apps/admin/src/editor/extensions/LinkTools.tsx` | Esc hides card + dismissed-until-caret-leaves flag; extend `shouldShowLinkCard` | 2 |
| (verification only) | full suite + typecheck + build | 3 |

No CSS changes (no new UI). No new dependencies.

---

## Task 1: `dismiss.ts` + format-bubble Esc (collapse selection)

**Files:** create `apps/admin/src/editor/dismiss.ts`, `apps/admin/test/dismiss.test.ts`; modify `apps/admin/src/editor/extensions/KeyboardShortcuts.ts`, `apps/admin/src/editor/FormatBubble.tsx`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/dismiss.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { isEscape, collapseSelectionOnEscape } from '../src/editor/dismiss'

describe('isEscape', () => {
  it('is true only for the Escape key', () => {
    expect(isEscape({ key: 'Escape' } as KeyboardEvent)).toBe(true)
    expect(isEscape({ key: 'Esc' } as KeyboardEvent)).toBe(false)
    expect(isEscape({ key: 'a' } as KeyboardEvent)).toBe(false)
  })
})

describe('collapseSelectionOnEscape', () => {
  let editor: Editor
  afterEach(() => editor?.destroy())

  const make = () =>
    new Editor({
      extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
    })

  it('collapses a non-empty selection and reports handled', () => {
    editor = make()
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(editor.state.selection.empty).toBe(false)
    expect(collapseSelectionOnEscape(editor)).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
  })

  it('does nothing (returns false) when the selection is already empty', () => {
    editor = make()
    editor.commands.setTextSelection(3)
    expect(collapseSelectionOnEscape(editor)).toBe(false)
    expect(editor.state.selection.empty).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- dismiss`
Expected: FAIL — `dismiss` module not found.

- [ ] **Step 3: Implement `dismiss.ts`**

`apps/admin/src/editor/dismiss.ts`:

```ts
import type { Editor } from '@tiptap/core'

/** True when a keyboard event is the Escape key. Pure. */
export function isEscape(e: KeyboardEvent): boolean {
  return e.key === 'Escape'
}

/** Esc behavior for the format bubble: collapse a non-empty text selection to a
 *  caret at its end (which makes the BubbleMenu's `shouldShow` go false → the bubble
 *  hides), keeping focus in the editor. Returns true if it collapsed something
 *  (handled), false when the selection was already empty (let Esc fall through). */
export function collapseSelectionOnEscape(editor: Editor): boolean {
  const { selection } = editor.state
  if (selection.empty) return false
  return editor.chain().focus().setTextSelection(selection.to).run()
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- dismiss`
Expected: PASS (4 cases).

- [ ] **Step 5: Wire the `Escape` keymap into `KeyboardShortcuts.ts`**

In `apps/admin/src/editor/extensions/KeyboardShortcuts.ts`, add the import and an `Escape` entry to the returned keymap (alongside `Mod-k` / `Mod-/`):

```ts
import { collapseSelectionOnEscape } from '../dismiss'
```

Add inside the object returned by `addKeyboardShortcuts()`:

```ts
      Escape: () => collapseSelectionOnEscape(this.editor),
```

> Returns `false` on an empty selection so Esc still falls through to the slash/suggestion plugin when its menu is open (that menu's caret is empty); returns `true` (handled) only when it actually collapsed a selection. The mark/block-move shortcuts are unaffected.

- [ ] **Step 6: Add the secondary React `onKeyDown` in `FormatBubble.tsx`**

This covers a keyboard user who has **tabbed focus onto a bubble button** (then `view.dom` doesn't receive the keydown). Add the import:

```tsx
import { isEscape, collapseSelectionOnEscape } from './dismiss'
```

On the **buttons-view** container only (the second `return`, the `<div className="fmt-bubble" role="toolbar" …>` at the end of `FormatBubbleToolbar` — NOT the `linking` return, whose Esc is owned by `LinkInput`), add an `onKeyDown`:

```tsx
    <div
      className="fmt-bubble"
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={(e) => {
        if (isEscape(e.nativeEvent)) {
          e.preventDefault()
          collapseSelectionOnEscape(editor)
        }
      }}
    >
```

> Idempotent with the keymap: whichever fires, the second call no-ops on the now-empty selection. The `linking` return is intentionally left as-is so one Esc cancels the link input (returns to the buttons, selection intact) without also collapsing.

- [ ] **Step 7: Run tests + typecheck + full admin suite**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — `dismiss` tests + existing format-bubble/tooltip/editor suites green; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/dismiss.ts apps/admin/test/dismiss.test.ts apps/admin/src/editor/extensions/KeyboardShortcuts.ts apps/admin/src/editor/FormatBubble.tsx
git commit -m "feat(editor): Esc collapses the selection to dismiss the format bubble

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Link card Esc dismissal (`LinkTools`)

**Files:** modify `apps/admin/src/editor/extensions/LinkTools.tsx`, `apps/admin/test/link-tools.test.ts` (create if absent; if a LinkTools test file already exists, ADD the cases to it — check first).

- [ ] **Step 1: Write the failing test for the extended predicate**

`apps/admin/test/link-tools.test.ts` (create, or append the `dismissed` cases to the existing `shouldShowLinkCard` tests if a file already covers it):

```ts
import { describe, it, expect } from 'vitest'
import { shouldShowLinkCard } from '../src/editor/extensions/LinkTools'

describe('shouldShowLinkCard', () => {
  it('shows for an empty selection inside a link with an href', () => {
    expect(shouldShowLinkCard(true, true, 'https://x.com', false)).toBe(true)
  })
  it('does not show when the card was dismissed for this link', () => {
    expect(shouldShowLinkCard(true, true, 'https://x.com', true)).toBe(false)
  })
  it('does not show without a selection-empty link+href', () => {
    expect(shouldShowLinkCard(false, true, 'https://x.com', false)).toBe(false)
    expect(shouldShowLinkCard(true, false, 'https://x.com', false)).toBe(false)
    expect(shouldShowLinkCard(true, true, '', false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- link-tools`
Expected: FAIL — `shouldShowLinkCard` currently takes 3 args; the `dismissed` cases fail to type/behave.

- [ ] **Step 3: Extend the pure predicate**

In `apps/admin/src/editor/extensions/LinkTools.tsx`, change `shouldShowLinkCard` to accept a 4th `dismissed` flag (default `false` so existing internal call sites needn't all change at once, though we update them in Step 4):

```ts
/** Whether the caret-triggered link card should show for this state. Pure.
 *  `dismissed` is true while the user has Esc-dismissed the card for the link the
 *  caret currently sits in (suppresses re-show until the caret leaves that link). */
export function shouldShowLinkCard(
  selectionEmpty: boolean,
  linkActive: boolean,
  href: string,
  dismissed = false,
): boolean {
  return selectionEmpty && linkActive && href.length > 0 && !dismissed
}
```

- [ ] **Step 4: Add the dismissed-flag flow + `handleKeyDown` in the plugin**

In the same file, inside `addProseMirrorPlugins()`:

1. Add the import at the top of the file:

```ts
import { isEscape } from '../dismiss'
```

2. Add a flag alongside the other plugin-scoped `let`s (near `let shownFor…`):

```ts
    let dismissedHref: string | null = null
```

3. Guard `showFor` so a dismissed link won't re-show (covers the hover trigger too). At the very top of `showFor`:

```ts
    const showFor = (anchor: HTMLElement, href: string) => {
      if (dismissedHref !== null && href === dismissedHref) return
      cancelHide()
      // …rest unchanged…
```

4. Add `handleKeyDown` to the plugin's `props` (next to `handleDOMEvents`):

```ts
        props: {
          handleKeyDown(_view, event) {
            if (isEscape(event) && popup) {
              dismissedHref = (editor.getAttributes('link').href as string | undefined) ?? ''
              hide()
              return true
            }
            return false
          },
          handleDOMEvents: {
            // …unchanged…
          },
        },
```

5. Update `view().update()` to clear the flag when the caret leaves the link (or the link changes) and to pass `dismissed` into the predicate:

```ts
            update() {
              const { state } = editor
              const href = (editor.getAttributes('link').href as string | undefined) ?? ''
              const inSameDismissedLink =
                dismissedHref !== null &&
                editor.isActive('link') &&
                state.selection.empty &&
                href === dismissedHref
              if (dismissedHref !== null && !inSameDismissedLink) dismissedHref = null // caret left → re-arm
              if (shouldShowLinkCard(state.selection.empty, editor.isActive('link'), href, inSameDismissedLink)) {
                const domAt = editor.view.domAtPos(state.selection.from)
                const node = domAt.node
                const el = node instanceof HTMLElement ? node : node.parentElement
                const a = el?.closest('a')
                if (a instanceof HTMLAnchorElement) showFor(a, href)
              } else if (popup && !popup.popper.matches(':hover')) {
                scheduleHide()
              }
            },
```

> When dismissed-and-still-in-the-link: `inSameDismissedLink` is true → `shouldShowLinkCard` returns false → the `else if` runs but `popup` is already `null` (we hid it) → no-op. Moving the caret out clears `dismissedHref`, re-arming normal behavior. Focus never left the editor (the card never took focus), so no explicit refocus is needed.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- link-tools`
Expected: PASS (predicate cases).

- [ ] **Step 6: Full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — existing LinkTools/link tests still green (the `showFor`/`update` changes are behavior-preserving when `dismissedHref` is null, i.e. the default path).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/extensions/LinkTools.tsx apps/admin/test/link-tools.test.ts
git commit -m "feat(editor): Esc dismisses the link card until the caret leaves the link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Full verification

- [ ] **Step 1: Whole suite** — Run: `pnpm -r test` — expect every package green; admin gains `dismiss` + `link-tools` cases.
- [ ] **Step 2: Typecheck** — Run: `pnpm -r typecheck` — expect clean (incl. core edge guard).
- [ ] **Step 3: Build + no new deps** — Run: `pnpm --filter @setu/admin build` (succeeds; fonts intact) and `git diff main -- apps/admin/package.json` (empty — tippy/@tiptap already present, nothing added).
- [ ] **Step 4: Manual (reviewer)** — `pnpm dev`: select text → **Esc** hides the bubble and leaves the caret where the selection ended; open the link URL input (Link button or Cmd/Ctrl+K) → **Esc** returns to the bubble buttons with the selection intact (a second Esc then collapses it); click into a link → the card shows → **Esc** hides it and it stays hidden while the caret stays in that link, re-showing once the caret moves out; the slash menu and block menu still Esc-close.

---

## Self-Review Notes (author)

- **Spec coverage:** format bubble Esc=collapse → Task 1 (keymap + React fallback); link card Esc=hide+suppress → Task 2; `isEscape`/`collapseSelectionOnEscape` shared helper → Task 1 `dismiss.ts`; consistent focus-return → covered (collapse keeps editor focus; card never took focus). Slash/block/dialog/input already handle Esc — untouched (spec scope).
- **The focus insight:** bubble buttons use `onMouseDown preventDefault`, so during a selection focus is in `view.dom` → the **editor keymap** is the primary Esc path; the React `onKeyDown` is only for the tabbed-into-bubble keyboard case. Both call the same idempotent helper.
- **No double-action:** the `linking` (LinkInput) return is left without the collapse `onKeyDown`; `LinkInput` owns Esc there (cancel → buttons, selection intact). One Esc = one action.
- **Behavior-preserving for the default path:** the `LinkTools` changes are inert while `dismissedHref` is null (the normal case), so existing link-card tests/behavior stay green.
- **Type consistency:** `isEscape(e: KeyboardEvent)`, `collapseSelectionOnEscape(editor: Editor): boolean`, `shouldShowLinkCard(selectionEmpty, linkActive, href, dismissed=false)` — used identically across tasks.
- **No new deps; no CSS.** Honest test scope: pure helpers + the collapse behavior (real `Editor`) + the predicate are unit-tested; the keymap binding and the tippy float dismissal are build+manual verified (consistent with prior keymap/LinkTools deferrals — jsdom can't show tippy floats and keymap-binding dispatch is flaky).
```
