import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ShortcutsDialog } from '../src/editor/ShortcutsDialog'

afterEach(cleanup)

describe('ShortcutsDialog', () => {
  it('renders a dialog listing representative shortcuts', () => {
    render(<ShortcutsDialog onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
    expect(screen.getByText('Bold')).toBeInTheDocument()
    expect(screen.getByText('Add or edit link')).toBeInTheDocument()
    expect(screen.getByText('Move block up')).toBeInTheDocument()
  })
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('closes when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
