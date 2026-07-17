import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { SliderControl } from '../src/editor/controls/slider'
import type { ControlMeta } from '../src/editor/controls/types'

// ---------------------------------------------------------------------------------
// SliderControl range plumbing (#183): the control's bounds now come from the block
// contract (ControlMeta.min/max/step, lifted from the zod schema by resolveControls)
// instead of the hardcoded 1–6 tuned for the query block. Real-browser because the
// Radix Slider thumb is only a trustworthy role=slider in a real accessibility tree.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

const meta = (over: Partial<ControlMeta>): ControlMeta => ({
  name: 'height',
  apiBase: '',
  onPickMedia: () => {},
  ...over
})

describe('SliderControl (real browser)', () => {
  it('uses the contract range from meta (8–200) and shows the value readout', async () => {
    render(
      <SliderControl
        value={80}
        onChange={() => {}}
        meta={meta({ min: 8, max: 200, default: 48 })}
      />
    )
    const thumb = page.getByRole('slider')
    await expect.element(thumb).toHaveAttribute('aria-valuemin', '8')
    await expect.element(thumb).toHaveAttribute('aria-valuemax', '200')
    await expect.element(thumb).toHaveAttribute('aria-valuenow', '80')
    await expect.element(page.getByText('80')).toBeInTheDocument()
  })

  it('falls back to the query block legacy 1–6 range when meta carries no bounds', async () => {
    render(<SliderControl value={3} onChange={() => {}} meta={meta({})} />)
    const thumb = page.getByRole('slider')
    await expect.element(thumb).toHaveAttribute('aria-valuemin', '1')
    await expect.element(thumb).toHaveAttribute('aria-valuemax', '6')
  })

  it('keyboard steps write through onChange within the range', async () => {
    const onChange = vi.fn()
    render(
      <SliderControl
        value={200}
        onChange={onChange}
        meta={meta({ min: 8, max: 200 })}
      />
    )
    // Focus the thumb directly (a real click on a Radix track/thumb can itself emit a
    // position-derived value — that's pointer behavior, not what this test is about).
    const thumb = page.getByRole('slider')
    ;(thumb.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenCalledWith(199)
  })
})
