# Enriched Format Bubble + Toolbar Keyboard Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Turn into ▾" block-type switcher to the format bubble (sharing one registry with the slash menu), and give both floating toolbars (the bubble + the callout color/icon toolbar) a WAI-ARIA roving-tabindex keyboard model.

**Architecture:** A single `block-types.ts` registry is the source of truth for block transforms; the slash menu and a new `TurnIntoMenu` dropdown both consume it. A reusable `useToolbarRoving` hook adds ←/→/Home/End roving-tabindex to any `role="toolbar"`. No `@setu/core` changes — all block types already round-trip.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), React 18, Tiptap v3 (`@tiptap/core`), Vitest + `@testing-library/react`. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-16-saytu-enriched-bubble-design.md`

**Verified (do NOT re-verify):** the core Markdoc converter round-trips heading (with level), paragraph, bulletList/orderedList, blockquote, codeBlock — both directions (`packages/core/src/markdoc/to-markdoc.ts` + `to-tiptap.ts`). StarterKit v3 provides `setNode`, `toggleBulletList/OrderedList/Blockquote/CodeBlock`, `isActive`. The format bubble buttons use `onMouseDown preventDefault` (no focus steal). `useDismiss(ref,onClose,active)` exists at `src/ui/useDismiss.ts` (document Esc + click-outside). Esc-to-leave the bubble is already handled by FormatBubble's document listener.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/admin/src/editor/block-types.ts` | shared registry + `currentBlockType` | 1 |
| `apps/admin/src/editor/blocks.ts` | slash built-ins derive from registry (H2/H3/H4) | 2 |
| `apps/admin/src/editor/useToolbarRoving.ts` | roving-tabindex hook | 3 |
| `apps/admin/src/editor/TurnIntoMenu.tsx` | the bubble's block-type dropdown | 4 |
| `apps/admin/src/editor/FormatBubble.tsx` | add TurnIntoMenu + apply roving | 4 |
| `apps/admin/src/editor/extensions/Callout.tsx` | roving + Esc-to-body on the variant toolbar | 5 |
| `apps/admin/src/styles/editor.css` | Turn-into trigger + dropdown styles | 6 |
| round-trip guard + full verification | — | 7 |

---

## Task 1: `block-types.ts` — shared registry

**Files:** create `apps/admin/src/editor/block-types.ts`, `apps/admin/test/block-types.test.ts`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/block-types.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BLOCK_TYPES, currentBlockType } from '../src/editor/block-types'
import { isIconName } from '../src/ui/Icon'

const make = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })

describe('BLOCK_TYPES registry', () => {
  it('has unique ids, non-empty labels, and known icons', () => {
    const ids = new Set<string>()
    for (const b of BLOCK_TYPES) {
      expect(b.label.length).toBeGreaterThan(0)
      expect(isIconName(b.icon)).toBe(true)
      expect(ids.has(b.id)).toBe(false)
      ids.add(b.id)
    }
  })
  it('offers H2/H3/H4 (not H1) and the expected block ids', () => {
    expect(BLOCK_TYPES.map((b) => b.id)).toEqual([
      'paragraph', 'h2', 'h3', 'h4', 'bulletList', 'orderedList', 'blockquote', 'codeBlock',
    ])
  })
})

