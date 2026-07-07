import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeaturedImageField } from '../src/editor/FeaturedImageField'

// Stub the picker so the field's open→pick wiring is deterministic and network-free.
vi.mock('../src/editor/MediaPickerModal', () => ({
  MediaPickerModal: ({
    open,
    onPick
  }: {
    open: boolean
    onPick: (s: string) => void
  }) =>
    open ? (
      <button type="button" onClick={() => onPick('/media/2026/06/hero.jpg')}>
        mock-pick
      </button>
    ) : null
}))

const base = 'http://localhost:4444'

describe('FeaturedImageField', () => {
  it('shows a "Set featured image" button when empty', () => {
    render(<FeaturedImageField onChange={() => {}} editable apiBase={base} />)
    expect(
      screen.getByRole('button', { name: 'Set featured image' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('opening the picker and picking calls onChange with the /media src', () => {
    const onChange = vi.fn()
    render(<FeaturedImageField onChange={onChange} editable apiBase={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set featured image' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-pick' }))
    expect(onChange).toHaveBeenCalledWith('/media/2026/06/hero.jpg')
  })

  it('with a value shows a resolved preview and a Remove that clears it', () => {
    const onChange = vi.fn()
    render(
      <FeaturedImageField
        value="/media/2026/06/hero.jpg"
        onChange={onChange}
        editable
        apiBase={base}
      />
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute(
      'src',
      'http://localhost:4444/media/2026/06/hero.jpg'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('hides Change/Remove controls when not editable', () => {
    render(
      <FeaturedImageField
        value="/media/2026/06/hero.jpg"
        onChange={() => {}}
        editable={false}
        apiBase={base}
      />
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
  })
})
