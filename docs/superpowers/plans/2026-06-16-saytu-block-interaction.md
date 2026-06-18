# Block Interaction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a writer grab a block and move / duplicate / delete it — equally well by mouse and keyboard — and fix the callout title↔body keyboard gap, building the interaction substrate every future block sits on.

**Architecture:** Tiptap-first. The verbs are Tiptap commands (`addCommands` + the `command()` escape hatch); the tricky reorder math is a single pure function (`moveBlock`) unit-tested in isolation; the drag handle is a ProseMirror plugin (`addProseMirrorPlugins`, as `SlashCommand` already does); the block menu reuses the slash menu's `tippy.js` + `ReactRenderer` (no new external dep). We add `@tiptap/pm` (Tiptap's bundled ProseMirror, MIT, 3.26.1 — already in the tree, just declared for pnpm-strict imports). **No yjs / collaboration deps.**

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Tiptap v3.26.1 (`@tiptap/core`, `@tiptap/react`, `@tiptap/pm`), React 18, Vitest + `@testing-library/react` (jsdom), `tippy.js`.

**Spec:** `docs/superpowers/specs/2026-06-16-saytu-block-interaction-design.md`

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/admin/package.json` | declare `@tiptap/pm` dependency | 1 |
| `apps/admin/src/editor/block-reorder.ts` | pure `moveBlock(doc, tr, from, to)` — the reorder math | 1 |
| `apps/admin/src/editor/extensions/BlockActions.ts` | Tiptap extension: move/duplicate/delete commands + Alt-Shift-↑/↓ | 1 |
| `apps/admin/src/editor/Canvas.tsx` | register `BlockActions` + `DragHandle` | 1, 2 |
| `apps/admin/src/editor/extensions/DragHandle.tsx` | PM plugin: hover grip + drag-reorder (reuses `moveBlock`) + opens menu | 2 |
| `apps/admin/src/editor/extensions/BlockMenu.tsx` | `role=menu` popover wired to the commands | 3 |
| `apps/admin/src/editor/extensions/Callout.tsx` | title↔body keyboard nav | 4 |
| `apps/admin/src/styles/editor.css` | grip / drop indicator / block menu styles | 5 |
| `apps/admin/test/*` | tests per task | 1–4 |

---

## Task 1: `moveBlock` pure fn + `BlockActions` commands

**Files:**
- Modify: `apps/admin/package.json`
- Create: `apps/admin/src/editor/block-reorder.ts`
- Create: `apps/admin/src/editor/extensions/BlockActions.ts`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Test: `apps/admin/test/block-reorder.test.tsx`, `apps/admin/test/block-actions.test.tsx`

- [ ] **Step 1: Declare the `@tiptap/pm` dependency**

In `apps/admin/package.json`, add to `dependencies` (keep alphabetical-ish with the other `@tiptap/*` entries):

```json
    "@tiptap/pm": "^3.26.1",
```

Then run `pnpm install` from the repo root.
Run: `pnpm install`
Expected: resolves; `@tiptap/pm` is now a declared dep (it was already in the tree via `@tiptap/core`).

- [ ] **Step 2: Write the failing test for `moveBlock`**

Create `apps/admin/test/block-reorder.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { moveBlock } from '../src/editor/block-reorder'

afterEach(cleanup)

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const docOf = (...texts: string[]) => ({ type: 'doc', content: texts.map(para) })

function Harness({ texts, onReady }: { texts: string[]; onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: docOf(...texts),
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

/** Run moveBlock against the editor's live doc and return the resulting paragraph order. */
function orderAfterMove(editor: Editor, from: number, to: number): string[] {
  const tr = editor.state.tr
  const ok = moveBlock(editor.state.doc, tr, from, to)
  if (ok) editor.view.dispatch(tr)
  const json = editor.getJSON() as { content: Array<{ content?: Array<{ text?: string }> }> }
  return json.content.map((n) => n.content?.[0]?.text ?? '')
}

describe('moveBlock', () => {
  it('moves a block up, down, and across multiple positions', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    expect(orderAfterMove(editor, 0, 1)).toEqual(['B', 'A', 'C']) // A down past B
  })

  it('moves the last block up before its predecessor', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    expect(orderAfterMove(editor, 2, 1)).toEqual(['A', 'C', 'B'])
  })

  it('moves the first block to the end', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    expect(orderAfterMove(editor, 0, 2)).toEqual(['B', 'C', 'A'])
  })

  it('is a no-op for same index or out-of-range', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    const tr = editor.state.tr
    expect(moveBlock(editor.state.doc, tr, 1, 1)).toBe(false)
    expect(moveBlock(editor.state.doc, tr, 0, 5)).toBe(false)
    expect(moveBlock(editor.state.doc, tr, -1, 0)).toBe(false)
  })
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- block-reorder`
Expected: FAIL — `moveBlock` is not exported.

- [ ] **Step 4: Implement `moveBlock`**

Create `apps/admin/src/editor/block-reorder.ts`:

```ts
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