describe('currentBlockType', () => {
  it('is Text for a plain paragraph', () => {
    const e = make()
    expect(currentBlockType(e).id).toBe('paragraph')
    e.destroy()
  })
  it('reflects an applied heading and list', () => {
    const e = make()
    e.chain().setTextSelection({ from: 1, to: 6 }).setNode('heading', { level: 3 }).run()
    expect(currentBlockType(e).id).toBe('h3')
    e.chain().setNode('paragraph').toggleBulletList().run()
    expect(currentBlockType(e).id).toBe('bulletList')
    e.destroy()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- block-types`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `block-types.ts`**

`apps/admin/src/editor/block-types.ts`:

```ts
import type { Editor, ChainedCommands } from '@tiptap/core'
import type { IconName } from '../ui/Icon'

/** One block-type the editor can turn a block into. `isActive` reports whether the
 *  current selection is already that type; `setOn` applies the transform to a chain.
 *  Single source of truth shared by the slash menu (insert) and the bubble's
 *  Turn-into dropdown (transform). All types round-trip through the core converter. */
export interface BlockType {
  id: string
  label: string
  icon: IconName
  isActive: (editor: Editor) => boolean
  setOn: (chain: ChainedCommands) => ChainedCommands
}

export const BLOCK_TYPES: BlockType[] = [
  { id: 'paragraph', label: 'Text', icon: 'post', isActive: (e) => e.isActive('paragraph'), setOn: (c) => c.setNode('paragraph') },
  { id: 'h2', label: 'Heading 2', icon: 'pages', isActive: (e) => e.isActive('heading', { level: 2 }), setOn: (c) => c.setNode('heading', { level: 2 }) },
  { id: 'h3', label: 'Heading 3', icon: 'pages', isActive: (e) => e.isActive('heading', { level: 3 }), setOn: (c) => c.setNode('heading', { level: 3 }) },
  { id: 'h4', label: 'Heading 4', icon: 'pages', isActive: (e) => e.isActive('heading', { level: 4 }), setOn: (c) => c.setNode('heading', { level: 4 }) },
  { id: 'bulletList', label: 'Bullet list', icon: 'forms', isActive: (e) => e.isActive('bulletList'), setOn: (c) => c.toggleBulletList() },
  { id: 'orderedList', label: 'Numbered list', icon: 'forms', isActive: (e) => e.isActive('orderedList'), setOn: (c) => c.toggleOrderedList() },
  { id: 'blockquote', label: 'Quote', icon: 'post', isActive: (e) => e.isActive('blockquote'), setOn: (c) => c.toggleBlockquote() },
  { id: 'codeBlock', label: 'Code block', icon: 'settings', isActive: (e) => e.isActive('codeBlock'), setOn: (c) => c.toggleCodeBlock() },
]

/** The block type of the current selection — the first non-Text type that's active
 *  (so a list/quote/heading wins over its inner paragraph), else Text. */
export function currentBlockType(editor: Editor): BlockType {
  const nonText = BLOCK_TYPES.slice(1).find((b) => b.isActive(editor))
  return nonText ?? BLOCK_TYPES[0]!
}
```

> Icons reuse existing `IconName`s (`post`/`pages`/`forms`/`settings`) — same ones the slash menu uses today, so no new icons. `BLOCK_TYPES[0]!` is safe (literal array, always non-empty); the `!` is the established pattern for known-present indices.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- block-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/block-types.ts apps/admin/test/block-types.test.ts
git commit -m "feat(editor): shared block-type registry (Text/H2-H4/lists/quote/code)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: slash menu consumes the registry (H2/H3/H4)

**Files:** modify `apps/admin/src/editor/blocks.ts`; create/extend `apps/admin/test/blocks.test.ts`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/blocks.test.ts` (create; if one exists, add these cases):

```ts
import { describe, it, expect } from 'vitest'
import { slashBlocks } from '../src/editor/blocks'

describe('slashBlocks', () => {
  it('offers H2/H3/H4 (not H1) plus the structural blocks, divider, and the callout', () => {
    const titles = slashBlocks().map((b) => b.title)
    expect(titles).toContain('Heading 2')
    expect(titles).toContain('Heading 3')
    expect(titles).toContain('Heading 4')
    expect(titles).not.toContain('Heading 1')
    expect(titles).toContain('Text')
    expect(titles).toContain('Bullet list')
    expect(titles).toContain('Numbered list')
    expect(titles).toContain('Quote')
    expect(titles).toContain('Code')
    expect(titles).toContain('Divider')
    expect(titles.some((t) => /callout/i.test(t))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- blocks`
Expected: FAIL — current built-ins have Heading 1/Heading 2, no H3/H4.

- [ ] **Step 3: Refactor `blocks.ts` built-ins to derive from the registry**

In `apps/admin/src/editor/blocks.ts`, replace the hardcoded `BUILTINS` block list so the block-transform entries come from `BLOCK_TYPES` (slash *inserts*: delete the `/query` range, focus, then apply `setOn`). Keep Divider and the config Callout exactly as they are. Import the registry:

```ts
import { BLOCK_TYPES } from './block-types'
```

Replace the `BUILTINS` array with:

```ts
const SUBTITLES: Record<string, string> = {
  paragraph: 'Plain paragraph',
  h2: 'Large section heading',
  h3: 'Medium section heading',
  h4: 'Small section heading',
  bulletList: 'Simple bulleted list',
  orderedList: 'Ordered list',
  blockquote: 'Block quote',
  codeBlock: 'Code block',
}

const BUILTINS: SlashBlock[] = [
  ...BLOCK_TYPES.map((b) => ({
    title: b.label,
    subtitle: SUBTITLES[b.id] ?? b.label,
    icon: b.icon,
    run: (e: Editor, r: Range) => b.setOn(e.chain().focus().deleteRange(r)).run(),
  })),
  { title: 'Divider', subtitle: 'Horizontal rule', icon: 'settings', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
]
```

> The `slashBlocks()` function (built-ins + config Callout) is otherwise unchanged. `SlashBlock.title` stays the display label, so the slash menu now shows Text / Heading 2 / Heading 3 / Heading 4 / Bullet list / Numbered list / Quote / Code block / Divider / Callout. (Note: the registry label for code is "Code block"; the old slash title was "Code" — the test above checks `toContain('Code')`, which matches "Code block". If you prefer to keep the exact old "Code" title, add a title override map; not required.)

Adjust the `toContain('Code')` expectation only if you deliberately keep a different title — keep test and impl consistent.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- blocks`
Expected: PASS. Also run the existing slash test: `pnpm --filter @setu/admin test -- slash` — still green.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/blocks.ts apps/admin/test/blocks.test.ts
git commit -m "refactor(editor): slash built-ins derive from block-type registry (H2-H4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `useToolbarRoving` hook

**Files:** create `apps/admin/src/editor/useToolbarRoving.ts`, `apps/admin/test/use-toolbar-roving.test.tsx`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/use-toolbar-roving.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useToolbarRoving } from '../src/editor/useToolbarRoving'

afterEach(cleanup)

function Bar() {
  const { ref, onKeyDown } = useToolbarRoving()
  return (
    <div role="toolbar" ref={ref} onKeyDown={onKeyDown}>
      <button data-toolbar-item>a</button>
      <button data-toolbar-item>b</button>
      <button data-toolbar-item>c</button>
    </div>
  )
}

describe('useToolbarRoving', () => {
  it('makes exactly one item tabbable initially (roving tabindex)', () => {
    const { getByText } = render(<Bar />)
    expect(getByText('a').tabIndex).toBe(0)
    expect(getByText('b').tabIndex).toBe(-1)
    expect(getByText('c').tabIndex).toBe(-1)
  })
  it('ArrowRight/ArrowLeft move the tabbable item (wrapping)', () => {
    const { getByText, getByRole } = render(<Bar />)
    const bar = getByRole('toolbar')
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(getByText('b').tabIndex).toBe(0)
    expect(document.activeElement).toBe(getByText('b'))
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(getByText('a').tabIndex).toBe(0)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' }) // wraps to last
    expect(getByText('c').tabIndex).toBe(0)
  })
  it('Home/End jump to first/last', () => {
    const { getByText, getByRole } = render(<Bar />)
    const bar = getByRole('toolbar')
    fireEvent.keyDown(bar, { key: 'End' })
    expect(getByText('c').tabIndex).toBe(0)
    fireEvent.keyDown(bar, { key: 'Home' })
    expect(getByText('a').tabIndex).toBe(0)
  })
}) 
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- use-toolbar-roving`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useToolbarRoving.ts`**

`apps/admin/src/editor/useToolbarRoving.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** Roving-tabindex keyboard nav for a `role="toolbar"`. Mark each focusable child
 *  with `data-toolbar-item`. Exactly one child is tabbable (tabIndex 0) at a time —
 *  the toolbar becomes a single Tab stop — and ←/→ (wrapping) + Home/End move which
 *  one, focusing it. Returns the container `ref` and an `onKeyDown` to spread on the
 *  toolbar element. (Esc is intentionally NOT handled here.) */
export function useToolbarRoving() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  const items = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]') ?? []),
    [],
  )

  // Sync tabIndex to the active index on every render (cheap; keeps a single tab stop).
  useEffect(() => {
    const els = items()
    const clamped = els.length === 0 ? 0 : Math.min(active, els.length - 1)
    els.forEach((el, i) => {
      el.tabIndex = i === clamped ? 0 : -1
    })
  })

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const els = items()
      if (els.length === 0) return
      const cur = els.findIndex((el) => el.tabIndex === 0)
      const at = cur < 0 ? 0 : cur
      let next: number | null = null
      if (e.key === 'ArrowRight') next = (at + 1) % els.length
      else if (e.key === 'ArrowLeft') next = (at - 1 + els.length) % els.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = els.length - 1
      if (next === null) return
      e.preventDefault()
      setActive(next)
      els[next]?.focus()
    },
    [items],
  )

  return { ref, onKeyDown }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- use-toolbar-roving`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/useToolbarRoving.ts apps/admin/test/use-toolbar-roving.test.tsx
git commit -m "feat(editor): useToolbarRoving — roving-tabindex arrow nav for role=toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `TurnIntoMenu` + wire into FormatBubble (+ roving)

**Files:** create `apps/admin/src/editor/TurnIntoMenu.tsx`, `apps/admin/test/turn-into.test.tsx`; modify `apps/admin/src/editor/FormatBubble.tsx`.

- [ ] **Step 1: Implement `TurnIntoMenu.tsx`** (thin UI over the registry; tested via the next step)

`apps/admin/src/editor/TurnIntoMenu.tsx`:

```tsx
import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'
import { useDismiss } from '../ui/useDismiss'
import { BLOCK_TYPES, currentBlockType } from './block-types'

