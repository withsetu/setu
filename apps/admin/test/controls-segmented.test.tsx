import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SegmentedSelect } from '../src/editor/controls/segmented-select'

const meta = (options: string[]) => ({
  name: 'layout',
  options,
  apiBase: '',
  onPickMedia: vi.fn()
})

describe('SegmentedSelect', () => {
  it('renders a segmented button per option for small enums and emits on click', () => {
    const onChange = vi.fn()
    render(
      <SegmentedSelect
        value="centered"
        onChange={onChange}
        meta={meta(['centered', 'split-left', 'background'])}
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: 'background' }))
    expect(onChange).toHaveBeenCalledWith('background')
  })

  it('falls back to a dropdown for long enums (>4)', () => {
    render(
      <SegmentedSelect
        value="a"
        onChange={vi.fn()}
        meta={meta(['a', 'b', 'c', 'd', 'e'])}
      />
    )
    // dropdown renders a combobox trigger, not 5 radios
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('renders segmented for exactly 4 options', () => {
    render(
      <SegmentedSelect
        value="a"
        onChange={vi.fn()}
        meta={meta(['a', 'b', 'c', 'd'])}
      />
    )
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('delegates to dropdown for 0 options', () => {
    render(<SegmentedSelect value="" onChange={vi.fn()} meta={meta([])} />)
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