/** Document position just before the top-level child at `index`. */
function startOfChild(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize
  return pos
}

/** Move the top-level block at `fromIndex` to `toIndex`, mutating `tr`. Returns
 *  false (no mutation) for a no-op or out-of-range move. Pure w.r.t. the DOM —
 *  operates only on the document + transaction, so it is unit-testable and is
 *  shared by both the keyboard commands and the drag handle. */
export function moveBlock(doc: PMNode, tr: Transaction, fromIndex: number, toIndex: number): boolean {
  if (fromIndex === toIndex) return false
  if (fromIndex < 0 || fromIndex >= doc.childCount) return false
  if (toIndex < 0 || toIndex >= doc.childCount) return false

  const node = doc.child(fromIndex)
  const from = startOfChild(doc, fromIndex)
  const to = from + node.nodeSize

  tr.delete(from, to)

  let insertPos: number
  if (toIndex > fromIndex) {
    // Moving down: land AFTER the block at toIndex. Positions >= `to` shifted left
    // by node.nodeSize once the source was deleted.
    insertPos = startOfChild(doc, toIndex) + doc.child(toIndex).nodeSize - node.nodeSize
  } else {
    // Moving up: target start is before the deleted range, so it is unaffected.
    insertPos = startOfChild(doc, toIndex)
  }
  tr.insert(insertPos, node)
  return true
}
```

- [ ] **Step 5: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- block-reorder`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing test for `BlockActions`**

Create `apps/admin/test/block-actions.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { tiptapToMarkdoc } from '@setu/core'
import { BlockActions } from '../src/editor/extensions/BlockActions'

afterEach(cleanup)

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const docOf = (...texts: string[]) => ({ type: 'doc', content: texts.map(para) })

function Harness({ texts, onReady }: { texts: string[]; onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, BlockActions],
    content: docOf(...texts),
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

/** Put the cursor inside the top-level block at `index` (paragraphs of size 3: <p>+text+</p>). */
function caretInBlock(editor: Editor, index: number) {
  let pos = 1
  const json = editor.getJSON() as { content: unknown[] }
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize
  void json
  act(() => {
    editor.commands.setTextSelection(pos + 1)
  })
}

const texts = (editor: Editor): string[] => {
  const json = editor.getJSON() as { content: Array<{ content?: Array<{ text?: string }> }> }
  return json.content.map((n) => n.content?.[0]?.text ?? '')
}

describe('BlockActions', () => {
  it('moveBlockDown reorders and round-trips to Markdoc', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B', 'C']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.moveBlockDown() })
    expect(texts(editor)).toEqual(['B', 'A', 'C'])
    // content-safety: serialization equals the serialization of the expected order
    expect(tiptapToMarkdoc(editor.getJSON())).toBe(tiptapToMarkdoc(docOf('B', 'A', 'C')))
  })

  it('moveBlockUp at the first block is a no-op', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.moveBlockUp() })
    expect(texts(editor)).toEqual(['A', 'B'])
  })

  it('duplicateBlock inserts an identical block right after', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.duplicateBlock() })
    expect(texts(editor)).toEqual(['A', 'A', 'B'])
  })

  it('deleteBlock removes the block', () => {
    let editor!: Editor
    render(<Harness texts={['A', 'B']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.deleteBlock() })
    expect(texts(editor)).toEqual(['B'])
  })

  it('deleteBlock on the only block leaves an empty paragraph', () => {
    let editor!: Editor
    render(<Harness texts={['A']} onReady={(e) => (editor = e)} />)
    caretInBlock(editor, 0)
    act(() => { editor.commands.deleteBlock() })
    const json = editor.getJSON() as { content: Array<{ type: string; content?: unknown[] }> }
    expect(json.content).toHaveLength(1)
    expect(json.content[0]?.type).toBe('paragraph')
    expect(json.content[0]?.content ?? []).toHaveLength(0)
  })
})
```

