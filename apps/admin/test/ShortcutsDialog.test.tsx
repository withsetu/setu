import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ShortcutsDialog } from '../src/editor/ShortcutsDialog'

afterEach(cleanup)

describe('ShortcutsDialog (shadcn Dialog, controlled open prop)', () => {
  it('renders title and shortcut rows when open=true', () => {
    render(<ShortcutsDialog open={true} onClose={vi.fn()} />)
    // The DialogTitle renders "Keyboard shortcuts" as an h2
    expect(
      screen.getByRole('heading', { name: 'Keyboard shortcuts' })
    ).toBeInTheDocument()
    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.getByText('Add or edit link')).toBeInTheDocument()
    expect(screen.getByText('Move block up')).toBeInTheDocument()
  })

  it('does not render dialog content when open=false', () => {
    render(<ShortcutsDialog open={false} onClose={vi.fn()} />)
    expect(
      screen.queryByRole('heading', { name: 'Keyboard shortcuts' })
    ).toBeNull()
    expect(screen.queryByText('Bold')).toBeNull()
  })

  it('calls onClose when the dialog is dismissed', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog open={true} onClose={onClose} />)
    // The shadcn DialogContent includes a built-in close button (XIcon, sr-only "Close")
    const closeBtn = screen.getByRole('button', { name: /close/i })
    closeBtn.click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('lists block-type shortcuts (Heading 2, Quote) when open', () => {
    render(<ShortcutsDialog open={true} onClose={() => {}} />)
    expect(screen.getByText('Heading 2')).toBeInTheDocument()
    expect(screen.getByText('Quote')).toBeInTheDocument()
  })
})
