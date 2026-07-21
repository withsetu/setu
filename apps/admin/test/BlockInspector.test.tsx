import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationProvider } from '../src/ui/notify'
import { BlockInspector } from '../src/editor/BlockInspector'

// BlockInspector mounts MediaPickerModal, which calls useNotify() (#756) — every
// render must sit under a NotificationProvider.
const wrapper = NotificationProvider

describe('BlockInspector', () => {
  it('renders a control per hero prop and writes edits via onChange', () => {
    const onChange = vi.fn()
    render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'centered' }}
        onChange={onChange}
        apiBase=""
      />,
      { wrapper }
    )
    const headline = screen.getByLabelText<HTMLInputElement>('headline')
    expect(headline.value).toBe('Hi')
    fireEvent.change(headline, { target: { value: 'Welcome' } })
    expect(onChange).toHaveBeenCalledWith('headline', 'Welcome')
    // textarea for subhead, segmented toggle group for layout present. The layout
    // control is a toggle group named by the visible "Layout" label (aria-labelledby).
    expect(screen.getByLabelText('subhead').tagName.toLowerCase()).toBe(
      'textarea'
    )
    expect(screen.getByLabelText('Layout')).toBeInTheDocument()
  })

  it('renders an unknown tag as an empty inspector (no crash)', () => {
    render(
      <BlockInspector
        tag="does-not-exist"
        mdAttrs={{}}
        onChange={() => {}}
        apiBase=""
      />,
      { wrapper }
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
      />,
      { wrapper }
    )
    expect(screen.queryByLabelText('Overlay Color')).toBeNull() // hidden on centered
    rerender(
      <BlockInspector
        tag="hero"
        mdAttrs={{ layout: 'background' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    expect(screen.getByLabelText('Overlay Color')).toBeInTheDocument() // shown on background
  })

  it('video: renders grouped controls with media pickers and playback switches', () => {
    render(
      <BlockInspector
        tag="video"
        mdAttrs={{ src: '/media/clip.mp4' }}
        onChange={() => {}}
        apiBase=""
      />,
      { wrapper }
    )
    // media pickers, not raw text boxes: a set src shows a player + Replace/Remove,
    // an empty poster shows the library button
    // root-relative srcs resolve against the media origin for display
    expect(document.querySelector('video[src$="/media/clip.mp4"]')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Replace src' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'poster' })).toHaveTextContent(
      /choose from library/i
    )
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
      />,
      { wrapper }
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

  it('video: empty src also accepts a pasted video-file URL (Enter commits)', () => {
    const onChange = vi.fn()
    render(
      <BlockInspector
        tag="video"
        mdAttrs={{}}
        onChange={onChange}
        apiBase=""
      />,
      { wrapper }
    )
    const url = screen.getByLabelText<HTMLInputElement>('Video file URL')
    fireEvent.change(url, {
      target: { value: 'https://cdn.example.test/clip.mp4' }
    })
    fireEvent.keyDown(url, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(
      'src',
      'https://cdn.example.test/clip.mp4'
    )
    // a non-URL never commits
    onChange.mockClear()
    fireEvent.change(url, { target: { value: 'not a url' } })
    fireEvent.keyDown(url, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