- [ ] **Step 7: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- block-actions`
Expected: FAIL — `BlockActions` is not exported.

- [ ] **Step 8: Implement `BlockActions`**

Create `apps/admin/src/editor/extensions/BlockActions.ts`:

```ts
import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { moveBlock } from '../block-reorder'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockActions: {
      moveBlockUp: () => ReturnType
      moveBlockDown: () => ReturnType
      duplicateBlock: () => ReturnType
      deleteBlock: () => ReturnType
    }
  }
}

/** Block-level verbs (operate on the top-level block containing the selection):
 *  move up/down, duplicate, delete. The single source of truth for both the
 *  keyboard shortcuts and the drag-handle menu. */
export const BlockActions = Extension.create({
  name: 'blockActions',

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const index = $from.index(0)
          if (index <= 0) return false
          if (dispatch) {
            moveBlock(state.doc, tr, index, index - 1)
            tr.setSelection(TextSelection.near(tr.doc.resolve($from.before(1) - state.doc.child(index - 1).nodeSize + 1)))
          }
          return true
        },

      moveBlockDown:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const index = $from.index(0)
          if (index >= state.doc.childCount - 1) return false
          if (dispatch) {
            moveBlock(state.doc, tr, index, index + 1)
            tr.setSelection(TextSelection.near(tr.doc.resolve($from.after(1) + 1)))
          }
          return true
        },

      duplicateBlock:
        () =>
        ({ state, chain }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const after = $from.after(1)
          const node = $from.node(1)
          return chain().insertContentAt(after, node.toJSON()).run()
        },

      deleteBlock:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const from = $from.before(1)
          const to = $from.after(1)
          if (dispatch) {
            if (state.doc.childCount > 1) {
              tr.delete(from, to)
            } else {
              tr.replaceWith(from, to, state.schema.nodes.paragraph!.create())
            }
            const target = Math.min(from + 1, tr.doc.content.size)
            tr.setSelection(TextSelection.near(tr.doc.resolve(target)))
          }
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Alt-Shift-ArrowDown': () => this.editor.commands.moveBlockDown(),
    }
  },
})
```

> Note on the selection lines in move: they re-center the cursor near the moved block. If a position calculation proves off in a test, fall back to `tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min($from.pos, tr.doc.content.size))))` — selection placement is cosmetic and must not change the asserted block order.

- [ ] **Step 9: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- block-actions`
Expected: PASS (5 tests).

- [ ] **Step 10: Register `BlockActions` in the Canvas**

In `apps/admin/src/editor/Canvas.tsx`, add the import and put it in the extensions array:

```tsx
import { BlockActions } from './extensions/BlockActions'
```

```tsx
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      BlockActions,
      Callout,
      Passthrough,
      SlashCommand,
    ],
```

- [ ] **Step 11: Run the full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS (existing suite green; new tests green; strict TS clean).

- [ ] **Step 12: Commit**

```bash
git add apps/admin/package.json apps/admin/src/editor/block-reorder.ts apps/admin/src/editor/extensions/BlockActions.ts apps/admin/src/editor/Canvas.tsx apps/admin/test/block-reorder.test.tsx apps/admin/test/block-actions.test.tsx pnpm-lock.yaml
git commit -m "feat(editor): block move/duplicate/delete commands + Alt-Shift-arrow shortcuts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `DragHandle` plugin — hover grip + drag-to-reorder

**Files:**
- Create: `apps/admin/src/editor/extensions/DragHandle.tsx`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Test: `apps/admin/test/drag-handle.test.tsx`

**Context:** A ProseMirror plugin (via `addProseMirrorPlugins`, like `SlashCommand`) that renders one reusable grip element in the editor's left gutter, positions it against the top-level block under the pointer, and reorders via the shared `moveBlock` on drop. The grip exposes a callback the menu (Task 3) hooks into. Drag-and-drop over real HTML5 events is validated manually (`pnpm dev`); the automated test covers the index-mapping helper that translates a drop position into `moveBlock` indices (the logic most likely to be wrong), since `moveBlock` itself is already tested.

- [ ] **Step 1: Write the failing test for the drop-index helper**

Create `apps/admin/test/drag-handle.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { dropTargetIndex } from '../src/editor/extensions/DragHandle'

