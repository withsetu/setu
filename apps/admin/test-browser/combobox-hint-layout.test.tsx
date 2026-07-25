import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Combobox } from '../src/ui/Combobox'
// The WHOLE admin stylesheet, not just components.css: Tailwind's preflight resets `p`
// margins, and the toolbar's own layout classes live here too. An earlier version of this
// file imported components.css alone and mounted into a plain block `<div>` — which is
// exactly why it passed while the combobox WAS 4px too tall in the real app (PR #925's
// visual failure). The environment a layout test renders in is part of the assertion.
import '../src/index.css'

// ---------------------------------------------------------------------------------
// The dropdown must hang off the INPUT, not off the whole combobox (#914).
// `.combo-list` is `position: absolute; top: calc(100% + 4px)`, so whatever box it
// resolves against decides where it lands. That box used to be `.combo`, whose height
// grew by the hint line the moment a hint was shown — so the first caller to show a
// hint AND items at once would get a dropdown floating a line and a half below the
// input, with a visible gap over the content it covers.
//
// This is the jsdom-blind class: jsdom has no layout, so every getBoundingClientRect
// here is zeros and an offset dropdown passes. Real chromium computes real rects.
// Kill-shot verified: moving `position: relative` back to `.combo` fails the
// hint-and-items case below by roughly the hint's height.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

/** The real toolbar shape: `.combo` as a direct flex item.
 *  Copied from apps/admin/src/screens/content-list/ListToolbar.tsx's wrapper — BulkBar
 *  uses the same `flex flex-wrap items-center gap-2`. This matters for more than realism:
 *  a flex item establishes an independent formatting context, so a child's margin cannot
 *  collapse out of it the way it does in a block parent. */
const TOOLBAR = 'flex flex-wrap items-center gap-2'

function mount(hint?: string, layout: 'flex' | 'block' = 'flex') {
  const { container } = render(
    <div
      className={layout === 'flex' ? TOOLBAR : undefined}
      style={{ width: 260, padding: 40 }}
    >
      <Combobox
        value="re"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        items={[{ value: 'react' }, { value: 'redux' }]}
        ariaLabel="Test combo"
        hint={hint}
      />
    </div>
  )
  const input = container.querySelector('.combo-input')
  input?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  return container
}

/** Height of the combobox wrapper minus the height of its input — i.e. everything the
 *  always-mounted hint region costs the surrounding layout. */
function overhead(container: Element): number {
  const combo = container.querySelector('.combo')!.getBoundingClientRect()
  const input = container.querySelector('.combo-input')!.getBoundingClientRect()
  return combo.height - input.height
}

/** Wait for the dropdown to exist AND for its `popIn` entry animation to finish.
 *  `.combo-list` animates in over 0.12s (components.css); measuring mid-flight reads the
 *  animated transform, not the resting position, which is a flake — and a misleading one,
 *  since the numbers land near the value under test. */
async function openedList(container: Element): Promise<Element> {
  let list: Element | null = null
  await vi.waitFor(() => {
    list = container.querySelector('.combo-list')
    expect(list).toBeTruthy()
  })
  await Promise.all(list!.getAnimations().map((a) => a.finished))
  return list!
}

/** Vertical gap between the bottom of the input and the top of the settled dropdown. */
function gap(container: Element, list: Element): number {
  const input = container.querySelector('.combo-input')!.getBoundingClientRect()
  return list.getBoundingClientRect().top - input.bottom
}

describe('Combobox dropdown position', () => {
  it('sits just under the input with no hint', async () => {
    const container = mount()
    expect(gap(container, await openedList(container))).toBeCloseTo(4, 0)
  })

  it('sits in the SAME place when a hint is shown alongside the items', async () => {
    const container = mount('Couldn’t load tag suggestions.')
    expect(gap(container, await openedList(container))).toBeCloseTo(4, 0)
  })

  // The always-mounted live region must cost the surrounding layout exactly nothing until
  // it has something to say. This is what PR #925 got wrong: the empty `<p>` kept its 4px
  // top margin, which collapses harmlessly out of a block parent but CANNOT escape a flex
  // item — so every real toolbar grew 4px and the content-list visual baseline failed.
  // `.combo-hint:empty { margin: 0 }` in components.css is what makes it zero; deleting
  // that rule fails the flex case below (kill-shot verified: 4px overhead).
  it('adds no vertical space while the hint is empty, even as a flex item', () => {
    expect(overhead(mount(undefined, 'flex'))).toBeCloseTo(0, 0)
  })

  it('adds no vertical space while the hint is empty in a block parent either', () => {
    // The weaker of the two cases, kept only to show the flex one is what has teeth:
    // margin collapse hides the defect here, so this passed against the broken CSS.
    expect(overhead(mount(undefined, 'block'))).toBeCloseTo(0, 0)
  })

  it('does grow once there is a hint to show', () => {
    expect(overhead(mount('Couldn’t load tag suggestions.'))).toBeGreaterThan(0)
  })
})
