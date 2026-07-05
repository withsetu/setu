import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { Position9 } from '../src/editor/controls/position9'
import { SegmentedSelect } from '../src/editor/controls/segmented-select'
import { MediaControl } from '../src/editor/controls/media'
import type { ControlMeta, ControlProps } from '../src/editor/controls/types'

// ---------------------------------------------------------------------------------
// Control interactions (#293 target 3): one REAL round-trip per touched control
// type, driven by real click/focus in chromium. Position9 and SegmentedSelect's
// small-enum path already have thorough jsdom coverage (test/controls-position9.test.tsx,
// test/controls-segmented.test.tsx) via fireEvent — this file's job is the part those
// tests cannot reach: SegmentedSelect's >4-option fallback opens a REAL Radix Select
// portal (jsdom's fireEvent never actually opens it, per that test file's own comment
// "dropdown renders a combobox trigger" — it asserts the trigger exists, never drives
// it open), and real focus-follows-click/arrow-key behavior for Position9 (jsdom's
// document.activeElement tracking is unreliable for this).
// ---------------------------------------------------------------------------------

afterEach(cleanup)

const baseMeta: ControlMeta = {
  name: 'demo',
  apiBase: '',
  onPickMedia: () => {}
}

describe('Position9 (real browser)', () => {
  it('moves real DOM focus to the newly active cell after an arrow-key move', async () => {
    const onChange = vi.fn()
    render(<Position9 value="center" onChange={onChange} meta={baseMeta} />)
    const centerCell = page.getByRole('radio', { name: 'center', exact: true })
    await centerCell.click()
    await expect.element(centerCell).toBeInTheDocument()
    // Real keyboard input via the browser, not fireEvent.keyDown — moves focus for
    // real, which is exactly what jsdom cannot reliably assert (document.activeElement
    // tracking is not faithful there).
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('middle-right')
    const nextCell = page.getByRole('radio', { name: 'middle-right' })
    await expect.element(nextCell).toBeInTheDocument()
    expect(document.activeElement).toBe(nextCell.element())
  })
})

describe('SegmentedSelect (real browser)', () => {
  it('opens the real Radix Select portal for a >4-option enum and round-trips a pick', async () => {
    const onChange = vi.fn()
    const meta: ControlMeta = {
      ...baseMeta,
      name: 'layout',
      options: ['grid', 'list', 'masonry', 'carousel', 'timeline']
    }
    // Controlled harness, mirroring how BlockInspector actually drives every control:
    // onChange's new value flows back in as the next `value` prop (real Radix Select
    // is a controlled component — asserting the displayed trigger text after a pick
    // requires that real round-trip, not a static value prop).
    function Controlled(props: Omit<ControlProps, 'value' | 'onChange'>) {
      const [value, setValue] = useState('grid')
      return (
        <SegmentedSelect
          {...props}
          value={value}
          onChange={(v) => {
            onChange(v)
            setValue(v as string)
          }}
        />
      )
    }
    render(<Controlled meta={meta} />)

    // >4 options -> SelectControl (Radix Select), not ToggleGroup — confirmed by role,
    // not by absence-of-radio (which is all the jsdom test can assert).
    expect(page.getByRole('radio').elements().length).toBe(0)
    const trigger = page.getByRole('combobox', { name: 'layout' })
    await expect.element(trigger).toBeInTheDocument()

    await trigger.click()
    const option = page.getByRole('option', { name: 'carousel' })
    await expect.element(option).toBeInTheDocument()
    await option.click()

    expect(onChange).toHaveBeenCalledWith('carousel')
    await expect.element(trigger).toHaveTextContent('carousel')
  })

  it('renders a segmented ToggleGroup (not Select) for <=4 options, confirmed by real role', async () => {
    render(
      <SegmentedSelect
        value="a"
        onChange={vi.fn()}
        meta={{ ...baseMeta, name: 'size', options: ['a', 'b', 'c'] }}
      />
    )
    expect(page.getByRole('combobox').elements().length).toBe(0)
    await expect
      .element(page.getByRole('radio', { name: 'b' }))
      .toBeInTheDocument()
  })
})

describe('MediaControl (real browser)', () => {
  it('opens the picker for real on click when empty', async () => {
    const onPickMedia = vi.fn()
    render(
      <MediaControl
        value=""
        onChange={vi.fn()}
        meta={{ ...baseMeta, name: 'image', onPickMedia }}
      />
    )
    const button = page.getByRole('button', { name: 'image' })
    await expect.element(button).toBeInTheDocument()
    await button.click()
    expect(onPickMedia).toHaveBeenCalledWith('image')
  })

  it('reveals real hover-affordance Replace/Remove buttons for a populated value', async () => {
    const onChange = vi.fn()
    const onPickMedia = vi.fn()
    render(
      <MediaControl
        value="/media/2026/07/photo.jpg"
        onChange={onChange}
        meta={{ ...baseMeta, name: 'image', onPickMedia }}
      />
    )
    const replace = page.getByRole('button', { name: 'Replace image' })
    const remove = page.getByRole('button', { name: 'Remove image' })
    await expect.element(replace).toBeInTheDocument()
    await expect.element(remove).toBeInTheDocument()
    await remove.click()
    expect(onChange).toHaveBeenCalledWith('')
  })
})
