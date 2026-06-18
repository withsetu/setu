# Turn-into Menu Regroup (categorized, inline-expand) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the bubble's "Turn into ▾" menu into categories — Text, Heading (→ H2/H3/H4), List (→ Bullet/Numbered), Quote, Code — with Heading/List expanding inline.

**Architecture:** A grouped view-model `TURN_INTO_GROUPS` is derived from the existing flat `BLOCK_TYPES` (so transforms/active-state stay single-sourced). `TurnIntoMenu` renders leaves + expandable groups, with keyboard nav over the computed visible rows. Pure editor UI — no content-model change; the slash menu stays flat.

**Tech Stack:** TypeScript (strict), React 18, Tiptap v3, Vitest + @testing-library/react. No new deps; no `@setu/core` change.

**Spec:** `docs/superpowers/specs/2026-06-16-saytu-turn-into-regroup-design.md`

**Verified (do NOT re-verify):** `block-types.ts` exports flat `BLOCK_TYPES` (`{id,label,icon,isActive,setOn}`) + `currentBlockType`. `TurnIntoMenu` uses `useDismiss` + `registerBubblePopup` (Esc-defer guard, shipped) + roving `data-toolbar-item` trigger. All block types already round-trip. This is bubble-v2 slice 1; checklist (slice 3) later adds a third List item; sub/sup (slice 2) are marks, not here.

---

## Task 1: `TURN_INTO_GROUPS` view-model

**Files:** modify `apps/admin/src/editor/block-types.ts`; create `apps/admin/test/turn-into-groups.test.ts`.

- [ ] **Step 1: Write the failing test**

`apps/admin/test/turn-into-groups.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TURN_INTO_GROUPS, groupContaining, BLOCK_TYPES } from '../src/editor/block-types'

const make = () =>
  new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })

const ids = new Set(BLOCK_TYPES.map((b) => b.id))

describe('TURN_INTO_GROUPS', () => {
  it('is Text(leaf), Heading(group h2/h3/h4), List(group bullet/ordered), Quote(leaf), Code(leaf)', () => {
    const shape = TURN_INTO_GROUPS.map((e) => (e.kind === 'leaf' ? `leaf:${e.type.id}` : `group:${e.id}[${e.items.map((i) => i.id).join(',')}]`))
    expect(shape).toEqual([
      'leaf:paragraph',
      'group:heading[h2,h3,h4]',
      'group:list[bulletList,orderedList]',
      'leaf:blockquote',
      'leaf:codeBlock',
    ])
  })
  it('every referenced block type is a real BLOCK_TYPES entry', () => {
    for (const e of TURN_INTO_GROUPS) {
      if (e.kind === 'leaf') expect(ids.has(e.type.id)).toBe(true)
      else for (const it of e.items) expect(ids.has(it.id)).toBe(true)
    }
  })
})

describe('groupContaining', () => {
  it('returns the active group id, or null for a leaf/plain block', () => {
    const e = make()
    expect(groupContaining(e)).toBe(null) // plain paragraph
    e.chain().setTextSelection({ from: 1, to: 6 }).setNode('heading', { level: 3 }).run()
    expect(groupContaining(e)).toBe('heading')
    e.chain().setNode('paragraph').toggleBulletList().run()
    expect(groupContaining(e)).toBe('list')
    e.destroy()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- turn-into-groups`
Expected: FAIL — `TURN_INTO_GROUPS`/`groupContaining` not exported.

- [ ] **Step 3: Add the view-model to `block-types.ts`**

Append to `apps/admin/src/editor/block-types.ts` (keep `BLOCK_TYPES`/`currentBlockType` as-is):

```ts
/** A row in the bubble's Turn-into menu: a leaf applies a block type directly; a
 *  group expands inline to its items. Derived from BLOCK_TYPES (same objects) so the
 *  transforms/active-state are single-sourced. */
export type TurnIntoEntry =
  | { kind: 'leaf'; type: BlockType }
  | { kind: 'group'; id: string; label: string; icon: IconName; items: BlockType[] }

function byId(id: string): BlockType {
  const b = BLOCK_TYPES.find((x) => x.id === id)
  if (!b) throw new Error(`block-types: unknown id ${id}`)
  return b
}

export const TURN_INTO_GROUPS: TurnIntoEntry[] = [
  { kind: 'leaf', type: byId('paragraph') },
  { kind: 'group', id: 'heading', label: 'Heading', icon: 'pages', items: [byId('h2'), byId('h3'), byId('h4')] },
  { kind: 'group', id: 'list', label: 'List', icon: 'forms', items: [byId('bulletList'), byId('orderedList')] },
  { kind: 'leaf', type: byId('blockquote') },
  { kind: 'leaf', type: byId('codeBlock') },
]

/** The id of the group whose item is currently active (so the menu can pre-expand it),
 *  or null when the active block is a leaf/plain paragraph. */
export function groupContaining(editor: Editor): string | null {
  for (const e of TURN_INTO_GROUPS) {
    if (e.kind === 'group' && e.items.some((it) => it.isActive(editor))) return e.id
  }
  return null
}
```