/** The bubble's block-type switcher: a button labelled with the current block type
 *  that opens a role=menu of the registry. Picking an item transforms the selected
 *  block. Keyboard: Enter/↓ opens; ↑/↓ move; Enter picks; Esc closes the menu only
 *  (stopPropagation so it doesn't also collapse the selection). Click-outside closes
 *  via useDismiss. The trigger participates in the toolbar roving (data-toolbar-item). */
export function TurnIntoMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = currentBlockType(editor)

  useDismiss(panelRef, () => setOpen(false), open)

  const openMenu = () => {
    setOpen(true)
    // focus the active (or first) item after it mounts
    queueMicrotask(() => {
      const activeIdx = Math.max(0, BLOCK_TYPES.findIndex((b) => b.isActive(editor)))
      itemRefs.current[activeIdx]?.focus()
    })
  }

  const pick = (index: number) => {
    const b = BLOCK_TYPES[index]
    if (!b) return
    b.setOn(editor.chain().focus()).run()
    setOpen(false)
  }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const count = BLOCK_TYPES.length
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      itemRefs.current[(cur + 1 + count) % count]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      itemRefs.current[(cur - 1 + count) % count]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // close the menu only; don't collapse the selection
      setOpen(false)
    }
  }

  return (
    <div className="ti-wrap">
      <button
        type="button"
        data-toolbar-item
        className="fmt-btn ti-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Turn into"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault()
            openMenu()
          }
        }}
      >
        <span className="ti-label">{current.label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div ref={panelRef} className="ti-menu" role="menu" aria-label="Turn into" onKeyDown={onMenuKeyDown}>
          {BLOCK_TYPES.map((b, i) => (
            <button
              key={b.id}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={b.isActive(editor)}
              className={`ti-item${b.isActive(editor) ? ' on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <Icon name={b.icon} size={15} />
              <span>{b.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write the failing test**

`apps/admin/test/turn-into.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { TurnIntoMenu } from '../src/editor/TurnIntoMenu'

afterEach(cleanup)

function H({ onReady }: { onReady: (e: Editor) => void }) {
  const e = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })
  if (e) onReady(e)
  return <>{e && <TurnIntoMenu editor={e} />}</>
}

describe('TurnIntoMenu', () => {
  it('shows the current block type and turns the block into a heading', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    // trigger labelled "Text"
    const trigger = screen.getByRole('button', { name: /turn into/i })
    expect(trigger).toHaveTextContent('Text')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /heading 3/i }))
    expect(editor.isActive('heading', { level: 3 })).toBe(true)
  })

  it('Escape in the menu closes it without collapsing the selection', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /turn into/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(editor.state.selection.empty).toBe(false) // selection preserved
  })
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- turn-into`
Expected: FAIL — until TurnIntoMenu compiles AND is correct (should pass once Step 1 is in; if the file already exists from Step 1, this step confirms it).

- [ ] **Step 4: Wire `TurnIntoMenu` + roving into `FormatBubble.tsx`**

In `FormatBubbleToolbar` (the buttons-view return — the SECOND return, not the `linking` one), apply the roving hook and add the dropdown + `data-toolbar-item` on every focusable control.

Add imports:

```tsx
import { TurnIntoMenu } from './TurnIntoMenu'
import { useToolbarRoving } from './useToolbarRoving'
```

Inside `FormatBubbleToolbar`, near the other hooks, add:

```tsx
  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()