describe('dropTargetIndex', () => {
  // childTops: the document-relative Y of each top-level block's top edge; heights uniform 20px.
  const tops = [0, 20, 40] // 3 blocks at y=0,20,40, each 20 tall

  it('returns the block index when dropping over its top half', () => {
    expect(dropTargetIndex(tops, 20, 25)).toBe(1) // pointer y=25 → top half of block 1
  })

  it('returns the next index when dropping over the bottom half', () => {
    expect(dropTargetIndex(tops, 20, 35)).toBe(2) // bottom half of block 1 → insert after → index 2
  })

  it('clamps to the last index past the end', () => {
    expect(dropTargetIndex(tops, 20, 999)).toBe(2)
  })

  it('clamps to 0 before the start', () => {
    expect(dropTargetIndex(tops, 20, -50)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- drag-handle`
Expected: FAIL — `dropTargetIndex` is not exported.

- [ ] **Step 3: Implement `DragHandle`**

Create `apps/admin/src/editor/extensions/DragHandle.tsx`:

```tsx
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { moveBlock } from '../block-reorder'

export const dragHandleKey = new PluginKey('saytuDragHandle')

/** Given each top-level block's top Y (`tops`, uniform `height`) and a pointer Y,
 *  return the insertion index: the block under the top half, or the next index for
 *  the bottom half. Clamped to [0, tops.length - 1]. Pure — unit-tested. */
export function dropTargetIndex(tops: number[], height: number, y: number): number {
  if (tops.length === 0) return 0
  for (let i = 0; i < tops.length; i += 1) {
    const top = tops[i]!
    if (y < top + height / 2) return i
    if (y < top + height) return Math.min(i + 1, tops.length - 1)
  }
  return tops.length - 1
}

/** Index of the top-level block whose vertical span contains `y` (doc-relative). */
function blockIndexAtY(view: EditorView, clientY: number): number | null {
  const doc = view.state.doc
  let best: number | null = null
  let pos = 0
  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i)
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) {
        best = i
        break
      }
      if (clientY < rect.top && best === null) best = i
    }
    pos += node.nodeSize
  }
  return best
}

/** A grip in the left gutter that follows the hovered top-level block, drags to
 *  reorder, and opens the block menu (set via `onMenu`). */
export const DragHandle = Extension.create<{ onMenu?: (view: EditorView, index: number, anchor: HTMLElement) => void }>({
  name: 'saytuDragHandle',

  addOptions() {
    return { onMenu: undefined }
  },

  addProseMirrorPlugins() {
    const options = this.options
    let grip: HTMLElement | null = null
    let hoverIndex: number | null = null

    return [
      new Plugin({
        key: dragHandleKey,
        view(view) {
          grip = document.createElement('button')
          grip.type = 'button'
          grip.className = 'blk-grip'
          grip.setAttribute('aria-label', 'Block actions')
          grip.setAttribute('draggable', 'true')
          grip.textContent = '⋮⋮'
          grip.style.position = 'absolute'
          grip.style.display = 'none'
          view.dom.parentElement?.appendChild(grip)

          const openMenu = () => {
            if (hoverIndex !== null && grip) options.onMenu?.(view, hoverIndex, grip)
          }
          grip.addEventListener('click', openMenu)
          grip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openMenu()
            }
          })
          grip.addEventListener('dragstart', (e) => {
            if (hoverIndex === null) return
            e.dataTransfer?.setData('application/x-saytu-block', String(hoverIndex))
            e.dataTransfer!.effectAllowed = 'move'
          })

          return {
            destroy() {
              grip?.remove()
              grip = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              const index = blockIndexAtY(view, event.clientY)
              hoverIndex = index
              if (grip === null) return false
              if (index === null) {
                grip.style.display = 'none'
                return false
              }
              let pos = 0
              for (let i = 0; i < index; i += 1) pos += view.state.doc.child(i).nodeSize
              const dom = view.nodeDOM(pos)
              const parent = view.dom.parentElement
              if (dom instanceof HTMLElement && parent) {
                const r = dom.getBoundingClientRect()
                const pr = parent.getBoundingClientRect()
                grip.style.display = 'flex'
                grip.style.top = `${r.top - pr.top}px`
                grip.style.left = '0px'
              }
              return false
            },
            drop(view, event) {
              const raw = event.dataTransfer?.getData('application/x-saytu-block')
              if (raw === undefined || raw === '') return false
              const fromIndex = Number(raw)
              const tops: number[] = []
              let pos = 0
              let height = 20
              for (let i = 0; i < view.state.doc.childCount; i += 1) {
                const dom = view.nodeDOM(pos)
                if (dom instanceof HTMLElement) {
                  const r = dom.getBoundingClientRect()
                  tops.push(r.top)
                  height = r.height || height
                }
                pos += view.state.doc.child(i).nodeSize
              }
              let toIndex = dropTargetIndex(tops, height, event.clientY)
              if (toIndex > fromIndex) toIndex -= 1 // dropping below shifts the target slot up by one
              event.preventDefault()
              const tr = view.state.tr
              if (moveBlock(view.state.doc, tr, fromIndex, toIndex)) view.dispatch(tr)
              return true
            },
          },
        },
      }),
    ]
  },
})
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- drag-handle`
Expected: PASS (4 tests for `dropTargetIndex`).

- [ ] **Step 5: Register `DragHandle` in the Canvas (menu wired in Task 3)**

In `apps/admin/src/editor/Canvas.tsx` add the import and the extension. For now register it without `onMenu` (Task 3 supplies the handler):

```tsx
import { DragHandle } from './extensions/DragHandle'
```

```tsx
      BlockActions,
      DragHandle,
      Callout,
