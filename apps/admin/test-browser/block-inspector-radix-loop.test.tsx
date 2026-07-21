import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { z } from 'zod'
import { createSetuBlock } from '../src/editor/extensions/SetuBlock'
import { NotificationProvider } from '../src/ui/notify'
import { BlockInspector } from '../src/editor/BlockInspector'
import { useSelectedBlock } from '../src/editor/useSelectedBlock'
import { registry } from '../src/blocks/registry'
import { blockCores } from '@setu/blocks'

// ---------------------------------------------------------------------------------
// Regression for the historical Radix-in-canvas update-loop bug (issue #293,
// commit c36cf02 "fix(admin): guard useSelectedBlock against render loop on block
// select"). Commit message, verbatim: "selectedBlockOf returns a fresh object each
// call; setSel fired on every editor transaction. Once the inspector's Radix
// children mounted on selection, the render<->transaction churn became an
// unbounded 'Maximum update depth exceeded' loop that blanked the editor."
//
// Mechanism: useSelectedBlock.ts subscribes to the editor's `transaction` and
// `selectionUpdate` events and calls `setSel` on every fire. Radix's mounted
// children (Select's Portal, ToggleGroup) do their own focus/measurement work that
// produces MORE no-op-shaped editor transactions while the rail is open — without
// a reference-equality guard, each one yields a brand-new SelectedBlock object,
// forcing React to re-render the rail, which lets Radix react again, which
// produces more transactions: an unbounded feedback loop. The fix
// (`sameBlock`, useSelectedBlock.ts:55-59) makes `setSel` a no-op unless the
// selected block's pos/tag/mdAttrs actually changed.
//
// An existing jsdom test (test/selected-block-rail.test.tsx) already asserts the
// GUARD's pure logic via `renderHook` + 3 manually-dispatched no-op transactions —
// but it never mounts BlockInspector, never mounts a real Radix Select, and jsdom
// doesn't run Portal-driven focus/measurement effects the way a real browser does.
// This test covers that gap: BlockInspector's REAL Radix Select (portal-rendered,
// via a >4-option `select` control — the exact SegmentedSelect fallback path,
// segmented-select.tsx) mounted against a REAL Tiptap editor in real chromium,
// driven by real clicks, under the SAME no-op-transaction storm the jsdom test
// uses as its churn proxy (the shape Radix's own effects produce in the app) — and
// asserts the render count stays BOUNDED, not unbounded, exactly the property that
// would have caught this bug and regresses if the guard is ever removed/weakened.
// ---------------------------------------------------------------------------------

// A synthetic block with a 5-option `select` control — deliberately forces
// SegmentedSelect's fallback to the Radix `Select` primitive (segmented-select.tsx:
// <=4 options -> ToggleGroup, >4 -> SelectControl / Radix Select + Portal). None of
// the real repo-root blocks/*/block.ts happen to declare a >4-option enum today, so
// this fixture is added to the live registry singleton for the duration of this
// file only (restored in afterAll) — the exact shape BlockInspector resolves for
// any real block, not a stand-in component.
const RADIX_LOOP_TAG = 'radix-loop-fixture'
let restoreRegistry: (() => void) | null = null

beforeAll(() => {
  if (registry.blocksByTag.has(RADIX_LOOP_TAG)) return
  // A real zod enum with 5 options: resolveControls derives `select` automatically
  // for any zod enum (ENUM_HINTS path in resolve-controls.ts).
  const entry = {
    tag: RADIX_LOOP_TAG,
    props: z.object({
      variant: z
        .enum(['alpha', 'bravo', 'charlie', 'delta', 'echo'])
        .default('alpha')
    }),
    component: 'test-fixture',
    editor: {
      label: 'Radix loop fixture',
      icon: 'zap' as const,
      group: 'text' as const,
      controls: { variant: 'select' as const }
    }
  }
  registry.blocks.push(entry)
  registry.blocksByTag.set(RADIX_LOOP_TAG, entry)
  registry.knownBlockTags.add(RADIX_LOOP_TAG)
  restoreRegistry = () => {
    const idx = registry.blocks.indexOf(entry)
    if (idx >= 0) registry.blocks.splice(idx, 1)
    registry.blocksByTag.delete(RADIX_LOOP_TAG)
    registry.knownBlockTags.delete(RADIX_LOOP_TAG)
  }
})

afterAll(() => {
  restoreRegistry?.()
})

afterEach(cleanup)

let renderCount = 0

