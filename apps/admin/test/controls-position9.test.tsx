import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Position9 } from '../src/editor/controls/position9'

const meta = { name: 'textPosition', apiBase: '', onPickMedia: vi.fn() }

describe('Position9', () => {
  it('renders 9 cells and emits the clicked position', () => {
    const onChange = vi.fn()
    render(<Position9 value="center" onChange={onChange} meta={meta} />)
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    fireEvent.click(screen.getByRole('radio', { name: 'bottom-right' }))
    expect(onChange).toHaveBeenCalledWith('bottom-right')
  })

  it('marks the active cell', () => {
    render(<Position9 value="top-left" onChange={vi.fn()} meta={meta} />)
    expect(screen.getByRole('radio', { name: 'top-left' })).toHaveAttribute('aria-checked', 'true')
  })
})