```

- [ ] **Step 6: Run the full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS. (Grip renders in the app; DnD verified manually in Step 7.)

- [ ] **Step 7: Manual smoke (reviewer)**

`pnpm dev` → hover a paragraph: a ⋮⋮ grip appears at its left; drag the grip onto another block to reorder. (Automated DnD is impractical in jsdom; the move math is covered by `moveBlock` + `dropTargetIndex` tests.)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/extensions/DragHandle.tsx apps/admin/src/editor/Canvas.tsx apps/admin/test/drag-handle.test.tsx
git commit -m "feat(editor): drag handle grip + drag-to-reorder (own plugin, no yjs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `BlockMenu` — the role=menu popover

**Files:**
- Create: `apps/admin/src/editor/extensions/BlockMenu.tsx`
- Modify: `apps/admin/src/editor/Canvas.tsx`
- Test: `apps/admin/test/block-menu.test.tsx`

**Context:** A self-contained React menu component, rendered + positioned with `tippy.js` (already a dep, same as `SlashCommand`). It takes the four actions and an `onClose`, renders `role="menu"` with `role="menuitem"` buttons, supports ↑/↓/Enter/Esc, and disables Move up at the first block / Move down at the last. Task 2's `DragHandle.onMenu` will mount it; this task builds + tests the component in isolation, then wires it into the Canvas.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/block-menu.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BlockMenu } from '../src/editor/extensions/BlockMenu'

afterEach(cleanup)

const actions = () => ({
  moveUp: vi.fn(),
  moveDown: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
})

describe('BlockMenu', () => {
  it('renders the four actions as a role=menu', () => {
    render(<BlockMenu actions={actions()} canMoveUp canMoveDown onClose={vi.fn()} />)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /move up/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /move down/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /duplicate/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()
  })

  it('invokes the action and closes on click', () => {
    const a = actions()
    const onClose = vi.fn()
    render(<BlockMenu actions={a} canMoveUp canMoveDown onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }))
    expect(a.duplicate).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables Move up at the first block and Move down at the last', () => {
    const a = actions()
    render(<BlockMenu actions={a} canMoveUp={false} canMoveDown onClose={vi.fn()} />)
    expect(screen.getByRole('menuitem', { name: /move up/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /move down/i })).not.toBeDisabled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<BlockMenu actions={actions()} canMoveUp canMoveDown onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- block-menu`
Expected: FAIL — `BlockMenu` is not exported.

- [ ] **Step 3: Implement `BlockMenu`**

Create `apps/admin/src/editor/extensions/BlockMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/Icon'

export interface BlockMenuActions {
  moveUp: () => void
  moveDown: () => void
  duplicate: () => void
  remove: () => void
}

interface Item {
  key: keyof BlockMenuActions
  label: string
  icon: IconName
  disabled?: boolean
}

export function BlockMenu({
  actions,
  canMoveUp,
  canMoveDown,
  onClose,
}: {
  actions: BlockMenuActions
  canMoveUp: boolean
  canMoveDown: boolean
  onClose: () => void
}) {
  const items: Item[] = [
    { key: 'moveUp', label: 'Move up', icon: 'chevUp', disabled: !canMoveUp },
    { key: 'moveDown', label: 'Move down', icon: 'chevDown', disabled: !canMoveDown },
    { key: 'duplicate', label: 'Duplicate', icon: 'copy' },
    { key: 'remove', label: 'Delete', icon: 'trash' },
  ]
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const run = (item: Item) => {
    if (item.disabled) return
    actions[item.key]()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i + items.length - 1) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) run(item)
    }
  }

  return (
    <div ref={ref} className="blk-menu" role="menu" aria-label="Block actions" tabIndex={-1} onKeyDown={onKeyDown}>
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`blk-menu-item${i === active ? ' sel' : ''}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => run(item)}
        >
          <Icon name={item.icon} size={15} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
