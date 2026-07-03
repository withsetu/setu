import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockInspector } from '../src/editor/BlockInspector'

describe('BlockInspector', () => {
  it('renders a control per hero prop and writes edits via onChange', () => {
    const onChange = vi.fn()
    render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'centered' }}
        onChange={onChange}
        apiBase=""
      />
    )
    const headline = screen.getByLabelText<HTMLInputElement>('headline')
    expect(headline.value).toBe('Hi')
    fireEvent.change(headline, { target: { value: 'Welcome' } })
    expect(onChange).toHaveBeenCalledWith('headline', 'Welcome')
    // textarea for subhead, select for layout present
    expect(screen.getByLabelText('subhead').tagName.toLowerCase()).toBe(
      'textarea'
    )
    expect(screen.getByLabelText('layout')).toBeInTheDocument()
  })

  it('renders an unknown tag as an empty inspector (no crash)', () => {
    render(
      <BlockInspector
        tag="does-not-exist"
        mdAttrs={{}}
        onChange={() => {}}
        apiBase=""
      />
    )
    expect(
      screen.getByText(/no editable properties|select a block/i)
    ).toBeInTheDocument()
  })

  it('renders a color control and hides showWhen-gated controls', async () => {
    // hero declares overlayColor:'color' + parallax gated to layout==='background'
    const { rerender } = render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ layout: 'centered' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    expect(screen.queryByLabelText('overlayColor')).toBeNull() // hidden on centered
    rerender(
      <BlockInspector
        tag="hero"
        mdAttrs={{ layout: 'background' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    expect(screen.getByLabelText('overlayColor')).toBeInTheDocument() // shown on background
  })
})
