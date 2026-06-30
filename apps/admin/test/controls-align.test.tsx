import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlignControl } from '../src/editor/controls/align'

const meta = (options?: string[]) => ({ name: 'width', options, apiBase: '', onPickMedia: vi.fn() })

describe('AlignControl', () => {
  it('renders the provided options and emits on click', () => {
    const onChange = vi.fn()
    render(<AlignControl value="none" onChange={onChange} meta={meta(['none','wide','full'])} />)
    fireEvent.click(screen.getByRole('radio', { name: 'full' }))
    expect(onChange).toHaveBeenCalledWith('full')
  })

  it('defaults to none/wide/full when options absent', () => {
    render(<AlignControl value="none" onChange={vi.fn()} meta={meta()} />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })
})