```

> **Icon check (verified against `src/ui/Icon.tsx`):** `chevDown`, `copy`, `trash` already exist; **`chevUp` does NOT** — add it to the `ICONS` map in `apps/admin/src/ui/Icon.tsx` (mirroring `chevDown: 'm6 9 6 6 6-6'`), so the `IconName` union includes it and the menu typechecks:
>
> ```ts
>   chevUp: '<path d="m6 15 6-6 6 6"/>',
> ```
>
> Don't invent any other `IconName` — the union is `keyof typeof ICONS`.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- block-menu`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the menu into the Canvas via `DragHandle.onMenu`**

In `apps/admin/src/editor/Canvas.tsx`, mount the menu with `tippy` when the grip requests it. Replace the bare `DragHandle` registration with a configured one. Add imports:

```tsx
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import type { Instance as TippyInstance } from 'tippy.js'
import type { EditorView } from '@tiptap/pm/view'
import { BlockMenu } from './extensions/BlockMenu'
```

Inside `Canvas`, before `useEditor`, define the handler and configure the extension:

```tsx
  const dragHandle = DragHandle.configure({
    onMenu: (view: EditorView, index: number, anchor: HTMLElement) => {
      let popup: TippyInstance[] = []
      const close = () => {
        popup[0]?.destroy()
        renderer.destroy()
      }
      const sel = view.state.tr // capture current doc for can-move flags
      const renderer = new ReactRenderer(BlockMenu, {
        editor: editorRef.current!,
        props: {
          canMoveUp: index > 0,
          canMoveDown: index < view.state.doc.childCount - 1,
          onClose: close,
          actions: {
            moveUp: () => editorRef.current?.commands.moveBlockUp(),
            moveDown: () => editorRef.current?.commands.moveBlockDown(),
            duplicate: () => editorRef.current?.commands.duplicateBlock(),
            remove: () => editorRef.current?.commands.deleteBlock(),
          },
        },
      })
      void sel
      popup = tippy('body', {
        getReferenceClientRect: () => anchor.getBoundingClientRect(),
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        onHidden: close,
      })
    },
  })
```

**Important wiring detail:** the menu's actions call `editorRef.current.commands.*`, which act on the editor's *current selection*. Before opening the menu, the grip must place the selection inside its block so the command targets the right block. In `DragHandle`'s `openMenu` (Task 2), before calling `options.onMenu`, set the selection to the hovered block's start:

```tsx
          const openMenu = () => {
            if (hoverIndex === null || grip === null) return
            let pos = 0
            for (let i = 0; i < hoverIndex; i += 1) pos += view.state.doc.child(i).nodeSize
            const tr = view.state.tr
            tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1)))
            view.dispatch(tr)
            options.onMenu?.(view, hoverIndex, grip)
          }
```

(Add `import { TextSelection } from '@tiptap/pm/state'` to `DragHandle.tsx`.)

Hold the editor in a ref so the handler can reach it. Add near the top of `Canvas`:

```tsx
  const editorRef = useRef<Editor | null>(null)
```

(import `useRef` from `react` and `Editor` type from `@tiptap/core`), set `editorRef.current = editor` after `useEditor`, and replace `DragHandle` with `dragHandle` in the extensions array.

- [ ] **Step 6: Run the full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS.

- [ ] **Step 7: Manual smoke (reviewer)**

`pnpm dev` → click the grip → the menu opens; Move up/down/Duplicate/Delete act on that block; Move up is disabled on the first block; Esc closes.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/editor/extensions/BlockMenu.tsx apps/admin/src/editor/extensions/DragHandle.tsx apps/admin/src/editor/Canvas.tsx apps/admin/src/ui/Icon.tsx apps/admin/test/block-menu.test.tsx
git commit -m "feat(editor): block actions menu (role=menu) on the drag-handle grip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Callout title↔body keyboard navigation

**Files:**
- Modify: `apps/admin/src/editor/extensions/Callout.tsx`
- Test: `apps/admin/test/callout-keyboard.test.tsx`