> Needs `IconName` — it's already imported at the top of `block-types.ts` (`import type { IconName } from '../ui/Icon'`). If not, add it.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- turn-into-groups`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/editor/block-types.ts apps/admin/test/turn-into-groups.test.ts
git commit -m "feat(editor): TURN_INTO_GROUPS view-model (Heading/List groups) derived from registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: rebuild `TurnIntoMenu` with inline-expand groups

**Files:** modify `apps/admin/src/editor/TurnIntoMenu.tsx`, `apps/admin/test/turn-into.test.tsx`.

- [ ] **Step 1: Update the existing tests to the grouped interaction + add cases**

Replace `apps/admin/test/turn-into.test.tsx` with (the old tests clicked a flat "Heading 3" item; now Heading is a group you expand first):

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { TurnIntoMenu } from '../src/editor/TurnIntoMenu'
import { bubbleEscapeShouldCollapse } from '../src/editor/bubble-popup'

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

const open = () => fireEvent.click(screen.getByRole('button', { name: /turn into/i }))

describe('TurnIntoMenu (grouped)', () => {
  it('expands the Heading group and turns the block into H4', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    // Heading is a collapsed group on a plain paragraph
    fireEvent.click(screen.getByRole('menuitem', { name: /heading/i }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /heading 4/i }))
    expect(editor.isActive('heading', { level: 4 })).toBe(true)
  })

  it('expands the List group and makes a numbered list', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /list/i }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /numbered/i }))
    expect(editor.isActive('orderedList')).toBe(true)
  })

  it('applies a leaf (Quote) directly without expanding', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /quote/i }))
    expect(editor.isActive('blockquote')).toBe(true)
  })

  it('pre-expands the active group and checks the active item', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).setNode('heading', { level: 3 }).run() })
    open()
    // Heading group pre-expanded → H3 visible and checked
    expect(screen.getByRole('menuitemradio', { name: /heading 3/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('Esc closes the menu without collapsing the selection', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    expect(bubbleEscapeShouldCollapse(editor)).toBe(false) // popup guard active while open
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(bubbleEscapeShouldCollapse(editor)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- turn-into`
Expected: FAIL — the menu is still flat (no group `menuitem`s).

- [ ] **Step 3: Rebuild `TurnIntoMenu.tsx`**

Replace `apps/admin/src/editor/TurnIntoMenu.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useDismiss } from '../ui/useDismiss'
import { TURN_INTO_GROUPS, currentBlockType, groupContaining } from './block-types'
import type { BlockType } from './block-types'
import { registerBubblePopup } from './bubble-popup'

type Row =
  | { kind: 'leaf'; type: BlockType }
  | { kind: 'group'; id: string; label: string; icon: IconName; expanded: boolean }
  | { kind: 'item'; type: BlockType }

/** The bubble's block-type switcher. Categorized: Heading/List are groups that expand
 *  inline to their options; Text/Quote/Code apply directly. Keyboard: ↑/↓ over visible
 *  rows, Enter expands a group / applies a leaf-or-item, Esc closes (the popup guard
 *  keeps the bubble selection intact). Click-outside closes via useDismiss. */
export function TurnIntoMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = currentBlockType(editor)

  useDismiss(panelRef, () => setOpen(false), open)
  useEffect(() => {
    if (!open) return
    return registerBubblePopup()
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const e of TURN_INTO_GROUPS) {
      if (e.kind === 'leaf') {
        out.push({ kind: 'leaf', type: e.type })
      } else {
        const isExp = expanded.has(e.id)
        out.push({ kind: 'group', id: e.id, label: e.label, icon: e.icon, expanded: isExp })
        if (isExp) for (const it of e.items) out.push({ kind: 'item', type: it })
      }
    }
    return out
  }, [expanded])

  const openMenu = () => {
    const g = groupContaining(editor)
    setExpanded(new Set(g ? [g] : []))
    setOpen(true)
  }

  // On open (after the seeded render commits), focus the active row, else the first.
  useEffect(() => {
    if (!open) return
    const idx = rows.findIndex((r) => r.kind !== 'group' && r.type.isActive(editor))
    rowRefs.current[idx >= 0 ? idx : 0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const apply = (b: BlockType) => {
    b.setOn(editor.chain().focus()).run()
    setOpen(false)
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const activate = (row: Row) => {
    if (row.kind === 'group') toggle(row.id)
    else apply(row.type)
  }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const n = rows.length
    if (n === 0) return
    const cur = rowRefs.current.findIndex((el) => el === document.activeElement)
    const at = cur < 0 ? 0 : cur
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      rowRefs.current[(at + 1) % n]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      rowRefs.current[(at - 1 + n) % n]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="ti-wrap">
      <button
        ref={triggerRef}
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
          {rows.map((row, i) => {
            const refFn = (el: HTMLButtonElement | null) => {
              rowRefs.current[i] = el
            }
            if (row.kind === 'group') {
              return (
                <button
                  key={`g:${row.id}`}
                  ref={refFn}
                  type="button"
                  role="menuitem"
                  aria-expanded={row.expanded}
                  className={`ti-item ti-group${row.expanded ? ' open' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => activate(row)}
                >
                  <Icon name={row.icon} size={15} />
                  <span>{row.label}</span>
                  <span className="ti-chev" aria-hidden>▾</span>
                </button>
              )
            }
            const active = row.type.isActive(editor)
            return (
              <button
                key={row.kind === 'item' ? `i:${row.type.id}` : `l:${row.type.id}`}
                ref={refFn}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`ti-item${row.kind === 'item' ? ' ti-sub' : ''}${active ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => activate(row)}
              >
                <Icon name={row.type.icon} size={15} />
                <span>{row.type.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- turn-into`
Expected: PASS (grouped interactions + pre-expand + Esc).

- [ ] **Step 5: Full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS — existing `format`/`block-types`/`turn-into-groups`/`slash` suites green (slash menu untouched; `BLOCK_TYPES`/`currentBlockType` unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/editor/TurnIntoMenu.tsx apps/admin/test/turn-into.test.tsx
git commit -m "feat(editor): categorize Turn-into menu (Heading/List inline-expand groups)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CSS — group rows, indentation, chevron

**Files:** modify `apps/admin/src/styles/editor.css`.

- [ ] **Step 1: Append styles**

READ the existing `.ti-menu`/`.ti-item` rules first, then append (reuse the same tokens):

```css
/* Turn-into groups (inline expand) */
.ti-group { justify-content: flex-start; }
.ti-group .ti-chev { margin-left: auto; transition: transform 120ms ease; font-size: 11px; color: var(--text-3, var(--text-2)); }
.ti-group.open .ti-chev { transform: rotate(180deg); }
.ti-sub { padding-left: 26px; }
```

- [ ] **Step 2: Build** — Run: `pnpm --filter @setu/admin build` — succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/styles/editor.css
git commit -m "style(editor): Turn-into group rows + indented sub-items + chevron

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification

- [ ] **Step 1: Whole suite** — Run: `pnpm -r test` — every package green.
- [ ] **Step 2: Typecheck** — Run: `pnpm -r typecheck` — clean.
- [ ] **Step 3: Build + no new deps** — Run: `pnpm --filter @setu/admin build` (fonts intact) and `git diff main -- apps/admin/package.json` (empty).
- [ ] **Step 4: Manual (reviewer)** — `pnpm dev`: select text → "Turn into ▾" shows **Text · Heading ▸ · List ▸ · Quote · Code**; clicking Heading/List expands them inline; the current block type's group is pre-expanded with its item checked; ↑/↓ move through visible rows, Enter expands a group / applies an item, Esc closes (selection survives); the slash menu still lists the flat H2/H3/H4 etc.

---

## Self-Review Notes (author)

- **Spec coverage:** grouped model → Task 1; inline-expand menu + keyboard + pre-expand + Esc-guard → Task 2; CSS → Task 3; verify → Task 4.
- **Single source of truth:** `TURN_INTO_GROUPS` references `BLOCK_TYPES` objects by id; the slash menu + `currentBlockType` (trigger label) are unchanged — no drift, no `@setu/core` change.
- **Keyboard correctness:** `rows` (visible rows) drives both render and ↑/↓ so they can't disagree; Esc keeps the shipped popup-guard contract (`registerBubblePopup`), focus returns to the trigger; arrows `stopPropagation` so the toolbar roving doesn't steal focus.
- **Focus-on-open:** a `useEffect` keyed on `open` (not `queueMicrotask`) focuses the active row after the seeded-`expanded` render commits — avoids the stale-refs race when rows change on open.
- **No new deps.** Honest test scope: the grouped model + the menu interactions (expand, pick, pre-expand, Esc-guard) are unit/integration tested; the floating bubble render stays build+manual verified (jsdom can't mount BubbleMenu) — `TurnIntoMenu` is tested in isolation as before.
- **Type consistency:** `TurnIntoEntry`, `TURN_INTO_GROUPS`, `groupContaining`, `Row`, `BlockType` used identically across tasks.
