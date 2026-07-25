import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Combobox } from '../src/ui/Combobox'
import '../src/styles/components.css'

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

function mount(hint?: string) {
  const { container } = render(
    <div style={{ width: 260, padding: 40 }}>
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

/** Vertical gap between the bottom of the input and the top of the dropdown. */
function gap(container: Element): number {
  const input = container.querySelector('.combo-input')!.getBoundingClientRect()
  const list = container.querySelector('.combo-list')
  if (list === null) throw new Error('dropdown did not open')
  return list.getBoundingClientRect().top - input.bottom
}

describe('Combobox dropdown position', () => {
  it('sits just under the input with no hint', async () => {
    const container = mount()
    await vi.waitFor(() =>
      expect(container.querySelector('.combo-list')).toBeTruthy()
    )
    expect(gap(container)).toBeCloseTo(4, 0)
  })

  it('sits in the SAME place when a hint is shown alongside the items', async () => {
    const container = mount('Couldn’t load tag suggestions.')
    await vi.waitFor(() =>
      expect(container.querySelector('.combo-list')).toBeTruthy()
    )
    expect(gap(container)).toBeCloseTo(4, 0)
  })

  it('adds no vertical space while the hint is empty', () => {
    // The always-mounted live region must cost exactly nothing until it has something to
    // say: the combobox is no taller than its input. Today that falls out of margin
    // collapse through `.combo` — kill-shot verified by giving `.combo` a 1px
    // padding-bottom, which stops the collapse and fails this assertion.
    const container = mount()
    const combo = container.querySelector('.combo')!.getBoundingClientRect()
    const input = container
      .querySelector('.combo-input')!
      .getBoundingClientRect()
    expect(combo.height).toBeCloseTo(input.height, 0)
  })

  it('does grow once there is a hint to show', () => {
    const container = mount('Couldn’t load tag suggestions.')
    const combo = container.querySelector('.combo')!.getBoundingClientRect()
    const input = container
      .querySelector('.combo-input')!
      .getBoundingClientRect()
    expect(combo.height).toBeGreaterThan(input.height)
  })
})