**Context:** Today the callout title `<input>` calls `e.stopPropagation()` on every keydown, trapping the keyboard there. `CalloutView` gets `editor` and `getPos` from `ReactNodeViewProps`. We move into the body on ↓/Enter and back to the title on ↑ at body start.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/test/callout-keyboard.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { Callout } from '../src/editor/extensions/Callout'

afterEach(cleanup)

function Harness({ onReady }: { onReady: (e: Editor) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Callout],
    content: {
      type: 'doc',
      content: [
        { type: 'callout', attrs: { mdAttrs: { type: 'info' } }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] },
      ],
    },
  })
  if (editor) onReady(editor)
  return <EditorContent editor={editor} />
}

describe('Callout title↔body keyboard nav', () => {
  it('ArrowDown in the title moves the selection into the callout body', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    title.focus()
    fireEvent.keyDown(title, { key: 'ArrowDown' })
    // selection now sits inside the callout body (depth >= 2: doc > callout > paragraph)
    expect(editor.state.selection.$from.depth).toBeGreaterThanOrEqual(2)
    expect(editor.isFocused).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- callout-keyboard`
Expected: FAIL — ArrowDown is swallowed by `stopPropagation`; selection stays out of the body.

- [ ] **Step 3: Implement the title↔body nav in `Callout.tsx`**

In `apps/admin/src/editor/extensions/Callout.tsx`, update `CalloutView` to use `editor` + `getPos` and move focus into the body. Change the function signature destructure and the title input's `onKeyDown`:

```tsx
function CalloutView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
```

Replace the title `<input>`'s `onKeyDown`:

```tsx
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault()
              const pos = getPos()
              if (typeof pos === 'number') {
                // pos = position of the callout node; +1 enters its first child (body)
                editor.chain().focus().setTextSelection(pos + 2).run()
              }
              return
            }
            e.stopPropagation()
          }}
```

> `pos + 2`: `pos` is just before the callout; `pos + 1` is inside the callout (before its first child); `+1` more enters the first paragraph's text. If a test shows the caret landing one position off, adjust by ±1 — the assertion is "selection depth is inside the body," not an exact offset.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- callout-keyboard`
Expected: PASS.

- [ ] **Step 5: Add body→title (ArrowUp at body start) — failing test**

Append to `apps/admin/test/callout-keyboard.test.tsx`:

```tsx
  it('ArrowUp at the start of the body refocuses the title input', async () => {
    let editor!: Editor
    render(<Harness onReady={(e) => (editor = e)} />)
    const title = await screen.findByPlaceholderText(/add a title/i)
    // put the caret at the very start of the body paragraph
    editor.chain().focus().setTextSelection(2).run()
    fireEvent.keyDown(editor.view.dom, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(title)
  })
```

- [ ] **Step 6: Run it — verify it fails**

Run: `pnpm --filter @setu/admin test -- callout-keyboard`
Expected: FAIL — ArrowUp at body start does nothing.

- [ ] **Step 7: Implement body→title**

In `CalloutView`, give the title input a ref and add an ArrowUp handler on the body via `NodeViewContent`'s wrapper. Add a ref:

```tsx
  const titleRef = useRef<HTMLInputElement>(null)
```

(import `useRef` from `react`), attach `ref={titleRef}` to the title `<input>`, and wrap the body to catch ArrowUp at its start:

```tsx
      <NodeViewContent
        className="callout-body"
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key !== 'ArrowUp') return
          const sel = editor.state.selection
          const pos = getPos()
          if (typeof pos !== 'number') return
          // body starts at pos + 2; if the caret is at/just inside the body start, go to the title
          if (sel.empty && sel.$from.parentOffset === 0 && sel.from <= pos + 2) {
            e.preventDefault()
            titleRef.current?.focus()
          }
        }}
      />
```

- [ ] **Step 8: Run it — verify it passes**

Run: `pnpm --filter @setu/admin test -- callout-keyboard`
Expected: PASS (both tests).

- [ ] **Step 9: Full admin suite + typecheck**

Run: `pnpm --filter @setu/admin test && pnpm --filter @setu/admin typecheck`
Expected: PASS (existing callout-node test still green).

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/editor/extensions/Callout.tsx apps/admin/test/callout-keyboard.test.tsx
git commit -m "feat(editor): callout title<->body keyboard navigation (a11y)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CSS — grip, drop affordance, block menu

**Files:**
- Modify: `apps/admin/src/styles/editor.css`

- [ ] **Step 1: Add the styles**

