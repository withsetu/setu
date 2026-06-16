import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LinkPopup } from '../src/editor/LinkPopup'

afterEach(cleanup)

describe('LinkPopup', () => {
  it('renders the href as an Open link to a new tab', () => {
    render(<LinkPopup href="https://x.com" onEdit={vi.fn()} onRemove={vi.fn()} editable />)
    const open = screen.getByRole('link', { name: /open/i })
    expect(open).toHaveAttribute('href', 'https://x.com')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows Edit/Remove when editable and calls them', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    render(<LinkPopup href="https://x.com" onEdit={onEdit} onRemove={onRemove} editable />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('hides Edit/Remove when not editable (read-only) but keeps Open', () => {
    render(<LinkPopup href="https://x.com" onEdit={vi.fn()} onRemove={vi.fn()} editable={false} />)
    expect(screen.getByRole('link', { name: /open/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
})