```

Change the buttons-view container to wire the ref + onKeyDown, and render `<TurnIntoMenu>` first:

```tsx
    <div
      className="fmt-bubble"
      role="toolbar"
      aria-label="Text formatting"
      ref={toolbarRef}
      onKeyDown={onToolbarKeyDown}
    >
      <TurnIntoMenu editor={editor} />
      {MARKS.map((m) => ( /* …unchanged… */ ))}
      {/* link Tooltip/button — unchanged */}
    </div>
```

Add `data-toolbar-item` to each mark button and the link button (so roving sees them). The mark button inside the `MARKS.map` gains `data-toolbar-item`:

```tsx
          <button
            type="button"
            data-toolbar-item
            className={`fmt-btn${active[m.name as keyof typeof active] ? ' on' : ''}`}
            /* …rest unchanged… */
```

and the link button likewise gains `data-toolbar-item`. (The `TurnIntoMenu` trigger already has `data-toolbar-item`.) Leave the existing `onKeyDown` Esc on the container (from the Esc increment) intact — it coexists with `onToolbarKeyDown` (different keys; if the file routes both, call both, or merge: the roving handler ignores Escape, the Esc handler ignores arrows). If there is an existing `onKeyDown` on this div, MERGE the two handlers into one that calls both, e.g.:

```tsx
      onKeyDown={(e) => {
        onToolbarKeyDown(e)
        if (isEscape(e.nativeEvent)) {
          e.preventDefault()
          collapseSelectionOnEscape(editor)
        }
      }}
