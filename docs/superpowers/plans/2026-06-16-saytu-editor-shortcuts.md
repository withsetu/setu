# Editor Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editor shortcuts discoverable (hover/focus hints), add a `Cmd/Ctrl+K` link shortcut, and add a keyboard-shortcuts cheat sheet — all driven by one shortcuts registry.

**Architecture:** A single `shortcuts.ts` registry (+ pure `formatKeys`/`ariaKeyshortcuts`) is the source of truth. A tiny `editor-events.ts` emitter bridges a Tiptap keymap extension (`Mod-k`, `Mod-/`) to React (the format bubble's link input, and the cheat-sheet dialog). Tooltips reuse `tippy.js` (already a dep). No new dependencies; no `@setu/core` changes.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), React 18, Tiptap v3, `tippy.js` (existing), Vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-16-saytu-editor-shortcuts-design.md`

**Verified shortcuts (do NOT re-verify):** Bold `Mod-b`, Italic `Mod-i`, Inline code `Mod-e`, Strikethrough `Mod-Shift-s` (StarterKit defaults); Link has **no** Tiptap default (we add `Mod-k`); block moves `Alt-Shift-ArrowUp/ArrowDown` (BlockActions). Tiptap `addKeyboardShortcuts` handlers return `true` if handled (stops propagation) / `false` to pass through.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/admin/src/editor/shortcuts.ts` | registry + `formatKeys` + `ariaKeyshortcuts` + `detectMac` | 1 |
| `apps/admin/src/editor/editor-events.ts` | `requestLinkEdit/onRequestLinkEdit`, `requestShortcuts/onRequestShortcuts` | 2 |
| `apps/admin/src/editor/extensions/KeyboardShortcuts.ts` | Tiptap keymap: `Mod-k`, `Mod-/` | 2 |
| `apps/admin/src/editor/Canvas.tsx` | register `KeyboardShortcuts` | 2 |
| `apps/admin/src/editor/Tooltip.tsx` | tippy hover+focus wrapper | 3 |
| `apps/admin/src/editor/FormatBubble.tsx` | button tooltips + aria-keyshortcuts + open-link subscription | 3 |
| `apps/admin/src/editor/ShortcutsDialog.tsx` | the cheat-sheet modal | 4 |
| `apps/admin/src/ui/Icon.tsx` | add `keyboard` icon | 4 |
| `apps/admin/src/editor/EditorScreen.tsx` | `?` strip button + dialog state + `onRequestShortcuts` | 4 |
| `apps/admin/src/styles/editor.css` | tooltip theme + dialog + strip button | 5 |

---

## Task 1: `shortcuts.ts` — registry + formatters

**Files:** create `apps/admin/src/editor/shortcuts.ts`, `apps/admin/test/shortcuts.test.ts`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/shortcuts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SHORTCUTS, formatKeys, ariaKeyshortcuts } from '../src/editor/shortcuts'
import type { ShortcutGroup } from '../src/editor/shortcuts'

describe('formatKeys', () => {
  it('renders Mac glyphs (no separator)', () => {
    expect(formatKeys(['Mod', 'b'], true)).toBe('⌘B')
    expect(formatKeys(['Mod', 'Shift', 's'], true)).toBe('⌘⇧S')
    expect(formatKeys(['Alt', 'Shift', 'ArrowUp'], true)).toBe('⌥⇧↑')
  })
  it('renders PC labels joined by +', () => {
    expect(formatKeys(['Mod', 'b'], false)).toBe('Ctrl+B')
    expect(formatKeys(['Mod', 'Shift', 's'], false)).toBe('Ctrl+Shift+S')
    expect(formatKeys(['Alt', 'Shift', 'ArrowDown'], false)).toBe('Alt+Shift+↓')
  })
})

describe('ariaKeyshortcuts', () => {
  it('renders the W3C token form', () => {
    expect(ariaKeyshortcuts(['Mod', 'b'])).toBe('Meta+B')
    expect(ariaKeyshortcuts(['Mod', 'Shift', 's'])).toBe('Meta+Shift+S')
    expect(ariaKeyshortcuts(['Mod', 'k'])).toBe('Meta+K')
  })
})

describe('SHORTCUTS registry', () => {
  it('every entry has a label, non-empty keys, and a known group', () => {
    const groups: ShortcutGroup[] = ['Formatting', 'Links', 'Blocks', 'Help']
    for (const s of SHORTCUTS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.keys.length).toBeGreaterThan(0)
      expect(groups).toContain(s.group)
    }
  })
  it('includes the link shortcut Mod-k', () => {
    const link = SHORTCUTS.find((s) => s.id === 'link')
    expect(link?.keys).toEqual(['Mod', 'k'])
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- shortcuts`
Expected: FAIL — `shortcuts` module not found.

- [ ] **Step 3: Implement `shortcuts.ts`**

`apps/admin/src/editor/shortcuts.ts`:

```ts
export type ShortcutGroup = 'Formatting' | 'Links' | 'Blocks' | 'Help'

export interface Shortcut {
  id: string
  label: string
  keys: string[]
  group: ShortcutGroup
}

/** Single source of truth for editor shortcuts — consumed by the tooltips and the
 *  cheat sheet so they can't drift. `keys` use tokens: Mod/Alt/Shift + a letter or
 *  ArrowUp/ArrowDown. Mark + block-move keys match the actual StarterKit/BlockActions
 *  bindings; the link key is the one we add (KeyboardShortcuts extension). */
export const SHORTCUTS: Shortcut[] = [
  { id: 'bold', label: 'Bold', keys: ['Mod', 'b'], group: 'Formatting' },
  { id: 'italic', label: 'Italic', keys: ['Mod', 'i'], group: 'Formatting' },
  { id: 'code', label: 'Inline code', keys: ['Mod', 'e'], group: 'Formatting' },
  { id: 'strike', label: 'Strikethrough', keys: ['Mod', 'Shift', 's'], group: 'Formatting' },
  { id: 'link', label: 'Add or edit link', keys: ['Mod', 'k'], group: 'Links' },
  { id: 'moveUp', label: 'Move block up', keys: ['Alt', 'Shift', 'ArrowUp'], group: 'Blocks' },
  { id: 'moveDown', label: 'Move block down', keys: ['Alt', 'Shift', 'ArrowDown'], group: 'Blocks' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['Mod', '/'], group: 'Help' },
]

const MAC_GLYPH: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', ArrowUp: '↑', ArrowDown: '↓' }
const PC_LABEL: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', ArrowUp: '↑', ArrowDown: '↓' }

/** Render a shortcut for display, platform-aware. Mac uses adjacent glyphs (⌘⇧S);
 *  other platforms use `+`-joined labels (Ctrl+Shift+S). Pure. */
export function formatKeys(keys: string[], mac: boolean): string {
  const map = mac ? MAC_GLYPH : PC_LABEL
  const parts = keys.map((k) => map[k] ?? (k.length === 1 ? k.toUpperCase() : k))
  return mac ? parts.join('') : parts.join('+')
}

const ARIA: Record<string, string> = { Mod: 'Meta', Alt: 'Alt', Shift: 'Shift', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown' }

/** W3C `aria-keyshortcuts` token form, e.g. "Meta+Shift+S". Pure. */
export function ariaKeyshortcuts(keys: string[]): string {
  return keys.map((k) => ARIA[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join('+')
}

/** Best-effort Mac detection (browser only). */
export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac/i.test(navigator.platform || navigator.userAgent || '')
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- shortcuts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/shortcuts.ts apps/admin/test/shortcuts.test.ts
git commit -m "feat(editor): shortcuts registry + platform-aware formatKeys/ariaKeyshortcuts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: event bridge + `KeyboardShortcuts` extension

**Files:** create `apps/admin/src/editor/editor-events.ts`, `apps/admin/src/editor/extensions/KeyboardShortcuts.ts`, `apps/admin/test/editor-events.test.ts`; modify `apps/admin/src/editor/Canvas.tsx`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/editor-events.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { onRequestLinkEdit, requestLinkEdit, onRequestShortcuts, requestShortcuts } from '../src/editor/editor-events'

describe('editor-events', () => {
  it('notifies link-edit subscribers and stops after unsubscribe', () => {
    const cb = vi.fn()
    const off = onRequestLinkEdit(cb)
    requestLinkEdit()
    requestLinkEdit()
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    requestLinkEdit()
    expect(cb).toHaveBeenCalledTimes(2)
  })
  it('has an independent shortcuts channel', () => {
    const link = vi.fn()
    const sc = vi.fn()
    onRequestLinkEdit(link)
    onRequestShortcuts(sc)
    requestShortcuts()
    expect(sc).toHaveBeenCalledOnce()
    expect(link).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- editor-events`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `editor-events.ts`**

`apps/admin/src/editor/editor-events.ts`:

```ts
type Listener = () => void

function channel() {
  const listeners = new Set<Listener>()
  return {
    on(cb: Listener): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    emit(): void {
      for (const l of [...listeners]) l()
    },
  }
}

const linkEdit = channel()
const shortcuts = channel()

/** Subscribe to "open the link editor" requests (returns an unsubscribe fn). */
export const onRequestLinkEdit = linkEdit.on
/** Request the link editor be opened (fired by the Mod-k keymap). */
export const requestLinkEdit = linkEdit.emit
/** Subscribe to "open the shortcuts cheat sheet" requests. */
export const onRequestShortcuts = shortcuts.on
/** Request the shortcuts cheat sheet be opened (fired by Mod-/ or the ? button). */
export const requestShortcuts = shortcuts.emit
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- editor-events`
Expected: PASS.

- [ ] **Step 5: Implement the `KeyboardShortcuts` extension**

`apps/admin/src/editor/extensions/KeyboardShortcuts.ts`:

```ts
import { Extension } from '@tiptap/core'
import { requestLinkEdit, requestShortcuts } from '../editor-events'

/** Editor-level custom keymaps that need app coordination (the mark/block-move
 *  shortcuts live in StarterKit/BlockActions). Mod-k opens the link editor for a
 *  non-empty selection; Mod-/ opens the shortcuts cheat sheet. */
export const KeyboardShortcuts = Extension.create({
  name: 'saytuKeyboardShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (this.editor.state.selection.empty) return false
        requestLinkEdit()
        return true
      },
      'Mod-/': () => {
        requestShortcuts()
        return true
      },
    }
  },
})
```

- [ ] **Step 6: Register it in the Canvas**

In `apps/admin/src/editor/Canvas.tsx`, add the import and place it in the extensions array (after `BlockActions,`):

```tsx
import { KeyboardShortcuts } from './extensions/KeyboardShortcuts'
```
```tsx
      BlockActions,
      KeyboardShortcuts,
      dragHandle,
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @setu/admin test -- editor-events && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/editor-events.ts apps/admin/src/editor/extensions/KeyboardShortcuts.ts apps/admin/src/editor/Canvas.tsx apps/admin/test/editor-events.test.ts
git commit -m "feat(editor): Mod-k (link) + Mod-/ (cheat sheet) keymap via an event bridge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tooltip + format-bubble hints + Mod-k opens link input

**Files:** create `apps/admin/src/editor/Tooltip.tsx`; modify `apps/admin/src/editor/FormatBubble.tsx`; create `apps/admin/test/format-tooltips.test.tsx`.

- [ ] **Step 1: Implement `Tooltip` (no test-first — it's a thin tippy wrapper, covered via FormatBubble)**

`apps/admin/src/editor/Tooltip.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import tippy from 'tippy.js'

/** Attaches a tippy tooltip (shows on hover AND keyboard focus) to its single child
 *  element. Uses a `display:contents` wrapper so it adds no layout box; targets the
 *  wrapped element directly. Destroys the instance on unmount. */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current?.firstElementChild
    if (!(el instanceof HTMLElement)) return
    const inst = tippy(el, {
      content,
      trigger: 'mouseenter focus',
      theme: 'saytu',
      delay: [150, 0],
      placement: 'top',
    })
    return () => inst.destroy()
  }, [content])
  return (
    <span ref={ref} style={{ display: 'contents' }}>
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Write the failing test**

`apps/admin/test/format-tooltips.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { FormatBubbleToolbar } from '../src/editor/FormatBubble'
import { requestLinkEdit } from '../src/editor/editor-events'

afterEach(cleanup)

const sk = () => StarterKit.configure({ link: { openOnClick: false }, underline: false })

describe('FormatBubbleToolbar shortcut hints', () => {
  it('sets aria-keyshortcuts on the mark + link buttons', () => {
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] } })
      return <>{e && <FormatBubbleToolbar editor={e} />}</>
    }
    render(<H />)
    expect(screen.getByRole('button', { name: /bold/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+B')
    expect(screen.getByRole('button', { name: /strikethrough/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+S')
    expect(screen.getByRole('button', { name: /^link$/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+K')
  })

  it('opens the link input when a link edit is requested (Mod-k path)', () => {
    let editor!: Editor
    function H() {
      const e = useEditor({ immediatelyRender: false, extensions: [sk()], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] } })
      if (e) editor = e
      return <>{e && <><EditorContent editor={e} /><FormatBubbleToolbar editor={e} /></>}</>
    }
    render(<H />)
    act(() => { editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run() })
    act(() => { requestLinkEdit() })
    expect(screen.getByRole('textbox', { name: /url/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- format-tooltips`
Expected: FAIL — no `aria-keyshortcuts` yet / link input not opened by the event.

- [ ] **Step 4: Wire tooltips + aria + subscription into `FormatBubble.tsx`**

Add imports:

```tsx
import { Tooltip } from './Tooltip'
import { SHORTCUTS, formatKeys, ariaKeyshortcuts, detectMac } from './shortcuts'
import { onRequestLinkEdit } from './editor-events'
```

Inside `FormatBubbleToolbar`, after the `currentHref` line, add helpers + the subscription:

```tsx
  const mac = detectMac()
  const shortcutFor = (id: string) => SHORTCUTS.find((s) => s.id === id)
  const tipFor = (id: string, fallback: string) => {
    const s = shortcutFor(id)
    return s ? `${s.label}  ${formatKeys(s.keys, mac)}` : fallback
  }
  const ariaFor = (id: string) => {
    const s = shortcutFor(id)
    return s ? ariaKeyshortcuts(s.keys) : undefined
  }

  useEffect(() => onRequestLinkEdit(() => setLinking(true)), [])
```

Then wrap each mark button and the link button in `<Tooltip>` and add `aria-keyshortcuts`. The mark `.map`:

```tsx
      {MARKS.map((m) => (
        <Tooltip key={m.name} content={tipFor(m.name, m.label)}>
          <button
            type="button"
            className={`fmt-btn${active[m.name as keyof typeof active] ? ' on' : ''}`}
            aria-label={m.label}
            aria-keyshortcuts={ariaFor(m.name)}
            aria-pressed={!!active[m.name as keyof typeof active]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => m.toggle(editor)}
          >
            <Icon name={m.icon} size={16} />
          </button>
        </Tooltip>
      ))}
```

The link button:

```tsx
      <Tooltip content={tipFor('link', 'Link')}>
        <button
          type="button"
          className={`fmt-btn${active.link ? ' on' : ''}`}
          aria-label="Link"
          aria-keyshortcuts={ariaFor('link')}
          aria-pressed={active.link}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setLinking(true)}
        >
          <Icon name="link" size={16} />
        </button>
      </Tooltip>
```

> The mark `id`s (`bold`/`italic`/`code`/`strike`) match the registry ids, so `tipFor`/`ariaFor` resolve. `aria-keyshortcuts={undefined}` omits the attribute cleanly when not found.

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- format-tooltips`
Expected: PASS (aria-keyshortcuts present; requestLinkEdit opens the input).

- [ ] **Step 6: Full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS (existing format-bubble/link tests still green).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/Tooltip.tsx apps/admin/src/editor/FormatBubble.tsx apps/admin/test/format-tooltips.test.tsx
git commit -m "feat(editor): shortcut hint tooltips on format buttons + Mod-k opens link input

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ShortcutsDialog + cheat-sheet trigger

**Files:** create `apps/admin/src/editor/ShortcutsDialog.tsx`; modify `apps/admin/src/ui/Icon.tsx`, `apps/admin/src/editor/EditorScreen.tsx`; create `apps/admin/test/shortcuts-dialog.test.tsx`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/shortcuts-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ShortcutsDialog } from '../src/editor/ShortcutsDialog'

afterEach(cleanup)

describe('ShortcutsDialog', () => {
  it('renders a dialog listing representative shortcuts', () => {
    render(<ShortcutsDialog onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.getByText('Add or edit link')).toBeInTheDocument()
    expect(screen.getByText('Move block up')).toBeInTheDocument()
  })
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('closes when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- shortcuts-dialog`
Expected: FAIL — `ShortcutsDialog` not exported.

- [ ] **Step 3: Implement `ShortcutsDialog.tsx`**

`apps/admin/src/editor/ShortcutsDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { SHORTCUTS, formatKeys, detectMac } from './shortcuts'
import type { ShortcutGroup } from './shortcuts'

const GROUP_ORDER: ShortcutGroup[] = ['Formatting', 'Links', 'Blocks', 'Help']

/** The keyboard-shortcuts cheat sheet (modal). Lists the registry grouped; closes
 *  on Esc, backdrop click, or the close button. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const mac = detectMac()

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sc-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="sc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sc-head">
          <h2 className="sc-title">Keyboard shortcuts</h2>
          <button type="button" className="sc-close" aria-label="Close" onClick={onClose}>
            <span aria-hidden>✕</span>
          </button>
        </div>
        {GROUP_ORDER.map((group) => {
          const items = SHORTCUTS.filter((s) => s.group === group)
          if (items.length === 0) return null
          return (
            <section key={group} className="sc-group">
              <h3 className="sc-group-title">{group}</h3>
              {items.map((s) => (
                <div key={s.id} className="sc-row">
                  <span className="sc-label">{s.label}</span>
                  <kbd className="sc-keys">{formatKeys(s.keys, mac)}</kbd>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
```

> Lightweight a11y for v1: focus moves to the dialog on open; Esc / backdrop / close-button all close. (A full Tab focus-trap is a follow-up; the dialog has a single interactive control — the close button — so focus doesn't wander far.) Backdrop uses `onMouseDown` so a text-selection drag that ends outside doesn't spuriously close.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- shortcuts-dialog`
Expected: PASS (3 cases).

- [ ] **Step 5: Add a `keyboard` icon**

In `apps/admin/src/ui/Icon.tsx`, add to the `ICONS` map (near other icons):

```ts
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M16.5 13h.01M9 13h6"/>',
```

- [ ] **Step 6: Wire the trigger + dialog into `EditorScreen.tsx`**

Add imports:

```tsx
import { ShortcutsDialog } from './ShortcutsDialog'
import { onRequestShortcuts } from './editor-events'
```

Inside the `EditorScreen` component body (with the other `useState`s), add:

```tsx
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => onRequestShortcuts(() => setShortcutsOpen(true)), [])
```

In the `ed-strip-right` div, add a `?`/keyboard button (before `<PublishMenu`):

```tsx
          <button
            type="button"
            className="strip-btn btn-icononly"
            aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
          >
            <Icon name="keyboard" size={18} />
          </button>
```

And render the dialog near the end of the returned JSX (inside the top-level `.editor` div, e.g. just before its closing `</div>`):

```tsx
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
```

- [ ] **Step 7: Run tests + typecheck + full suite**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS (dialog tests + existing suite green).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/ShortcutsDialog.tsx apps/admin/src/ui/Icon.tsx apps/admin/src/editor/EditorScreen.tsx apps/admin/test/shortcuts-dialog.test.tsx
git commit -m "feat(editor): keyboard-shortcuts cheat sheet (dialog + strip button + Mod-/)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CSS — tooltip theme + dialog + strip button

**Files:** modify `apps/admin/src/styles/editor.css`.

- [ ] **Step 1: Append the styles**

Append to `apps/admin/src/styles/editor.css` (reuse existing tokens; the tippy theme is scoped to `data-theme~='saytu'` so it doesn't affect the slash/block popups, which use their own content):

```css
/* Shortcut tooltips (scoped tippy theme) */
.tippy-box[data-theme~='saytu'] {
  background: var(--text); color: var(--canvas);
  font-family: var(--font-ui); font-size: 12px; font-weight: 550;
  padding: 1px 2px; border-radius: var(--r-sm, 6px);
}
.tippy-box[data-theme~='saytu'] .tippy-content { padding: 4px 8px; }

/* Shortcuts cheat-sheet dialog */
.sc-backdrop { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; background: color-mix(in oklch, var(--bg) 60%, transparent); }
.sc-dialog { width: min(440px, 92vw); max-height: 80vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--r-md); box-shadow: var(--shadow-pop); padding: 18px 20px 20px; font-family: var(--font-ui); }
.sc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.sc-title { font-size: 16px; font-weight: 700; color: var(--text); margin: 0; }
.sc-close { display: grid; place-items: center; width: 28px; height: 28px; border: none; background: transparent; color: var(--text-3); border-radius: var(--r-sm); cursor: pointer; }
.sc-close:hover { background: var(--surface-2, #f1f3f5); color: var(--text); }
.sc-group { margin-top: 14px; }
.sc-group-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-4); margin: 0 0 6px; }
.sc-row { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; }
.sc-label { font-size: 14px; color: var(--text); }
.sc-keys { font-family: var(--font-ui); font-size: 12.5px; color: var(--text-2); background: var(--surface-2, #f1f3f5); border: 1px solid var(--border); border-radius: var(--r-sm, 6px); padding: 2px 7px; }
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @setu/admin build`
Expected: build succeeds; CSS emitted.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/styles/editor.css
git commit -m "style(editor): shortcut tooltip theme + cheat-sheet dialog CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification

- [ ] **Step 1: Whole suite** — Run: `pnpm -r test` — expect every package green; admin gains shortcuts / editor-events / format-tooltips / shortcuts-dialog tests.
- [ ] **Step 2: Typecheck** — Run: `pnpm -r typecheck` — expect clean (incl. core edge guard).
- [ ] **Step 3: Build** — Run: `pnpm --filter @setu/admin build` — succeeds; brand fonts still linked; no new deps (`git diff` shows `package.json` unchanged — tippy already present).
- [ ] **Step 4: Manual (reviewer)** — `pnpm dev`: select text → hover/focus a format button shows e.g. "Bold ⌘B"; `Cmd/Ctrl+K` on a selection opens the link input; the `?` strip button and `Cmd/Ctrl+/` open the cheat sheet listing all shortcuts; Esc/backdrop close it.

---

## Self-Review Notes (author)

- **Spec coverage:** registry+formatters → Task 1; event bridge + Mod-k/Mod-/ keymap → Task 2; tooltips + aria + Mod-k-opens-input → Task 3; cheat sheet + trigger → Task 4; CSS → Task 5; verify → Task 6.
- **Single source of truth:** tooltips (Task 3) and the dialog (Task 4) both read `SHORTCUTS`/`formatKeys` from Task 1 — they can't drift.
- **No new deps:** tippy already present; Task 6 asserts `package.json` unchanged. No `@setu/core` change.
- **Type consistency:** `formatKeys(keys, mac)`, `ariaKeyshortcuts(keys)`, `SHORTCUTS`/`Shortcut`/`ShortcutGroup`, `onRequestLinkEdit/requestLinkEdit/onRequestShortcuts/requestShortcuts`, `Tooltip({content,children})`, `ShortcutsDialog({onClose})` — used identically across tasks.
- **Honest test scope:** pure formatters + registry + emitter + aria attributes + the Mod-k→input wiring (via `requestLinkEdit`) + the dialog are all unit/integration tested. The tippy *visual* tooltip and the EditorScreen `?`-button/Mod-/ end-to-end are build+manual verified (jsdom can't show tippy floats; EditorScreen needs heavy harness) — consistent with prior glue deferrals. The dialog's full Tab focus-trap is a noted v1 simplification (single focusable control).
- **a11y:** `aria-keyshortcuts` on buttons (tested); tooltips on focus; dialog `role=dialog`/`aria-modal`/Esc/labelled; all shortcuts listed for keyboard discovery.
- **Icon:** Task 4 adds a `keyboard` icon (verified `keyboard` is NOT already in `Icon.tsx`); no other invented icon names.
