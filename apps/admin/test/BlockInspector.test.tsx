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

  it('video: renders grouped controls with media pickers and playback switches', () => {
    render(
      <BlockInspector
        tag="video"
        mdAttrs={{ src: '/media/clip.mp4' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    // media pickers, not raw text boxes: a set src shows a player + Replace/Remove,
    // an empty poster shows the library button
    // root-relative srcs resolve against the media origin for display
    expect(
      document.querySelector('video[src$="/media/clip.mp4"]')
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Replace src' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'poster' })
    ).toHaveTextContent(/choose from library/i)
    // playback switches
    expect(screen.getByLabelText('controls')).toBeInTheDocument()
    expect(screen.getByLabelText('autoplay')).toBeInTheDocument()
    expect(screen.getByLabelText('muted')).toBeInTheDocument()
    expect(screen.getByLabelText('loop')).toBeInTheDocument()
  })

  it('video: muted is forced on + disabled with a hint while autoplay is on (forcedWhen)', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <BlockInspector
        tag="video"
        mdAttrs={{ src: '/media/clip.mp4' }}
        onChange={onChange}
        apiBase=""
      />
    )
    const muted = screen.getByLabelText<HTMLButtonElement>('muted')
    expect(muted).not.toBeDisabled()
    expect(muted).toHaveAttribute('data-state', 'unchecked')

    rerender(
      <BlockInspector
        tag="video"
        mdAttrs={{ src: '/media/clip.mp4', autoplay: true }}
        onChange={onChange}
        apiBase=""
      />
    )
    const forced = screen.getByLabelText<HTMLButtonElement>('muted')
    expect(forced).toBeDisabled()
    expect(forced).toHaveAttribute('data-state', 'checked') // forced value shown
    expect(screen.getByText(/autoplay requires muted/i)).toBeInTheDocument()
  })
})