```

(keep the existing `isEscape`/`collapseSelectionOnEscape` imports already present from the Esc increment).

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- turn-into && pnpm --filter @setu/admin test -- format`
Expected: PASS (TurnIntoMenu + existing format-bubble/format-tooltips suites green).

- [ ] **Step 6: Full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/editor/TurnIntoMenu.tsx apps/admin/test/turn-into.test.tsx apps/admin/src/editor/FormatBubble.tsx
git commit -m "feat(editor): Turn-into block-type dropdown in the format bubble + roving toolbar nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: callout toolbar — roving + Esc-to-body

**Files:** modify `apps/admin/src/editor/extensions/Callout.tsx`; create `apps/admin/test/callout-toolbar-roving.test.tsx`.

- [ ] **Step 1: Apply `useToolbarRoving` + Esc to the `.block-props` toolbar**

In `CalloutView` (`extensions/Callout.tsx`), import the hook:

```tsx
import { useToolbarRoving } from '../useToolbarRoving'
```

Inside `CalloutView`, add:

```tsx
  const { ref: toolbarRef, onKeyDown: onToolbarKeyDown } = useToolbarRoving()
```

Change the `.block-props` container to a `role="toolbar"` wired with the ref + key handler, and add `data-toolbar-item` to every tone swatch and icon button. Esc moves focus from the toolbar back into the callout body (so the `:focus-within` chrome hides):