function Harness() {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, createSetuBlock(registry.blocks, blockCores)],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        {
          type: 'setuBlock',
          attrs: { tag: RADIX_LOOP_TAG, mdAttrs: { variant: 'delta' } },
          content: [{ type: 'paragraph' }]
        }
      ]
    }
  })
  // Test-only escape hatch: expose the live editor instance so the test can dispatch
  // the no-op-transaction storm directly against ProseMirror, the same mechanism
  // Radix's own mounted-child effects use in the app (see file header comment).
  ;(
    window as unknown as { __setuTestEditor?: Editor | null }
  ).__setuTestEditor = editor
  return <InspectorRail editor={editor} />
}

function InspectorRail({ editor }: { editor: Editor | null }) {
  renderCount += 1
  const selected = useSelectedBlock(editor)
  return (
    <div>
      <EditorContent editor={editor} />
      {selected ? (
        <aside data-testid="inspector-rail">
          <BlockInspector
            tag={selected.tag}
            mdAttrs={selected.mdAttrs}
            onChange={selected.update}
            apiBase=""
          />
        </aside>
      ) : (
        <div data-testid="no-selection" />
      )}
    </div>
  )
}

describe('BlockInspector against a real editor — Radix update-loop regression', () => {
  it('mounts a real Radix Select in the rail and survives a no-op transaction storm without an unbounded re-render loop', async () => {
    const consoleErrors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '))
      originalError(...args)
    }

    renderCount = 0
    const { unmount } = render(
      <NotificationProvider>
        <Harness />
      </NotificationProvider>
    )

    // Select the fixture block by clicking its real rendered node view — the path a
    // user actually takes, not a synthetic ProseMirror selection dispatch.
    const block = page.getByText('Radix loop fixture')
    await expect.element(block).toBeInTheDocument()
    await userEvent.click(block)

    const rail = page.getByTestId('inspector-rail')
    await expect.element(rail).toBeInTheDocument()

    // The real Radix Select (portal-rendered SelectContent, mounted to document.body)
    // — confirm it's really there and drive one real open/select/close cycle before
    // the storm, proving this exercises Radix's actual DOM, not a stand-in.
    const trigger = page.getByRole('combobox', { name: 'variant' })
    await expect.element(trigger).toBeInTheDocument()
    await userEvent.click(trigger)
    const firstOption = page.getByRole('option', { name: 'echo' })
    await expect.element(firstOption).toBeInTheDocument()
    await userEvent.click(firstOption)
    await expect.element(trigger).toHaveTextContent('echo')

    // Grab the live editor instance to fire the SAME no-op-transaction shape the
    // jsdom test uses as its churn proxy (test/selected-block-rail.test.tsx) — the
    // documented stand-in for whatever real focus/measurement side effects Radix's
    // mounted children produce while this rail is open. Firing it here, with the
    // REAL BlockInspector + REAL Radix Select mounted in a REAL browser, is exactly
    // the gap the jsdom test (hook-only, no Radix DOM) cannot cover.
    const editor = (window as unknown as { __setuTestEditor?: Editor })
      .__setuTestEditor
    if (!editor) throw new Error('test editor was not exposed on window')

    const STORM_SIZE = 30
    const before = renderCount
    for (let i = 0; i < STORM_SIZE; i += 1) {
      editor.view.dispatch(editor.state.tr.setMeta('noop', i))
      // yield a task so React's commit phase (and any Radix effect it triggers)
      // actually runs between dispatches, matching how a real transaction storm
      // interleaves with paint/effects rather than batching into one commit.
      await new Promise((r) => setTimeout(r, 0))
    }
    const after = renderCount

    console.error = originalError
    unmount()

    // The bug's signature: an unguarded no-op transaction re-renders on EVERY fire
    // (1:1 with STORM_SIZE, i.e. ~30 extra renders here — confirmed by temporarily
    // reverting the sameBlock guard while writing this test, see task report). With
    // the guard, React's eager bailout on an unchanged SelectedBlock reference keeps
    // the rail from re-rendering AT ALL for no-op transactions — the count stays
    // flat regardless of storm size. A generous bound (well under 1:1 with
    // STORM_SIZE) distinguishes "guard present" from "guard removed/broken" without
    // being brittle to incidental React scheduling renders.
    // ARCHITECTURE ASSUMPTION (final-review note): this render-count proxy relies on
    // the rail re-rendering through useSelectedBlock's React state. If selection state
    // ever moves out of that hook (a different re-render strategy), re-verify this test
    // still goes RED against a removed guard — don't trust a silent green through that
    // refactor.
    expect(after - before).toBeLessThan(STORM_SIZE / 2)
    expect(
      consoleErrors.some((e) => /Maximum update depth exceeded/.test(e))
    ).toBe(false)
  })
})
