import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockInspector } from '../src/editor/BlockInspector'

describe('BlockInspector', () => {
  it('renders a control per hero prop and writes edits via onChange', () => {
    const onChange = vi.fn()
    render(<BlockInspector tag="hero" mdAttrs={{ headline: 'Hi', variant: 'center' }} onChange={onChange} apiBase="" />)
    const headline = screen.getByLabelText('headline') as HTMLInputElement
    expect(headline.value).toBe('Hi')
    fireEvent.change(headline, { target: { value: 'Welcome' } })
    expect(onChange).toHaveBeenCalledWith('headline', 'Welcome')
    // textarea for subhead, select for variant present
    expect(screen.getByLabelText('subhead').tagName.toLowerCase()).toBe('textarea')
    expect(screen.getByLabelText('variant')).toBeInTheDocument()
  })

  it('renders an unknown tag as an empty inspector (no crash)', () => {
    render(<BlockInspector tag="does-not-exist" mdAttrs={{}} onChange={() => {}} apiBase="" />)
    expect(screen.getByText(/no editable properties|select a block/i)).toBeInTheDocument()
  })
})