```tsx
      <div
        className="block-props"
        contentEditable={false}
        role="toolbar"
        aria-label="Callout style"
        ref={toolbarRef}
        onKeyDown={(e) => {
          onToolbarKeyDown(e)
          if (e.key === 'Escape') {
            e.preventDefault()
            const pos = getPos()
            if (typeof pos === 'number') {
              editor.chain().setTextSelection(pos + 2).run()
              editor.view.focus()
            }
          }
        }}
      >
        <span className="bp-label">Tone</span>
        {calloutVariants().map((v) => (
          <button /* …unchanged… */ data-toolbar-item /* add this attr */ >…</button>
        ))}
        <span className="bp-sep" />
        {CALLOUT_ICONS.map((ic) => (
          <button /* …unchanged… */ data-toolbar-item /* add this attr */ >…</button>
        ))}
      </div>
```

> `getPos() + 2` places the caret at the start of the callout body (same offset the title-input Enter/↓ handler already uses at lines ~89-94). `editor.view.focus()` focuses synchronously (the file's existing comment explains why not `chain().focus()`).

- [ ] **Step 2: Write the test**

`apps/admin/test/callout-toolbar-roving.test.tsx` — render the editor with the Callout node, focus a tone swatch, assert ArrowRight moves focus to the next `[data-toolbar-item]`. Because mounting a full callout node view in jsdom is heavy, a pragmatic test renders a minimal stand-in toolbar using the SAME hook (mirroring `use-toolbar-roving.test.tsx`) is ALREADY covered in Task 3 — so here, instead, add a lighter assertion that the callout's `.block-props` carries `role="toolbar"` and its buttons carry `data-toolbar-item`, via the existing callout render path if one exists (check `apps/admin/test/` for an existing callout view test, e.g. `callout-*.test.tsx`, and extend it). If no callout-view render test exists and standing one up is disproportionate, rely on Task 3's hook test + build+manual verification for the callout wiring, and state that in the task report. Do NOT ship a hollow test.

Run: `pnpm --filter @setu/admin test -- callout`
Expected: PASS (existing callout tests stay green; any added assertion passes).

- [ ] **Step 3: Typecheck + full suite**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/editor/extensions/Callout.tsx apps/admin/test/callout-toolbar-roving.test.tsx
git commit -m "feat(editor): roving arrow-nav + Esc-to-body on the callout style toolbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CSS — Turn-into trigger + dropdown

**Files:** modify `apps/admin/src/styles/editor.css`.

- [ ] **Step 1: Read the existing bubble styles** for the design tokens + `.fmt-bubble`/`.fmt-btn` patterns, then append styles for the Turn-into trigger and dropdown. READ `apps/admin/src/styles/editor.css` (find `.fmt-bubble`, `.fmt-btn`). Append (reuse existing tokens — adjust names to whatever the file already uses, e.g. `--surface`, `--border`, `--text`, `--r-sm`, `--shadow-pop`):

```css
/* Turn-into block-type switcher (in the format bubble) */
.ti-wrap { position: relative; display: inline-flex; }
.ti-trigger { display: inline-flex; align-items: center; gap: 4px; width: auto; padding: 0 6px; font-family: var(--font-ui); font-size: 12.5px; color: var(--text); }
.ti-label { white-space: nowrap; }
.ti-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 320; min-width: 180px; background: var(--surface); border: 1px solid var(--border-strong, var(--border)); border-radius: var(--r-md, 8px); box-shadow: var(--shadow-pop); padding: 4px; display: flex; flex-direction: column; }
.ti-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: none; background: transparent; border-radius: var(--r-sm, 6px); font-family: var(--font-ui); font-size: 13px; color: var(--text); cursor: pointer; text-align: left; }
.ti-item:hover, .ti-item:focus-visible { background: var(--surface-2, #f1f3f5); outline: none; }
.ti-item.on { color: var(--accent); font-weight: 600; }
```

- [ ] **Step 2: Build** — Run: `pnpm --filter @setu/admin build` — succeeds; CSS emitted.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/styles/editor.css
git commit -m "style(editor): Turn-into trigger + dropdown menu styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: round-trip guard + full verification

**Files:** create `apps/admin/test/block-types-roundtrip.test.ts` (or add to an existing core round-trip test in admin if one exists).

- [ ] **Step 1: Write the round-trip guard**

`apps/admin/test/block-types-roundtrip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tiptapToMarkdoc, markdocToTiptap } from '@setu/core'

describe('structural block types round-trip', () => {
  it('H2/H3/H4 + lists + quote + code block survive tiptap → markdoc → tiptap', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Three' }] },
        { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Four' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'code()' }] },
      ],
    }
    const back = markdocToTiptap(tiptapToMarkdoc(doc as Parameters<typeof tiptapToMarkdoc>[0]))
    const types = (back.content ?? []).map((n) => n.type)
    expect(types).toEqual(['heading', 'heading', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock'])
    const levels = (back.content ?? []).filter((n) => n.type === 'heading').map((n) => n.attrs?.level)
    expect(levels).toEqual([2, 3, 4])
  })
})
```

> Confirm the exact import names/shape against `@setu/core`'s barrel (`tiptapToMarkdoc`/`markdocToTiptap` and the `TiptapDoc` type) — adapt the cast if the public types differ. If `@setu/core` exposes a `TiptapDoc` type, import and use it instead of the `Parameters<>` cast.

- [ ] **Step 2: Run it** — Run: `pnpm --filter @setu/admin test -- block-types-roundtrip` — Expected: PASS.

- [ ] **Step 3: Whole suite** — Run: `pnpm -r test` — every package green.
- [ ] **Step 4: Typecheck** — Run: `pnpm -r typecheck` — clean (incl. core edge guard).
- [ ] **Step 5: Build + no new deps** — Run: `pnpm --filter @setu/admin build` (fonts intact) and `git diff main -- apps/admin/package.json` (empty).
- [ ] **Step 6: Manual (reviewer)** — `pnpm dev`: select text → bubble shows "Turn into ▾" with the current block type; pick Heading 3 / Bullet list / Quote / Code → block transforms; **Tab** into the bubble → **←/→** move across controls, **Enter** on Turn-into opens the dropdown (**↑/↓/Enter**, **Esc** closes just the dropdown), **Esc** on the toolbar leaves the bubble; the callout style toolbar navigates by **←/→** and **Esc** returns to the body; the slash menu now lists H2/H3/H4; publish a doc with the new blocks and reopen → identical.

- [ ] **Step 7: Commit** (if the round-trip test is a new file)

```bash
git add apps/admin/test/block-types-roundtrip.test.ts
git commit -m "test(editor): round-trip guard for H2-H4/lists/quote/code block types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** registry → T1; slash parity (H2/H3/H4) → T2; roving hook → T3; Turn-into dropdown + bubble wiring + roving → T4; callout toolbar roving + Esc-to-body → T5; CSS → T6; round-trip guard + verification → T7.
- **Single source of truth:** the slash menu (T2) and Turn-into dropdown (T4) both consume `BLOCK_TYPES` (T1) — they can't drift.
- **Esc precedence:** the Turn-into menu's Esc `stopPropagation`s so it closes only the dropdown (the bubble's document-level collapse won't fire); toolbar Esc (dropdown closed) = the shipped dismiss.
- **No new deps; no `@setu/core` change.** All block types already round-trip (verified); T7 locks it.
- **Type consistency:** `BlockType {id,label,icon,isActive,setOn}`, `BLOCK_TYPES`, `currentBlockType(editor)`, `useToolbarRoving() → {ref,onKeyDown}`, `TurnIntoMenu({editor})` — used identically across tasks.
- **Honest test scope:** registry + slash parity + roving + Turn-into transform/Esc + round-trip are unit/integration tested; the floating bubble/callout *render* and the full keyboard end-to-end are build+manual verified (jsdom can't mount BubbleMenu / a full node-view toolbar) — consistent with prior increments.
- **a11y:** WAI-ARIA toolbar (roving tabindex, ←/→, Home/End), `aria-haspopup`/`aria-expanded` trigger, `role="menu"`/`menuitemradio`/`aria-checked` items, Esc leaves; callout toolbar matched.