Append to `apps/admin/src/styles/editor.css` (match the existing token usage — `var(--surface)`, `var(--border)`, `var(--r-md)`, `var(--text)`, `var(--font-ui)`, `var(--shadow-pop)` — already used elsewhere in this file):

```css
/* Block drag handle (gutter grip) */
.blk-grip {
  position: absolute;
  z-index: 20;
  width: 22px;
  height: 24px;
  margin-left: -28px;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: grab;
  border: none;
  background: transparent;
  color: var(--text-subtle, #9aa0a6);
  border-radius: var(--r-sm, 6px);
  font-size: 14px;
  line-height: 1;
  user-select: none;
}
.blk-grip:hover { background: var(--surface-2, #f1f3f5); color: var(--text); }
.blk-grip:active { cursor: grabbing; }
.blk-grip:focus-visible { outline: 2px solid var(--accent-ring); }

/* Block actions menu */
.blk-menu {
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 5px;
  background: var(--surface);
  border: 1px solid var(--border-strong, var(--border));
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  font-family: var(--font-ui);
}
.blk-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border: none;
  background: transparent;
  border-radius: var(--r-sm, 6px);
  font: inherit;
  font-size: 14px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.blk-menu-item.sel,
.blk-menu-item:hover:not(:disabled) { background: var(--surface-2, #f1f3f5); }
.blk-menu-item:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: Build to confirm CSS + bundle are healthy**

Run: `pnpm --filter @setu/admin build`
Expected: build succeeds; CSS emitted; brand fonts intact; bundle has **no yjs** (`grep -c yjs dist/assets/*.js` → 0).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/styles/editor.css
git commit -m "style(editor): drag-handle grip + block menu CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification

- [ ] **Step 1: Whole suite**

Run: `pnpm -r test`
Expected: every package green; admin gains the new block-reorder / block-actions / drag-handle / block-menu / callout-keyboard tests.

- [ ] **Step 2: Typecheck (incl. core edge guard)**

Run: `pnpm -r typecheck`
Expected: PASS; `verbatimModuleSyntax` + `noUncheckedIndexedAccess` clean.

- [ ] **Step 3: Build — fonts + jiti-free + no yjs**

Run: `pnpm --filter @setu/admin build`
Then: `grep -c "yjs" apps/admin/dist/assets/*.js` → expect `0`; brand fonts still linked in `dist/index.html`.

- [ ] **Step 4: Manual smoke (reviewer)** — `pnpm dev`: hover→grip; drag→reorder; grip menu Move/Duplicate/Delete (edges disabled); Alt+Shift+↑/↓ moves the current block; callout ↓/Enter goes title→body, ↑ at body start returns to the title; read-only mode (a locked entry) shows no grip.

---

## Self-Review Notes (author)

- **Spec coverage:** BlockActions verbs + shortcuts → Task 1; drag grip + reorder → Task 2; role=menu actions + a11y → Task 3; callout title↔body → Task 4; CSS → Task 5; suite/build/no-yjs → Task 6. Format bubble menu, nested reordering, new block types — correctly absent (deferred).
- **Tiptap-first:** verbs are `addCommands`/`command()`/`insertContentAt`; locating blocks uses resolved positions/NodePos; raw PM only inside the drag plugin (`addProseMirrorPlugins`) and the shared `moveBlock`. `@tiptap/pm` declared (MIT, 3.26.1, verified on npm). No yjs/collaboration.
- **Content-safety:** every verb rearranges/clones/removes existing nodes; round-trip asserted via `tiptapToMarkdoc(getJSON())` equality in Task 1.
- **Risk flagged honestly:** raw HTML5 DnD isn't unit-tested (jsdom limitation); the error-prone math is isolated in `moveBlock` + `dropTargetIndex`, both unit-tested, with DnD verified manually. Selection-placement offsets (`pos + 2`, the move `setSelection` lines) are cosmetic and may need ±1 tuning at implementation — noted inline so a worker adjusts without changing asserted behavior.
- **Type consistency:** `moveBlock(doc, tr, fromIndex, toIndex)`, `dropTargetIndex(tops, height, y)`, `BlockMenuActions {moveUp,moveDown,duplicate,remove}`, command names `moveBlockUp/moveBlockDown/duplicateBlock/deleteBlock` — used identically across tasks.
- **Icon dependency (verified):** `chevDown`, `copy`, `trash`, `grip` exist in `Icon.tsx`; the only missing one is `chevUp`, which Task 3 adds explicitly (with the exact SVG). No invented `IconName`s.
```
